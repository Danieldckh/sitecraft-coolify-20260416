'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  Sparkles,
  Loader2,
  Check,
  AlertCircle,
  ArrowUpRight,
} from 'lucide-react';

type Phase = 'idle' | 'building' | 'error';

type SectionStatus = 'pending' | 'active' | 'done' | 'error';

interface PlannedSection {
  id: string;
  role: string;
  brief?: string;
  status: SectionStatus;
  pageSlug: string;
}

interface PlannedPage {
  slug: string;
  name: string;
}

const HOME_SLUG = 'home';

const MIN_PROMPT_LENGTH = 10;
const PLACEHOLDER =
  'A moody independent record store called Static Age — vinyl, cassettes, merch, late-night listening bar in the back.';

export default function Landing() {
  const router = useRouter();
  const [prompt, setPrompt] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);

  // Build-phase state
  const [siteId, setSiteId] = useState<string | null>(null);
  const [siteName, setSiteName] = useState<string | null>(null);
  const [pages, setPages] = useState<PlannedPage[]>([]);
  const [activeSlug, setActiveSlug] = useState<string>(HOME_SLUG);
  const [sections, setSections] = useState<PlannedSection[]>([]);
  const [statusText, setStatusText] = useState('Connecting agents…');
  const [iframeNonce, setIframeNonce] = useState<number | null>(null);
  const [done, setDone] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);

  const canSubmit =
    phase !== 'building' && prompt.trim().length >= MIN_PROMPT_LENGTH;

  // Cleanup any in-flight request on unmount.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // Auto-grow the textarea between 3 and ~8 rows.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const max = 8 * 24 + 24; // ~8 lines + padding
    el.style.height = Math.min(el.scrollHeight, max) + 'px';
  }, [prompt]);

  // Keep the log scrolled to the bottom as events arrive.
  useEffect(() => {
    const el = logRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [sections, statusText, done]);

  // Countdown + navigation once the build is done.
  useEffect(() => {
    if (!done || !siteId) return;
    setCountdown(2);
    const t1 = setTimeout(() => setCountdown(1), 700);
    const t2 = setTimeout(() => {
      router.push(`/site/${siteId}`);
    }, 1400);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [done, siteId, router]);

  const progress = useMemo(() => {
    if (sections.length === 0) return 0;
    const doneCount = sections.filter((s) => s.status === 'done').length;
    return Math.round((doneCount / sections.length) * 100);
  }, [sections]);

  function resetToIdle() {
    abortRef.current?.abort();
    abortRef.current = null;
    setPhase('idle');
    setError(null);
    setSiteId(null);
    setSiteName(null);
    setPages([]);
    setActiveSlug(HOME_SLUG);
    setSections([]);
    setStatusText('Connecting agents…');
    setIframeNonce(null);
    setDone(false);
    setCountdown(null);
  }

  async function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!canSubmit) return;

    setError(null);
    setSiteId(null);
    setSiteName(null);
    setPages([]);
    setActiveSlug(HOME_SLUG);
    setSections([]);
    setStatusText('Connecting agents…');
    setIframeNonce(null);
    setDone(false);
    setCountdown(null);
    setPhase('building');

    const controller = new AbortController();
    abortRef.current = controller;

    let res: Response;
    try {
      res = await fetch('/api/build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: prompt.trim() }),
        signal: controller.signal,
      });
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Network error');
      setPhase('error');
      return;
    }

    if (!res.ok) {
      let msg = `Build failed (${res.status})`;
      try {
        const body = await res.json();
        if (body && typeof body.error === 'string') msg = body.error;
      } catch {
        try {
          const text = await res.text();
          if (text) msg = text;
        } catch {
          /* ignore */
        }
      }
      setError(msg);
      setPhase('error');
      return;
    }

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/event-stream') || !res.body) {
      setError('Server did not return an SSE stream');
      setPhase('error');
      return;
    }

    try {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let capturedSiteId: string | null = null;

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
          case 'siteId': {
            const id =
              data && typeof data === 'object' && 'siteId' in (data as Record<string, unknown>)
                ? (data as { siteId?: string }).siteId
                : typeof data === 'string'
                  ? data
                  : undefined;
            if (id) {
              capturedSiteId = id;
              setSiteId(id);
              setIframeNonce(Date.now());
              setStatusText('Planning your site…');
            }
            break;
          }
          case 'plan': {
            const plan = (data ?? {}) as {
              siteName?: string;
              // Legacy single-page shape: sections at top level.
              sections?: Array<{ id?: string; role?: string; brief?: string }>;
              // New multi-page shape.
              pages?: Array<{
                slug?: string;
                name?: string;
                brief?: string;
                sections?: Array<{ id?: string; role?: string; brief?: string }>;
              }>;
            };
            if (plan.siteName) setSiteName(plan.siteName);

            // Normalise pages. Fall back to a single "home" page when the
            // backend still uses the legacy shape.
            const rawPages = Array.isArray(plan.pages) && plan.pages.length > 0
              ? plan.pages
              : [{ slug: HOME_SLUG, name: 'Home', sections: plan.sections ?? [] }];

            const normalisedPages: PlannedPage[] = rawPages
              .map((p, i) => ({
                slug:
                  typeof p?.slug === 'string' && p.slug
                    ? p.slug
                    : i === 0
                      ? HOME_SLUG
                      : `page-${i + 1}`,
                name:
                  typeof p?.name === 'string' && p.name
                    ? p.name
                    : i === 0
                      ? 'Home'
                      : `Page ${i + 1}`,
              }));
            setPages(normalisedPages);

            const planned: PlannedSection[] = [];
            rawPages.forEach((p, pi) => {
              const slug = normalisedPages[pi].slug;
              (p?.sections ?? [])
                .filter((s) => typeof s?.id === 'string')
                .forEach((s, i) =>
                  planned.push({
                    id: s.id as string,
                    role: s.role || s.id || `section-${i + 1}`,
                    brief: s.brief,
                    status:
                      planned.length === 0 ? 'active' : 'pending',
                    pageSlug: slug,
                  }),
                );
            });
            setSections(planned);

            // Default the active tab to the first page (usually "home").
            const firstSlug = normalisedPages[0]?.slug ?? HOME_SLUG;
            setActiveSlug(firstSlug);

            setStatusText(
              planned.length > 0
                ? `Designing ${planned[0].role}…`
                : 'Designing sections…',
            );
            break;
          }
          case 'section': {
            const obj =
              data && typeof data === 'object'
                ? (data as Record<string, unknown>)
                : ({} as Record<string, unknown>);
            const id = typeof obj.id === 'string' ? obj.id : '';
            const evtPageSlug =
              typeof obj.pageSlug === 'string' && obj.pageSlug
                ? (obj.pageSlug as string)
                : HOME_SLUG;

            // Mark the matching section done, activate the next pending one.
            setSections((prev) => {
              if (prev.length === 0) return prev;
              // Prefer matching on both page + id; fall back to id-only for
              // backends that omit pageSlug.
              let matchedIdx = prev.findIndex(
                (s) => s.id === id && s.pageSlug === evtPageSlug,
              );
              if (matchedIdx === -1) {
                matchedIdx = prev.findIndex(
                  (s) => s.id === id && s.status !== 'done',
                );
              }

              const next = prev.slice();
              if (matchedIdx !== -1) {
                next[matchedIdx] = { ...next[matchedIdx], status: 'done' };
              } else {
                // Defensive: mark the first in-flight row done.
                const idx = next.findIndex(
                  (s) => s.status === 'active' || s.status === 'pending',
                );
                if (idx !== -1) {
                  next[idx] = { ...next[idx], status: 'done' };
                }
              }
              const nextPending = next.findIndex((s) => s.status === 'pending');
              if (nextPending !== -1) {
                next[nextPending] = { ...next[nextPending], status: 'active' };
                setStatusText(`Designing ${next[nextPending].role}…`);
              } else {
                setStatusText('Finishing up…');
              }
              return next;
            });

            // Only reload the iframe when the arriving section matches the
            // currently-visible page. Cross-page section events still appear
            // in the log (prefixed) but don't force a reload.
            setActiveSlug((currentActive) => {
              if (evtPageSlug === currentActive) {
                setIframeNonce(Date.now());
              }
              return currentActive;
            });
            break;
          }
          case 'error': {
            const msg =
              data && typeof data === 'object' && 'message' in (data as Record<string, unknown>)
                ? String((data as { message: string }).message)
                : typeof data === 'string'
                  ? data
                  : 'Build failed';
            setError(msg);
            setSections((prev) =>
              prev.map((s) =>
                s.status === 'active' ? { ...s, status: 'error' } : s,
              ),
            );
            break;
          }
          case 'done': {
            // Mark any still-active as done defensively.
            setSections((prev) =>
              prev.map((s) =>
                s.status === 'active' || s.status === 'pending'
                  ? { ...s, status: 'done' }
                  : s,
              ),
            );
            setStatusText('Site ready.');
            setDone(true);
            setIframeNonce(Date.now());
            break;
          }
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

      if (!capturedSiteId) {
        setError('Build completed but no site id was returned.');
        setPhase('error');
      }
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Stream error');
      setPhase('error');
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      void handleSubmit();
    }
  }

  function handleTabChange(slug: string) {
    if (slug === activeSlug) return;
    setActiveSlug(slug);
    setIframeNonce(Date.now());
  }

  if (phase === 'building') {
    return (
      <BuildingView
        siteId={siteId}
        siteName={siteName}
        pages={pages}
        activeSlug={activeSlug}
        onTabChange={handleTabChange}
        sections={sections}
        statusText={statusText}
        progress={progress}
        iframeNonce={iframeNonce}
        done={done}
        countdown={countdown}
        logRef={logRef}
        error={error}
        onCancel={resetToIdle}
      />
    );
  }

  if (phase === 'error') {
    return (
      <ErrorView
        message={error ?? 'Something went wrong.'}
        onReset={resetToIdle}
      />
    );
  }

  // idle
  const remaining = Math.max(0, MIN_PROMPT_LENGTH - prompt.trim().length);

  return (
    <main className="relative min-h-screen w-full overflow-hidden">
      <div className="absolute inset-0 sc-paper pointer-events-none" aria-hidden />
      {/* Soft vignette */}
      <div
        className="absolute inset-0 pointer-events-none"
        aria-hidden
        style={{
          background:
            'radial-gradient(ellipse at 50% 0%, rgba(23,23,26,0.04), transparent 60%)',
        }}
      />

      {/* Wordmark */}
      <header className="relative z-10 flex items-center justify-between px-6 py-5 md:px-10 md:py-6">
        <Wordmark />
        <a
          href="https://github.com"
          className="hidden md:inline-flex items-center gap-1 text-xs text-[color:var(--sc-muted)] hover:text-[color:var(--sc-ink)] transition-colors"
          aria-label="Project repository"
        >
          Built by agents
          <ArrowUpRight className="h-3.5 w-3.5" />
        </a>
      </header>

      <section className="relative z-10 mx-auto flex min-h-[calc(100vh-88px)] max-w-2xl flex-col items-stretch justify-center px-6 pb-16 md:px-0">
        <form onSubmit={handleSubmit} className="space-y-8">
          <div className="space-y-4 text-left">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--sc-border)] bg-[color:var(--sc-panel)] px-2.5 py-1 text-[11px] font-medium text-[color:var(--sc-muted)]">
              <span className="relative flex h-1.5 w-1.5">
                <span className="sc-pulse-dot absolute inline-flex h-full w-full rounded-full bg-[color:var(--sc-ink)] opacity-60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[color:var(--sc-ink)]" />
              </span>
              Agents online
            </span>
            <h1 className="font-display text-5xl leading-[1.02] tracking-tight text-[color:var(--sc-ink)] md:text-[64px]">
              What should we build?
            </h1>
            <p className="max-w-xl text-[15px] leading-relaxed text-[color:var(--sc-ink-2)]">
              Describe a website in a sentence or two. A team of agents will
              plan it, design it, and ship a full page — section by section —
              while you watch.
            </p>
          </div>

          <div className="group rounded-2xl border border-[color:var(--sc-border)] bg-[color:var(--sc-panel)] shadow-[0_1px_0_rgba(23,23,26,0.04),0_12px_40px_-16px_rgba(23,23,26,0.12)] transition-shadow focus-within:shadow-[0_1px_0_rgba(23,23,26,0.06),0_20px_60px_-20px_rgba(23,23,26,0.22)] focus-within:border-[color:var(--sc-border-strong)]">
            <label htmlFor="sc-prompt" className="sr-only">
              Describe the site you want to build
            </label>
            <textarea
              id="sc-prompt"
              ref={textareaRef}
              autoFocus
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={PLACEHOLDER}
              rows={3}
              className="block w-full resize-none border-0 bg-transparent px-5 pt-4 pb-2 text-[16px] leading-relaxed text-[color:var(--sc-ink)] placeholder:text-[color:var(--sc-muted-2)] focus:outline-none focus:ring-0"
              style={{ minHeight: '96px' }}
            />
            <div className="flex items-center justify-between gap-3 border-t border-[color:var(--sc-border)] px-3 py-2.5">
              <span className="pl-2 text-[11px] text-[color:var(--sc-muted)]">
                {remaining > 0
                  ? `${remaining} more character${remaining === 1 ? '' : 's'}`
                  : 'Ready to build'}
              </span>
              <button
                type="submit"
                disabled={!canSubmit}
                aria-label="Build site"
                className="group/btn inline-flex items-center gap-2 rounded-lg bg-[color:var(--sc-accent)] px-3.5 py-2 text-sm font-medium text-white shadow-sm transition-all hover:bg-[color:var(--sc-accent-hover)] disabled:cursor-not-allowed disabled:bg-[color:var(--sc-border-strong)] disabled:text-white/90"
              >
                <Sparkles className="h-4 w-4" />
                <span>Build site</span>
                <span className="hidden rounded border border-white/20 bg-white/5 px-1 text-[10px] font-medium text-white/80 sm:inline">
                  ⌘⏎
                </span>
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between text-[11px] text-[color:var(--sc-muted)]">
            <span>
              Press{' '}
              <kbd className="rounded border border-[color:var(--sc-border)] bg-[color:var(--sc-panel)] px-1.5 py-0.5 font-sans text-[10px] text-[color:var(--sc-ink-2)]">
                ⌘
              </kbd>{' '}
              +{' '}
              <kbd className="rounded border border-[color:var(--sc-border)] bg-[color:var(--sc-panel)] px-1.5 py-0.5 font-sans text-[10px] text-[color:var(--sc-ink-2)]">
                ⏎
              </kbd>{' '}
              to build.
            </span>
            <span>No account. No setup. Export as ZIP.</span>
          </div>
        </form>
      </section>
    </main>
  );
}

