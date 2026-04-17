// POST /api/build — SSE stream that drives the multi-page Architect + Designer
// agent team.
//
// Flow:
//   1. Validate { prompt } (zod, 10 ≤ len ≤ 8000).
//   2. Create a pending Site row and immediately emit `event: siteId` so the
//      client can redirect to /site/[id] while generation is still running.
//   3. Stream events from `buildSite(prompt)`:
//        plan    -> persist Site.name, Theme, and ALL Page rows (one per
//                   plan.pages[]), then emit `event: plan`.
//        section -> `{ pageSlug, id, html }`
//                   -> inject element ids, upsert Element under the matching
//                      Page, re-assemble THAT page's pageHtml from its
//                      elements (ordered), emit `event: section`.
//        done    -> emit event: done, close.
//        error   -> emit event: error, close.
//   4. Client-abort (req.signal) tears the generator down cleanly.
//
// Runtime: nodejs (SSE + long-running Anthropic calls don't fit Edge).

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db/client';
import { enforceRateLimit } from '@/server/rateLimit';
import { buildSite, type BuildEvent } from '@/server/ai/orchestrator';
import type { SitePlan } from '@/server/ai/architect';
import { injectElementIds } from '@/server/html/augment';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BuildBody = z.object({
  prompt: z.string().min(10).max(8000),
});

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Assemble one page's full HTML document from its ordered section HTML.
 *
 * Nav links rendered by "header-nav"/"footer" sections use relative
 * `./{slug}` hrefs. In the in-iframe preview (`/preview/[id]/[slug]`) those
 * resolve to sibling pages at `/preview/[id]/{slug}`. The export route
 * rewrites them to `./{slug}.html` for the standalone zip.
 */
function assemblePageHtml(
  plan: SitePlan,
  currentPage: SitePlan['pages'][number],
  sections: { html: string }[],
): string {
  const sectionHtml = sections.map((s) => s.html).join('\n');
  const displayFont = plan.typography.displayFont;
  const bodyFont = plan.typography.bodyFont;
  const pageTitle =
    currentPage.slug === 'home'
      ? plan.siteName
      : `${currentPage.name} — ${plan.siteName}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(pageTitle)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=${encodeURIComponent(displayFont)}:wght@400;600;700&family=${encodeURIComponent(bodyFont)}:wght@400;500;600&display=swap" rel="stylesheet">
<style>
:root {
  --c-primary: ${plan.palette.primary};
  --c-secondary: ${plan.palette.secondary};
  --c-accent: ${plan.palette.accent};
  --c-ink: ${plan.palette.ink};
  --c-surface: ${plan.palette.surface};
  --f-display: "${displayFont}", serif;
  --f-body: "${bodyFont}", sans-serif;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: var(--c-surface); color: var(--c-ink); font-family: var(--f-body); }
h1, h2, h3, h4 { font-family: var(--f-display); margin: 0; }
img { max-width: 100%; display: block; }
a { color: inherit; }
</style>
</head>
<body>
${sectionHtml}
</body>
</html>`;
}

// Small SSE helper — formats a single event frame.
function sseFrame(event: string, data: unknown): string {
  const payload = typeof data === 'string' ? data : JSON.stringify(data);
  return `event: ${event}\ndata: ${payload}\n\n`;
}

/**
 * Snapshot of a page's in-flight assembly. We keep one of these per page
 * while the generator streams sections so we can re-build `Page.pageHtml`
 * in the correct section order without re-querying the DB on every tick.
 */
interface PageAssembly {
  pageId: string;
  plan: SitePlan['pages'][number];
  /** indexed by section id, slot order comes from the plan's section order */
  sections: Map<string, string>;
}

