import { NextResponse } from 'next/server';
import { prisma } from '@/server/db/client';
import { handleError, HttpError, notFound } from '@/server/http';
import { storage } from '@/server/storage';

export const runtime = 'nodejs';

const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get('file') ?? form.get('image');
    const siteId = form.get('siteId');
    if (!(file instanceof File)) throw new HttpError(400, 'Missing "file" field');
    if (typeof siteId !== 'string' || !siteId) throw new HttpError(400, 'Missing "siteId" field');
    if (!ALLOWED.has(file.type)) throw new HttpError(400, `Unsupported MIME: ${file.type}`);
    if (file.size > MAX_BYTES) throw new HttpError(413, 'File exceeds 8MB');

    const site = await prisma.site.findUnique({ where: { id: siteId } });
    if (!site) return notFound('Site not found');

    const bytes = Buffer.from(await file.arrayBuffer());
    const { url } = await storage.put({ siteId, mime: file.type, bytes, originalName: file.name });

    await prisma.asset.create({
      data: { siteId, kind: 'image', url, mime: file.type, sizeBytes: bytes.byteLength },
    });

    return NextResponse.json({ url });
  } catch (err) {
    return handleError(err);
  }
}