/* -------------------------------------------------------------------------- */
/* Wordmark                                                                   */
/* -------------------------------------------------------------------------- */

function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span
        aria-hidden
        className="inline-block h-5 w-5 rounded-[5px] bg-[color:var(--sc-ink)] shadow-[inset_0_-3px_0_rgba(255,255,255,0.12)]"
      />
      <span
        className={`text-[13px] font-medium tracking-tight text-[color:var(--sc-ink)] ${
          compact ? '' : 'md:text-[14px]'
        }`}
      >
        Sitecraft
      </span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Building view                                                              */
/* -------------------------------------------------------------------------- */

interface BuildingViewProps {
  siteId: string | null;
  siteName: string | null;
  pages: PlannedPage[];
  activeSlug: string;
  onTabChange: (slug: string) => void;
  sections: PlannedSection[];
  statusText: string;
  progress: number;
  iframeNonce: number | null;
  done: boolean;
  countdown: number | null;
  logRef: React.RefObject<HTMLDivElement | null>;
  error: string | null;
  onCancel: () => void;
}

function BuildingView({
  siteId,
  siteName,
  pages,
  activeSlug,
  onTabChange,
  sections,
  statusText,
  progress,
  iframeNonce,
  done,
  countdown,
  logRef,
  error,
  onCancel,
}: BuildingViewProps) {
  return (
    <main className="flex h-screen w-screen flex-col bg-[color:var(--sc-bg)] text-[color:var(--sc-ink)]">
      {/* Top bar */}
      <header className="relative flex h-14 shrink-0 items-center justify-between border-b border-[color:var(--sc-border)] bg-[color:var(--sc-panel)] px-4 md:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Wordmark />
          <span
            aria-hidden
            className="h-4 w-px bg-[color:var(--sc-border-strong)]"
          />
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[13px] text-[color:var(--sc-ink-2)]">
              {siteName ?? 'Planning…'}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--sc-border)] bg-[color:var(--sc-panel-2)] px-2 py-0.5 text-[10.5px] font-medium text-[color:var(--sc-muted)]">
              {done ? (
                <>
                  <Check className="h-3 w-3 text-[color:var(--sc-success)]" />
                  Ready
                </>
              ) : (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Building
                </>
              )}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {done && countdown !== null ? (
            <span className="text-[11px] text-[color:var(--sc-muted)]">
              Opening editor in {countdown}s…
            </span>
          ) : null}
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-2.5 py-1.5 text-[12px] font-medium text-[color:var(--sc-muted)] transition-colors hover:bg-[color:var(--sc-panel-2)] hover:text-[color:var(--sc-ink)]"
          >
            Cancel
          </button>
        </div>

        {/* Progress bar lives on the bottom edge of the top bar. */}
        <div
          className="absolute inset-x-0 bottom-0 h-px bg-[color:var(--sc-border)]"
          aria-hidden
        />
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
          className="absolute inset-x-0 bottom-0 h-px overflow-hidden"
        >
          {sections.length > 0 ? (
            <div
              className="h-full bg-[color:var(--sc-ink)] transition-[width] duration-500 ease-out"
              style={{ width: `${progress}%` }}
            />
          ) : (
            <div className="sc-indet-bar relative h-full w-full" />
          )}
        </div>
      </header>

      {/* Body */}
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {/* Preview (70%) */}
        <section className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-[color:var(--sc-bg)] p-4 md:p-6">
          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-[color:var(--sc-border)] bg-white shadow-[0_1px_0_rgba(23,23,26,0.04),0_24px_60px_-28px_rgba(23,23,26,0.25)]">
            {pages.length > 0 ? (
              <PageTabs
                pages={pages}
                activeSlug={activeSlug}
                onChange={onTabChange}
              />
            ) : null}
            <div className="relative flex-1 overflow-hidden bg-white">
              {siteId && iframeNonce !== null ? (
                <iframe
                  key={`${activeSlug}-${iframeNonce}`}
                  src={`/preview/${siteId}/${activeSlug}?_=${iframeNonce}`}
                  title="Live site preview"
                  className="sc-fade-in h-full w-full border-0 bg-white"
                />
              ) : (
                <EmptyPreview />
              )}
            </div>
          </div>
          <div className="mt-3 hidden items-center justify-between px-1 text-[11px] text-[color:var(--sc-muted)] md:flex">
            <span className="font-mono">
              {siteId
                ? `/preview/${siteId}/${activeSlug}`
                : 'preparing preview…'}
            </span>
            <span>
              {sections.length > 0
                ? `${sections.filter((s) => s.status === 'done').length} / ${sections.length} sections`
                : ''}
            </span>
          </div>
        </section>

        {/* Build log (30%) */}
        <aside className="flex min-h-[280px] w-full shrink-0 flex-col border-[color:var(--sc-border)] bg-[color:var(--sc-panel)] md:w-[360px] md:border-l">
          <div className="flex h-10 shrink-0 items-center justify-between border-b border-[color:var(--sc-border)] px-4">
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[color:var(--sc-muted)]">
              Build log
            </span>
            <span className="font-mono text-[10.5px] text-[color:var(--sc-muted-2)]">
              {siteId ? siteId.slice(0, 8) : '—'}
            </span>
          </div>
          <div
            ref={logRef}
            className="flex-1 overflow-y-auto px-4 py-3 font-mono text-[12px] leading-relaxed"
          >
            <LogLine kind="info" text="Connecting to build service…" done />
            {siteId ? (
              <LogLine
                kind="info"
                text={`Session ${siteId.slice(0, 8)} opened`}
                done
              />
            ) : null}
            {siteName ? (
              <LogLine kind="plan" text={`Plan: ${siteName}`} done />
            ) : !done ? (
              <LogLine kind="plan" text="Architect drafting plan…" active />
            ) : null}
            {sections.length > 0 ? (
              <>
                <div className="mt-2 mb-1 text-[10.5px] uppercase tracking-[0.14em] text-[color:var(--sc-muted-2)]">
                  Sections
                </div>
                <ul className="space-y-1">
                  {sections.map((s) => (
                    <SectionRow
                      key={`${s.pageSlug}-${s.id}`}
                      section={s}
                      showPagePrefix={s.pageSlug !== activeSlug}
                    />
                  ))}
                </ul>
              </>
            ) : null}
            {!done ? (
              <div className="mt-3 text-[color:var(--sc-muted)]">
                <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-[color:var(--sc-ink)]" />
                {statusText}
              </div>
            ) : (
              <div className="mt-3 flex items-center gap-1.5 text-[color:var(--sc-success)]">
                <Check className="h-3.5 w-3.5" />
                Site ready. Opening editor…
              </div>
            )}
            {error ? (
              <div className="mt-3 flex items-start gap-1.5 rounded-md border border-[color:var(--sc-border)] bg-[color:var(--sc-panel-2)] p-2 text-[color:var(--sc-danger)]">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span className="font-sans text-[12px]">{error}</span>
              </div>
            ) : null}
          </div>
        </aside>
      </div>
    </main>
  );
}

