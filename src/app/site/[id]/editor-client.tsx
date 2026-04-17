'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Inspector, type SelectedElement } from './inspector';

interface EditorClientProps {
  siteId: string;
  building: boolean;
}

interface SiteInfo {
  id: string;
  name: string;
}

interface PageTab {
  slug: string;
  name: string;
}

type HostStatus =
  | 'idle'
  | 'queued'
  | 'bundling'
  | 'pushing'
  | 'deploying'
  | 'probing'
  | 'live'
  | 'failed';

interface HostState {
  status: HostStatus;
  url: string | null;
  message: string | null;
}

const HOME_SLUG = 'home';

const HOST_BUSY_STATES: ReadonlySet<HostStatus> = new Set([
  'queued',
  'bundling',
  'pushing',
  'deploying',
  'probing',
]);

function hostStatusLabel(status: HostStatus): string {
  switch (status) {
    case 'queued':
      return 'Queued';
    case 'bundling':
      return 'Bundling';
    case 'pushing':
      return 'Pushing';
    case 'deploying':
      return 'Deploying';
    case 'probing':
      return 'Probing';
    case 'live':
      return 'Live';
    case 'failed':
      return 'Failed';
    default:
      return '';
  }
}

const HOVER_STYLE = `
/* Injected by Sitecraft editor */
[data-el-id] { position: relative; }
[data-el-id]:hover {
  outline: 2px solid rgba(23, 23, 26, 0.55);
  outline-offset: -2px;
  cursor: pointer;
}
[data-el-id][data-role]:hover::after {
  content: attr(data-role);
  position: absolute;
  top: 8px;
  left: 8px;
  padding: 3px 7px;
  background: #17171a;
  color: #ffffff;
  font: 500 10.5px/1 ui-sans-serif, system-ui, -apple-system, sans-serif;
  letter-spacing: 0.02em;
  text-transform: lowercase;
  border-radius: 4px;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.08),
              0 6px 18px -6px rgba(0,0,0,0.4);
  pointer-events: none;
  z-index: 2147483647;
}
[data-el-id].sc-selected {
  outline: 2px solid #17171a !important;
  outline-offset: -2px;
  box-shadow: 0 0 0 4px rgba(23, 23, 26, 0.08);
}
`;

