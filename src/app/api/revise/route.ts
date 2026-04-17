// POST /api/revise — SSE stream for site-wide prompt edits.
//
// Flow:
//   1. Rate-limit ("ai" bucket).
//   2. Validate { siteId, prompt, attachmentUrls? }.
//   3. Classify the prompt: 'theme' vs 'structural'.
//   4. Theme path:
//        - Ask Haiku for updated palette + typography.
//        - Update the Theme row.
//        - For every Page: applyThemeUpdate(pageHtml, ...), save, emit `page`.
//        - If theme-apply misses its fingerprint on any page OR the palette
//          JSON is unparseable, we fall through to the structural path
//          silently.
//   5. Structural path:
//        - Load Site.planJson. 400 if missing.
//        - Append the user's instruction as a site-wide directive on each
//          page brief (in-memory only; not persisted).
//        - Delete every Element row for the site's pages + clear every
//          Page.pageHtml so buildSiteResume rebuilds all sections against
//          the new directive.
//        - Iterate buildSiteResume and persist/emit each section the same
//          way /api/build does.
//
// SSE events:
//   event: status         data: { message }
//   event: classification data: { mode: 'theme' | 'structural' }
//   event: page           data: { slug, pageHtml }
//   event: done           data: {}
//   event: error          data: { message }
//
// Runtime: nodejs. Like /api/build, we DO NOT tie the orchestrator's lifetime
// to req.signal — a navigate-away shouldn't kill an in-progress rebuild.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db/client';
import { enforceRateLimit } from '@/server/rateLimit';
import { anthropic, MODELS } from '@/server/ai/anthropic';
import { classifyPrompt, type ClassifiedMode } from '@/server/ai/classifier';
import {
  buildSiteResume,
  type BuildEvent,
} from '@/server/ai/orchestrator';
import type { SitePlan } from '@/server/ai/architect';
import { applyThemeUpdate } from '@/server/html/theme-apply';
import { injectElementIds } from '@/server/html/augment';
import { assemblePageHtml } from '@/server/html/template';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ReviseBody = z.object({
  siteId: z.string().min(1).max(200),
  prompt: z.string().min(3).max(8000),
  attachmentUrls: z.array(z.string().min(1).max(2000)).max(20).optional(),
});

function sseFrame(event: string, data: unknown): string {
  const payload = typeof data === 'string' ? data : JSON.stringify(data);
  return `event: ${event}\ndata: ${payload}\n\n`;
}

function redactSecrets(s: string): string {
  return s.replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]');
}

type Palette = SitePlan['palette'];
type Typography = SitePlan['typography'];

const HEX_RE = /^#[0-9a-fA-F]{3,8}$/;

interface ThemeUpdateJson {
  palette: Palette;
  typography: Typography;
}

/**
 * Ask Haiku for an updated palette + typography given the current values plus
 * the user's prompt + attachment URLs. Returns null on any parse / validation
 * failure so the caller can fall back to the structural path silently.
 */
