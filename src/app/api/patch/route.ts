// POST /api/patch — direct DOM patch for trivial edits (text, href, img src,
// button text). Skips the Claude round-trip entirely.
//
// Flow:
//   1. Validate { siteId, pageSlug, elementId, op } via zod.
//   2. Load Page by (siteId, slug=pageSlug).
//   3. Call patchElement() on Page.pageHtml.
//   4. Persist the mutated pageHtml.
//   5. Respond with { html: newElementOuterHtml } so the inspector can
//      hot-swap the iframe without a full reload.
//
// Page.pageHtml is the source of truth. Element rows are scratch state from
// the build phase and are not touched here.
//
// Runtime: nodejs (cheerio needs Node APIs).

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db/client';
import { enforceRateLimit } from '@/server/rateLimit';
import { patchElement, type PatchOp } from '@/server/html/patch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PatchOpSchema: z.ZodType<PatchOp> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), value: z.string().max(10_000) }),
  z.object({ kind: z.literal('href'), value: z.string().max(2_000) }),
  z.object({ kind: z.literal('img-src'), value: z.string().max(2_000) }),
  z.object({ kind: z.literal('button-text'), value: z.string().max(2_000) }),
]);

const PatchBody = z.object({
  siteId: z.string().min(1),
  pageSlug: z.string().min(1),
  elementId: z.string().min(1),
  op: PatchOpSchema,
});

export async function POST(req: NextRequest) {
  const limited = enforceRateLimit(req, 'ai');
  if (limited) return limited;

  let body: z.infer<typeof PatchBody>;
  try {
    const raw = (await req.json()) as unknown;
    body = PatchBody.parse(raw);
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

    const page = await prisma.page.findUnique({
      where: { siteId_slug: { siteId: body.siteId, slug: body.pageSlug } },
    });
    if (!page) return NextResponse.json({ error: 'Page not found' }, { status: 404 });

    const fullHtml = page.pageHtml ?? '';
    if (!fullHtml.trim()) {
      return NextResponse.json({ error: 'Page is not built yet' }, { status: 409 });
    }

    const result = patchElement(fullHtml, body.elementId, body.op);
    if (!result) {
      return NextResponse.json(
        { error: 'Element not found or op not applicable to this element' },
        { status: 404 },
      );
    }

    await prisma.page.update({
      where: { id: page.id },
      data: { pageHtml: result.fullHtml },
    });

    return NextResponse.json({ html: result.elementHtml });
  } catch (err) {
    console.error('[api/patch] unexpected error', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
