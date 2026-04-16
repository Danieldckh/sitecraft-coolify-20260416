import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db/client';
import { toSiteDTO } from '@/server/db/mappers';
import { handleError, notFound, parseJson } from '@/server/http';
import { logChange } from '@/server/services/changelog';
import { enforceLock } from '@/server/services/locks';
import { STYLE_PRESET_IDS } from '@/server/ai/stylePresets';

export const runtime = 'nodejs';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const site = await prisma.site.findUnique({ where: { id } });
    if (!site) return notFound('Site not found');
    return NextResponse.json(toSiteDTO(site));
  } catch (err) {
    return handleError(err);
  }
}

const PatchSiteBody = z.object({
  name: z.string().min(1).max(120).optional(),
  sitePrompt: z.string().max(8000).optional(),
  stylePresetId: z.string().optional(),
  domain: z.string().max(255).nullable().optional(),
  locked: z.boolean().optional(),
  force: z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = PatchSiteBody.parse(await parseJson(req));
    const existing = await prisma.site.findUnique({ where: { id } });
    if (!existing) return notFound('Site not found');

    const promptChanging = body.sitePrompt !== undefined && body.sitePrompt !== existing.sitePrompt;
    if (promptChanging) enforceLock(existing, body.force, 'Site');
    if (body.stylePresetId !== undefined && !STYLE_PRESET_IDS.includes(body.stylePresetId)) {
      return NextResponse.json({ error: `Unknown style preset: ${body.stylePresetId}` }, { status: 400 });
    }

    const updated = await prisma.site.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.sitePrompt !== undefined ? { sitePrompt: body.sitePrompt } : {}),
        ...(body.stylePresetId !== undefined ? { stylePresetId: body.stylePresetId } : {}),
        ...(body.domain !== undefined ? { domain: body.domain } : {}),
        ...(body.locked !== undefined ? { locked: body.locked } : {}),
      },
    });

    await logChange({
      siteId: id,
      scope: 'site',
      targetId: id,
      summary: promptChanging ? 'Updated site prompt' : 'Updated site',
      before: existing,
      after: updated,
    });

    return NextResponse.json({ site: toSiteDTO(updated) });
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const existing = await prisma.site.findUnique({ where: { id } });
    if (!existing) return notFound('Site not found');
    await prisma.site.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