function SectionRow({
  section,
  showPagePrefix,
}: {
  section: PlannedSection;
  showPagePrefix?: boolean;
}) {
  const brief = section.brief
    ? section.brief.length > 68
      ? section.brief.slice(0, 68) + '…'
      : section.brief
    : null;
  return (
    <li className="flex items-start gap-2">
      <StatusIcon status={section.status} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span
            className={
              section.status === 'done'
                ? 'text-[color:var(--sc-ink)]'
                : section.status === 'active'
                  ? 'text-[color:var(--sc-ink)]'
                  : section.status === 'error'
                    ? 'text-[color:var(--sc-danger)]'
                    : 'text-[color:var(--sc-muted)]'
            }
          >
            {showPagePrefix ? (
              <span className="mr-1 text-[color:var(--sc-muted)]">
                [{section.pageSlug}]
              </span>
            ) : null}
            {section.role}
          </span>
        </div>
        {brief ? (
          <div className="truncate text-[11px] font-sans text-[color:var(--sc-muted)]">
            {brief}
          </div>
        ) : null}
      </div>
    </li>
  );
}

/* -------------------------------------------------------------------------- */
/* Page tabs (browser-style)                                                  */
/* -------------------------------------------------------------------------- */

function PageTabs({
  pages,
  activeSlug,
  onChange,
}: {
  pages: PlannedPage[];
  activeSlug: string;
  onChange: (slug: string) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Pages"
      className="flex shrink-0 items-end overflow-x-auto border-b border-[color:var(--sc-border)] bg-[color:var(--sc-panel-2)] px-2"
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
            className={`relative -mb-px shrink-0 border-b-2 px-3 py-2 text-[12px] font-medium transition-colors ${
              active
                ? 'border-[color:var(--sc-ink)] text-[color:var(--sc-ink)]'
                : 'border-transparent text-[color:var(--sc-muted)] hover:text-[color:var(--sc-ink)]'
            }`}
          >
            {p.name}
          </button>
        );
      })}
    </div>
  );
}

