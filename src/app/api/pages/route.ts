import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db/client';
import { toPageDTO } from '@/server/db/mappers';
import { handleError, notFound, parseJson } from '@/server/http';
import { logChange } from '@/server/services/changelog';
import { uniquePageSlug } from '@/server/services/slug';
import { regeneratePageFor } from '@/server/services/regenerate';

export const runtime = 'nodejs';

const CreatePageBody = z.object({
  siteId: z.string().min(1),
  name: z.string().min(1).max(120),
  slug: z.string().max(64).optional(),
  pagePrompt: z.string().max(8000).optional().default(''),
  navVisible: z.boolean().optional().default(true),
  generate: z.boolean().optional().default(true),
});

export async function POST(req: Request) {
  try {
    const body = CreatePageBody.parse(await parseJson(req));
    const site = await prisma.site.findUnique({ where: { id: body.siteId } });
    if (!site) return notFound('Site not found');

    const slug = await uniquePageSlug(body.siteId, body.slug || body.name);
    const max = await prisma.page.aggregate({
      where: { siteId: body.siteId },
      _max: { orderIdx: true },
    });
    const page = await prisma.page.create({
      data: {
        siteId: body.siteId,
        name: body.name,
        slug,
        pagePrompt: body.pagePrompt ?? '',
        navVisible: body.navVisible,
        orderIdx: (max._max.orderIdx ?? -1) + 1,
      },
    });

    await logChange({
      siteId: body.siteId,
      scope: 'page',
      targetId: page.id,
      summary: `Created page "${page.name}"`,
      after: { name: page.name, slug: page.slug },
    });

    // Always auto-generate full page (sections + code) after creation unless explicitly opted out.
    // Page prompt can be empty — the AI will infer from site context.
    if (body.generate) {
      // Fire-and-forget; UI polls / refetches. Keeps POST fast.
      void regeneratePageFor(page.id).catch((err) =>
        console.error('[pages.POST] regenerate failed', err),
      );
    }

    return NextResponse.json(toPageDTO(page), { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}
