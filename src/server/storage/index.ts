// Storage provider: local disk in dev, swap to S3/MinIO in prod.
// Hardening:
//  - siteId is validated against /^[a-z0-9-]+$/ to prevent path traversal.
//  - MIME is sniffed from magic bytes (PNG/JPG/WebP/GIF). SVG rejected.
//  - Resolved destination must remain inside the uploads root.

import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { HttpError } from '@/server/http';

export interface StoragePutInput {
  siteId: string;
  bytes: Buffer;
  originalName?: string;
  declaredMime?: string;
}

export interface StoragePutResult {
  url: string;
  key: string;
  mime: string;
  sizeBytes: number;
}

export interface StorageProvider {
  put(input: StoragePutInput): Promise<StoragePutResult>;
}

const SITE_ID_RE = /^[a-z0-9-]+$/i;

// Magic-byte sniffer for the formats we accept. Returns null on unknown/denied.
export function sniffImageMime(bytes: Buffer): string | null {
  if (bytes.length < 12) return null;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  // GIF: "GIF87a" or "GIF89a"
  if (
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return 'image/gif';
  }
  // WebP: "RIFF"...."WEBP"
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}

function mimeToExt(m: string): string | undefined {
  return {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/webp': '.webp',
    'image/gif': '.gif',
  }[m];
}

class LocalDiskStorage implements StorageProvider {
  constructor(private readonly root = path.resolve(process.cwd(), 'public', 'uploads')) {}

  async put({ siteId, bytes, originalName, declaredMime }: StoragePutInput): Promise<StoragePutResult> {
    if (!SITE_ID_RE.test(siteId)) {
      throw new HttpError(400, 'Invalid siteId (alphanumeric + hyphen only)');
    }
    if (declaredMime === 'image/svg+xml') {
      throw new HttpError(415, 'SVG uploads are not permitted');
    }

    const sniffed = sniffImageMime(bytes);
    if (!sniffed) {
      throw new HttpError(415, 'Unsupported or unrecognized image format (PNG/JPG/WebP/GIF only)');
    }
    if (declaredMime && declaredMime !== sniffed) {
      throw new HttpError(
        415,
        `Declared MIME ${declaredMime} does not match detected ${sniffed}`,
      );
    }

    const dir = path.resolve(this.root, siteId);
    const rootWithSep = this.root + path.sep;
    if (!dir.startsWith(rootWithSep)) {
      throw new HttpError(400, 'Path escape detected');
    }
    await mkdir(dir, { recursive: true });

    const ext =
      (originalName?.match(/\.[a-z0-9]+$/i)?.[0] ?? mimeToExt(sniffed) ?? '.bin').toLowerCase();
    const key = `${Date.now()}-${randomUUID().slice(0, 8)}${ext}`;
    const full = path.resolve(dir, key);
    if (!full.startsWith(rootWithSep)) {
      throw new HttpError(400, 'Path escape detected');
    }
    await writeFile(full, bytes);

    return {
      url: `/uploads/${siteId}/${key}`,
      key,
      mime: sniffed,
      sizeBytes: bytes.byteLength,
    };
  }
}

export const storage: StorageProvider = new LocalDiskStorage();