function StatusIcon({ status }: { status: SectionStatus }) {
  if (status === 'done') {
    return <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[color:var(--sc-success)]" />;
  }
  if (status === 'active') {
    return (
      <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-[color:var(--sc-ink)]" />
    );
  }
  if (status === 'error') {
    return (
      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[color:var(--sc-danger)]" />
    );
  }
  return (
    <span
      aria-hidden
      className="mt-[7px] ml-[5px] inline-block h-[3px] w-[3px] shrink-0 rounded-full bg-[color:var(--sc-muted-2)]"
    />
  );
}

function LogLine({
  kind,
  text,
  done,
  active,
}: {
  kind: 'info' | 'plan';
  text: string;
  done?: boolean;
  active?: boolean;
}) {
  return (
    <div className="flex items-start gap-2 py-0.5">
      {done ? (
        <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[color:var(--sc-success)]" />
      ) : active ? (
        <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-[color:var(--sc-ink)]" />
      ) : (
        <span
          aria-hidden
          className="mt-[7px] ml-[5px] inline-block h-[3px] w-[3px] shrink-0 rounded-full bg-[color:var(--sc-muted-2)]"
        />
      )}
      <span
        className={
          kind === 'plan'
            ? 'text-[color:var(--sc-ink)]'
            : 'text-[color:var(--sc-ink-2)]'
        }
      >
        {text}
      </span>
    </div>
  );
}

