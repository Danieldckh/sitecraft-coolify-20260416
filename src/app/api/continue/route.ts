// POST /api/continue — SSE stream that resumes an interrupted build from
// the next unfinished section.
//
// Flow:
//   1. Rate-limit ("ai" bucket, same as /api/build).
//   2. Validate { siteId } (zod).
//   3. Load the Site + its saved planJson. 400 if missing.
//   4. Parse planJson into SitePlan. 400 on malformed JSON.
//   5. Load every Page and its Elements; derive:
//        - completed: every (pageSlug, sectionId) already persisted
//        - priorSectionsByPage: per-page, Element.html[] ordered by orderIdx
//   6. Open the SSE stream. Emit `siteId` first, then iterate
//      buildSiteResume(). Persist each new section exactly like /api/build
//      does (inject ids → upsert Element → rebuild pageHtml → update Page).
//   7. Support `req.signal` abort for graceful client disconnects.
//
// Runtime: nodejs (long-lived SSE + Anthropic calls).

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db/client';
import { enforceRateLimit } from '@/server/rateLimit';
import {
  buildSiteResume,
  type BuildEvent,
  type CompletedSectionKey,
} from '@/server/ai/orchestrator';
import type { SitePlan } from '@/server/ai/architect';
import { injectElementIds } from '@/server/html/augment';
import { assemblePageHtml } from '@/server/html/template';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ContinueBody = z.object({
  siteId: z.string().min(1).max(200),
});

// Small SSE helper — formats a single event frame.
function sseFrame(event: string, data: unknown): string {
  const payload = typeof data === 'string' ? data : JSON.stringify(data);
  return `event: ${event}\ndata: ${payload}\n\n`;
}

/**
 * Redact any `sk-…` tokens that may have surfaced in an error message
 * before it leaves the server.
 */
function redactSecrets(s: string): string {
  return s.replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]');
}

interface PageAssembly {
  pageId: string;
  plan: SitePlan['pages'][number];
  /** All sections known for this page so far, keyed by section id. */
  sections: Map<string, string>;
}

