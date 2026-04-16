import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db/client';
import { toSectionDTO } from '@/server/db/mappers';
import { handleError, notFound, parseJson } from '@/server/http';
import { logChange } from '@/server/services/changelog';
import { regenerateSectionFor } from '@/server/services/regenerate';

export const runtime = 'nodejs';

const SectionTypeEnum = z.enum([
  'header', 'hero', 'features', 'cta', 'footer',
  'gallery', 'testimonials', 'pricing', 'faq', 'contact', 'custom',
]);

const CreateSectionBody = z.object({
  pageId: z.string().min(1),
  type: SectionTypeEnum,
  sectionPrompt: z.string().max(8000).optional().default(''),
  orderIdx: z.number().int().optional(),
  generate: z.boolean().optional().default(false),
});

export async function POST(req: Request) {
  try {
    const body = CreateSectionBody.parse(await parseJson(req));
    const page = await prisma.page.findUnique({ where: { id: body.pageId } });
    if (!page) return notFound('Page not found');

    let orderIdx = body.orderIdx;
    if (orderIdx === undefined) {
      const max = await prisma.section.aggregate({
        where: { pageId: body.pageId },
        _max: { orderIdx: true },
      });
      orderIdx = (max._max.orderIdx ?? -1) + 1;
    }

    const section = await prisma.section.create({
      data: {
        pageId: body.pageId,
        type: body.type,
        sectionPrompt: body.sectionPrompt ?? '',
        orderIdx,
      },
    });

    await logChange({
      siteId: page.siteId,
      scope: 'section',
      targetId: section.id,
      summary: `Created ${section.type} section on ${page.slug}`,
      after: { type: section.type },
    });

    if (body.generate && section.sectionPrompt.trim().length > 0) {
      try {
        await regenerateSectionFor(section.id);
      } catch (err) {
        console.error('[sections.POST] generate failed', err);
      }
    }

    const fresh = await prisma.section.findUnique({ where: { id: section.id } });
    return NextResponse.json({ section: toSectionDTO(fresh!) }, { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}
