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

interface SiteListDeployment {
  url: string | null;
  status: string;
  updatedAt: string;
}

interface SiteListItem {
  id: string;
  name: string;
  sitePrompt: string;
  createdAt: string;
  updatedAt: string;
  deployment: SiteListDeployment | null;
  build?: { pagesPlanned: number; pagesReady: number; inProgress: boolean };
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
  const siteIdRef = useRef<string | null>(null);

  // Sites grid (idle state only).
  const [sites, setSites] = useState<SiteListItem[]>([]);
  const [sitesLoaded, setSitesLoaded] = useState(false);

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

  // Load the sites list on mount + poll every 4s while any site is building
  // in the background. That way when a user returns to the menu mid-build,
  // the progress counter in the grid keeps ticking without a manual refresh.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async (): Promise<void> => {
      try {
        const res = await fetch('/api/sites', { cache: 'no-store' });
        if (!res.ok) throw new Error(`Failed to load sites (${res.status})`);
        const data = (await res.json()) as { sites?: SiteListItem[] };
        if (cancelled) return;
        const list = Array.isArray(data.sites) ? data.sites : [];
        setSites(list);
        setSitesLoaded(true);

        const anyBuilding = list.some((s) => s.build?.inProgress);
        if (anyBuilding && !cancelled) {
          timer = setTimeout(tick, 4000);
        }
      } catch {
        if (!cancelled) {
          setSites([]);
          setSitesLoaded(true);
        }
      }
    };

    void tick();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  const handleOpenSite = useCallback(
    (id: string) => {
      router.push(`/site/${id}`);
    },
    [router],
  );

  const handleDeleteSite = useCallback(async (id: string) => {
    // Optimistic removal — restore on failure.
    let removed: SiteListItem | null = null;
    setSites((prev) => {
      const next: SiteListItem[] = [];
      for (const s of prev) {
        if (s.id === id) {
          removed = s;
          continue;
        }
        next.push(s);
      }
      return next;
    });
    try {
      const res = await fetch(`/api/sites/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`Delete failed (${res.status})`);
    } catch {
      if (removed) {
        const restored: SiteListItem = removed;
        setSites((prev) => {
          const next = prev.slice();
          next.push(restored);
          next.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
          return next;
        });
      }
    }
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
    siteIdRef.current = null;
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
    let streamError: string | null = null;

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
            siteIdRef.current = id;
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
          streamError = msg;
          // Mark any in-flight section as errored — the retry path will
          // re-activate it when the next stream reopens.
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

    if (streamError) {
      // Server emitted `event: error` mid-stream — surface it so the caller
      // can decide whether to retry via /api/continue.
      throw new Error(streamError);
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
      siteIdRef.current = null;
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

      // Perform the initial POST /api/build. Network errors or non-OK responses
      // here short-circuit straight to the error view (no retry — the build
      // hasn't even started, so there's nothing to resume).
      let initialRes: Response;
      try {
        initialRes = await fetch('/api/build', {
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

      if (!initialRes.ok) {
        let msg = `Build failed (${initialRes.status})`;
        try {
          const body = await initialRes.json();
          if (body && typeof body.error === 'string') msg = body.error;
        } catch {
          try {
            const text = await initialRes.text();
            if (text) msg = text;
          } catch {
            /* ignore */
          }
        }
        setError(msg);
        setPhase('error');
        return;
      }

      // Retry wrapper: consume the initial build stream. If it throws (either
      // a mid-stream `event: error` or a network failure), wait with backoff
      // and resume via POST /api/continue. Give up after 3 retry attempts
      // (4 total tries including the initial build), then fall through to
      // the existing ErrorView as a manual last resort.
      const MAX_ATTEMPTS = 4;
      const BACKOFFS_MS = [1500, 3000, 6000]; // applied before attempt 2, 3, 4
      let attempt = 0;
      let currentResponse: Response = initialRes;
      let lastErr: unknown = null;

      while (attempt < MAX_ATTEMPTS) {
        try {
          const captured = await consumeStream(currentResponse);
          if (!captured && !siteIdRef.current) {
            setError('Build completed but no site id was returned.');
            setPhase('error');
          }
          return;
        } catch (err) {
          if ((err as { name?: string })?.name === 'AbortError') return;
          lastErr = err;
          attempt += 1;
          if (attempt >= MAX_ATTEMPTS) break;

          const currentSiteId = siteIdRef.current;
          if (!currentSiteId) {
            // Nothing to continue — the initial stream failed before we got a
            // siteId. Surface the error immediately.
            break;
          }

          const backoff = BACKOFFS_MS[attempt - 1] ?? 6000;
          setStatusText(
            `Retrying… (attempt ${attempt + 1}/${MAX_ATTEMPTS})`,
          );
          await new Promise((r) => setTimeout(r, backoff));
          if (controller.signal.aborted) return;

          try {
            currentResponse = await fetch('/api/continue', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ siteId: currentSiteId }),
              signal: controller.signal,
            });
          } catch (fetchErr) {
            if ((fetchErr as { name?: string })?.name === 'AbortError') return;
            lastErr = fetchErr;
            continue;
          }

          if (!currentResponse.ok) {
            try {
              const body = await currentResponse.json();
              if (body && typeof body.error === 'string') {
                lastErr = new Error(body.error);
              } else {
                lastErr = new Error(
                  `Resume failed (${currentResponse.status})`,
                );
              }
            } catch {
              lastErr = new Error(
                `Resume failed (${currentResponse.status})`,
              );
            }
            continue;
          }

          // Reset transient error/done state before re-consuming.
          setDone(false);
          setStatusText('Resuming…');
        }
      }

      setError(lastErr instanceof Error ? lastErr.message : 'Stream error');
      setPhase('error');
    },
    [canSubmit, prompt, consumeStream],
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

      <section className="mx-auto flex w-full max-w-[680px] flex-col items-stretch px-6 pb-16 pt-24 md:pt-32">
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

      <SitesGrid
        sites={sites}
        loaded={sitesLoaded}
        onOpen={handleOpenSite}
        onDelete={handleDeleteSite}
      />
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
    <main className="relative flex h-screen w-full overflow-x-hidden flex-col bg-[color:var(--sc-bg)] text-[color:var(--sc-ink)]">
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

/* -------------------------------------------------------------------------- */
/* Sites grid (idle state)                                                    */
/* -------------------------------------------------------------------------- */

function SitesGrid({
  sites,
  loaded,
  onOpen,
  onDelete,
}: {
  sites: SiteListItem[];
  loaded: boolean;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  if (!loaded) return null;

  if (sites.length === 0) {
    return (
      <section className="mx-auto w-full max-w-[1024px] px-6 pb-24">
        <p className="text-[12.5px] text-[color:var(--sc-muted)]">
          No sites yet — describe one above to get started.
        </p>
      </section>
    );
  }

  return (
    <section className="mx-auto w-full max-w-[1024px] px-6 pb-24">
      <div className="mb-4 flex items-center">
        <span className="text-[10.5px] font-medium uppercase tracking-[0.16em] text-[color:var(--sc-muted)]">
          Your sites
        </span>
      </div>
      <div
        className="grid gap-4"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}
      >
        {sites.map((s) => (
          <SiteCard
            key={s.id}
            site={s}
            onOpen={() => onOpen(s.id)}
            onDelete={() => onDelete(s.id)}
          />
        ))}
      </div>
    </section>
  );
}

function SiteCard({
  site,
  onOpen,
  onDelete,
}: {
  site: SiteListItem;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const isLive = site.deployment?.status === 'live';
  const isBuilding = site.build?.inProgress === true;
  const built = site.build?.pagesReady ?? 0;
  const planned = site.build?.pagesPlanned ?? 0;

  return (
    <article
      className="sc-soft-shadow flex flex-col rounded-[var(--sc-radius-card)] border border-[color:var(--sc-border)] bg-[color:var(--sc-panel)] p-5 transition-colors hover:border-[color:var(--sc-border-strong)]"
    >
      <header className="flex items-center gap-2">
        <span
          aria-hidden
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${isBuilding ? 'sc-pulse-dot' : ''}`}
          style={{
            backgroundColor: isBuilding
              ? 'var(--sc-accent)'
              : isLive
                ? 'var(--sc-success)'
                : 'var(--sc-muted-2)',
          }}
          title={isBuilding ? 'Building…' : isLive ? 'Live' : 'Not hosted'}
        />
        <h3
          className="min-w-0 truncate text-[15px] font-semibold tracking-[-0.005em] text-[color:var(--sc-ink)]"
          title={site.name}
        >
          {site.name}
        </h3>
        {isBuilding ? (
          <span className="ml-auto shrink-0 text-[11px] text-[color:var(--sc-muted)]">
            Building {built}/{planned}
          </span>
        ) : null}
      </header>

      <p
        className="mt-2 text-[13px] leading-relaxed text-[color:var(--sc-muted)]"
        style={{
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {site.sitePrompt || 'No description'}
      </p>

      <div className="mt-4 flex items-center justify-between gap-3">
        <time
          className="shrink-0 text-[11.5px] text-[color:var(--sc-muted-2)]"
          dateTime={site.updatedAt}
        >
          {formatRelative(site.updatedAt)}
        </time>
        <div className="flex items-center gap-2">
          {confirming ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setConfirming(false);
                  onDelete();
                }}
                className="text-[12px] font-medium text-[color:var(--sc-danger)] transition-opacity hover:opacity-80"
              >
                Confirm delete?
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="text-[12px] text-[color:var(--sc-muted)] transition-colors hover:text-[color:var(--sc-ink)]"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={onOpen}
                className="inline-flex items-center justify-center rounded-[8px] bg-[color:var(--sc-accent)] px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-[color:var(--sc-accent-hover)]"
              >
                Open
              </button>
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="text-[12px] text-[color:var(--sc-muted)] transition-colors hover:text-[color:var(--sc-ink)]"
              >
                Delete
              </button>
            </>
          )}
        </div>
      </div>
    </article>
  );
}

/** Plain-English relative time. No external dep. */
function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const now = Date.now();
  const sec = Math.max(0, Math.round((now - then) / 1000));
  if (sec < 5) return 'just now';
  if (sec < 60) return `${sec} seconds ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return min === 1 ? '1 minute ago' : `${min} minutes ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return hr === 1 ? '1 hour ago' : `${hr} hours ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return day === 1 ? '1 day ago' : `${day} days ago`;
  const mo = Math.round(day / 30);
  if (mo < 12) return mo === 1 ? '1 month ago' : `${mo} months ago`;
  const yr = Math.round(mo / 12);
  return yr === 1 ? '1 year ago' : `${yr} years ago`;
}
