// /api/sites/[id]
//
// GET    — return a small site summary (used by the editor top bar for the
//          site name). Shape: { id, name, sitePrompt, createdAt, updatedAt }.
// DELETE — remove the Site row. Prisma cascade takes care of Pages,
//          Elements, Theme, Deployment, etc. GitHub repos and Coolify apps
//          are intentionally left alone (out of scope).

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/server/db/client';
import { enforceRateLimit } from '@/server/rateLimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const limited = enforceRateLimit(req, 'read');
  if (limited) return limited;

  const { id } = await context.params;
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  try {
    const site = await prisma.site.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        sitePrompt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!site) {
      return NextResponse.json({ error: 'Site not found' }, { status: 404 });
    }
    return NextResponse.json({
      id: site.id,
      name: site.name,
      sitePrompt: site.sitePrompt,
      createdAt: site.createdAt.toISOString(),
      updatedAt: site.updatedAt.toISOString(),
    });
  } catch (err) {
    console.error('[api/sites/[id]] get failed', err);
    return NextResponse.json({ error: 'Failed to load site' }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const limited = enforceRateLimit(req, 'ai');
  if (limited) return limited;

  const { id } = await context.params;
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  try {
    await prisma.site.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const status =
      err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'P2025'
        ? 404
        : 500;
    if (status === 404) {
      return NextResponse.json({ error: 'Site not found' }, { status: 404 });
    }
    console.error('[api/sites/[id]] delete failed', err);
    return NextResponse.json({ error: 'Failed to delete site' }, { status: 500 });
  }
}