function EmptyPreview() {
  return (
    <div className="relative flex h-full w-full items-center justify-center bg-[color:var(--sc-panel-2)]">
      <div
        className="absolute inset-0 sc-paper opacity-60"
        aria-hidden
      />
      <div className="relative flex flex-col items-center gap-3 text-center">
        <div className="flex items-center gap-1.5 rounded-full border border-[color:var(--sc-border)] bg-[color:var(--sc-panel)] px-3 py-1 text-[11px] font-medium text-[color:var(--sc-muted)]">
          <Loader2 className="h-3 w-3 animate-spin" />
          Waking up the team
        </div>
        <p className="font-display text-2xl text-[color:var(--sc-ink-2)]">
          Preview will appear here
        </p>
        <p className="max-w-xs text-[12px] text-[color:var(--sc-muted)]">
          As each agent finishes a section, it will materialise in this pane.
        </p>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Error view                                                                 */
/* -------------------------------------------------------------------------- */

function ErrorView({
  message,
  onReset,
}: {
  message: string;
  onReset: () => void;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-md rounded-2xl border border-[color:var(--sc-border)] bg-[color:var(--sc-panel)] p-6 shadow-[0_1px_0_rgba(23,23,26,0.04),0_12px_40px_-16px_rgba(23,23,26,0.12)]">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[color:var(--sc-border)] bg-[color:var(--sc-panel-2)] px-2.5 py-1 text-[11px] font-medium text-[color:var(--sc-danger)]">
          <AlertCircle className="h-3.5 w-3.5" />
          Build failed
        </div>
        <h2 className="font-display text-3xl leading-tight text-[color:var(--sc-ink)]">
          We couldn&rsquo;t finish the build.
        </h2>
        <p className="mt-2 text-[13px] text-[color:var(--sc-ink-2)]">{message}</p>
        <div className="mt-5 flex items-center gap-2">
          <button
            type="button"
            onClick={onReset}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[color:var(--sc-accent)] px-3.5 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[color:var(--sc-accent-hover)]"
          >
            Try again
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </main>
  );
}
