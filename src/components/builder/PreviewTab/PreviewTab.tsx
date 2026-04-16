'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, Monitor, RefreshCw, Smartphone, Sparkles, Tablet } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/Select';
import { Label } from '@/components/ui/Label';
import { cn } from '@/lib/cn';
import { usePages, useTheme } from '@/hooks/use-site';
import { useEditorStore } from '@/stores/editor';
import type { PageDTO } from '@/types/models';
import { buildPreviewDoc } from './buildPreviewDoc';

type Viewport = 'desktop' | 'tablet' | 'mobile';

const VIEWPORTS: Record<Viewport, { label: string; width: number; icon: typeof Monitor }> = {
  desktop: { label: 'Desktop', width: 1280, icon: Monitor },
  tablet: { label: 'Tablet', width: 768, icon: Tablet },
  mobile: { label: 'Mobile', width: 390, icon: Smartphone },
};

export function PreviewTab({ siteId }: { siteId: string }) {
  const { data: pages, isLoading: pagesLoading } = usePages(siteId);
  const { data: theme, isLoading: themeLoading } = useTheme(siteId);
  const storePageId = useEditorStore((s) => s.selectedPageId);
  const setSelectedPageId = useEditorStore((s) => s.setSelectedPageId);
  const setTab = useEditorStore((s) => s.setTab);

  const activePage: PageDTO | null = useMemo(() => {
    if (!pages || pages.length === 0) return null;
    return pages.find((p) => p.id === storePageId) ?? pages[0];
  }, [pages, storePageId]);

  const [viewport, setViewport] = useState<Viewport>('desktop');
  const [refreshKey, setRefreshKey] = useState(0);

  const srcDoc = useMemo(() => {
    if (!theme || !activePage || !activePage.pageHtml) return null;
    return buildPreviewDoc({ page: activePage, theme });
    // refreshKey intentionally included to allow manual refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme, activePage, refreshKey]);

  // ─── Empty states ─────────────────────────────────────────────────
  if (themeLoading || pagesLoading) {
    return (
      <div className="p-6" role="status" aria-live="polite">
        <Card>
          <CardBody className="py-10 text-center text-sm text-[var(--text-secondary)]">
            Loading preview…
          </CardBody>
        </Card>
      </div>
    );
  }

  if (!theme) {
    return (
      <div className="p-6">
        <Card className="mx-auto max-w-xl">
          <CardBody className="space-y-3 py-8 text-center">
            <div className="text-base font-semibold text-[var(--text-primary)]">
              No theme yet
            </div>
            <p className="text-sm text-[var(--text-secondary)]">
              Generate a theme from the Build tab to unlock the preview.
            </p>
            <div className="flex justify-center">
              <Button
                onClick={() => setTab('build')}
                leftIcon={<Sparkles className="h-3.5 w-3.5" aria-hidden />}
              >
                Go to Build
              </Button>
            </div>
          </CardBody>
        </Card>
      </div>
    );
  }

  if (!pages || pages.length === 0) {
    return (
      <div className="p-6">
        <Card className="mx-auto max-w-xl">
          <CardBody className="space-y-2 py-8 text-center">
            <div className="text-base font-semibold text-[var(--text-primary)]">
              No pages yet
            </div>
            <p className="text-sm text-[var(--text-secondary)]">
              Add a page from the Build tab to preview it here.
            </p>
          </CardBody>
        </Card>
      </div>
    );
  }

  const needsGeneration = !activePage?.pageHtml?.trim();

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-6">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-[220px] flex-col gap-1">
          <Label htmlFor="preview-page-select" className="text-[11px] uppercase tracking-[var(--ls-wide)] text-[var(--text-muted)]">
            Page
          </Label>
          <Select
            value={activePage?.id ?? ''}
            onValueChange={(v) => setSelectedPageId(v)}
          >
            <SelectTrigger id="preview-page-select" aria-label="Preview page">
              <SelectValue placeholder="Select a page" />
            </SelectTrigger>
            <SelectContent>
              {pages.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                  <span className="ml-2 font-mono text-[11px] text-[var(--text-muted)]">
                    /{p.slug}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div
          role="group"
          aria-label="Preview viewport size"
          className="ml-auto flex items-center gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-1"
        >
          {(Object.keys(VIEWPORTS) as Viewport[]).map((key) => {
            const v = VIEWPORTS[key];
            const Icon = v.icon;
            const active = viewport === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setViewport(key)}
                aria-pressed={active}
                aria-label={`${v.label} (${v.width}px)`}
                className={cn(
                  'inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium',
                  'transition-colors',
                  active
                    ? 'bg-[var(--bg-sunken)] text-[var(--text-primary)]'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--state-hover)]',
                )}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden />
                <span>{v.label}</span>
              </button>
            );
          })}
        </div>

        <Button
          variant="ghost"
          size="icon"
          aria-label="Refresh preview"
          onClick={() => setRefreshKey((k) => k + 1)}
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
        </Button>
        <Link
          href={activePage ? `/preview/${siteId}/${activePage.slug}` : '#'}
          target="_blank"
          rel="noreferrer"
          aria-label="Open preview in new tab"
          className={cn(
            'inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border-default)]',
            'text-[var(--text-primary)] hover:bg-[var(--state-hover)]',
          )}
        >
          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </div>

      <p className="-mt-2 text-[11px] text-[var(--text-muted)]">
        Full site navigation across pages — coming soon.
      </p>

      {/* Iframe surface */}
      {needsGeneration ? (
        <Card className="mx-auto w-full max-w-xl">
          <CardBody className="space-y-3 py-8 text-center">
            <div className="text-base font-semibold text-[var(--text-primary)]">
              Page not yet generated
            </div>
            <p className="text-sm text-[var(--text-secondary)]">
              Generate this page from the Build tab to see it here.
            </p>
            <div className="flex justify-center">
              <Button
                onClick={() => setTab('build')}
                leftIcon={<Sparkles className="h-3.5 w-3.5" aria-hidden />}
              >
                Go to Build
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : (
        <PreviewFrame srcDoc={srcDoc ?? ''} width={VIEWPORTS[viewport].width} pageName={activePage?.name ?? ''} />
      )}
    </div>
  );
}

function PreviewFrame({
  srcDoc,
  width,
  pageName,
}: {
  srcDoc: string;
  width: number;
  pageName: string;
}) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  // Rebuild srcDoc via key change when input changes.
  useEffect(() => {
    // no-op; iframe re-renders on srcDoc change
  }, [srcDoc]);

  return (
    <div
      className={cn(
        'mx-auto flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border',
        'border-[var(--border-subtle)] bg-[var(--bg-sunken)] shadow-[var(--shadow-md)]',
      )}
      style={{ width: '100%', maxWidth: width }}
    >
      <iframe
        ref={frameRef}
        title={`Preview of ${pageName}`}
        sandbox="allow-scripts"
        srcDoc={srcDoc}
        className="h-full w-full flex-1 border-0 bg-white"
        style={{ minHeight: 600 }}
      />
    </div>
  );
}
