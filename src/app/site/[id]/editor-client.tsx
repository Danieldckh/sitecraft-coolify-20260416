'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import Link from 'next/link';
import { ArrowLeft, Copy, Hand, MousePointerClick } from 'lucide-react';
import {
  Inspector,
  type InspectMode,
  type SelectedElement,
} from './inspector';

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

const INSPECT_HIGHLIGHT_COLOR = '#3b82f6';

// Rules scoped under `html.sc-inspect-on` fire only when the editor is in
// inspect mode — toggling the class on the iframe's <html> is enough to
// enable/disable every effect in one go (hover fill, role label, cursor).
// The selected-state rule stays active regardless of mode so a stale
// highlight never lingers visually; the parent clears selection on toggle
// anyway, but this is a safe secondary guarantee.
// Layout-safe hover/selected styling.
//
// Earlier versions forced `position: relative` on every [data-el-id] and used
// a giant inset box-shadow to paint a translucent fill. Both broke overlapping
// layouts: the forced positioning hijacked stacking contexts (elements the
// Designer had `position: absolute` over a nearest-positioned ancestor suddenly
// positioned against our ring), and the inset shadow rendered above the
// element's background, visually masking child overlaps.
//
// New approach: outline only. Outlines don't participate in layout, don't
// affect stacking contexts, don't paint over children. We use a thick bright
// outline that sits *outside* the box (`outline-offset: 2px`) so it surrounds
// the element without clipping — unmistakable without altering the page. A
// separate floating overlay (`#__sc_hover_label`) is positioned via JS in
// `handleIframeLoad` to show the role label without relying on `::after` +
// positioned ancestor.
const HOVER_STYLE = `
/* Injected by Sitecraft editor — inspect-mode only */
html.sc-inspect-on [data-el-id]:hover {
  outline: 3px solid ${INSPECT_HIGHLIGHT_COLOR};
  outline-offset: 2px;
  cursor: pointer;
}
html.sc-inspect-on [data-el-id].sc-selected {
  outline: 3px solid ${INSPECT_HIGHLIGHT_COLOR} !important;
  outline-offset: 2px !important;
}
`;

const INSPECT_MODE_SESSION_PREFIX = 'sc:inspectMode:';

function isInspectMode(value: string | null): value is InspectMode {
  return value === 'inspect' || value === 'interact';
}

