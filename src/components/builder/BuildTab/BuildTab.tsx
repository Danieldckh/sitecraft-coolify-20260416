'use client';

import { useEffect } from 'react';
import { PanelRightOpen, PanelRightClose } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import { useEditorStore } from '@/stores/editor';
import { usePages } from '@/hooks/use-site';
import { ThemeGate } from './ThemeGate';
import { PageList } from './PageList';
import { PageComposer } from './PageComposer';
import { AssetsDrawer } from './AssetsDrawer';

export function BuildTab({ siteId }: { siteId: string }) {
  const { data: pages } = usePages(siteId);
  const selectedPageId = useEditorStore((s) => s.selectedPageId);
  const setSelectedPageId = useEditorStore((s) => s.setSelectedPageId);
  const assetsDrawerOpen = useEditorStore((s) => s.assetsDrawerOpen);
  const setAssetsDrawerOpen = useEditorStore((s) => s.setAssetsDrawerOpen);

  // Auto-select first page if none selected.
  useEffect(() => {
    if (!pages || pages.length === 0) return;
    if (!selectedPageId || !pages.some((p) => p.id === selectedPageId)) {
      setSelectedPageId(pages[0].id);
    }
  }, [pages, selectedPageId, setSelectedPageId]);

  return (
    <div className="flex min-h-full flex-col gap-6 p-6">
      <ThemeGate siteId={siteId} />

      <div
        className={cn(
          'grid min-h-0 flex-1 gap-6',
          'grid-cols-1 xl:grid-cols-[260px_minmax(0,1fr)]',
          assetsDrawerOpen && '2xl:grid-cols-[260px_minmax(0,1fr)_320px]',
        )}
      >
        <PageList siteId={siteId} />

        <div className="min-w-0">
          <div className="mb-3 flex items-center justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setAssetsDrawerOpen(!assetsDrawerOpen)}
              leftIcon={
                assetsDrawerOpen ? (
                  <PanelRightClose className="h-3.5 w-3.5" aria-hidden />
                ) : (
                  <PanelRightOpen className="h-3.5 w-3.5" aria-hidden />
                )
              }
              aria-pressed={assetsDrawerOpen}
            >
              Assets
            </Button>
          </div>
          <PageComposer siteId={siteId} />
        </div>

        {assetsDrawerOpen ? (
          <div className="hidden 2xl:block">
            <AssetsDrawer siteId={siteId} />
          </div>
        ) : null}
      </div>

      {/* Mobile/narrow — drawer below when toggled */}
      {assetsDrawerOpen ? (
        <div className="2xl:hidden">
          <AssetsDrawer siteId={siteId} />
        </div>
      ) : null}
    </div>
  );
}