async function requestThemeUpdate(
  current: { palette: Palette; typography: Typography },
  prompt: string,
  attachmentUrls: string[],
): Promise<ThemeUpdateJson | null> {
  const system = `You are a tasteful art director. Given the current palette and typography plus a user's change request, return a JSON object with the updated palette (5 hex colors: primary, secondary, accent, ink, surface) and typography (displayFont + bodyFont — Google Fonts family names). Only change what the user asked for; keep everything else. Output strict JSON, nothing else.

Output schema:
{
  "palette": { "primary": "#RRGGBB", "secondary": "#RRGGBB", "accent": "#RRGGBB", "ink": "#RRGGBB", "surface": "#RRGGBB" },
  "typography": { "displayFont": "Google Font family name", "bodyFont": "Google Font family name" }
}`;

  const userLines: string[] = [
    `Current palette: ${JSON.stringify(current.palette)}`,
    `Current typography: ${JSON.stringify(current.typography)}`,
    `User request: ${prompt}`,
  ];
  if (attachmentUrls.length > 0) {
    userLines.push(`Attached reference images: ${attachmentUrls.join(', ')}`);
  }
  userLines.push('Return ONLY the JSON object.');

  let rawText = '';
  try {
    const response = await anthropic.messages.create({
      model: MODELS.fast,
      max_tokens: 512,
      system,
      messages: [{ role: 'user', content: userLines.join('\n') }],
    });
    const firstBlock = response.content.find((b) => b.type === 'text');
    if (firstBlock && firstBlock.type === 'text') {
      rawText = firstBlock.text;
    }
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error('[api/revise] theme-update Haiku failed', redactSecrets(raw));
    return null;
  }

  // Carve out the JSON object if the model returned fenced or surrounding prose.
  let candidate = rawText.trim();
  const fenceMatch = candidate.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenceMatch && fenceMatch[1]) candidate = fenceMatch[1].trim();
  if (!candidate.startsWith('{')) {
    const first = candidate.indexOf('{');
    const last = candidate.lastIndexOf('}');
    if (first !== -1 && last !== -1 && last > first) {
      candidate = candidate.slice(first, last + 1);
    }
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  const pal = obj.palette as Record<string, unknown> | undefined;
  const typo = obj.typography as Record<string, unknown> | undefined;
  if (!pal || typeof pal !== 'object' || !typo || typeof typo !== 'object') {
    return null;
  }

  const keys: Array<keyof Palette> = ['primary', 'secondary', 'accent', 'ink', 'surface'];
  const palette: Partial<Palette> = {};
  for (const k of keys) {
    const v = pal[k];
    if (typeof v !== 'string' || !HEX_RE.test(v.trim())) return null;
    palette[k] = v.trim();
  }

  const displayFont = typeof typo.displayFont === 'string' ? typo.displayFont.trim() : '';
  const bodyFont = typeof typo.bodyFont === 'string' ? typo.bodyFont.trim() : '';
  if (displayFont.length === 0 || bodyFont.length === 0) return null;

  return {
    palette: palette as Palette,
    typography: { displayFont, bodyFont },
  };
}

