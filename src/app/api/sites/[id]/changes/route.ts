import { NextResponse } from 'next/server';
import { prisma } from '@/server/db/client';
import { toChangeLogDTO } from '@/server/db/mappers';
import { handleError, notFound } from '@/server/http';

export const runtime = 'nodejs';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const site = await prisma.site.findUnique({ where: { id }, select: { id: true } });
    if (!site) return notFound('Site not found');
    const url = new URL(req.url);
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '200', 10) || 200, 500);
    const scope = url.searchParams.get('scope');
    const entries = await prisma.changeLogEntry.findMany({
      where: { siteId: id, ...(scope && scope !== 'all' ? { scope } : {}) },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return NextResponse.json(entries.map(toChangeLogDTO));
  } catch (err) {
    return handleError(err);
  }
}
