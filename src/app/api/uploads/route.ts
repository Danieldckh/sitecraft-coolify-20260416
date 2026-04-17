// POST /api/uploads — accept a single image upload, persist to public/uploads
// so it's served from the builder at `/uploads/<id>.<ext>`, return the URL.
//
// Used by the inspector's "Replace image" affordance. The caller passes a
// multipart/form-data body with a single `file` field. We:
//   1. Validate size + mime (images only, ≤ 5 MB).
//   2. Write to `public/uploads/<cuid>.<ext>` on disk.
//   3. Return `{ url: '/uploads/<cuid>.<ext>' }`.
//
// Deploy-time note: the bundler walks generated page HTML for `/uploads/…`
// refs and pulls those files into the zip before pushing to Coolify.

import { NextRequest, NextResponse } from 'next/server';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { enforceRateLimit } from '@/server/rateLimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_MIME: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
  'image/avif',
]);

const EXT_FOR_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
};

export async function POST(req: NextRequest) {
  const limited = enforceRateLimit(req, 'ai');
  if (limited) return limited;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid multipart body' }, { status: 400 });
  }

  const raw = form.get('file');
  if (!(raw instanceof Blob)) {
    return NextResponse.json({ error: 'Missing "file" field' }, { status: 400 });
  }

  const mime = raw.type || 'application/octet-stream';
  if (!ALLOWED_MIME.has(mime)) {
    return NextResponse.json(
      { error: `Unsupported type: ${mime}. Images only (PNG, JPEG, WebP, GIF, SVG, AVIF).` },
      { status: 415 },
    );
  }
  if (raw.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `File too large (${raw.size} bytes). Max is 5 MB.` },
      { status: 413 },
    );
  }

  const ext = EXT_FOR_MIME[mime] ?? 'bin';
  const id = randomUUID().replace(/-/g, '');
  const filename = `${id}.${ext}`;

  const uploadsDir = path.join(process.cwd(), 'public', 'uploads');
  try {
    await mkdir(uploadsDir, { recursive: true });
    const bytes = Buffer.from(await raw.arrayBuffer());
    await writeFile(path.join(uploadsDir, filename), bytes);
  } catch (err) {
    console.error('[api/uploads] write failed', err);
    return NextResponse.json({ error: 'Failed to save upload' }, { status: 500 });
  }

  return NextResponse.json({
    url: `/uploads/${filename}`,
    bytes: raw.size,
    mime,
  });
}
