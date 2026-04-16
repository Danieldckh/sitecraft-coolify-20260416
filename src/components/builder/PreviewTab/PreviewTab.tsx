'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { Switch } from '@/components/ui/Switch';
import { cn } from '@/lib/cn';
import { usePages, useSite, useTheme } from '@/hooks/use-site';
import { useEditorStore, type InspectorSelection } from '@/stores/editor';
import type { PageDTO } from '@/types/models';
import { buildFullSiteDoc } from './buildFullSiteDoc';
import { InspectorPopover } from './InspectorPopover';

type Viewport = 'desktop' | 'tablet' | 'mobile';

const VIEWPORTS: Record<Viewport, { label: string; width: number; icon: typeof Monitor }> = {
  desktop: { label: 'Desktop', width: 1280, icon: Monitor },
  tablet: { label: 'Tablet', width: 768, icon: Tablet },
  mobile: { label: 'Mobile', width: 390, icon: Smartphone },
};

export function PreviewTab({ siteId }: { siteId: string }) {
  const { data: site } = useSite(siteId);
  const { data: pages, isLoading: pagesLoading } = usePages(siteId);
  const { data: theme, isLoading: themeLoading } = useTheme(siteId);
  const storePageId = useEditorStore((s) => s.selectedPageId);
  const setSelectedPageId = useEditorStore((s) => s.setSelectedPageId);
  const setTab = useEditorStore((s) => s.setTab);
  const inspectorOn = useEditorStore((s) => s.inspectorOn);
  const setInspectorOn = useEditorStore((s) => s.setInspectorOn);
  const inspectorSelection = useEditorStore((s) => s.inspectorSelection);
  const setInspectorSelection = useEditorStore((s) => s.setInspectorSelection);

  const activePage: PageDTO | null = useMemo(() => {
    if (!pages || pages.length === 0) return null;
    return pages.find((p) => p.id === storePageId) ?? pages[0];
  }, [pages, storePageId]);

  const [viewport, setViewport] = useState<Viewport>('desktop');
  const [refreshKey, setRefreshKey] = useState(0);

  const srcDoc = useMemo(() => {
    if (!theme || !pages || pages.length === 0 || !activePage) return null;
    return buildFullSiteDoc({
      site: { name: site?.name ?? 'Preview' },
      theme,
      pages,
      currentSlug: activePage.slug,
    });
    // refreshKey intentionally included to allow manual refresh.
    // activePage is intentionally excluded: slug switches are posted into
    // the iframe, not rebuilt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme, pages, site?.name, refreshKey]);

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

        <label className="flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-1">
          <span className="text-xs font-medium text-[var(--text-secondary)]">Edit mode</span>
          <Switch
            checked={inspectorOn}
            onCheckedChange={(b) => {
              setInspectorOn(b);
              if (!b) setInspectorSelection(null);
            }}
            aria-label="Toggle edit mode"
          />
        </label>

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

      <div className="-mt-2 text-[11px] text-[var(--text-muted)]">
        <span>Home</span>
        <span className="mx-1.5">›</span>
        <span>
          Currently viewing:{' '}
          <span className="text-[var(--text-secondary)]">{activePage?.name ?? ''}</span>
        </span>
      </div>

      <PreviewFrame
        key={refreshKey}
        srcDoc={srcDoc ?? ''}
        width={VIEWPORTS[viewport].width}
        siteName={site?.name ?? 'Preview'}
        activeSlug={activePage?.slug ?? ''}
        siteId={siteId}
        pageId={activePage?.id ?? ''}
        inspectorOn={inspectorOn}
        inspectorSelection={inspectorSelection}
        onInspectorSelect={setInspectorSelection}
        onNavigate={(slug) => {
          const match = pages.find((p) => p.slug === slug);
          if (match) setSelectedPageId(match.id);
        }}
      />
    </div>
  );
}

interface PreviewFrameProps {
  srcDoc: string;
  width: number;
  siteName: string;
  activeSlug: string;
  siteId: string;
  pageId: string;
  inspectorOn: boolean;
  inspectorSelection: InspectorSelection | null;
  onInspectorSelect: (sel: InspectorSelection | null) => void;
  onNavigate: (slug: string) => void;
}

function PreviewFrame({
  srcDoc,
  width,
  siteName,
  activeSlug,
  siteId,
  pageId,
  inspectorOn,
  inspectorSelection,
  onInspectorSelect,
  onNavigate,
}: PreviewFrameProps) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const textResolverRef = useRef<
    Map<string, (value: string) => void>
  >(new Map());

  const postToFrame = useCallback((msg: unknown) => {
    const win = frameRef.current?.contentWindow;
    if (!win) return;
    win.postMessage(msg, '*');
  }, []);

  // Listen for iframe messages: navigation + inspector events.
  useEffect(() => {
    function onMessage(ev: MessageEvent) {
      if (ev.source !== frameRef.current?.contentWindow) return;
      const d = ev.data;
      if (!d || typeof d !== 'object') return;
      if (d.type === 'sc-navigate' && typeof d.slug === 'string') {
        onNavigate(d.slug);
      } else if (d.type === 'sc-inspector-select') {
        const frame = frameRef.current;
        if (!frame) return;
        const frameRect = frame.getBoundingClientRect();
        const r = d.boundingClientRect ?? { top: 0, left: 0, width: 0, height: 0 };
        onInspectorSelect({
          selectorId: String(d.selectorId || ''),
          tagName: String(d.tagName || 'div'),
          textPreview: String(d.textPreview || ''),
          promoted: Boolean(d.promoted),
          rect: {
            top: frameRect.top + r.top,
            left: frameRect.left + r.left,
            width: r.width,
            height: r.height,
          },
        });
      } else if (d.type === 'sc-inspector-text-value' && typeof d.selectorId === 'string') {
        const resolver = textResolverRef.current.get(d.selectorId);
        if (resolver) {
          resolver(String(d.text ?? ''));
          textResolverRef.current.delete(d.selectorId);
        }
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [onNavigate, onInspectorSelect]);

  // Post navigation into the iframe when the parent selection changes.
  useEffect(() => {
    if (!activeSlug) return;
    postToFrame({ type: 'sc-navigate', slug: activeSlug });
  }, [activeSlug, srcDoc, postToFrame]);

  // Toggle inspector mode inside iframe.
  useEffect(() => {
    postToFrame({ type: 'sc-inspector-mode', enabled: inspectorOn });
    if (!inspectorOn) {
      postToFrame({ type: 'sc-inspector-deselect' });
    }
  }, [inspectorOn, srcDoc, postToFrame]);

  const applyReplace = useCallback(
    (selectorId: string, html: string, css?: string) => {
      postToFrame({ type: 'sc-inspector-replace', selectorId, html, css });
    },
    [postToFrame],
  );

  const liveText = useCallback(
    (selectorId: string, text: string) => {
      postToFrame({ type: 'sc-inspector-text', selectorId, text });
    },
    [postToFrame],
  );

  const requestText = useCallback(
    (selectorId: string) => {
      return new Promise<string>((resolve) => {
        // Drop any stale resolver for the same id.
        textResolverRef.current.set(selectorId, resolve);
        postToFrame({ type: 'sc-inspector-get-text', selectorId });
        // Timeout fallback
        setTimeout(() => {
          const r = textResolverRef.current.get(selectorId);
          if (r) {
            textResolverRef.current.delete(selectorId);
            r('');
          }
        }, 800);
      });
    },
    [postToFrame],
  );

  const closeInspector = useCallback(() => {
    onInspectorSelect(null);
    postToFrame({ type: 'sc-inspector-deselect' });
  }, [onInspectorSelect, postToFrame]);

  return (
    <>
      <div
        className={cn(
          'mx-auto flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border',
          'border-[var(--border-subtle)] bg-[var(--bg-sunken)] shadow-[var(--shadow-md)]',
        )}
        style={{ width: '100%', maxWidth: width }}
      >
        <iframe
          ref={frameRef}
          title={`Preview of ${siteName}`}
          sandbox="allow-scripts"
          srcDoc={srcDoc}
          className="h-full w-full flex-1 border-0 bg-white"
          style={{ minHeight: 600 }}
        />
      </div>
      {inspectorOn && inspectorSelection && pageId ? (
        <InspectorPopover
          siteId={siteId}
          pageId={pageId}
          selection={inspectorSelection}
          onClose={closeInspector}
          onApplyReplace={applyReplace}
          onLiveText={liveText}
          requestText={requestText}
        />
      ) : null}
    </>
  );
}
