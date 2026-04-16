import { NextResponse } from 'next/server';
import { prisma } from '@/server/db/client';
import { handleError, HttpError, notFound } from '@/server/http';
import { listAssets, storeAsset } from '@/server/services/assetService';

export const runtime = 'nodejs';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const site = await prisma.site.findUnique({ where: { id } });
    if (!site) return notFound('Site not found');
    const assets = await listAssets(id);
    return NextResponse.json({ assets });
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const site = await prisma.site.findUnique({ where: { id } });
    if (!site) return notFound('Site not found');

    const form = await req.formData();
    const file = form.get('file');
    const kind = (form.get('kind') as string) || 'image';
    if (!(file instanceof File)) throw new HttpError(400, 'Missing "file" field');

    const asset = await storeAsset({ siteId: id, kind, file });
    return NextResponse.json({ asset }, { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}
