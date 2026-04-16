'use client';

import { useState } from 'react';
import type { DragEvent } from 'react';
import { Copy, Upload, Image as ImageIcon } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/common/SkeletonLoader';
import { FileDrop } from '@/components/common/FileDrop';
import { cn } from '@/lib/cn';
import { useAssets, useUploadAsset } from '@/hooks/use-site';
import type { AssetDTO } from '@/types/models';

export function AssetsDrawer({ siteId }: { siteId: string }) {
  const { data: assets, isLoading } = useAssets(siteId);
  const upload = useUploadAsset(siteId);
  const [dropOpen, setDropOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopy = async (asset: AssetDTO) => {
    try {
      await navigator.clipboard.writeText(asset.url);
      setCopiedId(asset.id);
      setTimeout(() => setCopiedId((id) => (id === asset.id ? null : id)), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  const handleDragStart = (e: DragEvent<HTMLDivElement>, asset: AssetDTO) => {
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('text/plain', asset.url);
    e.dataTransfer.setData('application/x-sc-asset', asset.id);
  };

  return (
    <aside className="flex min-h-0 flex-col rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
      <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-3 py-2.5">
        <div className="text-[11px] font-medium uppercase tracking-[var(--ls-wide)] text-[var(--text-muted)]">
          Assets
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setDropOpen((v) => !v)}
          leftIcon={<Upload className="h-3 w-3" aria-hidden />}
          aria-expanded={dropOpen}
        >
          Upload
        </Button>
      </div>

      {dropOpen ? (
        <div className="border-b border-[var(--border-subtle)] p-3">
          <FileDrop
            accept="image/*"
            multiple
            disabled={upload.isPending}
            label="Drop images or click"
            hint="Logo, hero images, favicons"
            onFiles={async (files) => {
              for (const file of files) {
                try {
                  await upload.mutateAsync({ file, kind: 'image' });
                } catch {
                  /* surfaces below */
                }
              }
            }}
          />
          {upload.error ? (
            <p className="mt-2 text-xs text-[var(--color-danger-600)]">
              {upload.error instanceof Error ? upload.error.message : 'Upload failed'}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {isLoading ? (
          <div className="grid grid-cols-2 gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="aspect-square rounded-lg" />
            ))}
          </div>
        ) : !assets || assets.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-3 py-8 text-center">
            <div className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--bg-sunken)] text-[var(--text-muted)]">
              <ImageIcon className="h-4 w-4" aria-hidden />
            </div>
            <p className="text-xs text-[var(--text-secondary)]">No assets yet</p>
          </div>
        ) : (
          <ul className="grid grid-cols-2 gap-2">
            {assets.map((asset) => (
              <li key={asset.id}>
                <div
                  draggable
                  onDragStart={(e) => handleDragStart(e, asset)}
                  onClick={() => handleCopy(asset)}
                  className={cn(
                    'group relative aspect-square overflow-hidden rounded-lg border',
                    'border-[var(--border-subtle)] bg-[var(--bg-sunken)]',
                    'cursor-pointer transition-shadow duration-150 ease-out hover:shadow-sm',
                  )}
                  role="button"
                  aria-label={`Copy URL for ${asset.url}`}
                >
                  {asset.mime.startsWith('image/') ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={asset.url}
                      alt=""
                      className="h-full w-full object-cover"
                      draggable={false}
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-xs text-[var(--text-muted)]">
                      {asset.mime}
                    </div>
                  )}

                  <div className="absolute left-1 top-1">
                    <Badge variant="neutral" className="text-[10px] capitalize">
                      {asset.kind}
                    </Badge>
                  </div>
                  <div
                    className={cn(
                      'absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 px-1.5 py-1',
                      'bg-gradient-to-t from-black/60 to-transparent text-[10px] text-white',
                      'opacity-0 transition-opacity duration-150 group-hover:opacity-100',
                    )}
                  >
                    <Copy className="h-3 w-3" aria-hidden />
                    <span>{copiedId === asset.id ? 'Copied!' : 'Copy URL'}</span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
