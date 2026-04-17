// POST /api/edit — re-prompt a single element on a specific page with the
// element-editor model.
//
// Flow:
//   1. Validate { siteId, pageSlug, elementId, prompt } (zod, prompt min 3).
//   2. Load Site, Theme, and the Page by (siteId, slug=pageSlug).
//   3. Find the element inside Page.pageHtml via findElementById(elementId).
//      404 if not found.
//   4. Call editElement() with current outerHTML + instruction + palette/typography.
//   5. Splice the replacement back into Page.pageHtml via the `replace` helper
//      and persist.
//   6. Respond with { html: newElementHtml }.
//
// Page.pageHtml is the source of truth after build completes — we do NOT
// mutate Element rows here. Those rows are just scratch state used during
// streaming assembly in /api/build.
//
// Runtime: nodejs. Anthropic SDK needs Node APIs.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db/client';
import { enforceRateLimit } from '@/server/rateLimit';
import { editElement } from '@/server/ai/editor';
import { findElementById } from '@/server/html/augment';
import type { SitePlan } from '@/server/ai/architect';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const EditBody = z.object({
  siteId: z.string().min(1),
  pageSlug: z.string().min(1),
  elementId: z.string().min(1),
  prompt: z.string().min(3).max(4000),
});

type Palette = SitePlan['palette'];

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
      where: { siteId_slug: { siteId: body.siteId, slug: body.pageSlug } },
    });
    if (!page) return NextResponse.json({ error: 'Page not found' }, { status: 404 });

    const fullHtml = page.pageHtml ?? '';
    if (!fullHtml.trim()) {
      return NextResponse.json({ error: 'Page is not built yet' }, { status: 409 });
    }

    const target = findElementById(fullHtml, body.elementId);
    if (!target) {
      return NextResponse.json({ error: 'Element not found' }, { status: 404 });
    }

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

    let newElementHtml: string;
    try {
      newElementHtml = await editElement({
        currentHtml: target.outerHtml,
        userInstruction: body.prompt,
        palette,
        typography,
      });
    } catch (err) {
      console.error('[api/edit] editElement failed', err);
      return NextResponse.json({ error: 'Edit failed' }, { status: 502 });
    }

    if (typeof newElementHtml !== 'string' || newElementHtml.trim().length === 0) {
      return NextResponse.json({ error: 'Editor returned empty HTML' }, { status: 502 });
    }

    const newPageHtml = target.replace(newElementHtml);

    await prisma.page.update({
      where: { id: page.id },
      data: { pageHtml: newPageHtml },
    });

    return NextResponse.json({ html: newElementHtml });
  } catch (err) {
    console.error('[api/edit] unexpected error', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
