// POST /api/edit — re-prompt a single element with the element-editor model.
//
// Flow:
//   1. Validate { siteId, elementId, prompt } (zod).
//   2. Load Site + Theme + Home Page + target Element (by selectorId).
//   3. Call editElement() with current HTML + instruction + palette/typography.
//   4. Persist new HTML on the Element, re-assemble Page.pageHtml from all
//      elements in orderIdx order, return { html }.
//
// Runtime: nodejs. Anthropic SDK needs Node APIs.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db/client';
import { enforceRateLimit } from '@/server/rateLimit';
import { editElement } from '@/server/ai/editor';
import type { SitePlan } from '@/server/ai/architect';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const EditBody = z.object({
  siteId: z.string().min(1),
  elementId: z.string().min(1),
  prompt: z.string().min(3).max(4000),
});

type Palette = SitePlan['palette'];

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function assembleHtml(
  siteName: string,
  palette: Palette,
  typography: { displayFont: string; bodyFont: string },
  sections: { html: string }[],
): string {
  const sectionHtml = sections.map((s) => s.html).join('\n');
  const { displayFont, bodyFont } = typography;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(siteName)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=${encodeURIComponent(displayFont)}:wght@400;600;700&family=${encodeURIComponent(bodyFont)}:wght@400;500;600&display=swap" rel="stylesheet">
<style>
:root {
  --c-primary: ${palette.primary};
  --c-secondary: ${palette.secondary};
  --c-accent: ${palette.accent};
  --c-ink: ${palette.ink};
  --c-surface: ${palette.surface};
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

function isPalette(value: unknown): value is Palette {
  if (!value || typeof value !== 'object') return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p.primary === 'string' &&
    typeof p.secondary === 'string' &&
    typeof p.accent === 'string' &&
    typeof p.ink === 'string' &&
    typeof p.surface === 'string'
  );
}

export async function POST(req: NextRequest) {
  const limited = enforceRateLimit(req, 'ai');
  if (limited) return limited;

  let body: z.infer<typeof EditBody>;
  try {
    const raw = (await req.json()) as unknown;
    body = EditBody.parse(raw);
  } catch (err) {
    const message =
      err instanceof z.ZodError
        ? err.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ')
        : 'Invalid JSON body';
    return NextResponse.json({ error: message }, { status: 400 });
  }

  try {
    const site = await prisma.site.findUnique({ where: { id: body.siteId } });
    if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 });

    const theme = await prisma.theme.findUnique({ where: { siteId: body.siteId } });
    if (!theme) return NextResponse.json({ error: 'Theme not found' }, { status: 404 });

    const page = await prisma.page.findUnique({
      where: { siteId_slug: { siteId: body.siteId, slug: 'home' } },
    });
    if (!page) return NextResponse.json({ error: 'Page not found' }, { status: 404 });

    const element = await prisma.element.findUnique({
      where: { pageId_selectorId: { pageId: page.id, selectorId: body.elementId } },
    });
    if (!element) return NextResponse.json({ error: 'Element not found' }, { status: 404 });

    let palette: Palette;
    try {
      const parsed: unknown = JSON.parse(theme.paletteJson || '{}');
      if (!isPalette(parsed)) {
        return NextResponse.json({ error: 'Theme palette is malformed' }, { status: 500 });
      }
      palette = parsed;
    } catch {
      return NextResponse.json({ error: 'Theme palette is malformed' }, { status: 500 });
    }

    const typography = {
      displayFont: theme.primaryFont,
      bodyFont: theme.secondaryFont,
    };

    let newHtml: string;
    try {
      newHtml = await editElement({
        currentHtml: element.html,
        userInstruction: body.prompt,
        palette,
        typography,
      });
    } catch (err) {
      console.error('[api/edit] editElement failed', err);
      return NextResponse.json({ error: 'Edit failed' }, { status: 502 });
    }

    if (typeof newHtml !== 'string' || newHtml.trim().length === 0) {
      return NextResponse.json({ error: 'Editor returned empty HTML' }, { status: 502 });
    }

    await prisma.element.update({
      where: { id: element.id },
      data: { html: newHtml, lastEditedAt: new Date() },
    });

    const allElements = await prisma.element.findMany({
      where: { pageId: page.id },
      orderBy: { orderIdx: 'asc' },
    });

    const fullHtml = assembleHtml(
      site.name,
      palette,
      typography,
      allElements.map((e) => ({ html: e.html })),
    );
    await prisma.page.update({
      where: { id: page.id },
      data: { pageHtml: fullHtml },
    });

    return NextResponse.json({ html: newHtml });
  } catch (err) {
    console.error('[api/edit] unexpected error', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
