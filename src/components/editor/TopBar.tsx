'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Rocket, History, Loader2, Eye } from 'lucide-react';
import { useSite } from '@/hooks/use-site';
import { FullSitePreview } from '@/components/preview/FullSitePreview';

export function TopBar({ siteId }: { siteId: string }) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const { data: site } = useSite(siteId);
  const [deploying, setDeploying] = useState(false);
  const [deployInfo, setDeployInfo] = useState<string | null>(null);

  async function handleDeploy() {
    setDeploying(true);
    setDeployInfo(null);
    try {
      const r = await fetch(`/api/deploy/${siteId}`, { method: 'POST' });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body?.error ?? `HTTP ${r.status}`);
      setDeployInfo(body?.url ?? 'Deploy started');
    } catch (e: any) {
      setDeployInfo(e?.message ?? 'Deploy failed');
    } finally {
      setDeploying(false);
    }
  }

  return (
    <div className="flex h-14 items-center justify-between border-b border-black/10 bg-paper-raised px-4">
      <div className="flex items-center gap-3 text-sm">
        <Link href="/sites" className="text-ink/60 hover:text-ink">
          Sites
        </Link>
        <span className="text-ink/30">/</span>
        <span className="font-semibold text-ink">{site?.name ?? '…'}</span>
        {site?.domain && <span className="ml-2 text-xs text-ink/40">{site.domain}</span>}
      </div>
      <div className="flex items-center gap-2">
        {deployInfo && (
          <span className="mr-2 truncate text-xs text-ink/60" title={deployInfo}>
            {deployInfo.startsWith('http') ? (
              <a href={deployInfo} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                {deployInfo}
              </a>
            ) : (
              deployInfo
            )}
          </span>
        )}
        <button onClick={() => setPreviewOpen(true)} className="btn-ghost">
          <Eye className="h-4 w-4" /> Preview
        </button>
        <Link href={`/sites/${siteId}/changes`} className="btn-ghost">
          <History className="h-4 w-4" /> Changes
        </Link>
        <button
          onClick={handleDeploy}
          disabled={deploying}
          className="btn-primary disabled:opacity-60"
        >
          {deploying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
          Deploy
        </button>
      </div>
      {previewOpen && <FullSitePreview siteId={siteId} onClose={() => setPreviewOpen(false)} />}
    </div>
  );
}
