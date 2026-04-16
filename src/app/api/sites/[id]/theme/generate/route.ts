import { NextResponse } from 'next/server';
import { prisma } from '@/server/db/client';
import { handleError, notFound } from '@/server/http';
import { enforceLock } from '@/server/services/locks';
import { generateThemeForSite } from '@/server/services/themeService';
import { enforceRateLimit } from '@/server/rateLimit';

export const runtime = 'nodejs';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const limited = enforceRateLimit(req, 'ai');
    if (limited) return limited;
    const { id } = await params;
    const site = await prisma.site.findUnique({ where: { id } });
    if (!site) return notFound('Site not found');
    enforceLock(site, false, 'Site');
    const theme = await generateThemeForSite(id);
    return NextResponse.json({ theme });
  } catch (err) {
    return handleError(err);
  }
}
