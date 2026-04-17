// POST /api/build — SSE stream that drives the Architect + Designer agent team.
//
// Flow:
//   1. Validate { prompt } (zod, min 10 chars).
//   2. Create a pending Site row and immediately emit `event: siteId` so the
//      client can redirect to /site/[id] while generation is still running.
//   3. Stream events from `buildSite(prompt)`:
//        plan    -> persist Theme + Home Page, emit event: plan
//        section -> upsert Element, rebuild Page.pageHtml, emit event: section
//        done    -> emit event: done, close
//        error   -> emit event: error, close
//   4. Client-abort (req.signal) tears the generator down cleanly.
//
// Runtime: nodejs (SSE + long-running Anthropic calls don't fit Edge).

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db/client';
import { enforceRateLimit } from '@/server/rateLimit';
import { buildSite, type BuildEvent } from '@/server/ai/orchestrator';
import type { SitePlan } from '@/server/ai/architect';

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

function assembleHtml(plan: SitePlan, sections: { id: string; html: string }[]): string {
  const sectionHtml = sections.map((s) => s.html).join('\n');
  const displayFont = plan.typography.displayFont;
  const bodyFont = plan.typography.bodyFont;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(plan.siteName)}</title>
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
      let pageId: string | null = null;
      const sections: { id: string; html: string }[] = [];

      try {
        const generator = buildSite(prompt);

        for await (const evt of generator as AsyncGenerator<BuildEvent>) {
          if (abortController.signal.aborted) {
            // Best-effort: ask the generator to wrap up. Most generators treat
            // `return()` as a cancel signal.
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
              const page = await prisma.page.upsert({
                where: { siteId_slug: { siteId, slug: 'home' } },
                create: {
                  siteId,
                  name: 'Home',
                  slug: 'home',
                  orderIdx: 0,
                  navVisible: true,
                  pageHtml: '',
                },
                update: {},
              });
              pageId = page.id;
            } catch (err) {
              console.error('[api/build] failed to persist plan', err);
              enqueue('error', { message: 'Failed to persist plan' });
              controller.close();
              return;
            }
            enqueue('plan', evt.plan);
            continue;
          }

          if (evt.type === 'section') {
            if (!plan || !pageId) {
              console.error('[api/build] section event arrived before plan');
              enqueue('error', { message: 'Section received before plan' });
              controller.close();
              return;
            }
            try {
              // Preserve insertion order in our in-memory array. If the same
              // id comes back twice (regen), replace rather than duplicate.
              const existingIdx = sections.findIndex((s) => s.id === evt.id);
              if (existingIdx >= 0) {
                sections[existingIdx] = { id: evt.id, html: evt.html };
              } else {
                sections.push({ id: evt.id, html: evt.html });
              }

              await prisma.element.upsert({
                where: { pageId_selectorId: { pageId, selectorId: evt.id } },
                create: {
                  pageId,
                  selectorId: evt.id,
                  role: 'custom',
                  html: evt.html,
                  orderIdx: sections.length - 1,
                },
                update: {
                  html: evt.html,
                },
              });

              const fullHtml = assembleHtml(plan, sections);
              await prisma.page.update({
                where: { id: pageId },
                data: { pageHtml: fullHtml },
              });
            } catch (err) {
              console.error('[api/build] failed to persist section', err);
              enqueue('error', { message: 'Failed to persist section' });
              controller.close();
              return;
            }
            enqueue('section', { id: evt.id, html: evt.html });
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
