import { prisma } from '@/server/db/client';
import { storage } from '@/server/storage';
import { HttpError } from '@/server/http';
import { withSiteLock } from './mutex';
import { toAssetDTO } from '@/server/db/mappers';
import type { AssetDTO } from '@/types/models';

const ALLOWED_KINDS = new Set(['logo', 'image', 'favicon', 'font']);
const MAX_BYTES = 8 * 1024 * 1024;

export async function storeAsset(input: {
  siteId: string;
  kind: string;
  file: File;
  meta?: Record<string, unknown>;
}): Promise<AssetDTO> {
  if (!ALLOWED_KINDS.has(input.kind)) {
    throw new HttpError(400, `Invalid asset kind: ${input.kind}`);
  }
  if (input.file.size > MAX_BYTES) {
    throw new HttpError(413, `File exceeds ${MAX_BYTES} bytes`);
  }
  const bytes = Buffer.from(await input.file.arrayBuffer());
  const stored = await storage.put({
    siteId: input.siteId,
    bytes,
    originalName: input.file.name,
    declaredMime: input.file.type,
  });

  return withSiteLock(input.siteId, async () => {
    const row = await prisma.asset.create({
      data: {
        siteId: input.siteId,
        kind: input.kind,
        url: stored.url,
        mime: stored.mime,
        sizeBytes: stored.sizeBytes,
        meta: JSON.stringify(input.meta ?? {}),
      },
    });
    return toAssetDTO(row);
  });
}

export async function listAssets(siteId: string): Promise<AssetDTO[]> {
  const rows = await prisma.asset.findMany({
    where: { siteId },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map(toAssetDTO);
}
