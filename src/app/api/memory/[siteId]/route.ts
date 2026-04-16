import { NextResponse } from 'next/server';
import { prisma } from '@/server/db/client';
import { handleError, notFound } from '@/server/http';
import { toMemoryEntry } from '@/server/db/mappers';

export const runtime = 'nodejs';

export async function GET(_req: Request, { params }: { params: Promise<{ siteId: string }> }) {
  try {
    const { siteId } = await params;
    const site = await prisma.site.findUnique({ where: { id: siteId } });
    if (!site) return notFound('Site not found');

    const recent = await prisma.memoryEntry.findMany({
      where: { siteId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return NextResponse.json({
      site: { id: site.id, name: site.name, memorySummary: site.memorySummary },
      entries: recent.map(toMemoryEntry),
    });
  } catch (err) {
    return handleError(err);
  }
}