export function EditorClient({ siteId, building }: EditorClientProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [site, setSite] = useState<SiteInfo | null>(null);
  const [siteError, setSiteError] = useState<string | null>(null);
  const [iframeNonce, setIframeNonce] = useState(() => Date.now());
  const [iframeReady, setIframeReady] = useState(false);
  const [selected, setSelected] = useState<SelectedElement | null>(null);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applySuccess, setApplySuccess] = useState(false);
  const [activeSlug, setActiveSlug] = useState<string>(HOME_SLUG);
  const [pages, setPages] = useState<PageTab[]>([
    { slug: HOME_SLUG, name: 'Home' },
  ]);

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
        const name =
          typeof data?.name === 'string' ? data.name : 'Untitled site';
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

  // Auto-clear inspector success state after 1.5s.
  useEffect(() => {
    if (!applySuccess) return;
    const t = setTimeout(() => setApplySuccess(false), 1500);
    return () => clearTimeout(t);
  }, [applySuccess]);

  const reloadIframe = useCallback(() => {
    setIframeNonce(Date.now());
    setIframeReady(false);
    setSelected(null);
  }, []);

  const handleTabChange = useCallback(
    (slug: string) => {
      if (slug === activeSlug) return;
      setActiveSlug(slug);
      setIframeReady(false);
      setSelected(null);
      setApplyError(null);
      setApplySuccess(false);
      setIframeNonce(Date.now());
    },
    [activeSlug],
  );

  // Since builds now run detached from the client connection, any visit to
  // /site/[id] may land on a site that's still under construction. Poll the
  // sites API — if this site is still building, bump the iframe nonce so new
  // sections appear as they finish. Stop once build completes (or after 10
  // minutes as a safety net).
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const deadline = Date.now() + 10 * 60_000;

    const tick = async (): Promise<void> => {
      if (cancelled || Date.now() > deadline) return;
      try {
        const res = await fetch('/api/sites', { cache: 'no-store' });
        if (res.ok) {
          const data = (await res.json()) as {
            sites?: { id: string; build?: { inProgress?: boolean } }[];
          };
          const me = data.sites?.find((s) => s.id === siteId);
          if (me?.build?.inProgress) {
            setIframeNonce(Date.now());
            timer = setTimeout(tick, 3000);
            return;
          }
          // One more refresh so the final state lands, then stop.
          setIframeNonce(Date.now());
        }
      } catch {
        // Transient network — try again shortly.
        if (!cancelled) timer = setTimeout(tick, 5000);
      }
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [siteId]);

  // Wire up click-to-edit + hover styles inside the iframe whenever it loads.
  const handleIframeLoad = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    let doc: Document | null = null;
    try {
      doc = iframe.contentDocument;
    } catch {
      setIframeReady(true);
      return;
    }
    if (!doc) return;

    setIframeReady(true);

    // Discover page nav links in the iframe.
    try {
      const anchors = Array.from(
        doc.querySelectorAll('a[href^="./"]'),
      ) as HTMLAnchorElement[];
      const seen = new Set<string>();
      const discovered: PageTab[] = [];
      for (const a of anchors) {
        const raw = a.getAttribute('href') || '';
        const slug = raw
          .replace(/^\.\//, '')
          .replace(/[/?#].*$/, '')
          .trim();
        if (!slug || seen.has(slug)) continue;
        seen.add(slug);
        const label =
          (a.textContent || '').trim() ||
          slug.charAt(0).toUpperCase() + slug.slice(1);
        discovered.push({ slug, name: label });
      }
      if (discovered.length > 0) {
        if (!seen.has(activeSlug)) {
          discovered.unshift({
            slug: activeSlug,
            name:
              activeSlug.charAt(0).toUpperCase() + activeSlug.slice(1),
          });
        }
        setPages(discovered);
      }
    } catch {
      /* keep existing pages list */
    }

    if (!doc.getElementById('sc-editor-hover-style')) {
      const style = doc.createElement('style');
      style.id = 'sc-editor-hover-style';
      style.textContent = HOVER_STYLE;
      doc.head.appendChild(style);
    }

    doc.querySelectorAll('[data-el-id]').forEach((el) => {
      const node = el as HTMLElement;
      if (!node.getAttribute('data-role')) {
        const cls = (node.className || '').toString().split(/\s+/)[0];
        if (cls) node.setAttribute('data-role', cls);
      }
    });

    if (selected) {
      const prev = doc.querySelector('.sc-selected');
      if (prev) prev.classList.remove('sc-selected');
      const match = doc.querySelector(
        `[data-el-id="${cssEscape(selected.id)}"]`,
      );
      if (match) match.classList.add('sc-selected');
    }

    const onClick = (e: Event) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const el = target.closest('[data-el-id]') as HTMLElement | null;
      if (!el) return;
      const id = el.getAttribute('data-el-id');
      if (!id) return;
      e.preventDefault();
      e.stopPropagation();

      const prev = doc!.querySelector('.sc-selected');
      if (prev) prev.classList.remove('sc-selected');
      el.classList.add('sc-selected');

      const role = el.getAttribute('data-role') || inferRole(el);
      setSelected({ id, html: el.outerHTML, role });
      setApplyError(null);
      setApplySuccess(false);
    };

    doc.addEventListener('click', onClick, true);

    const onAnchorClick = (e: Event) => {
      const target = e.target as HTMLElement | null;
      const anchor = target?.closest('a') as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = anchor.getAttribute('href') || '';
      if (href.startsWith('http')) {
        e.preventDefault();
        return;
      }
      if (href.startsWith('./')) {
        const slug = href
          .replace(/^\.\//, '')
          .replace(/[/?#].*$/, '')
          .trim();
        if (slug) {
          e.preventDefault();
          e.stopPropagation();
          handleTabChange(slug);
        }
      }
    };
    doc.addEventListener('click', onAnchorClick);

    const cleanup = () => {
      doc!.removeEventListener('click', onClick, true);
      doc!.removeEventListener('click', onAnchorClick);
    };
    iframe.addEventListener('unload', cleanup, { once: true });
  }, [selected, activeSlug, handleTabChange]);

  const handleApply = useCallback(
    async (prompt: string) => {
      if (!selected) return;
      setApplying(true);
      setApplyError(null);
      setApplySuccess(false);
      try {
        const res = await fetch('/api/edit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            siteId,
            pageSlug: activeSlug,
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
            /* ignore */
          }
          throw new Error(msg);
        }
        setApplySuccess(true);
        // Small delay so the user registers the success state before reload.
        setTimeout(() => {
          reloadIframe();
        }, 400);
      } catch (err) {
        setApplyError(err instanceof Error ? err.message : 'Edit failed');
      } finally {
        setApplying(false);
      }
    },
    [selected, siteId, activeSlug, reloadIframe],
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
    setApplySuccess(false);
  }, []);

  const displayName = site?.name ?? (siteError ? 'Error' : null);

  return (
    <div className="flex h-screen w-screen flex-col bg-[color:var(--sc-bg)] text-[color:var(--sc-ink)]">
      {/* Top bar */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-[color:var(--sc-border)] bg-[color:var(--sc-panel)] px-5">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href="/"
            aria-label="Back"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[color:var(--sc-muted)] transition-colors hover:bg-[color:var(--sc-panel-2)] hover:text-[color:var(--sc-ink)]"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="flex min-w-0 items-center gap-2">
            <span className="font-display text-[17px] leading-none tracking-[-0.005em] text-[color:var(--sc-ink)]">
              Sitecraft
            </span>
            <span
              aria-hidden
              className="text-[13px] text-[color:var(--sc-muted-2)]"
            >
              ·
            </span>
            <span className="truncate text-[13px] text-[color:var(--sc-ink-2)]">
              {displayName ?? 'Loading…'}
            </span>
            {building ? (
              <span className="ml-1 inline-flex items-center rounded-full border border-[color:var(--sc-border)] bg-[color:var(--sc-panel-2)] px-2 py-0.5 text-[10.5px] font-medium text-[color:var(--sc-muted)]">
                Building
              </span>
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <a
            href={`/api/export/${siteId}`}
            download
            className="inline-flex items-center justify-center rounded-[10px] bg-[color:var(--sc-accent)] px-3.5 py-1.5 text-[12.5px] font-medium text-white transition-colors hover:bg-[color:var(--sc-accent-hover)]"
          >
            Export ZIP
          </a>
        </div>
      </header>

      {/* Page tabs row */}
      <div className="h-10 shrink-0 border-b border-[color:var(--sc-border)] bg-[color:var(--sc-panel)]">
        <EditorPageTabs
          pages={pages}
          activeSlug={activeSlug}
          onChange={handleTabChange}
        />
      </div>

      {/* Split view */}
      <div className="flex min-h-0 flex-1">
        {/* Preview pane (~70%) */}
        <section className="flex min-w-0 flex-[7] items-stretch bg-[color:var(--sc-bg)] p-5">
          <div className="sc-soft-shadow relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[var(--sc-radius-card)] border border-[color:var(--sc-border)] bg-white">
            <iframe
              ref={iframeRef}
              key={`${activeSlug}-${iframeNonce}`}
              src={`/preview/${siteId}/${activeSlug}?_=${iframeNonce}`}
              onLoad={handleIframeLoad}
              title="Site preview"
              className={`h-full w-full border-0 bg-white transition-opacity duration-300 ${
                iframeReady ? 'opacity-100' : 'opacity-0'
              }`}
            />
            {!iframeReady ? (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[color:var(--sc-panel-2)]">
                <span className="text-[12px] text-[color:var(--sc-muted)]">
                  Loading preview…
                </span>
              </div>
            ) : null}
          </div>
        </section>

        {/* Inspector pane (~30%) */}
        <aside className="flex w-[360px] shrink-0 flex-col border-l border-[color:var(--sc-border)] bg-[color:var(--sc-panel)]">
          <Inspector
            selected={selected}
            pageSlug={activeSlug}
            onClear={handleClearSelection}
            onApply={handleApply}
            busy={applying}
            error={applyError}
            success={applySuccess}
          />
        </aside>
      </div>
    </div>
  );
}

function EditorPageTabs({
  pages,
  activeSlug,
  onChange,
}: {
  pages: PageTab[];
  activeSlug: string;
  onChange: (slug: string) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Pages"
      className="flex h-full items-end overflow-x-auto px-4"
    >
      {pages.map((p) => {
        const active = p.slug === activeSlug;
        return (
          <button
            key={p.slug}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(p.slug)}
            className={`relative -mb-px shrink-0 border-b-2 px-3 py-2 text-[12.5px] transition-colors ${
              active
                ? 'border-[color:var(--sc-ink)] font-medium text-[color:var(--sc-ink)]'
                : 'border-transparent font-normal text-[color:var(--sc-muted)] hover:text-[color:var(--sc-ink)]'
            }`}
          >
            {p.name}
          </button>
        );
      })}
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
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return value.replace(/["\\]/g, '\\$&');
}
