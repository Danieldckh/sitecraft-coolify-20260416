// Converts local-origin reference image URLs (e.g. "/uploads/<siteId>/<file>")
// to base64 data URLs so OpenAI Vision can consume them. Remote https:// URLs
// are passed through unchanged.

import { readFile } from 'node:fs/promises';
import path from 'node:path';

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

export async function resolveImageUrlForOpenAI(urlOrPath: string): Promise<string> {
  if (/^https?:\/\//i.test(urlOrPath)) return urlOrPath;
  if (urlOrPath.startsWith('data:')) return urlOrPath;

  // Treat anything else as a path under /public (URL like "/uploads/..." or raw fs path).
  let relative = urlOrPath.startsWith('/') ? urlOrPath.slice(1) : urlOrPath;
  // Normalize away any "public/" prefix the caller might include
  if (relative.startsWith('public/')) relative = relative.slice('public/'.length);

  const fullPath = path.join(process.cwd(), 'public', relative);
  const bytes = await readFile(fullPath);
  const ext = path.extname(fullPath).toLowerCase();
  const mime = MIME_BY_EXT[ext] ?? 'application/octet-stream';
  return `data:${mime};base64,${bytes.toString('base64')}`;
}
