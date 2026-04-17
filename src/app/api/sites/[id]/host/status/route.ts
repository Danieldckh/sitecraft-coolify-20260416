// GET /api/sites/[id]/host/status — latest Deployment row for a site, or
// null if none exists yet. Used by the editor to restore hosting state on
// mount (is it live? was it mid-deploy?).

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/server/db/client';
import { enforceRateLimit } from '@/server/rateLimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface DeploymentPayload {
  id: string;
  status: string;
  url: string | null;
  coolifyAppUuid: string | null;
  deploymentUuid: string | null;
  logs: string;
  createdAt: string;
  updatedAt: string;
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const limited = enforceRateLimit(req, 'read');
  if (limited) return limited;

  const { id: siteId } = await context.params;
  if (!siteId) {
    return NextResponse.json({ error: 'Missing site id' }, { status: 400 });
  }

  try {
    const row = await prisma.deployment.findFirst({
      where: { siteId },
      orderBy: { createdAt: 'desc' },
    });
    if (!row) return NextResponse.json(null);

    const payload: DeploymentPayload = {
      id: row.id,
      status: row.status,
      url: row.url,
      coolifyAppUuid: row.coolifyAppUuid,
      deploymentUuid: row.deploymentUuid,
      logs: row.logs,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
    return NextResponse.json(payload);
  } catch (err) {
    console.error('[api/sites/[id]/host/status] failed', err);
    return NextResponse.json({ error: 'Failed to load status' }, { status: 500 });
  }
}
