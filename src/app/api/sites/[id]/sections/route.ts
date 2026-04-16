import { NextResponse } from 'next/server';
import { prisma } from '@/server/db/client';
import { toSectionDTO } from '@/server/db/mappers';
import { handleError, notFound } from '@/server/http';

export const runtime = 'nodejs';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const site = await prisma.site.findUnique({ where: { id }, select: { id: true } });
    if (!site) return notFound('Site not found');
    const sections = await prisma.section.findMany({
      where: { page: { siteId: id } },
      orderBy: [{ pageId: 'asc' }, { orderIdx: 'asc' }],
    });
    return NextResponse.json(sections.map(toSectionDTO));
  } catch (err) {
    return handleError(err);
  }
}
