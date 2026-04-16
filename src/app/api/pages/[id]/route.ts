import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db/client';
import { toPageDTO, toSectionDTO } from '@/server/db/mappers';
import { handleError, notFound, parseJson } from '@/server/http';
import { logChange } from '@/server/services/changelog';
import { enforceLock } from '@/server/services/locks';
import { uniquePageSlug, slugify } from '@/server/services/slug';
import { regeneratePageFor } from '@/server/services/regenerate';

export const runtime = 'nodejs';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const page = await prisma.page.findUnique({
      where: { id },
      include: { sections: { orderBy: { orderIdx: 'asc' } } },
    });
    if (!page) return notFound('Page not found');
    return NextResponse.json({
      page: toPageDTO(page),
      sections: page.sections.map(toSectionDTO),
    });
  } catch (err) {
    return handleError(err);
  }
}

const PatchPageBody = z.object({
  name: z.string().min(1).max(120).optional(),
  slug: z.string().max(64).optional(),
  pagePrompt: z.string().max(8000).optional(),
  locked: z.boolean().optional(),
  orderIdx: z.number().int().optional(),
  navVisible: z.boolean().optional(),
  force: z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = PatchPageBody.parse(await parseJson(req));
    const existing = await prisma.page.findUnique({ where: { id } });
    if (!existing) return notFound('Page not found');

    const promptChanging = body.pagePrompt !== undefined && body.pagePrompt !== existing.pagePrompt;
    if (promptChanging) enforceLock(existing, body.force, 'Page');

    let nextSlug = existing.slug;
    if (body.slug !== undefined && slugify(body.slug) !== existing.slug) {
      nextSlug = await uniquePageSlug(existing.siteId, body.slug, id);
    }

    const updated = await prisma.page.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.slug !== undefined ? { slug: nextSlug } : {}),
        ...(body.pagePrompt !== undefined ? { pagePrompt: body.pagePrompt } : {}),
        ...(body.locked !== undefined ? { locked: body.locked } : {}),
        ...(body.orderIdx !== undefined ? { orderIdx: body.orderIdx } : {}),
        ...(body.navVisible !== undefined ? { navVisible: body.navVisible } : {}),
      },
    });

    await logChange({
      siteId: existing.siteId,
      scope: 'page',
      targetId: id,
      summary: promptChanging ? `Updated page prompt on ${updated.slug}` : `Updated page ${updated.slug}`,
      before: existing,
      after: updated,
    });

    if (promptChanging) {
      try {
        await regeneratePageFor(id);
      } catch (err) {
        console.error('[pages.PATCH] regenerate failed', err);
      }
    }

    const fresh = await prisma.page.findUnique({ where: { id } });
    return NextResponse.json({ page: toPageDTO(fresh!) });
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const existing = await prisma.page.findUnique({ where: { id } });
    if (!existing) return notFound('Page not found');
    await prisma.page.delete({ where: { id } });
    await logChange({
      siteId: existing.siteId,
      scope: 'page',
      targetId: id,
      summary: `Deleted page ${existing.slug}`,
      before: existing,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
