import { NextResponse } from 'next/server';
import { HttpError, handleError, notFound } from '@/server/http';
import { prisma } from '@/server/db/client';
import { storeAsset } from '@/server/services/assetService';

export const runtime = 'nodejs';

// Back-compat shim for the v1 "/api/upload" form. Internally routes to the v2
// asset pipeline. Preserves the { url } response shape.
export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get('file') ?? form.get('image');
    const siteId = form.get('siteId');
    const kind = (form.get('kind') as string) || 'image';
    if (!(file instanceof File)) throw new HttpError(400, 'Missing "file" field');
    if (typeof siteId !== 'string' || !siteId) throw new HttpError(400, 'Missing "siteId" field');

    const site = await prisma.site.findUnique({ where: { id: siteId } });
    if (!site) return notFound('Site not found');

    const asset = await storeAsset({ siteId, kind, file });
    return NextResponse.json({ url: asset.url, asset });
  } catch (err) {
    return handleError(err);
  }
}
