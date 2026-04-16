// Converts local-origin reference image URLs (e.g. "/uploads/<siteId>/<file>")
// to base64 data URLs so OpenAI Vision can consume them. Remote https:// URLs
// pass through unchanged.
//
// SECURITY: aggressively guards against path traversal. The resolved absolute
// path MUST sit under <cwd>/public/. Null bytes, ".." segments, and anything
// whose normalized path escapes the root are rejected outright.

import { readFile } from 'node:fs/promises';
import path from 'node:path';

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

export class UnsafeImagePathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeImagePathError';
  }
}

export async function resolveImageUrlForOpenAI(urlOrPath: string): Promise<string> {
  if (/^https?:\/\//i.test(urlOrPath)) return urlOrPath;
  if (urlOrPath.startsWith('data:')) return urlOrPath;

  if (urlOrPath.includes('\0')) {
    throw new UnsafeImagePathError('Null byte in path');
  }
  if (/(^|[\\/])\.\.([\\/]|$)/.test(urlOrPath)) {
    throw new UnsafeImagePathError('Parent-directory segment rejected');
  }

  let relative = urlOrPath.startsWith('/') ? urlOrPath.slice(1) : urlOrPath;
  if (relative.startsWith('public/')) relative = relative.slice('public/'.length);

  const publicRoot = path.resolve(process.cwd(), 'public');
  const resolved = path.resolve(publicRoot, relative);
  const rootWithSep = publicRoot + path.sep;
  if (!resolved.startsWith(rootWithSep) && resolved !== publicRoot) {
    throw new UnsafeImagePathError(`Path escapes public root: ${urlOrPath}`);
  }

  const bytes = await readFile(resolved);
  const ext = path.extname(resolved).toLowerCase();
  const mime = MIME_BY_EXT[ext] ?? 'application/octet-stream';
  return `data:${mime};base64,${bytes.toString('base64')}`;
}
