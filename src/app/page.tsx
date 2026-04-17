'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

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

interface PlanShape {
  siteName?: string;
  sections?: Array<{ id?: string; role?: string; brief?: string }>;
  pages?: Array<{
    slug?: string;
    name?: string;
    brief?: string;
    sections?: Array<{ id?: string; role?: string; brief?: string }>;
  }>;
}

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

const HOME_SLUG = 'home';
const MIN_PROMPT_LENGTH = 10;
const PLACEHOLDER =
  'A moody independent record store called Static Age — vinyl, cassettes, late-night listening bar in the back.';

/* -------------------------------------------------------------------------- */
/* Landing                                                                    */
/* -------------------------------------------------------------------------- */

export default function Landing() {
  const router = useRouter();

  const [prompt, setPrompt] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);

  // Build-phase state (preserved across 'error' so Continue can resume)
  const [siteId, setSiteId] = useState<string | null>(null);
  const [siteName, setSiteName] = useState<string | null>(null);
  const [pages, setPages] = useState<PlannedPage[]>([]);
  const [activeSlug, setActiveSlug] = useState<string>(HOME_SLUG);
  const [sections, setSections] = useState<PlannedSection[]>([]);
  const [statusText, setStatusText] = useState('Planning…');
  const [iframeNonce, setIframeNonce] = useState<number | null>(null);
  const [done, setDone] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);

  const trimmedLength = prompt.trim().length;
  const canSubmit = phase !== 'building' && trimmedLength >= MIN_PROMPT_LENGTH;

  /* -------------------------------------------------- */
  /* Effects                                            */
  /* -------------------------------------------------- */

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
    const max = 8 * 26 + 24;
    el.style.height = Math.min(el.scrollHeight, max) + 'px';
  }, [prompt]);

  // Keep the log scrolled to the bottom as events arrive.
  useEffect(() => {
    const el = logRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [sections, statusText, done]);

  // Navigate into the editor after a short beat once `done` fires.
  useEffect(() => {
    if (!done || !siteId) return;
    const t = setTimeout(() => {
      router.push(`/site/${siteId}`);
    }, 1000);
    return () => clearTimeout(t);
  }, [done, siteId, router]);

  /* -------------------------------------------------- */
  /* Derived                                            */
  /* -------------------------------------------------- */

  const progress = useMemo(() => {
    if (sections.length === 0) return 0;
    const doneCount = sections.filter((s) => s.status === 'done').length;
    return Math.round((doneCount / sections.length) * 100);
  }, [sections]);

  /* -------------------------------------------------- */
  /* Reset                                              */
  /* -------------------------------------------------- */

  const resetToIdle = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPhase('idle');
    setError(null);
    setSiteId(null);
    setSiteName(null);
    setPages([]);
    setActiveSlug(HOME_SLUG);
    setSections([]);
    setStatusText('Planning…');
    setIframeNonce(null);
    setDone(false);
  }, []);

  /* -------------------------------------------------- */
  /* SSE consumption (shared by build + continue)       */
  /* -------------------------------------------------- */

  const consumeStream = useCallback(async (res: Response) => {
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/event-stream') || !res.body) {
      throw new Error('Server did not return an SSE stream');
    }

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
            setStatusText('Planning…');
          }
          break;
        }

        case 'plan': {
          const plan = (data ?? {}) as PlanShape;
          if (plan.siteName) setSiteName(plan.siteName);

          const rawPages =
            Array.isArray(plan.pages) && plan.pages.length > 0
              ? plan.pages
              : [{ slug: HOME_SLUG, name: 'Home', sections: plan.sections ?? [] }];

          const normalisedPages: PlannedPage[] = rawPages.map((p, i) => ({
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

          // Merge the incoming plan with any sections we've already completed
          // (only relevant during a Continue). Anything whose (pageSlug,id)
          // already exists as 'done' stays 'done'; everything else is pending,
          // except the first not-yet-done section which becomes active.
          setSections((prev) => {
            const priorDone = new Map<string, PlannedSection>();
            for (const s of prev) {
              if (s.status === 'done') {
                priorDone.set(`${s.pageSlug}::${s.id}`, s);
              }
            }

            const planned: PlannedSection[] = [];
            rawPages.forEach((p, pi) => {
              const slug = normalisedPages[pi].slug;
              (p?.sections ?? [])
                .filter((s) => typeof s?.id === 'string')
                .forEach((s, i) => {
                  const id = s.id as string;
                  const key = `${slug}::${id}`;
                  const existing = priorDone.get(key);
                  planned.push({
                    id,
                    role: s.role || id || `section-${i + 1}`,
                    brief: s.brief,
                    status: existing ? 'done' : 'pending',
                    pageSlug: slug,
                  });
                });
            });

            // Activate the first pending row.
            const firstPending = planned.findIndex((s) => s.status === 'pending');
            if (firstPending !== -1) {
              planned[firstPending] = { ...planned[firstPending], status: 'active' };
              setStatusText(`Designing ${planned[firstPending].role}…`);
            } else {
              setStatusText('Finishing up…');
            }
            return planned;
          });

          const firstSlug = normalisedPages[0]?.slug ?? HOME_SLUG;
          setActiveSlug(firstSlug);
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

          setSections((prev) => {
            if (prev.length === 0) return prev;
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

    return capturedSiteId;
  }, []);

  /* -------------------------------------------------- */
  /* Build                                              */
  /* -------------------------------------------------- */

  const handleSubmit = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
      if (!canSubmit) return;

      setError(null);
      setSiteId(null);
      setSiteName(null);
      setPages([]);
      setActiveSlug(HOME_SLUG);
      setSections([]);
      setStatusText('Planning…');
      setIframeNonce(null);
      setDone(false);
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

      try {
        const captured = await consumeStream(res);
        if (!captured && !siteId) {
          setError('Build completed but no site id was returned.');
          setPhase('error');
        }
      } catch (err) {
        if ((err as { name?: string })?.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'Stream error');
        setPhase('error');
      }
    },
    [canSubmit, prompt, siteId, consumeStream],
  );

  /* -------------------------------------------------- */
  /* Continue (resume a partial build)                  */
  /* -------------------------------------------------- */

  const handleContinue = useCallback(async () => {
    if (!siteId) return;

    setError(null);
    setDone(false);
    setPhase('building');
    setStatusText('Resuming…');

    const controller = new AbortController();
    abortRef.current = controller;

    let res: Response;
    try {
      res = await fetch('/api/continue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId }),
        signal: controller.signal,
      });
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Network error');
      setPhase('error');
      return;
    }

    if (!res.ok) {
      let msg = `Resume failed (${res.status})`;
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

    try {
      await consumeStream(res);
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Stream error');
      setPhase('error');
    }
  }, [siteId, consumeStream]);

  /* -------------------------------------------------- */
  /* Handlers                                           */
  /* -------------------------------------------------- */

  const handleTabChange = useCallback(
    (slug: string) => {
      setActiveSlug((current) => {
        if (slug === current) return current;
        setIframeNonce(Date.now());
        return slug;
      });
    },
    [],
  );

  /* -------------------------------------------------- */
  /* Render                                             */
  /* -------------------------------------------------- */

  if (phase === 'building') {
    return (
      <BuildingView
        siteId={siteId}
        pages={pages}
        activeSlug={activeSlug}
        onTabChange={handleTabChange}
        sections={sections}
        statusText={statusText}
        progress={progress}
        iframeNonce={iframeNonce}
        done={done}
        logRef={logRef}
        onCancel={resetToIdle}
      />
    );
  }

  if (phase === 'error') {
    return (
      <ErrorView
        message={error ?? 'Something went wrong.'}
        canContinue={Boolean(siteId)}
        onContinue={handleContinue}
        onReset={resetToIdle}
      />
    );
  }

  // idle
  return (
    <main className="relative min-h-screen w-full bg-[color:var(--sc-bg)] text-[color:var(--sc-ink)]">
      <Wordmark />

      <section className="mx-auto flex min-h-screen max-w-[680px] flex-col items-stretch justify-center px-6 py-24">
        <form onSubmit={handleSubmit} className="flex flex-col gap-10">
          <h1 className="font-display text-[44px] leading-[1.05] tracking-[-0.01em] text-[color:var(--sc-ink)] md:text-[56px]">
            Describe a website. Agents will build it.
          </h1>

          <PromptCard
            textareaRef={textareaRef}
            value={prompt}
            onChange={setPrompt}
            onSubmit={handleSubmit}
            canSubmit={canSubmit}
            placeholder={PLACEHOLDER}
          />
        </form>
      </section>
    </main>
  );
}

/* -------------------------------------------------------------------------- */
/* Prompt card                                                                */
/* -------------------------------------------------------------------------- */

function PromptCard({
  textareaRef,
  value,
  onChange,
  onSubmit,
  canSubmit,
  placeholder,
}: {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  canSubmit: boolean;
  placeholder: string;
}) {
  return (
    <div
      className="sc-soft-shadow group flex flex-col overflow-hidden rounded-[var(--sc-radius-card)] border border-[color:var(--sc-border)] bg-[color:var(--sc-panel)] transition-colors focus-within:border-[color:var(--sc-border-strong)]"
    >
      <label htmlFor="sc-prompt" className="sr-only">
        Describe the site you want to build
      </label>
      <textarea
        id="sc-prompt"
        ref={textareaRef}
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={3}
        className="block w-full resize-none border-0 bg-transparent px-6 pt-5 pb-4 text-[16px] leading-[1.6] text-[color:var(--sc-ink)] placeholder:text-[color:var(--sc-muted-2)] focus:outline-none focus:ring-0"
        style={{ minHeight: '110px' }}
      />
      <div className="flex items-center justify-end px-4 pb-4">
        <button
          type="button"
          onClick={onSubmit}
          disabled={!canSubmit}
          className="inline-flex items-center justify-center rounded-[10px] bg-[color:var(--sc-accent)] px-4 py-2 text-[13.5px] font-medium text-white transition-colors hover:bg-[color:var(--sc-accent-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          Build site
        </button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Wordmark                                                                   */
/* -------------------------------------------------------------------------- */

function Wordmark() {
  return (
    <div className="pointer-events-none absolute left-8 top-6 select-none">
      <span className="font-display text-[18px] leading-none tracking-[-0.005em] text-[color:var(--sc-ink)]">
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
  pages: PlannedPage[];
  activeSlug: string;
  onTabChange: (slug: string) => void;
  sections: PlannedSection[];
  statusText: string;
  progress: number;
  iframeNonce: number | null;
  done: boolean;
  logRef: React.RefObject<HTMLDivElement | null>;
  onCancel: () => void;
}

function BuildingView({
  siteId,
  pages,
  activeSlug,
  onTabChange,
  sections,
  statusText,
  progress,
  iframeNonce,
  done,
  logRef,
  onCancel,
}: BuildingViewProps) {
  return (
    <main className="relative flex h-screen w-screen flex-col bg-[color:var(--sc-bg)] text-[color:var(--sc-ink)]">
      {/* Top bar */}
      <header className="flex h-14 shrink-0 items-center justify-between px-8">
        <span className="font-display text-[18px] leading-none tracking-[-0.005em] text-[color:var(--sc-ink)]">
          Sitecraft
        </span>
        <button
          type="button"
          onClick={onCancel}
          className="text-[12.5px] text-[color:var(--sc-muted)] transition-colors hover:text-[color:var(--sc-ink)]"
        >
          Cancel
        </button>
      </header>

      {/* Body */}
      <div className="flex min-h-0 flex-1 flex-col gap-5 px-8 pb-8 md:flex-row">
        {/* Preview (70%) */}
        <section className="flex min-h-0 flex-[7] flex-col overflow-hidden">
          <div className="sc-soft-shadow-lg relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[var(--sc-radius-card)] border border-[color:var(--sc-border)] bg-white">
            {/* Progress bar — thin, on the top edge of the card */}
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress}
              className="relative h-[2px] w-full overflow-hidden bg-[color:var(--sc-border)]"
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
        </section>

        {/* Build log (30%) */}
        <aside className="flex min-h-[240px] w-full shrink-0 flex-col rounded-[var(--sc-radius-card)] border border-[color:var(--sc-border)] bg-[color:var(--sc-panel)] md:w-[320px]">
          <div className="flex h-11 shrink-0 items-center border-b border-[color:var(--sc-border)] px-5">
            <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-[color:var(--sc-muted)]">
              Build
            </span>
          </div>
          <div
            ref={logRef}
            className="flex min-h-0 flex-1 flex-col gap-[2px] overflow-y-auto px-4 py-4 text-[13px] leading-relaxed"
          >
            {sections.length === 0 ? (
              <LogStatusRow text={statusText} />
            ) : (
              <>
                <ul className="flex flex-col gap-[2px]">
                  {sections.map((s) => (
                    <SectionRow
                      key={`${s.pageSlug}-${s.id}`}
                      section={s}
                      showPagePrefix={s.pageSlug !== activeSlug}
                    />
                  ))}
                </ul>
                {!done ? (
                  <div className="mt-3 text-[12.5px] text-[color:var(--sc-muted)]">
                    {statusText}
                  </div>
                ) : null}
              </>
            )}
          </div>
        </aside>
      </div>

      {/* "Build complete" toast */}
      {done ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-6 flex justify-center">
          <div className="sc-fade-in rounded-full border border-[color:var(--sc-border)] bg-[color:var(--sc-panel)] px-4 py-2 text-[12.5px] text-[color:var(--sc-ink-2)] shadow-[0_6px_20px_-12px_rgba(23,23,26,0.24)]">
            Build complete. Opening editor…
          </div>
        </div>
      ) : null}
    </main>
  );
}

/* -------------------------------------------------------------------------- */
/* Log helpers                                                                */
/* -------------------------------------------------------------------------- */

function LogStatusRow({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2.5 pl-1 text-[13px] text-[color:var(--sc-ink-2)]">
      <span
        aria-hidden
        className="h-1.5 w-1.5 shrink-0 rounded-full bg-[color:var(--sc-ink)] opacity-70"
      />
      <span>{text}</span>
    </div>
  );
}

function SectionRow({
  section,
  showPagePrefix,
}: {
  section: PlannedSection;
  showPagePrefix?: boolean;
}) {
  const label = section.role;

  const statusLabel =
    section.status === 'done'
      ? 'done'
      : section.status === 'active'
        ? 'in progress'
        : section.status === 'error'
          ? 'error'
          : 'pending';

  // A single left-edge accent bar carries the state signal — no icons.
  const barColor =
    section.status === 'done'
      ? 'var(--sc-ink)'
      : section.status === 'active'
        ? 'var(--sc-ink)'
        : section.status === 'error'
          ? 'var(--sc-danger)'
          : 'var(--sc-border-strong)';

  const textColor =
    section.status === 'pending'
      ? 'var(--sc-muted)'
      : section.status === 'error'
        ? 'var(--sc-danger)'
        : 'var(--sc-ink)';

  const statusColor =
    section.status === 'done'
      ? 'var(--sc-muted)'
      : section.status === 'active'
        ? 'var(--sc-ink-2)'
        : section.status === 'error'
          ? 'var(--sc-danger)'
          : 'var(--sc-muted-2)';

  return (
    <li className="flex items-center gap-3 py-1">
      <span
        aria-hidden
        className={`h-4 w-[2px] shrink-0 rounded-full ${
          section.status === 'active' ? 'sc-pulse-dot' : ''
        }`}
        style={{ backgroundColor: barColor }}
      />
      <span className="min-w-0 flex-1 truncate" style={{ color: textColor }}>
        {showPagePrefix ? (
          <span className="mr-1.5 text-[color:var(--sc-muted)]">
            {section.pageSlug}
          </span>
        ) : null}
        <span className="font-medium">{label}</span>
      </span>
      <span
        className="shrink-0 text-[11.5px] tabular-nums"
        style={{ color: statusColor }}
      >
        {statusLabel}
      </span>
    </li>
  );
}

/* -------------------------------------------------------------------------- */
/* Page tabs                                                                  */
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
      className="flex shrink-0 items-end overflow-x-auto border-b border-[color:var(--sc-border)] bg-[color:var(--sc-panel)] px-3"
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

/* -------------------------------------------------------------------------- */
/* Empty preview placeholder                                                  */
/* -------------------------------------------------------------------------- */

function EmptyPreview() {
  return (
    <div className="relative flex h-full w-full items-center justify-center bg-[color:var(--sc-panel-2)]">
      <p className="font-display text-[22px] text-[color:var(--sc-muted)]">
        Preview will appear here
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Error view                                                                 */
/* -------------------------------------------------------------------------- */

function ErrorView({
  message,
  canContinue,
  onContinue,
  onReset,
}: {
  message: string;
  canContinue: boolean;
  onContinue: () => void;
  onReset: () => void;
}) {
  const truncated =
    message.length > 280 ? message.slice(0, 280).trimEnd() + '…' : message;

  return (
    <main className="relative min-h-screen w-full bg-[color:var(--sc-bg)] text-[color:var(--sc-ink)]">
      <div className="pointer-events-none absolute left-8 top-6 select-none">
        <span className="font-display text-[18px] leading-none tracking-[-0.005em] text-[color:var(--sc-ink)]">
          Sitecraft
        </span>
      </div>

      <div className="mx-auto flex min-h-screen max-w-[560px] flex-col items-stretch justify-center px-6 py-24">
        <div className="sc-soft-shadow rounded-[var(--sc-radius-card)] border border-[color:var(--sc-border)] bg-[color:var(--sc-panel)] p-8">
          <h2 className="font-display text-[32px] leading-[1.1] tracking-[-0.01em] text-[color:var(--sc-ink)]">
            Something broke mid-build.
          </h2>
          <p className="mt-3 text-[13.5px] leading-relaxed text-[color:var(--sc-ink-2)]">
            {truncated}
          </p>

          <div className="mt-7 flex flex-wrap items-center gap-2">
            {canContinue ? (
              <button
                type="button"
                onClick={onContinue}
                className="inline-flex items-center justify-center rounded-[10px] bg-[color:var(--sc-accent)] px-4 py-2 text-[13.5px] font-medium text-white transition-colors hover:bg-[color:var(--sc-accent-hover)]"
              >
                Continue building
              </button>
            ) : null}
            <button
              type="button"
              onClick={onReset}
              className="inline-flex items-center justify-center rounded-[10px] border border-[color:var(--sc-border)] bg-[color:var(--sc-panel)] px-4 py-2 text-[13.5px] font-medium text-[color:var(--sc-ink-2)] transition-colors hover:bg-[color:var(--sc-panel-2)] hover:text-[color:var(--sc-ink)]"
            >
              Start over
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
