'use client';

import Link from 'next/link';
import { ChevronLeft, ChevronRight, File, Layers } from 'lucide-react';
import { useState } from 'react';
import { useEditorStore } from '@/stores/editor';
import { useSite, usePages, useSections } from '@/hooks/use-site';
import { cn } from '@/lib/utils';

export function SiteInfoPanel({ siteId }: { siteId: string }) {
  const [collapsed, setCollapsed] = useState(false);
  const { data: site } = useSite(siteId);
  const { data: pages = [] } = usePages(siteId);
  const { data: sections = [] } = useSections(siteId);
  const selection = useEditorStore((s) => s.selection);
  const select = useEditorStore((s) => s.select);

  if (collapsed) {
    return (
      <div className="flex h-full flex-col items-center gap-3 border-r border-black/10 bg-paper-raised py-3">
        <button
          onClick={() => setCollapsed(false)}
          className="rounded-md p-1.5 hover:bg-black/5"
          title="Expand"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        <Layers className="h-4 w-4 text-ink/40" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden border-r border-black/10 bg-paper-raised">
      <div className="flex items-center justify-between border-b border-black/5 px-4 py-3">
        <div className="min-w-0">
          <div className="text-[11px] font-medium uppercase tracking-wider text-ink/50">Site</div>
          <button
            onClick={() => select({ kind: 'site', id: siteId })}
            className={cn(
              'truncate text-left text-sm font-semibold',
              selection?.kind === 'site' ? 'text-accent' : 'text-ink hover:text-accent',
            )}
          >
            {site?.name ?? '…'}
          </button>
        </div>
        <button
          onClick={() => setCollapsed(true)}
          className="rounded-md p-1.5 hover:bg-black/5"
          title="Collapse"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        <div className="mb-2 px-1 text-[11px] font-medium uppercase tracking-wider text-ink/50">
          Pages ({pages.length})
        </div>
        <div className="space-y-1">
          {pages.map((p) => {
            const pageSections = sections.filter((s) => s.pageId === p.id);
            const isSel = selection?.kind === 'page' && selection.id === p.id;
            return (
              <div key={p.id}>
                <button
                  onClick={() => select({ kind: 'page', id: p.id })}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition',
                    isSel ? 'bg-accent-soft text-accent' : 'hover:bg-black/5',
                  )}
                >
                  <File className="h-3.5 w-3.5 shrink-0 text-ink/40" />
                  <span className="truncate">{p.name}</span>
                  {p.locked && <span className="ml-auto text-[10px] text-amber-600">🔒</span>}
                </button>
                <div className="ml-5 mt-0.5 space-y-0.5 border-l border-black/5 pl-2">
                  {pageSections.map((s) => {
                    const ssel = selection?.kind === 'section' && selection.id === s.id;
                    return (
                      <button
                        key={s.id}
                        onClick={() => select({ kind: 'section', id: s.id })}
                        className={cn(
                          'flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs transition',
                          ssel ? 'bg-accent-soft text-accent' : 'text-ink/60 hover:bg-black/5 hover:text-ink',
                        )}
                      >
                        <span className="capitalize">{s.type}</span>
                        {s.locked && <span className="ml-auto text-[10px] text-amber-600">🔒</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {pages.length === 0 && (
            <div className="px-2 text-xs text-ink/40">No pages yet. Use "Add page".</div>
          )}
        </div>
      </div>

      <div className="border-t border-black/5 p-3">
        <Link
          href={`/sites/${siteId}/changes`}
          className="btn-ghost w-full justify-center text-xs"
        >
          View changes
        </Link>
      </div>
    </div>
  );
}
