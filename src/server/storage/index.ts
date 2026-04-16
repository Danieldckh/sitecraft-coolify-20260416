// Storage provider: local disk in dev, swap to S3/MinIO in prod.
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

export interface StorageProvider {
  put(args: { siteId: string; mime: string; bytes: Buffer; originalName?: string }): Promise<{ url: string; key: string }>;
}

class LocalDiskStorage implements StorageProvider {
  constructor(private readonly root = path.join(process.cwd(), 'public', 'uploads')) {}

  async put({ siteId, mime, bytes, originalName }: { siteId: string; mime: string; bytes: Buffer; originalName?: string }) {
    const dir = path.join(this.root, siteId);
    await mkdir(dir, { recursive: true });
    const ext = (originalName?.match(/\.[a-z0-9]+$/i)?.[0] ?? mimeToExt(mime) ?? '.bin').toLowerCase();
    const key = `${Date.now()}-${randomUUID().slice(0, 8)}${ext}`;
    await writeFile(path.join(dir, key), bytes);
    return { url: `/uploads/${siteId}/${key}`, key };
  }
}

function mimeToExt(m: string) {
  return { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' }[m];
}

export const storage: StorageProvider = new LocalDiskStorage();
