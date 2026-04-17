'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Download, Home, Loader2 } from 'lucide-react';
import { Inspector, type SelectedElement } from './inspector';

interface EditorClientProps {
  siteId: string;
  building: boolean;
}

interface SiteInfo {
  id: string;
  name: string;
}

const HOVER_STYLE = `
/* Injected by Sitecraft editor */
[data-el-id] { position: relative; }
[data-el-id]:hover {
  outline: 2px solid rgba(59, 130, 246, 0.6);
  outline-offset: -2px;
  cursor: pointer;
}
[data-el-id].sc-selected {
  outline: 2px solid rgb(59, 130, 246) !important;
  outline-offset: -2px;
}
`;

export function EditorClient({ siteId, building }: EditorClientProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [site, setSite] = useState<SiteInfo | null>(null);
  const [siteError, setSiteError] = useState<string | null>(null);
  const [iframeNonce, setIframeNonce] = useState(() => Date.now());
  const [selected, setSelected] = useState<SelectedElement | null>(null);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  // Fetch site metadata for the top bar name.
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(`/api/sites/${siteId}`, { cache: 'no-store' });
        if (!res.ok) {
          throw new Error(`Failed to load site (${res.status})`);
        }
        const data = await res.json();
        if (cancelled) return;
        // GET /api/sites/[id] returns the SiteDTO directly.
        const name = typeof data?.name === 'string' ? data.name : 'Untitled site';
        const id = typeof data?.id === 'string' ? data.id : siteId;
        setSite({ id, name });
      } catch (err) {
        if (cancelled) return;
        setSiteError(err instanceof Error ? err.message : 'Failed to load site');
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [siteId]);

  const reloadIframe = useCallback(() => {
    setIframeNonce(Date.now());
    setSelected(null);
  }, []);

  // If ?building=1 is still set, poll the preview while the build completes.
  useEffect(() => {
    if (!building) return;
    const interval = setInterval(() => {
      setIframeNonce(Date.now());
    }, 1500);
    // Stop polling after 60s as a safety net.
    const stop = setTimeout(() => clearInterval(interval), 60_000);
    return () => {
      clearInterval(interval);
      clearTimeout(stop);
    };
  }, [building]);

  // Wire up click-to-edit + hover styles inside the iframe whenever it loads.
  const handleIframeLoad = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const doc = iframe.contentDocument;
    if (!doc) return;

    // Inject hover style (idempotent).
    if (!doc.getElementById('sc-editor-hover-style')) {
      const style = doc.createElement('style');
      style.id = 'sc-editor-hover-style';
      style.textContent = HOVER_STYLE;
      doc.head.appendChild(style);
    }

    // Re-apply selected outline if still relevant.
    if (selected) {
      const prev = doc.querySelector('.sc-selected');
      if (prev) prev.classList.remove('sc-selected');
      const match = doc.querySelector(`[data-el-id="${cssEscape(selected.id)}"]`);
      if (match) match.classList.add('sc-selected');
    }

    // Attach click handler (once per load).
    const onClick = (e: Event) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const el = target.closest('[data-el-id]') as HTMLElement | null;
      if (!el) return;
      const id = el.getAttribute('data-el-id');
      if (!id) return;
      e.preventDefault();
      e.stopPropagation();

      // Swap selected outline.
      const prev = doc.querySelector('.sc-selected');
      if (prev) prev.classList.remove('sc-selected');
      el.classList.add('sc-selected');

      const role = el.getAttribute('data-role') || inferRole(el);
      setSelected({ id, html: el.outerHTML, role });
      setApplyError(null);
    };

    doc.addEventListener('click', onClick, true);

    // Prevent internal anchors from navigating the iframe away.
    const onAnchorClick = (e: Event) => {
      const target = e.target as HTMLElement | null;
      const anchor = target?.closest('a') as HTMLAnchorElement | null;
      if (anchor && anchor.getAttribute('href')?.startsWith('http')) {
        e.preventDefault();
      }
    };
    doc.addEventListener('click', onAnchorClick);

    // Cleanup when iframe unloads/reloads.
    const cleanup = () => {
      doc.removeEventListener('click', onClick, true);
      doc.removeEventListener('click', onAnchorClick);
    };
    iframe.addEventListener('unload', cleanup, { once: true });
  }, [selected]);

  const handleApply = useCallback(
    async (prompt: string) => {
      if (!selected) return;
      setApplying(true);
      setApplyError(null);
      try {
        const res = await fetch('/api/edit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            siteId,
            elementId: selected.id,
            prompt,
          }),
        });
        if (!res.ok) {
          let msg = `Edit failed (${res.status})`;
          try {
            const body = await res.json();
            if (body && typeof body.error === 'string') msg = body.error;
          } catch {
            // ignore
          }
          throw new Error(msg);
        }
        // Success — reload the iframe to reflect the change.
        reloadIframe();
      } catch (err) {
        setApplyError(err instanceof Error ? err.message : 'Edit failed');
      } finally {
        setApplying(false);
      }
    },
    [selected, siteId, reloadIframe],
  );

  const handleClearSelection = useCallback(() => {
    const iframe = iframeRef.current;
    const doc = iframe?.contentDocument;
    if (doc) {
      const prev = doc.querySelector('.sc-selected');
      if (prev) prev.classList.remove('sc-selected');
    }
    setSelected(null);
    setApplyError(null);
  }, []);

  const displayName = site?.name ?? (siteError ? 'Error' : null);

  return (
    <div className="flex h-screen w-screen flex-col bg-neutral-50 text-neutral-900">
      {/* Top bar */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-neutral-200 bg-white px-4">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-sm font-medium text-neutral-900 truncate">
            {displayName ?? (
              <span className="inline-flex items-center gap-2 text-neutral-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>Loading…</span>
              </span>
            )}
          </span>
          {building ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">
              <Loader2 className="h-3 w-3 animate-spin" />
              Building
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <a
            href={`/api/export/${siteId}`}
            download
            className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 shadow-sm transition hover:bg-neutral-50"
          >
            <Download className="h-3.5 w-3.5" />
            Export ZIP
          </a>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-neutral-600 transition hover:bg-neutral-100"
          >
            <Home className="h-3.5 w-3.5" />
            Home
          </Link>
        </div>
      </header>

      {/* Split view */}
      <div className="flex min-h-0 flex-1">
        {/* Preview pane (70%) */}
        <div className="flex min-w-0 flex-[7] items-stretch border-r border-neutral-200 bg-neutral-100">
          <div className="relative flex-1">
            <iframe
              ref={iframeRef}
              key={iframeNonce}
              src={`/preview/${siteId}?_=${iframeNonce}`}
              onLoad={handleIframeLoad}
              title="Site preview"
              className="h-full w-full border-0 bg-white"
            />
          </div>
        </div>

        {/* Inspector pane (30%) */}
        <aside className="flex w-0 flex-[3] min-w-[320px] flex-col bg-white">
          <Inspector
            selected={selected}
            onClear={handleClearSelection}
            onApply={handleApply}
            busy={applying}
            error={applyError}
          />
        </aside>
      </div>
    </div>
  );
}

function inferRole(el: HTMLElement): string {
  const cls = el.className || '';
  if (typeof cls === 'string' && cls.length > 0) {
    return cls.split(/\s+/)[0] || 'section';
  }
  return el.tagName.toLowerCase();
}

function cssEscape(value: string): string {
  // Minimal CSS.escape polyfill for older targets.
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return value.replace(/["\\]/g, '\\$&');
}