export async function POST(req: NextRequest) {
  const limited = enforceRateLimit(req, 'ai');
  if (limited) return limited;

  let prompt: string;
  try {
    const raw = (await req.json()) as unknown;
    const parsed = BuildBody.parse(raw);
    prompt = parsed.prompt;
  } catch (err) {
    const message =
      err instanceof z.ZodError
        ? err.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ')
        : 'Invalid JSON body';
    return NextResponse.json({ error: message }, { status: 400 });
  }

  // Create the pending Site row up-front so we can stream its id to the client
  // before the (slow) architect call kicks off.
  let siteId: string;
  try {
    const site = await prisma.site.create({
      data: {
        name: '(pending)',
        sitePrompt: prompt,
        stylePresetId: '',
      },
    });
    siteId = site.id;
  } catch (err) {
    console.error('[api/build] failed to create site row', err);
    return NextResponse.json({ error: 'Failed to start build' }, { status: 500 });
  }

  const encoder = new TextEncoder();
  const abortController = new AbortController();

  // If the client disconnects, propagate through our AbortController so the
  // generator (and any inflight Anthropic calls it owns) can wind down.
  req.signal.addEventListener('abort', () => abortController.abort(), { once: true });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enqueue = (event: string, data: unknown): void => {
        try {
          controller.enqueue(encoder.encode(sseFrame(event, data)));
        } catch {
          // Controller already closed — ignore.
        }
      };

      // Ship the siteId first so the UI can redirect immediately.
      enqueue('siteId', { siteId });

      let plan: SitePlan | null = null;
      // Per-page assembly state, keyed by page slug.
      const pages = new Map<string, PageAssembly>();

      try {
        const generator = buildSite(prompt);

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
            plan = evt.plan;
            try {
              await prisma.site.update({
                where: { id: siteId },
                data: { name: plan.siteName },
              });
              await prisma.theme.upsert({
                where: { siteId },
                create: {
                  siteId,
                  stylePresetId: '',
                  paletteJson: JSON.stringify(plan.palette),
                  primaryFont: plan.typography.displayFont,
                  secondaryFont: plan.typography.bodyFont,
                },
                update: {
                  paletteJson: JSON.stringify(plan.palette),
                  primaryFont: plan.typography.displayFont,
                  secondaryFont: plan.typography.bodyFont,
                },
              });

              // Upsert every Page row up-front (one per plan.pages[]) so the
              // preview route can redirect to the first page immediately.
              for (let i = 0; i < plan.pages.length; i += 1) {
                const p = plan.pages[i];
                const row = await prisma.page.upsert({
                  where: { siteId_slug: { siteId, slug: p.slug } },
                  create: {
                    siteId,
                    name: p.name,
                    slug: p.slug,
                    orderIdx: i,
                    navVisible: true,
                    pageHtml: '',
                  },
                  update: {
                    name: p.name,
                    orderIdx: i,
                    navVisible: true,
                  },
                });
                pages.set(p.slug, {
                  pageId: row.id,
                  plan: p,
                  sections: new Map<string, string>(),
                });
              }
            } catch (err) {
              console.error('[api/build] failed to persist plan', err);
              enqueue('error', { message: 'Failed to persist plan' });
              controller.close();
              return;
            }
            enqueue('plan', plan);
            continue;
          }

          if (evt.type === 'section') {
            if (!plan) {
              console.error('[api/build] section event arrived before plan');
              enqueue('error', { message: 'Section received before plan' });
              controller.close();
              return;
            }
            const page = pages.get(evt.pageSlug);
            if (!page) {
              console.error(
                `[api/build] section event references unknown pageSlug "${evt.pageSlug}"`,
              );
              enqueue('error', {
                message: `Unknown pageSlug "${evt.pageSlug}"`,
              });
              controller.close();
              return;
            }

            // ALWAYS inject element ids BEFORE persisting or emitting — the
            // augmented HTML is the source of truth downstream.
            const augmentedHtml = injectElementIds(evt.html, evt.id);

            try {
              page.sections.set(evt.id, augmentedHtml);

              // orderIdx = the section's slot in the plan (stable across
              // re-runs); sections that arrive "late" still land in the
              // correct visual order.
              const orderIdx = page.plan.sections.findIndex((s) => s.id === evt.id);
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

              // Re-assemble this page's HTML from all received sections, in
              // the plan's declared section order. Missing slots are skipped
              // until their designer finishes.
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
              console.error('[api/build] failed to persist section', err);
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
            console.error('[api/build] generator reported error:', evt.message);
            enqueue('error', { message: evt.message });
            controller.close();
            return;
          }
        }

        // Generator returned without emitting `done` (e.g. client abort).
        if (!abortController.signal.aborted) {
          enqueue('done', {});
        }
        controller.close();
      } catch (err) {
        console.error('[api/build] stream error', err);
        enqueue('error', { message: 'Build failed' });
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
