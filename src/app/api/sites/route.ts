import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db/client';
import { toSiteDTO } from '@/server/db/mappers';
import { handleError, parseJson } from '@/server/http';
import { logChange } from '@/server/services/changelog';
import { regenerateSitemapFor } from '@/server/services/regenerate';

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
  domain: z.string().max(255).optional().nullable(),
  generate: z.boolean().optional().default(true),
});

export async function POST(req: Request) {
  try {
    const body = CreateSiteBody.parse(await parseJson(req));
    const site = await prisma.site.create({
      data: {
        name: body.name,
        sitePrompt: body.sitePrompt ?? '',
        domain: body.domain ?? null,
      },
    });
    await logChange({
      siteId: site.id,
      scope: 'site',
      targetId: site.id,
      summary: `Created site "${site.name}"`,
      after: { name: site.name, sitePrompt: site.sitePrompt },
    });
    if (body.generate && site.sitePrompt.trim().length > 0) {
      try {
        await regenerateSitemapFor(site.id);
      } catch (err) {
        console.error('[sites.POST] regenerate failed', err);
      }
    }
    const fresh = await prisma.site.findUnique({ where: { id: site.id } });
    return NextResponse.json(toSiteDTO(fresh!), { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}