export async function POST(req: NextRequest) {
  const limited = enforceRateLimit(req, 'ai');
  if (limited) return limited;

  let body: z.infer<typeof ReviseBody>;
  try {
    const raw = (await req.json()) as unknown;
    body = ReviseBody.parse(raw);
  } catch (err) {
    const message =
      err instanceof z.ZodError
        ? err.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ')
        : 'Invalid JSON body';
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const siteId = body.siteId;
  const userPrompt = body.prompt.trim();
  const attachmentUrls = body.attachmentUrls ?? [];

  // Load the site + theme + pages up front. We need all three regardless of
  // which branch (theme or structural) we take.
  let site: { id: string; planJson: string } | null;
  try {
    site = await prisma.site.findUnique({
      where: { id: siteId },
      select: { id: true, planJson: true },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[api/revise] failed to load site', err);
    return NextResponse.json({ error: 'Failed to load site' }, { status: 500 });
  }
  if (!site) {
    return NextResponse.json({ error: 'Site not found' }, { status: 404 });
  }

  const encoder = new TextEncoder();

  // Background execution — like /api/build, don't tie the orchestrator's life
  // to the client's request signal. If the user navigates away the updates
  // still persist to the DB.
  let clientConnected = true;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enqueue = (event: string, data: unknown): void => {
        if (!clientConnected) return;
        try {
          controller.enqueue(encoder.encode(sseFrame(event, data)));
        } catch {
          clientConnected = false;
        }
      };

      const closeSafely = (): void => {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      try {
        // --- Phase 1: classify -----------------------------------------------
        enqueue('status', { message: 'Classifying…' });
        let mode: ClassifiedMode = await classifyPrompt(userPrompt);
        enqueue('classification', { mode });

        // --- Phase 2a: theme path -------------------------------------------
        if (mode === 'theme') {
          enqueue('status', { message: 'Updating theme…' });

          const theme = await prisma.theme.findUnique({ where: { siteId } });
          if (!theme) {
            // eslint-disable-next-line no-console
            console.warn('[api/revise] theme row missing; falling through to structural.');
            mode = 'structural';
          } else {
            let currentPalette: Palette;
            try {
              const parsed = JSON.parse(theme.paletteJson || '{}') as Partial<Palette>;
              currentPalette = {
                primary: typeof parsed.primary === 'string' ? parsed.primary : '#17171a',
                secondary: typeof parsed.secondary === 'string' ? parsed.secondary : '#3a3a3f',
                accent: typeof parsed.accent === 'string' ? parsed.accent : '#c55a2a',
                ink: typeof parsed.ink === 'string' ? parsed.ink : '#17171a',
                surface: typeof parsed.surface === 'string' ? parsed.surface : '#faf8f4',
              };
            } catch {
              currentPalette = {
                primary: '#17171a',
                secondary: '#3a3a3f',
                accent: '#c55a2a',
                ink: '#17171a',
                surface: '#faf8f4',
              };
            }
            const currentTypography: Typography = {
              displayFont: theme.primaryFont || 'Fraunces',
              bodyFont: theme.secondaryFont || 'Inter',
            };

            const update = await requestThemeUpdate(
              { palette: currentPalette, typography: currentTypography },
              userPrompt,
              attachmentUrls,
            );

            if (!update) {
              // eslint-disable-next-line no-console
              console.warn(
                '[api/revise] theme-update Haiku returned unparseable JSON; falling through to structural.',
              );
              mode = 'structural';
            } else {
              // Persist new theme fields.
              try {
                await prisma.theme.update({
                  where: { siteId },
                  data: {
                    paletteJson: JSON.stringify(update.palette),
                    primaryFont: update.typography.displayFont,
                    secondaryFont: update.typography.bodyFont,
                  },
                });
              } catch (err) {
                // eslint-disable-next-line no-console
                console.error('[api/revise] failed to update Theme', err);
                enqueue('error', { message: 'Failed to update theme' });
                closeSafely();
                return;
              }

              // Apply to every page. If ANY page fails the fingerprint match
              // we take a conservative stance and fall through to structural
              // for this site (consistency matters more than speed).
              const pageRows = await prisma.page.findMany({
                where: { siteId },
                select: { id: true, slug: true, pageHtml: true },
                orderBy: { orderIdx: 'asc' },
              });

              let anyMissed = false;
              const updates: { slug: string; pageHtml: string; id: string }[] = [];
              for (const pg of pageRows) {
                if (!pg.pageHtml || pg.pageHtml.length === 0) {
                  // Empty pages (mid-build) have no fingerprint. Skip silently;
                  // they'll get the new theme next time they re-render.
                  continue;
                }
                const mutated = applyThemeUpdate(
                  pg.pageHtml,
                  update.palette,
                  update.typography,
                );
                if (mutated === pg.pageHtml) {
                  // applyThemeUpdate returns the original on missed regex.
                  // Best heuristic: if the content is non-empty AND didn't
                  // change at all, a regex probably missed.
                  anyMissed = true;
                  break;
                }
                updates.push({ slug: pg.slug, pageHtml: mutated, id: pg.id });
              }

              if (anyMissed) {
                // eslint-disable-next-line no-console
                console.warn(
                  '[api/revise] theme-apply fingerprint missed on at least one page; falling through to structural.',
                );
                mode = 'structural';
              } else {
                for (const u of updates) {
                  try {
                    await prisma.page.update({
                      where: { id: u.id },
                      data: { pageHtml: u.pageHtml },
                    });
                  } catch (err) {
                    // eslint-disable-next-line no-console
                    console.error('[api/revise] failed to save page', err);
                    enqueue('error', { message: 'Failed to save page' });
                    closeSafely();
                    return;
                  }
                  enqueue('page', { slug: u.slug, pageHtml: u.pageHtml });
                }
                enqueue('done', {});
                closeSafely();
                return;
              }
            }
          }
        }

        // --- Phase 2b: structural path --------------------------------------
        // (Either the classifier picked it directly, OR the theme path fell
        // through.)

        if (!site.planJson || site.planJson.trim().length === 0) {
          enqueue('error', { message: 'No saved plan — nothing to revise' });
          enqueue('done', {});
          closeSafely();
          return;
        }

        let plan: SitePlan;
        try {
          plan = JSON.parse(site.planJson) as SitePlan;
        } catch (err) {
          const raw = err instanceof Error ? err.message : String(err);
          // eslint-disable-next-line no-console
          console.error('[api/revise] malformed planJson', redactSecrets(raw));
          enqueue('error', { message: 'Saved plan is corrupt' });
          enqueue('done', {});
          closeSafely();
          return;
        }

        // Build an in-memory modified plan with the user's directive appended
        // to every page's brief. The directive is consistent across pages so
        // every Designer call sees the same site-wide instruction.
        const attachmentLine =
          attachmentUrls.length > 0
            ? `\nAttached reference images: ${attachmentUrls.join(', ')}.`
            : '';
        const directive = `\n\nApply this site-wide change across all sections: ${userPrompt}.${attachmentLine}`;
        const modifiedPlan: SitePlan = {
          ...plan,
          pages: plan.pages.map((p) => ({
            ...p,
            brief: `${p.brief}${directive}`,
            sections: p.sections.map((s) => ({ ...s })),
          })),
        };

        enqueue('status', { message: 'Rebuilding site…' });

        // Load page rows so we can (a) wipe Elements, (b) clear pageHtml, and
        // (c) map (pageSlug → pageId) for section upserts during the rebuild.
        const pageRows = await prisma.page.findMany({
          where: { siteId },
          select: { id: true, slug: true },
        });
        const pageIdBySlug = new Map<string, string>();
        for (const pr of pageRows) pageIdBySlug.set(pr.slug, pr.id);

        // Wipe every Element for every page under this site, then blank out
        // pageHtml so the preview route falls back to the not-ready placeholder
        // during the rebuild.
        try {
          const pageIds = pageRows.map((p) => p.id);
          if (pageIds.length > 0) {
            await prisma.element.deleteMany({
              where: { pageId: { in: pageIds } },
            });
            await prisma.page.updateMany({
              where: { id: { in: pageIds } },
              data: { pageHtml: '' },
            });
          }
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('[api/revise] failed to wipe elements/pageHtml', err);
          enqueue('error', { message: 'Failed to reset pages for rebuild' });
          closeSafely();
          return;
        }

        // Per-page assembly state, keyed by slug. Mirrors /api/build + /api/continue.
        interface PageAssembly {
          pageId: string;
          plan: SitePlan['pages'][number];
          sections: Map<string, string>;
        }
        const pages = new Map<string, PageAssembly>();
        for (const p of modifiedPlan.pages) {
          const pageId = pageIdBySlug.get(p.slug);
          if (!pageId) continue;
          pages.set(p.slug, { pageId, plan: p, sections: new Map<string, string>() });
        }

        // Run the resume generator with no completed sections so every section
        // on every page is re-designed against the new directive.
        const generator = buildSiteResume({
          plan: modifiedPlan,
          priorSectionsByPage: {},
          completed: [],
        });

        for await (const evt of generator as AsyncGenerator<BuildEvent>) {
          if (evt.type === 'plan') {
            // Don't re-persist the plan — the user hasn't changed the
            // page/section list. Just keep going.
            continue;
          }

          if (evt.type === 'section') {
            const page = pages.get(evt.pageSlug);
            if (!page) {
              // eslint-disable-next-line no-console
              console.error(
                `[api/revise] section references unknown pageSlug "${evt.pageSlug}"`,
              );
              enqueue('error', {
                message: `Unknown pageSlug "${evt.pageSlug}"`,
              });
              closeSafely();
              return;
            }

            const augmentedHtml = injectElementIds(evt.html, evt.id);

            try {
              page.sections.set(evt.id, augmentedHtml);

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

              // Re-assemble in plan order.
              const orderedSections: { html: string }[] = [];
              for (const secPlan of page.plan.sections) {
                const h = page.sections.get(secPlan.id);
                if (h) orderedSections.push({ html: h });
              }
              const fullHtml = assemblePageHtml(modifiedPlan, page.plan, orderedSections);
              await prisma.page.update({
                where: { id: page.pageId },
                data: { pageHtml: fullHtml },
              });

              enqueue('page', { slug: evt.pageSlug, pageHtml: fullHtml });
            } catch (err) {
              // eslint-disable-next-line no-console
              console.error('[api/revise] failed to persist section', err);
              enqueue('error', { message: 'Failed to persist section' });
              closeSafely();
              return;
            }
            continue;
          }

          if (evt.type === 'done') {
            enqueue('done', {});
            closeSafely();
            return;
          }

          if (evt.type === 'error') {
            const safe = redactSecrets(evt.message);
            // eslint-disable-next-line no-console
            console.error('[api/revise] generator reported error:', safe);
            enqueue('error', { message: safe });
            closeSafely();
            return;
          }
        }

        // Generator exhausted without a done event (shouldn't happen, but be safe).
        enqueue('done', {});
        closeSafely();
      } catch (err) {
        const raw = err instanceof Error ? err.message : String(err);
        const safe = redactSecrets(raw);
        // eslint-disable-next-line no-console
        console.error('[api/revise] stream error', safe);
        enqueue('error', { message: 'Revise failed' });
        closeSafely();
      }
    },
    cancel() {
      clientConnected = false;
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
