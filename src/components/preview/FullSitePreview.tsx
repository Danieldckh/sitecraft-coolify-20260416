'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, Monitor, Tablet, Smartphone } from 'lucide-react';
import type { PageDTO, SectionDTO } from '@/types/models';
import { IframePreview } from './IframePreview';

type Device = 'desktop' | 'tablet' | 'mobile';
const DEVICE_WIDTH: Record<Device, number> = { desktop: 1280, tablet: 820, mobile: 390 };

async function fetchPages(siteId: string): Promise<PageDTO[]> {
  const r = await fetch(`/api/sites/${siteId}/pages`);
  if (!r.ok) throw new Error('pages');
  return r.json();
}
async function fetchSections(siteId: string): Promise<SectionDTO[]> {
  const r = await fetch(`/api/sites/${siteId}/sections`);
  if (!r.ok) throw new Error('sections');
  return r.json();
}

export function FullSitePreview({ siteId, onClose }: { siteId: string; onClose: () => void }) {
  const { data: pages = [] } = useQuery({
    queryKey: ['pages', siteId],
    queryFn: () => fetchPages(siteId),
  });
  const { data: allSections = [] } = useQuery({
    queryKey: ['sections', siteId],
    queryFn: () => fetchSections(siteId),
    refetchInterval: 4000, // polls while AI fills in code
  });

  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [device, setDevice] = useState<Device>('desktop');

  useEffect(() => {
    function onMsg(e: MessageEvent) {
      const data = e.data;
      if (!data || data.type !== 'sitecraft:navigate' || typeof data.slug !== 'string') return;
      const target = pages.find((p) => p.slug === data.slug);
      if (target) setSelectedPageId(target.id);
    }
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [pages]);

  const currentId = selectedPageId ?? pages[0]?.id ?? null;
  const current = pages.find((p) => p.id === currentId);
  const sectionsForCurrent = useMemo(
    () => allSections.filter((s) => s.pageId === currentId).sort((a, b) => a.orderIdx - b.orderIdx),
    [allSections, currentId],
  );

  const pending = sectionsForCurrent.filter((s) => !s.html).length;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-ink/90 backdrop-blur-sm">
      <div className="flex items-center justify-between gap-4 border-b border-white/10 px-5 py-3 text-paper">
        <div className="flex items-center gap-3">
          <div className="text-sm font-semibold tracking-tight">Full site preview</div>
          <div className="h-4 w-px bg-white/20" />
          <nav className="flex items-center gap-1 overflow-x-auto">
            {pages.map((p) => (
              <button
                key={p.id}
                onClick={() => setSelectedPageId(p.id)}
                className={
                  'rounded-full px-3 py-1 text-xs transition ' +
                  (p.id === currentId
                    ? 'bg-white text-ink'
                    : 'text-white/70 hover:bg-white/10 hover:text-white')
                }
              >
                {p.name}
                <span className="ml-1 opacity-60">/{p.slug}</span>
              </button>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-3">
          {pending > 0 && (
            <div className="flex items-center gap-2 rounded-full bg-amber-500/20 px-3 py-1 text-xs text-amber-200">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
              Generating {pending} section{pending === 1 ? '' : 's'}…
            </div>
          )}
          <div className="flex items-center rounded-lg border border-white/15 bg-white/5 p-0.5">
            {(['desktop', 'tablet', 'mobile'] as Device[]).map((d) => (
              <button
                key={d}
                onClick={() => setDevice(d)}
                aria-label={d}
                className={
                  'rounded-md p-1.5 transition ' +
                  (d === device ? 'bg-white text-ink' : 'text-white/70 hover:text-white')
                }
              >
                {d === 'desktop' && <Monitor className="h-4 w-4" />}
                {d === 'tablet' && <Tablet className="h-4 w-4" />}
                {d === 'mobile' && <Smartphone className="h-4 w-4" />}
              </button>
            ))}
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-white/80 transition hover:bg-white/10 hover:text-white"
            aria-label="Close preview"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        <div
          className="mx-auto h-full overflow-hidden rounded-2xl border border-white/10 bg-white shadow-2xl transition-all"
          style={{ maxWidth: DEVICE_WIDTH[device] }}
        >
          {current ? (
            <IframePreview
              page={{ ...current, sections: sectionsForCurrent }}
              sitemap={pages}
              className="h-full w-full"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-ink/50">
              No pages yet. Add one from the editor.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
