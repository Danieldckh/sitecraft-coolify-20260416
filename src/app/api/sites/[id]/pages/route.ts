import { NextResponse } from 'next/server';
import { prisma } from '@/server/db/client';
import { toPageDTO } from '@/server/db/mappers';
import { handleError, notFound } from '@/server/http';

export const runtime = 'nodejs';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const site = await prisma.site.findUnique({ where: { id }, select: { id: true } });
    if (!site) return notFound('Site not found');
    const pages = await prisma.page.findMany({
      where: { siteId: id },
      orderBy: { orderIdx: 'asc' },
    });
    return NextResponse.json(pages.map(toPageDTO));
  } catch (err) {
    return handleError(err);
  }
}
