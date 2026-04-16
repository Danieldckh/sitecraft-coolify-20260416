import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db/client';
import { toSectionDTO } from '@/server/db/mappers';
import { handleError, notFound, parseJson } from '@/server/http';
import { logChange } from '@/server/services/changelog';
import { enforceLock } from '@/server/services/locks';
import { regenerateSectionFor } from '@/server/services/regenerate';

export const runtime = 'nodejs';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const section = await prisma.section.findUnique({ where: { id } });
    if (!section) return notFound('Section not found');
    return NextResponse.json({ section: toSectionDTO(section) });
  } catch (err) {
    return handleError(err);
  }
}

const SectionTypeEnum = z.enum([
  'header', 'hero', 'features', 'cta', 'footer',
  'gallery', 'testimonials', 'pricing', 'faq', 'contact', 'custom',
]);

const PatchSectionBody = z.object({
  type: SectionTypeEnum.optional(),
  sectionPrompt: z.string().max(8000).optional(),
  locked: z.boolean().optional(),
  orderIdx: z.number().int().optional(),
  html: z.string().optional(),
  css: z.string().optional(),
  js: z.string().optional(),
  referenceImageUrl: z.string().url().nullable().optional(),
  force: z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = PatchSectionBody.parse(await parseJson(req));
    const existing = await prisma.section.findUnique({
      where: { id },
      include: { page: true },
    });
    if (!existing) return notFound('Section not found');

    const promptChanging = body.sectionPrompt !== undefined && body.sectionPrompt !== existing.sectionPrompt;
    if (promptChanging) enforceLock(existing, body.force, 'Section');

    const updated = await prisma.section.update({
      where: { id },
      data: {
        ...(body.type !== undefined ? { type: body.type } : {}),
        ...(body.sectionPrompt !== undefined ? { sectionPrompt: body.sectionPrompt } : {}),
        ...(body.locked !== undefined ? { locked: body.locked } : {}),
        ...(body.orderIdx !== undefined ? { orderIdx: body.orderIdx } : {}),
        ...(body.html !== undefined ? { html: body.html } : {}),
        ...(body.css !== undefined ? { css: body.css } : {}),
        ...(body.js !== undefined ? { js: body.js } : {}),
        ...(body.referenceImageUrl !== undefined ? { referenceImageUrl: body.referenceImageUrl } : {}),
      },
    });

    await logChange({
      siteId: existing.page.siteId,
      scope: 'section',
      targetId: id,
      summary: promptChanging ? `Updated prompt on ${existing.type} section` : `Updated ${existing.type} section`,
      before: existing,
      after: updated,
    });

    if (promptChanging) {
      try {
        await regenerateSectionFor(id);
      } catch (err) {
        console.error('[sections.PATCH] generate failed', err);
      }
    }

    const fresh = await prisma.section.findUnique({ where: { id } });
    return NextResponse.json({ section: toSectionDTO(fresh!) });
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const existing = await prisma.section.findUnique({
      where: { id },
      include: { page: true },
    });
    if (!existing) return notFound('Section not found');
    await prisma.section.delete({ where: { id } });
    await logChange({
      siteId: existing.page.siteId,
      scope: 'section',
      targetId: id,
      summary: `Deleted ${existing.type} section`,
      before: existing,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