export async function POST(req: NextRequest) {
  const limited = enforceRateLimit(req, 'ai');
  if (limited) return limited;

  let siteId: string;
  try {
    const raw = (await req.json()) as unknown;
    const parsed = ContinueBody.parse(raw);
    siteId = parsed.siteId;
  } catch (err) {
    const message =
      err instanceof z.ZodError
        ? err.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ')
        : 'Invalid JSON body';
    return NextResponse.json({ error: message }, { status: 400 });
  }

  // Load the site + plan. If either is missing there's nothing to resume.
  let site: { id: string; planJson: string } | null;
  try {
    site = await prisma.site.findUnique({
      where: { id: siteId },
      select: { id: true, planJson: true },
    });
  } catch (err) {
    console.error('[api/continue] failed to load site', err);
    return NextResponse.json({ error: 'Failed to load site' }, { status: 500 });
  }
  if (!site || !site.planJson || site.planJson.trim().length === 0) {
    return NextResponse.json(
      { error: 'No saved plan — nothing to resume' },
      { status: 400 },
    );
  }

  // Parse the persisted plan. If it's corrupt we can't trust anything else,
  // so we bail early with a clean 400.
  let plan: SitePlan;
  try {
    plan = JSON.parse(site.planJson) as SitePlan;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[api/continue] malformed planJson', message);
    return NextResponse.json(
      { error: 'Saved plan is corrupt' },
      { status: 400 },
    );
  }

  // Gather every Page and its already-persisted Elements. We need both the
  // completed-section keys (to tell the orchestrator what to skip) AND the
  // HTML content of those sections (so the Designer keeps cohesion on pages
  // that resume mid-way).
  let pageRows: {
    id: string;
    slug: string;
    elements: { selectorId: string; html: string; orderIdx: number }[];
  }[];
  try {
    pageRows = await prisma.page.findMany({
      where: { siteId },
      select: {
        id: true,
        slug: true,
        elements: {
          select: { selectorId: true, html: true, orderIdx: true },
          orderBy: { orderIdx: 'asc' },
        },
      },
    });
  } catch (err) {
    console.error('[api/continue] failed to load pages/elements', err);
    return NextResponse.json(
      { error: 'Failed to load existing pages' },
      { status: 500 },
    );
  }

  const pageIdBySlug = new Map<string, string>();
  const completed: CompletedSectionKey[] = [];
  const priorSectionsByPage: Record<string, string[]> = {};
  for (const pr of pageRows) {
    pageIdBySlug.set(pr.slug, pr.id);
    priorSectionsByPage[pr.slug] = pr.elements.map((e) => e.html);
    for (const el of pr.elements) {
      completed.push({ pageSlug: pr.slug, sectionId: el.selectorId });
    }
  }

  const encoder = new TextEncoder();
  const abortController = new AbortController();
  req.signal.addEventListener('abort', () => abortController.abort(), { once: true });

  // Seed per-page assembly state from what's already on disk so the first
  // newly-designed section on each page re-assembles the full page correctly
  // (not just the new section in isolation).
  const pages = new Map<string, PageAssembly>();
  for (const p of plan.pages) {
    const pageId = pageIdBySlug.get(p.slug);
    if (!pageId) {
      // A plan page with no DB row. This shouldn't happen because /api/build
      // upserts all Page rows up-front, but stay defensive.
      continue;
    }
    const existing = pageRows.find((pr) => pr.slug === p.slug);
    const sections = new Map<string, string>();
    if (existing) {
      for (const el of existing.elements) {
        sections.set(el.selectorId, el.html);
      }
    }
    pages.set(p.slug, { pageId, plan: p, sections });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enqueue = (event: string, data: unknown): void => {
        try {
          controller.enqueue(encoder.encode(sseFrame(event, data)));
        } catch {
          // Controller already closed — ignore.
        }
      };

      // Anchor the client to the same siteId so its SSE consumer behaves
      // identically to the original /api/build stream.
      enqueue('siteId', { siteId });

      try {
        const generator = buildSiteResume({
          plan,
          priorSectionsByPage,
          completed,
        });

        for await (const evt of generator as AsyncGenerator<BuildEvent>) {
          if (abortController.signal.aborted) {
            try {
              await generator.return?.(undefined);
            } catch {
              /* ignore */
            }
            break;
          }

          if (evt.type === 'plan') {
            // Don't re-persist plan/theme/pages — they're already in the DB
            // from the original /api/build run. Just relay the event so the
            // client UI can re-populate its tab state.
            enqueue('plan', evt.plan);
            continue;
          }

          if (evt.type === 'section') {
            const page = pages.get(evt.pageSlug);
            if (!page) {
              console.error(
                `[api/continue] section event references unknown pageSlug "${evt.pageSlug}"`,
              );
              enqueue('error', {
                message: `Unknown pageSlug "${evt.pageSlug}"`,
              });
              controller.close();
              return;
            }

            const augmentedHtml = injectElementIds(evt.html, evt.id);

            try {
              page.sections.set(evt.id, augmentedHtml);

              const orderIdx = page.plan.sections.findIndex(
                (s) => s.id === evt.id,
              );
              await prisma.element.upsert({
                where: {
                  pageId_selectorId: {
                    pageId: page.pageId,
                    selectorId: evt.id,
                  },
                },
                create: {
                  pageId: page.pageId,
                  selectorId: evt.id,
                  role: 'custom',
                  html: augmentedHtml,
                  orderIdx: orderIdx < 0 ? page.sections.size - 1 : orderIdx,
                },
                update: {
                  html: augmentedHtml,
                  orderIdx: orderIdx < 0 ? undefined : orderIdx,
                },
              });

              // Re-assemble this page's HTML from every section the DB now
              // holds, in the plan's declared section order. Missing slots
              // (not yet designed) are skipped.
              const orderedSections: { html: string }[] = [];
              for (const secPlan of page.plan.sections) {
                const h = page.sections.get(secPlan.id);
                if (h) orderedSections.push({ html: h });
              }
              const fullHtml = assemblePageHtml(plan, page.plan, orderedSections);
              await prisma.page.update({
                where: { id: page.pageId },
                data: { pageHtml: fullHtml },
              });
            } catch (err) {
              console.error('[api/continue] failed to persist section', err);
              enqueue('error', { message: 'Failed to persist section' });
              controller.close();
              return;
            }

            enqueue('section', {
              pageSlug: evt.pageSlug,
              id: evt.id,
              html: augmentedHtml,
            });
            continue;
          }

          if (evt.type === 'done') {
            enqueue('done', {});
            controller.close();
            return;
          }

          if (evt.type === 'error') {
            const safe = redactSecrets(evt.message);
            console.error('[api/continue] generator reported error:', safe);
            enqueue('error', { message: safe });
            controller.close();
            return;
          }
        }

        if (!abortController.signal.aborted) {
          enqueue('done', {});
        }
        controller.close();
      } catch (err) {
        const raw = err instanceof Error ? err.message : String(err);
        console.error('[api/continue] stream error', raw);
        enqueue('error', { message: redactSecrets('Resume failed') });
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
    cancel() {
      abortController.abort();
    },
  });

  return new NextResponse(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
