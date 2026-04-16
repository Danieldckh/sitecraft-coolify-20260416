import { NextResponse } from 'next/server';
import { prisma } from '@/server/db/client';
import { toPageDTO } from '@/server/db/mappers';
import { handleError, notFound } from '@/server/http';

export const runtime = 'nodejs';

// Note: PreviewTab renders the full site from this list, so we keep pageHtml/
// pageCss/pageJs in the response. The ?light=1 variant omits heavy fields for
// canvas-list style consumers that only need nav/status metadata.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const site = await prisma.site.findUnique({ where: { id }, select: { id: true } });
    if (!site) return notFound('Site not found');
    const url = new URL(req.url);
    const light = url.searchParams.get('light') === '1';

    if (light) {
      const pages = await prisma.page.findMany({
        where: { siteId: id },
        orderBy: { orderIdx: 'asc' },
        select: {
          id: true,
          siteId: true,
          name: true,
          slug: true,
          orderIdx: true,
          navVisible: true,
          locked: true,
          lastGeneratedAt: true,
          pageHtml: true,
        },
      });
      return NextResponse.json(
        pages.map((p) => ({
          id: p.id,
          siteId: p.siteId,
          name: p.name,
          slug: p.slug,
          orderIdx: p.orderIdx,
          navVisible: p.navVisible,
          locked: p.locked,
          lastGeneratedAt: p.lastGeneratedAt?.toISOString() ?? null,
          hasContent: Boolean(p.pageHtml && p.pageHtml.length),
        })),
      );
    }

    const pages = await prisma.page.findMany({
      where: { siteId: id },
      orderBy: { orderIdx: 'asc' },
    });
    return NextResponse.json(pages.map(toPageDTO));
  } catch (err) {
    return handleError(err);
  }
}
