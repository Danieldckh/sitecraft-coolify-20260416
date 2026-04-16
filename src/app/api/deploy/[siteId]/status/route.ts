import { NextResponse } from 'next/server';
import { prisma } from '@/server/db/client';
import { toDeploymentDTO } from '@/server/db/mappers';

export const runtime = 'nodejs';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ siteId: string }> },
) {
  const { siteId } = await params;
  const latest = await prisma.deployment.findFirst({
    where: { siteId },
    orderBy: { createdAt: 'desc' },
  });
  if (!latest) {
    return NextResponse.json({ deployment: null });
  }
  return NextResponse.json({ deployment: toDeploymentDTO(latest) });
}
