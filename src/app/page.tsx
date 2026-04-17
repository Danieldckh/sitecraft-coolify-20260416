'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, ArrowRight } from 'lucide-react';

type LogLine = { kind: 'pending' | 'done' | 'error' | 'info'; text: string };

const MIN_PROMPT_LENGTH = 10;

export default function Landing() {
  const router = useRouter();
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<LogLine[]>([]);
  const [siteId, setSiteId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const canSubmit = !busy && prompt.trim().length >= MIN_PROMPT_LENGTH;

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  function appendLog(line: LogLine) {
    setLog((prev) => [...prev, line]);
  }

  function replaceLast(line: LogLine) {
    setLog((prev) => {
      if (prev.length === 0) return [line];
      const next = prev.slice(0, -1);
      next.push(line);
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    setError(null);
    setBusy(true);
    setLog([{ kind: 'pending', text: 'Planning your site…' }]);

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
      setBusy(false);
      setLog([]);
      setError(err instanceof Error ? err.message : 'Network error');
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
          // ignore
        }
      }
      setBusy(false);
      setLog([]);
      setError(msg);
      return;
    }

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/event-stream') || !res.body) {
      setBusy(false);
      setLog([]);
      setError('Server did not return an SSE stream');
      return;
    }

    // Parse SSE stream.
    try {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let capturedSiteId: string | null = null;

      // Replace the initial "Planning your site…" pending with a done once plan arrives.
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
            if (data && typeof (data as { siteId?: string }).siteId === 'string') {
              capturedSiteId = (data as { siteId: string }).siteId;
              setSiteId(capturedSiteId);
            } else if (typeof data === 'string') {
              capturedSiteId = data;
              setSiteId(data);
            }
            break;
          }
          case 'plan': {
            const name =
              (data && typeof data === 'object' && 'siteName' in (data as Record<string, unknown>)
                ? (data as { siteName?: string }).siteName
                : undefined) || 'your site';
            replaceLast({ kind: 'done', text: `Site planned: "${name}"` });
            // Optionally list upcoming sections.
            const sections =
              data && typeof data === 'object' && 'sections' in (data as Record<string, unknown>)
                ? ((data as { sections?: Array<{ id?: string; role?: string }> }).sections ?? [])
                : [];
            if (sections.length > 0) {
              const first = sections[0];
              const label = first?.role || first?.id || 'section';
              appendLog({ kind: 'pending', text: `Designing ${label}…` });
            } else {
              appendLog({ kind: 'pending', text: 'Designing sections…' });
            }
            break;
          }
          case 'section': {
            const id =
              data && typeof data === 'object'
                ? ((data as { role?: string; id?: string }).role ??
                  (data as { id?: string }).id ??
                  'section')
                : 'section';
            replaceLast({ kind: 'done', text: String(id) });
            appendLog({ kind: 'pending', text: 'Designing next section…' });
            break;
          }
          case 'error': {
            const msg =
              data && typeof data === 'object' && 'message' in (data as Record<string, unknown>)
                ? String((data as { message: string }).message)
                : typeof data === 'string'
                  ? data
                  : 'Build failed';
            replaceLast({ kind: 'error', text: msg });
            setError(msg);
            break;
          }
          case 'done': {
            // Drop any trailing "Designing next section…" pending.
            setLog((prev) => {
              if (prev.length === 0) return prev;
              const last = prev[prev.length - 1];
              if (last.kind === 'pending') return prev.slice(0, -1);
              return prev;
            });
            appendLog({ kind: 'done', text: 'Done — opening editor.' });
            break;
          }
          default:
            break;
        }
      };

      const flushBuffer = () => {
        // SSE events are separated by a blank line.
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
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        flushBuffer();
      }
      // Flush remaining buffer with a synthetic terminator.
      if (buffer.trim().length > 0) {
        buffer += '\n\n';
        flushBuffer();
      }

      if (capturedSiteId) {
        // Small delay so the user sees "Done" before navigating.
        setTimeout(() => {
          router.push(`/site/${capturedSiteId}`);
        }, 400);
      } else {
        setBusy(false);
        setError('Build completed but no site id was returned');
      }
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') return;
      setBusy(false);
      setError(err instanceof Error ? err.message : 'Stream error');
    }
  }

  return (
    <main className="min-h-screen w-full bg-neutral-50 text-neutral-900 flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-2xl">
        {!busy ? (
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="text-center space-y-2">
              <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">
                Describe it. Agents build it.
              </p>
              <h1 className="text-3xl font-semibold tracking-tight text-neutral-900">
                What do you want to build?
              </h1>
            </div>

            <div className="rounded-2xl border border-neutral-200 bg-white shadow-sm overflow-hidden">
              <textarea
                autoFocus
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Describe the website you want to build..."
                rows={6}
                className="block w-full resize-none border-0 bg-white px-5 py-4 text-[15px] leading-relaxed text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-0"
              />
              <div className="flex items-center justify-between border-t border-neutral-200 bg-neutral-50 px-4 py-2">
                <span className="text-xs text-neutral-500">
                  {prompt.trim().length < MIN_PROMPT_LENGTH
                    ? `${MIN_PROMPT_LENGTH - prompt.trim().length} more characters`
                    : `${prompt.trim().length} characters`}
                </span>
                <button
                  type="submit"
                  disabled={!canSubmit}
                  className="inline-flex items-center gap-2 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-300"
                >
                  Build site
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>

            {error ? (
              <p role="alert" className="text-sm text-red-600">
                {error}
              </p>
            ) : null}
          </form>
        ) : (
          <div className="space-y-6">
            <div className="text-center space-y-2">
              <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">Building</p>
              <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
                Your agents are at work
              </h1>
              {siteId ? (
                <p className="text-xs text-neutral-500 font-mono">site id: {siteId}</p>
              ) : null}
            </div>

            <div className="rounded-2xl border border-neutral-200 bg-white shadow-sm p-5">
              <ul className="space-y-2 font-mono text-sm">
                {log.map((line, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <LineIcon kind={line.kind} />
                    <span
                      className={
                        line.kind === 'error'
                          ? 'text-red-600'
                          : line.kind === 'done'
                            ? 'text-neutral-900'
                            : 'text-neutral-600'
                      }
                    >
                      {line.text}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            {error ? (
              <p role="alert" className="text-sm text-red-600">
                {error}
              </p>
            ) : null}
          </div>
        )}
      </div>
    </main>
  );
}

function LineIcon({ kind }: { kind: LogLine['kind'] }) {
  if (kind === 'pending') {
    return <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-neutral-400" />;
  }
  if (kind === 'done') {
    return <span className="mt-0.5 text-green-600 leading-none">✓</span>;
  }
  if (kind === 'error') {
    return <span className="mt-0.5 text-red-600 leading-none">✕</span>;
  }
  return <span className="mt-0.5 text-neutral-400 leading-none">·</span>;
}
