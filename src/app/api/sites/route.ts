import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db/client';
import { toSiteDTO } from '@/server/db/mappers';
import { handleError, parseJson } from '@/server/http';
import { logChange } from '@/server/services/changelog';
import { STYLE_PRESET_IDS } from '@/server/ai/stylePresets';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const sites = await prisma.site.findMany({ orderBy: { createdAt: 'desc' } });
    return NextResponse.json(sites.map(toSiteDTO));
  } catch (err) {
    return handleError(err);
  }
}

const CreateSiteBody = z.object({
  name: z.string().min(1).max(120),
  sitePrompt: z.string().max(8000).optional().default(''),
  stylePresetId: z.string().optional(),
  domain: z.string().max(255).optional().nullable(),
});

export async function POST(req: Request) {
  try {
    const body = CreateSiteBody.parse(await parseJson(req));
    if (body.stylePresetId && !STYLE_PRESET_IDS.includes(body.stylePresetId)) {
      return NextResponse.json({ error: `Unknown style preset: ${body.stylePresetId}` }, { status: 400 });
    }
    const site = await prisma.site.create({
      data: {
        name: body.name,
        sitePrompt: body.sitePrompt ?? '',
        stylePresetId: body.stylePresetId ?? null,
        domain: body.domain ?? null,
      },
    });
    await logChange({
      siteId: site.id,
      scope: 'site',
      targetId: site.id,
      summary: `Created site "${site.name}"`,
      after: { name: site.name, sitePrompt: site.sitePrompt, stylePresetId: site.stylePresetId },
    });
    return NextResponse.json(toSiteDTO(site), { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}