function readPersistedInspectMode(siteId: string): InspectMode {
  if (typeof window === 'undefined') return 'inspect';
  try {
    const v = window.sessionStorage.getItem(INSPECT_MODE_SESSION_PREFIX + siteId);
    if (isInspectMode(v)) return v;
  } catch {
    /* sessionStorage unavailable — fall through */
  }
  return 'inspect';
}

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
  const [hostState, setHostState] = useState<HostState>({
    status: 'idle',
    url: null,
    message: null,
  });
  const hostAbortRef = useRef<AbortController | null>(null);

  // Editor interaction mode. Default 'inspect' preserves the prior behavior;
  // switching to 'interact' lets iframe clicks reach the site so the user can
  // actually use what they built (links, buttons, scroll buttons, forms).
  // Persisted per site id via sessionStorage so it survives reload-on-apply.
  const [inspectMode, setInspectMode] = useState<InspectMode>(() =>
    readPersistedInspectMode(siteId),
  );
  const inspectModeRef = useRef<InspectMode>(inspectMode);
  useEffect(() => {
    inspectModeRef.current = inspectMode;
  }, [inspectMode]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.sessionStorage.setItem(
        INSPECT_MODE_SESSION_PREFIX + siteId,
        inspectMode,
      );
    } catch {
      /* ignore quota / private-mode errors */
    }
  }, [siteId, inspectMode]);

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

  // Preserves the iframe's vertical scroll position across a reload so the
  // user stays on the element they just edited instead of jumping back to
  // the top of the page.
  const pendingScrollRef = useRef<number | null>(null);

  const reloadIframe = useCallback((preserveScroll = false) => {
    if (preserveScroll) {
      try {
        const win = iframeRef.current?.contentWindow;
        if (win) pendingScrollRef.current = win.scrollY;
      } catch {
        /* cross-origin or detached — no-op */
      }
    } else {
      pendingScrollRef.current = null;
    }
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

    // Restore scroll position if a reload preserved one (edit-apply flow).
    if (pendingScrollRef.current !== null) {
      const target = pendingScrollRef.current;
      pendingScrollRef.current = null;
      try {
        const win = iframe.contentWindow;
        if (win) {
          // Run in a microtask so layout/fonts have settled.
          requestAnimationFrame(() => {
            try {
              win.scrollTo({ top: target, behavior: 'auto' });
            } catch {
              /* ignore */
            }
          });
        }
      } catch {
        /* ignore */
      }
    }

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

    // Reflect the current inspect mode on the iframe's <html> so the scoped
    // hover/selected rules activate. A separate effect keeps this in sync on
    // later toggles; this call ensures the initial paint is correct.
    if (doc.documentElement) {
      doc.documentElement.classList.toggle(
        'sc-inspect-on',
        inspectModeRef.current === 'inspect',
      );
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
      // Interact mode: let the click through to the actual site so links,
      // buttons, forms, scroll-behavior, etc. all work normally. The anchor
      // handler below still runs so internal `./slug` links drive the page
      // tabs rather than navigating the iframe away.
      if (inspectModeRef.current !== 'inspect') return;

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

  // Consume the SSE stream from POST /api/sites/[id]/host, mapping each event
  // into hostState. Resolves cleanly on `event: done`; any `event: error` or
  // `event: failed` flips to the 'failed' state.
  const consumeHostStream = useCallback(async (res: Response): Promise<void> => {
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/event-stream') || !res.body) {
      throw new Error('Server did not return an SSE stream');
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const onEvent = (eventName: string, dataRaw: string) => {
      let data: unknown = undefined;
      if (dataRaw) {
        try {
          data = JSON.parse(dataRaw);
        } catch {
          data = dataRaw;
        }
      }

      switch (eventName) {
        case 'status': {
          const obj =
            data && typeof data === 'object'
              ? (data as Record<string, unknown>)
              : {};
          const rawStatus = typeof obj.status === 'string' ? obj.status : '';
          const msg =
            typeof obj.message === 'string' ? (obj.message as string) : null;
          const status = (rawStatus || 'queued') as HostStatus;
          setHostState((prev) => ({
            status,
            url: status === 'live' ? prev.url : prev.url,
            message: msg,
          }));
          break;
        }
        case 'live': {
          const obj =
            data && typeof data === 'object'
              ? (data as Record<string, unknown>)
              : {};
          const url = typeof obj.url === 'string' ? obj.url : null;
          setHostState({ status: 'live', url, message: null });
          break;
        }
        case 'error': {
          const obj =
            data && typeof data === 'object'
              ? (data as Record<string, unknown>)
              : {};
          const msg =
            typeof obj.message === 'string'
              ? (obj.message as string)
              : 'Deploy failed';
          setHostState((prev) => ({
            status: 'failed',
            url: prev.url,
            message: msg,
          }));
          break;
        }
        case 'done':
        default:
          break;
      }
    };

    const flushBuffer = () => {
      let sepIdx = buffer.indexOf('\n\n');
      while (sepIdx !== -1) {
        const rawEvent = buffer.slice(0, sepIdx);
        buffer = buffer.slice(sepIdx + 2);
        let eventName = 'message';
        const dataLines: string[] = [];
        for (const rawLine of rawEvent.split('\n')) {
          const line = rawLine.replace(/\r$/, '');
          if (!line || line.startsWith(':')) continue;
          if (line.startsWith('event:')) {
            eventName = line.slice(6).trim();
          } else if (line.startsWith('data:')) {
            dataLines.push(line.slice(5).replace(/^ /, ''));
          }
        }
        onEvent(eventName, dataLines.join('\n'));
        sepIdx = buffer.indexOf('\n\n');
      }
    };

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { value, done: streamDone } = await reader.read();
      if (streamDone) break;
      buffer += decoder.decode(value, { stream: true });
      flushBuffer();
    }
    if (buffer.trim().length > 0) {
      buffer += '\n\n';
      flushBuffer();
    }
  }, []);

  // Kick off a fresh deploy: POST /api/sites/[id]/host + consume the stream.
  const handleDeployClick = useCallback(async () => {
    if (HOST_BUSY_STATES.has(hostState.status)) return;

    hostAbortRef.current?.abort();
    const controller = new AbortController();
    hostAbortRef.current = controller;

    setHostState((prev) => ({
      status: 'queued',
      url: prev.url,
      message: null,
    }));

    let res: Response;
    try {
      res = await fetch(`/api/sites/${siteId}/host`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
      });
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') return;
      setHostState({
        status: 'failed',
        url: null,
        message: err instanceof Error ? err.message : 'Network error',
      });
      return;
    }

    if (!res.ok) {
      let msg = `Deploy failed (${res.status})`;
      try {
        const body = await res.json();
        if (body && typeof body.error === 'string') msg = body.error;
      } catch {
        /* ignore */
      }
      setHostState({ status: 'failed', url: null, message: msg });
      return;
    }

    try {
      await consumeHostStream(res);
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') return;
      setHostState((prev) => ({
        status: 'failed',
        url: prev.url,
        message: err instanceof Error ? err.message : 'Stream error',
      }));
    }
  }, [siteId, hostState.status, consumeHostStream]);

  // On mount: restore hosting state via GET /api/sites/[id]/host/status.
  // - null / idle → leave as 'idle'
  // - live         → show banner, button = 'Redeploy'
  // - busy         → poll every 3s until status resolves to live/failed
  // - failed       → leave as 'failed'
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const fetchStatus = async (): Promise<void> => {
      try {
        const res = await fetch(`/api/sites/${siteId}/host/status`, {
          cache: 'no-store',
        });
        if (!res.ok) return;
        const data = (await res.json()) as {
          status?: string;
          url?: string | null;
        } | null;
        if (cancelled) return;

        if (!data) {
          // No deployment row yet — nothing to restore.
          return;
        }

        const status = (data.status || 'idle') as HostStatus;
        const url = typeof data.url === 'string' ? data.url : null;

        if (status === 'live') {
          setHostState({ status: 'live', url, message: null });
          return;
        }
        if (status === 'failed') {
          setHostState({ status: 'failed', url, message: null });
          return;
        }
        if (HOST_BUSY_STATES.has(status)) {
          setHostState({ status, url, message: null });
          timer = setTimeout(fetchStatus, 3000);
          return;
        }
        // Unknown/idle-like status — leave state untouched.
      } catch {
        // Transient failure — try again shortly, but only while mounted.
        if (!cancelled) {
          timer = setTimeout(fetchStatus, 5000);
        }
      }
    };

    void fetchStatus();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [siteId]);

  // Abort any in-flight deploy SSE subscription when the editor unmounts.
  useEffect(() => {
    return () => {
      hostAbortRef.current?.abort();
    };
  }, []);

  // Keep the iframe's <html class="sc-inspect-on"> in sync with inspectMode.
  // The initial toggle happens in handleIframeLoad; this effect covers later
  // flips that shouldn't require reloading the iframe.
  useEffect(() => {
    if (!iframeReady) return;
    const doc = iframeRef.current?.contentDocument;
    if (!doc || !doc.documentElement) return;
    doc.documentElement.classList.toggle(
      'sc-inspect-on',
      inspectMode === 'inspect',
    );
  }, [inspectMode, iframeReady, iframeNonce]);

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
        // `true` tells reloadIframe to stash the current scrollY and restore
        // it after the new iframe content paints.
        setTimeout(() => {
          reloadIframe(true);
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

  const handleInspectModeChange = useCallback(
    (next: InspectMode) => {
      setInspectMode((prev) => {
        if (prev === next) return prev;
        if (next === 'interact') {
          // Drop any lingering selection so it doesn't flash back when the
          // user returns to inspect mode later in the session.
          const doc = iframeRef.current?.contentDocument;
          if (doc) {
            const prevEl = doc.querySelector('.sc-selected');
            if (prevEl) prevEl.classList.remove('sc-selected');
          }
          setSelected(null);
          setApplyError(null);
          setApplySuccess(false);
        }
        return next;
      });
    },
    [],
  );

  const displayName = site?.name ?? (siteError ? 'Error' : null);

  return (
    <div className="flex h-screen w-screen flex-col bg-[color:var(--sc-bg)] text-[color:var(--sc-ink)]">
      {/* Top bar — 56px, hairline bottom, panel bg, balanced three-slot layout. */}
      <header className="grid h-14 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-4 border-b border-[color:var(--sc-border)] bg-[color:var(--sc-panel)] px-5">
        {/* Left slot: back arrow, wordmark, site name. */}
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href="/"
            aria-label="Back to sites"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[color:var(--sc-muted)] transition-colors hover:bg-[color:var(--sc-panel-2)] hover:text-[color:var(--sc-ink)]"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
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

        {/* Center slot: Inspect / Interact segmented control. */}
        <div className="flex items-center justify-center">
          <InspectModeToggle
            value={inspectMode}
            onChange={handleInspectModeChange}
          />
        </div>

        {/* Right slot: Deploy. */}
        <div className="flex items-center justify-end">
          <DeployButton state={hostState} onClick={handleDeployClick} />
        </div>
      </header>

      {/* Split view */}
      <div className="flex min-h-0 flex-1">
        {/* Preview pane — preview card holds live banner, page tabs, iframe. */}
        <section className="flex min-w-0 flex-[72] items-stretch bg-[color:var(--sc-bg)] p-5">
          <div
            style={{ boxShadow: 'var(--sc-shadow-lg)' }}
            className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-[color:var(--sc-border)] bg-white"
          >
            {hostState.status === 'live' && hostState.url ? (
              <LiveUrlBanner url={hostState.url} />
            ) : null}
            {pages.length > 0 ? (
              <EditorPageTabs
                pages={pages}
                activeSlug={activeSlug}
                onChange={handleTabChange}
              />
            ) : null}
            <div className="relative min-h-0 flex-1 overflow-hidden bg-white">
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
          </div>
        </section>

        {/* Inspector pane — ~28% width, hairline separator, matching header. */}
        <aside className="flex w-[28%] min-w-[320px] max-w-[440px] shrink-0 flex-col border-l border-[color:var(--sc-border)] bg-[color:var(--sc-panel)]">
          <div className="flex h-14 shrink-0 items-center border-b border-[color:var(--sc-border)] px-5">
            <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-[color:var(--sc-muted)]">
              Inspect
            </span>
          </div>
          <div className="flex min-h-0 flex-1 flex-col">
            <Inspector
              siteId={siteId}
              selected={selected}
              pageSlug={activeSlug}
              onClear={handleClearSelection}
              onApply={handleApply}
              busy={applying}
              error={applyError}
              success={applySuccess}
              inspectMode={inspectMode}
              onEnableInspect={() => handleInspectModeChange('inspect')}
              onAfterPatch={() => reloadIframe(true)}
              onAfterRevise={() => reloadIframe(false)}
            />
          </div>
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
  // Tighter tab strip that lives inside the preview card header. Active tab
  // carries a 2px underline in ink; inactive tabs are muted until hover.
  return (
    <div
      role="tablist"
      aria-label="Pages"
      className="flex h-9 shrink-0 items-end gap-0.5 overflow-x-auto border-b border-[color:var(--sc-border)] bg-[color:var(--sc-panel)] px-4"
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
            className={`relative -mb-px shrink-0 px-2.5 py-1.5 text-[12px] transition-colors ${
              active
                ? 'border-b-2 border-[color:var(--sc-ink)] font-medium text-[color:var(--sc-ink)]'
                : 'border-b-2 border-transparent font-normal text-[color:var(--sc-muted)] hover:text-[color:var(--sc-ink)]'
            }`}
          >
            {p.name}
          </button>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Inspect-mode toggle                                                        */
/* -------------------------------------------------------------------------- */

function InspectModeToggle({
  value,
  onChange,
}: {
  value: InspectMode;
  onChange: (next: InspectMode) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Editor mode"
      className="inline-flex items-center rounded-[10px] border border-[color:var(--sc-border)] bg-[color:var(--sc-panel-2)] p-0.5"
    >
      <InspectModeSegment
        active={value === 'inspect'}
        label="Inspect"
        title="Click elements to edit them"
        onClick={() => onChange('inspect')}
      >
        <MousePointerClick className="h-3.5 w-3.5" aria-hidden />
      </InspectModeSegment>
      <InspectModeSegment
        active={value === 'interact'}
        label="Interact"
        title="Clicks pass through so you can use the site"
        onClick={() => onChange('interact')}
      >
        <Hand className="h-3.5 w-3.5" aria-hidden />
      </InspectModeSegment>
    </div>
  );
}

function InspectModeSegment({
  active,
  label,
  title,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  title: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={title}
      className={`inline-flex items-center gap-1.5 rounded-[8px] px-2.5 py-1 text-[12px] font-medium transition-colors ${
        active
          ? 'bg-[color:var(--sc-panel)] text-[color:var(--sc-ink)] shadow-[0_1px_0_rgba(0,0,0,0.04)]'
          : 'text-[color:var(--sc-muted)] hover:text-[color:var(--sc-ink)]'
      }`}
    >
      {children}
      <span>{label}</span>
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Deploy button                                                              */
/* -------------------------------------------------------------------------- */

function DeployButton({
  state,
  onClick,
}: {
  state: HostState;
  onClick: () => void;
}) {
  const busy = HOST_BUSY_STATES.has(state.status);
  const isLive = state.status === 'live';
  const isFailed = state.status === 'failed';

  let label: string;
  if (busy) {
    label = `${hostStatusLabel(state.status)}…`;
  } else if (isLive) {
    label = 'Redeploy';
  } else if (isFailed) {
    label = 'Retry deploy';
  } else {
    label = 'Deploy site';
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-busy={busy}
      className="inline-flex items-center justify-center gap-2 rounded-[10px] bg-[color:var(--sc-accent)] px-3.5 py-1.5 text-[12.5px] font-medium text-white transition-colors hover:bg-[color:var(--sc-accent-hover)] disabled:cursor-not-allowed disabled:opacity-80"
    >
      {busy ? (
        <span
          aria-hidden
          className="h-3 w-3 shrink-0 animate-spin rounded-full border border-white/40 border-t-white"
        />
      ) : null}
      <span>{label}</span>
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Live URL banner                                                            */
/* -------------------------------------------------------------------------- */

function LiveUrlBanner({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(url);
      } else {
        // Fallback for environments without the async clipboard API.
        const ta = document.createElement('textarea');
        ta.value = url;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        try {
          document.execCommand('copy');
        } finally {
          document.body.removeChild(ta);
        }
      }
      setCopied(true);
    } catch {
      // Silent — best-effort copy. Users can still click the Open link.
    }
  }, [url]);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  return (
    <div className="flex h-9 shrink-0 items-center justify-between gap-4 border-b border-[color:var(--sc-border)] bg-[color:var(--sc-panel-2)] px-4">
      <div className="flex min-w-0 items-center gap-2 text-[12px] text-[color:var(--sc-ink-2)]">
        <svg
          aria-hidden
          viewBox="0 0 16 16"
          className="h-3.5 w-3.5 shrink-0 text-[color:var(--sc-muted)]"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="8" cy="8" r="6.25" />
          <path d="M1.75 8h12.5" />
          <path d="M8 1.75c1.9 2 2.9 4.2 2.9 6.25S9.9 12.25 8 14.25" />
          <path d="M8 1.75C6.1 3.75 5.1 5.95 5.1 8s1 4.25 2.9 6.25" />
        </svg>
        <span className="shrink-0 text-[color:var(--sc-muted)]">Live at:</span>
        <span className="truncate font-mono text-[12px] text-[color:var(--sc-ink)]">
          {url}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          aria-label={copied ? 'Copied' : 'Copy URL'}
          title={copied ? 'Copied' : 'Copy URL'}
          className="inline-flex h-6 items-center gap-1 rounded px-1.5 text-[11px] text-[color:var(--sc-muted)] transition-colors hover:bg-[color:var(--sc-panel)] hover:text-[color:var(--sc-ink)]"
        >
          {copied ? (
            <span className="text-[color:var(--sc-ink-2)]">Copied</span>
          ) : (
            <Copy className="h-3.5 w-3.5" aria-hidden />
          )}
        </button>
      </div>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="shrink-0 text-[12px] text-[color:var(--sc-muted)] transition-colors hover:text-[color:var(--sc-ink)]"
      >
        Open live site →
      </a>
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
