'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { Paperclip, Upload, Sparkles, Wand2 } from 'lucide-react';

export interface SelectedElement {
  id: string;
  html: string;
  role?: string;
}

export type InspectMode = 'inspect' | 'interact';

export type ElementKind = 'text' | 'link' | 'button' | 'image' | 'complex';

/**
 * Detect which editing UX applies to the selected element based on its
 * opening tag + shallow inspection of its inner content. Text-ish tags
 * with child elements are treated as `complex` so we never clobber
 * nested structure with a naive textContent replacement.
 */
export function detectKind(selected: SelectedElement): ElementKind {
  const html = selected.html.trim();
  const m = /^\s*<\s*([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>/.exec(html);
  if (!m) return 'complex';
  const tag = m[1].toLowerCase();
  if (tag === 'img') return 'image';
  if (tag === 'a') return 'link';
  if (tag === 'button') return 'button';
  const TEXT_TAGS = new Set([
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'p',
    'span',
    'li',
    'em',
    'strong',
    'small',
    'label',
    'figcaption',
  ]);
  if (TEXT_TAGS.has(tag)) {
    const inner = html.replace(/^\s*<[^>]+>|<\/[a-zA-Z]+>\s*$/g, '');
    if (!/<[a-zA-Z]/.test(inner)) return 'text';
  }
  return 'complex';
}

/** Pull inner text of an outerHTML string — used for text/link/button seeds. */
export function extractText(html: string): string {
  const trimmed = html.trim();
  const openMatch = /^\s*<[^>]+>/.exec(trimmed);
  const closeMatch = /<\/[a-zA-Z][a-zA-Z0-9-]*>\s*$/.exec(trimmed);
  if (!openMatch || !closeMatch) return '';
  const inner = trimmed
    .slice(openMatch[0].length, trimmed.length - closeMatch[0].length)
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
  return inner;
}

/** Read href="..." from the opening tag of the outerHTML string. */
export function extractHref(html: string): string {
  const m = /^\s*<[^>]*\shref\s*=\s*("([^"]*)"|'([^']*)')/i.exec(html);
  if (!m) return '';
  return (m[2] ?? m[3] ?? '').trim();
}

/** Read src="..." from an <img> opening tag. */
export function extractImgSrc(html: string): string {
  const m = /^\s*<\s*img[^>]*\ssrc\s*=\s*("([^"]*)"|'([^']*)')/i.exec(html);
  if (!m) return '';
  return (m[2] ?? m[3] ?? '').trim();
}

/** Pull `background-image: url("...")` from an element's inline style, if any. */
export function extractBgImage(html: string): string {
  const styleMatch = /^\s*<[^>]*\sstyle\s*=\s*("([^"]*)"|'([^']*)')/i.exec(html);
  if (!styleMatch) return '';
  const style = styleMatch[2] ?? styleMatch[3] ?? '';
  const url =
    /background-image\s*:\s*url\(\s*(?:"([^"]+)"|'([^']+)'|([^)\s]+))\s*\)/i.exec(
      style,
    );
  if (!url) return '';
  return (url[1] ?? url[2] ?? url[3] ?? '').trim();
}

/* -------------------------------------------------------------------------- */
/* Patch + SSE helpers                                                        */
/* -------------------------------------------------------------------------- */

type PatchKind = 'text' | 'href' | 'img-src' | 'button-text';

interface PatchOpBase<K extends PatchKind> {
  kind: K;
  value: string;
}

type PatchOp =
  | PatchOpBase<'text'>
  | PatchOpBase<'href'>
  | PatchOpBase<'img-src'>
  | PatchOpBase<'button-text'>;

async function postPatch(args: {
  siteId: string;
  pageSlug: string;
  elementId: string;
  op: PatchOp;
}): Promise<{ html: string }> {
  const res = await fetch('/api/patch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    let msg = `Patch failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) msg = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return (await res.json()) as { html: string };
}

async function postGenerateImage(args: {
  prompt: string;
  size?: string;
}): Promise<{ url: string; bytes?: number }> {
  const res = await fetch('/api/generate-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    let msg = `Generate failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) msg = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return (await res.json()) as { url: string; bytes?: number };
}

async function postUpload(file: File): Promise<{ url: string }> {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch('/api/uploads', { method: 'POST', body: fd });
  if (!res.ok) {
    let msg = `Upload failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) msg = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  const data = (await res.json()) as { url?: string };
  if (!data.url) throw new Error('Upload returned no URL');
  return { url: data.url };
}

/**
 * Parse a text/event-stream response from /api/revise. Invokes onEvent for each
 * fully-received SSE event; resolves when the stream ends.
 */
async function consumeReviseStream(
  res: Response,
  onEvent: (name: string, data: unknown) => void,
): Promise<void> {
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('text/event-stream') || !res.body) {
    throw new Error('Server did not return an SSE stream');
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const flush = () => {
    let sep = buffer.indexOf('\n\n');
    while (sep !== -1) {
      const raw = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      let eventName = 'message';
      const dataLines: string[] = [];
      for (const rawLine of raw.split('\n')) {
        const line = rawLine.replace(/\r$/, '');
        if (!line || line.startsWith(':')) continue;
        if (line.startsWith('event:')) {
          eventName = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).replace(/^ /, ''));
        }
      }
      const dataRaw = dataLines.join('\n');
      let parsed: unknown = undefined;
      if (dataRaw) {
        try {
          parsed = JSON.parse(dataRaw);
        } catch {
          parsed = dataRaw;
        }
      }
      onEvent(eventName, parsed);
      sep = buffer.indexOf('\n\n');
    }
  };

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    flush();
  }
  if (buffer.trim().length > 0) {
    buffer += '\n\n';
    flush();
  }
}

/* -------------------------------------------------------------------------- */
/* Props                                                                      */
/* -------------------------------------------------------------------------- */

export interface InspectorProps {
  siteId: string;
  selected: SelectedElement | null;
  pageSlug?: string;
  inspectMode?: InspectMode;
  busy: boolean;
  error: string | null;
  success?: boolean;
  onClear: () => void;
  /** Fallback prompt flow — parent POSTs to /api/edit and reloads the iframe. */
  onApply: (prompt: string) => void | Promise<void>;
  onEnableInspect?: () => void;
  /** Called after a direct /api/patch succeeds — parent should bump the iframe nonce with scroll preserved. */
  onAfterPatch?: () => void;
  /** Called after /api/revise finishes — parent should fully reload the iframe (theme/structural changes). */
  onAfterRevise?: () => void;
}

/* -------------------------------------------------------------------------- */
/* Component                                                                  */
/* -------------------------------------------------------------------------- */

export function Inspector({
  siteId,
  selected,
  pageSlug,
  inspectMode = 'inspect',
  busy,
  error,
  success,
  onClear,
  onApply,
  onEnableInspect,
  onAfterPatch,
  onAfterRevise,
}: InspectorProps) {
  const selectedId = selected?.id ?? null;
  const kind = useMemo<ElementKind | null>(
    () => (selected ? detectKind(selected) : null),
    [selected],
  );

  const pillLabel = useMemo(() => {
    if (!selected) return 'section';
    const tagMatch = /^\s*<\s*([a-zA-Z][a-zA-Z0-9-]*)/.exec(selected.html);
    const tag = tagMatch?.[1]?.toLowerCase() ?? 'section';
    return `<${tag}>`;
  }, [selected]);

  /* ------------------------- Empty state ------------------------- */
  if (!selected) {
    if (inspectMode === 'interact') {
      return (
        <div className="flex h-full flex-col">
          <InspectorHeader title="Site" />
          <div className="flex flex-1 flex-col items-start gap-2 px-5 pt-6">
            <p className="text-[13px] font-medium leading-snug text-[color:var(--sc-ink)]">
              Inspect mode is off
            </p>
            <p className="text-[12px] leading-relaxed text-[color:var(--sc-muted)]">
              Toggle inspect on to click elements and edit them.
            </p>
            {onEnableInspect ? (
              <button
                type="button"
                onClick={onEnableInspect}
                className="mt-2 text-[11.5px] font-medium text-[color:var(--sc-muted)] underline decoration-[color:var(--sc-border)] underline-offset-4 transition-colors hover:text-[color:var(--sc-ink)] hover:decoration-[color:var(--sc-ink)]"
              >
                Turn inspect on
              </button>
            ) : null}
          </div>
        </div>
      );
    }
    return (
      <SiteWideEmptyState siteId={siteId} onAfterRevise={onAfterRevise} />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <InspectorHeader title="Inspect" onClear={onClear} />

      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 pb-5 pt-5">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center rounded-full border border-[color:var(--sc-border)] bg-[color:var(--sc-panel-2)] px-2 py-0.5 text-[10.5px] font-medium uppercase tracking-[0.08em] text-[color:var(--sc-ink-2)]">
            {pillLabel}
          </span>
          <span className="truncate font-mono text-[10.5px] text-[color:var(--sc-muted-2)]">
            {selected.id}
          </span>
          {pageSlug ? (
            <span className="ml-auto shrink-0 font-mono text-[10.5px] text-[color:var(--sc-muted-2)]">
              {pageSlug}
            </span>
          ) : null}
        </div>

        {kind === 'text' ? (
          <TextKind
            key={selectedId ?? 'none'}
            siteId={siteId}
            pageSlug={pageSlug}
            selected={selected}
            onAfterPatch={onAfterPatch}
            onApply={onApply}
            parentBusy={busy}
            parentError={error}
            parentSuccess={success}
          />
        ) : null}
        {kind === 'link' ? (
          <LinkKind
            key={selectedId ?? 'none'}
            siteId={siteId}
            pageSlug={pageSlug}
            selected={selected}
            onAfterPatch={onAfterPatch}
            onApply={onApply}
            parentBusy={busy}
            parentError={error}
            parentSuccess={success}
          />
        ) : null}
        {kind === 'button' ? (
          <ButtonKind
            key={selectedId ?? 'none'}
            siteId={siteId}
            pageSlug={pageSlug}
            selected={selected}
            onAfterPatch={onAfterPatch}
            onApply={onApply}
            parentBusy={busy}
            parentError={error}
            parentSuccess={success}
          />
        ) : null}
        {kind === 'image' ? (
          <ImageKind
            key={selectedId ?? 'none'}
            siteId={siteId}
            pageSlug={pageSlug}
            selected={selected}
            onAfterPatch={onAfterPatch}
            onApply={onApply}
            parentBusy={busy}
            parentError={error}
            parentSuccess={success}
          />
        ) : null}
        {kind === 'complex' ? (
          <ComplexKind
            key={selectedId ?? 'none'}
            onApply={onApply}
            parentBusy={busy}
            parentError={error}
            parentSuccess={success}
          />
        ) : null}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Site-wide empty state (revise)                                             */
/* -------------------------------------------------------------------------- */

interface RevisePageEvent {
  slug: string;
  pageHtml: string;
}

function SiteWideEmptyState({
  siteId,
  onAfterRevise,
}: {
  siteId: string;
  onAfterRevise?: () => void;
}) {
  const [prompt, setPrompt] = useState('');
  const [attachments, setAttachments] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [classification, setClassification] =
    useState<'theme' | 'structural' | null>(null);
  const [updatedSlugs, setUpdatedSlugs] = useState<string[]>([]);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), 1500);
    return () => clearTimeout(t);
  }, [done]);

  const canSubmit = !busy && prompt.trim().length > 0;

  const onSubmit = useCallback(async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    setStatusMsg(null);
    setClassification(null);
    setUpdatedSlugs([]);
    setDone(false);

    try {
      const res = await fetch('/api/revise', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({
          siteId,
          prompt: prompt.trim(),
          attachmentUrls: attachments.length > 0 ? attachments : undefined,
        }),
      });
      if (!res.ok) {
        let msg = `Revise failed (${res.status})`;
        try {
          const body = (await res.json()) as { error?: string };
          if (body?.error) msg = body.error;
        } catch {
          /* ignore */
        }
        throw new Error(msg);
      }
      await consumeReviseStream(res, (name, data) => {
        const obj =
          data && typeof data === 'object'
            ? (data as Record<string, unknown>)
            : {};
        switch (name) {
          case 'status': {
            const message =
              typeof obj.message === 'string' ? (obj.message as string) : null;
            if (message) setStatusMsg(message);
            break;
          }
          case 'classification': {
            const mode = obj.mode;
            if (mode === 'theme' || mode === 'structural') {
              setClassification(mode);
            }
            break;
          }
          case 'page': {
            const slug =
              typeof obj.slug === 'string' ? (obj.slug as string) : null;
            if (slug) {
              setUpdatedSlugs((prev) => (prev.includes(slug) ? prev : [...prev, slug]));
            }
            break;
          }
          case 'error': {
            const message =
              typeof obj.message === 'string' ? (obj.message as string) : 'Revise failed';
            throw new Error(message);
          }
          case 'done':
          default:
            break;
        }
      });
      setDone(true);
      setPrompt('');
      setAttachments([]);
      setStatusMsg(null);
      if (onAfterRevise) onAfterRevise();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Revise failed');
    } finally {
      setBusy(false);
    }
  }, [canSubmit, siteId, prompt, attachments, onAfterRevise]);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      void onSubmit();
    }
  };

  return (
    <div className="flex h-full flex-col">
      <InspectorHeader title="Site-wide" />
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pb-5 pt-5">
        <p className="text-[12px] leading-relaxed text-[color:var(--sc-muted)]">
          Describe a change to the whole site. Visual tweaks stay fast; structural changes rebuild pages.
        </p>

        <PromptBoxWithPaperclip
          value={prompt}
          onChange={setPrompt}
          onKeyDown={onKeyDown}
          attachments={attachments}
          onAttach={(url) => setAttachments((prev) => [...prev, url])}
          onRemoveAttachment={(url) =>
            setAttachments((prev) => prev.filter((u) => u !== url))
          }
          disabled={busy}
          placeholder="Make the palette darker, or add a testimonials section."
        />

        {statusMsg || classification || updatedSlugs.length > 0 ? (
          <div className="flex flex-col gap-1 rounded-[10px] border border-[color:var(--sc-border)] bg-[color:var(--sc-panel-2)] px-3 py-2 text-[11.5px] text-[color:var(--sc-ink-2)]">
            {classification ? (
              <span className="text-[color:var(--sc-muted)]">
                Mode:{' '}
                <span className="text-[color:var(--sc-ink-2)]">
                  {classification === 'theme' ? 'theme-only' : 'structural'}
                </span>
              </span>
            ) : null}
            {statusMsg ? (
              <span className="text-[color:var(--sc-muted)]">{statusMsg}</span>
            ) : null}
            {updatedSlugs.length > 0 ? (
              <span className="text-[color:var(--sc-muted)]">
                Updated: {updatedSlugs.join(', ')}
              </span>
            ) : null}
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="text-[12px] leading-relaxed text-[color:var(--sc-danger)]">
            {error}
          </p>
        ) : null}

        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => void onSubmit()}
          className="inline-flex items-center justify-center gap-2 rounded-[10px] bg-[color:var(--sc-accent)] px-3 py-2.5 text-[13px] font-medium text-white transition-colors hover:bg-[color:var(--sc-accent-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? (
            <>
              <InlineSpinner />
              Applying…
            </>
          ) : done ? (
            <span style={{ color: '#ffffff' }}>Applied</span>
          ) : (
            'Apply'
          )}
        </button>

        <p className="text-[11.5px] leading-relaxed text-[color:var(--sc-muted-2)]">
          Tip: describe visual changes (e.g. &ldquo;darker palette&rdquo;) or structural ones (e.g. &ldquo;add a testimonials section&rdquo;).
        </p>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Text kind                                                                  */
/* -------------------------------------------------------------------------- */

interface KindBaseProps {
  siteId: string;
  pageSlug?: string;
  selected: SelectedElement;
  onAfterPatch?: () => void;
  onApply: (prompt: string) => void | Promise<void>;
  parentBusy: boolean;
  parentError: string | null;
  parentSuccess?: boolean;
}

function TextKind({
  siteId,
  pageSlug,
  selected,
  onAfterPatch,
  onApply,
  parentBusy,
  parentError,
  parentSuccess,
}: KindBaseProps) {
  const initial = useMemo(() => extractText(selected.html), [selected.html]);
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedTick, setSavedTick] = useState(false);
  const textRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    requestAnimationFrame(() => {
      const el = textRef.current;
      if (!el) return;
      el.focus();
      el.select();
    });
  }, []);

  useEffect(() => {
    if (!savedTick) return;
    const t = setTimeout(() => setSavedTick(false), 1500);
    return () => clearTimeout(t);
  }, [savedTick]);

  const canSave =
    !saving &&
    !parentBusy &&
    draft.trim().length > 0 &&
    draft !== initial &&
    typeof pageSlug === 'string';

  const onSave = async () => {
    if (!canSave || !pageSlug) return;
    setSaving(true);
    setSaveError(null);
    try {
      await postPatch({
        siteId,
        pageSlug,
        elementId: selected.id,
        op: { kind: 'text', value: draft },
      });
      setSavedTick(true);
      if (onAfterPatch) onAfterPatch();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div>
        <FieldLabel>Current text</FieldLabel>
        <p className="mt-1 max-h-16 overflow-hidden text-[12px] leading-relaxed text-[color:var(--sc-muted)]">
          {initial || <span className="italic">(empty)</span>}
        </p>
      </div>

      <div>
        <FieldLabel htmlFor="sc-text-draft">New text</FieldLabel>
        <textarea
          id="sc-text-draft"
          ref={textRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              void onSave();
            }
          }}
          rows={4}
          className="mt-1 block w-full resize-y rounded-[10px] border border-[color:var(--sc-border)] bg-[color:var(--sc-panel)] px-3 py-2.5 text-[13px] leading-relaxed text-[color:var(--sc-ink)] placeholder:text-[color:var(--sc-muted-2)] transition-colors focus:border-[color:var(--sc-border-strong)] focus:outline-none"
        />
      </div>

      {saveError ? <InlineError message={saveError} /> : null}

      <PrimaryAction
        busy={saving}
        success={savedTick}
        disabled={!canSave}
        onClick={() => void onSave()}
        label="Save"
      />

      <AdvancedPromptDetails
        onApply={onApply}
        parentBusy={parentBusy}
        parentError={parentError}
        parentSuccess={parentSuccess}
      />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Link kind                                                                  */
/* -------------------------------------------------------------------------- */

function LinkKind({
  siteId,
  pageSlug,
  selected,
  onAfterPatch,
  onApply,
  parentBusy,
  parentError,
  parentSuccess,
}: KindBaseProps) {
  const initialText = useMemo(() => extractText(selected.html), [selected.html]);
  const initialHref = useMemo(() => extractHref(selected.html), [selected.html]);
  const [text, setText] = useState(initialText);
  const [href, setHref] = useState(initialHref);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedTick, setSavedTick] = useState(false);

  useEffect(() => {
    if (!savedTick) return;
    const t = setTimeout(() => setSavedTick(false), 1500);
    return () => clearTimeout(t);
  }, [savedTick]);

  const changed = text !== initialText || href !== initialHref;
  const canSave =
    !saving && !parentBusy && changed && typeof pageSlug === 'string';

  const onSave = async () => {
    if (!canSave || !pageSlug) return;
    setSaving(true);
    setSaveError(null);
    try {
      const ops: Promise<unknown>[] = [];
      if (href !== initialHref) {
        ops.push(
          postPatch({
            siteId,
            pageSlug,
            elementId: selected.id,
            op: { kind: 'href', value: href },
          }),
        );
      }
      if (text !== initialText) {
        ops.push(
          postPatch({
            siteId,
            pageSlug,
            elementId: selected.id,
            op: { kind: 'text', value: text },
          }),
        );
      }
      // Serialize so the server-side HTML update ordering is deterministic.
      for (const fn of ops) await fn;
      setSavedTick(true);
      if (onAfterPatch) onAfterPatch();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <TextField
        id="sc-link-text"
        label="Text"
        value={text}
        onChange={setText}
      />
      <TextField
        id="sc-link-href"
        label="URL"
        value={href}
        onChange={setHref}
        placeholder="https://example.com or ./about"
      />

      {saveError ? <InlineError message={saveError} /> : null}

      <PrimaryAction
        busy={saving}
        success={savedTick}
        disabled={!canSave}
        onClick={() => void onSave()}
        label="Save"
      />

      <AdvancedPromptDetails
        onApply={onApply}
        parentBusy={parentBusy}
        parentError={parentError}
        parentSuccess={parentSuccess}
      />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Button kind                                                                */
/* -------------------------------------------------------------------------- */

function ButtonKind({
  siteId,
  pageSlug,
  selected,
  onAfterPatch,
  onApply,
  parentBusy,
  parentError,
  parentSuccess,
}: KindBaseProps) {
  const initial = useMemo(() => extractText(selected.html), [selected.html]);
  const [text, setText] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedTick, setSavedTick] = useState(false);

  useEffect(() => {
    if (!savedTick) return;
    const t = setTimeout(() => setSavedTick(false), 1500);
    return () => clearTimeout(t);
  }, [savedTick]);

  const canSave =
    !saving &&
    !parentBusy &&
    text.trim().length > 0 &&
    text !== initial &&
    typeof pageSlug === 'string';

  const onSave = async () => {
    if (!canSave || !pageSlug) return;
    setSaving(true);
    setSaveError(null);
    try {
      await postPatch({
        siteId,
        pageSlug,
        elementId: selected.id,
        op: { kind: 'button-text', value: text },
      });
      setSavedTick(true);
      if (onAfterPatch) onAfterPatch();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <TextField id="sc-button-text" label="Text" value={text} onChange={setText} />
      {saveError ? <InlineError message={saveError} /> : null}
      <PrimaryAction
        busy={saving}
        success={savedTick}
        disabled={!canSave}
        onClick={() => void onSave()}
        label="Save"
      />
      <AdvancedPromptDetails
        onApply={onApply}
        parentBusy={parentBusy}
        parentError={parentError}
        parentSuccess={parentSuccess}
      />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Image kind                                                                 */
/* -------------------------------------------------------------------------- */

type ImageTab = 'upload' | 'generate' | 'prompt';

function ImageKind({
  siteId,
  pageSlug,
  selected,
  onAfterPatch,
  onApply,
  parentBusy,
  parentError,
  parentSuccess,
}: KindBaseProps) {
  const currentSrc = useMemo(() => {
    const direct = extractImgSrc(selected.html);
    if (direct) return direct;
    return extractBgImage(selected.html);
  }, [selected.html]);

  const [tab, setTab] = useState<ImageTab>('upload');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [savedTick, setSavedTick] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [genPrompt, setGenPrompt] = useState('');
  const [promptDraft, setPromptDraft] = useState('');

  useEffect(() => {
    if (!savedTick) return;
    const t = setTimeout(() => setSavedTick(false), 1500);
    return () => clearTimeout(t);
  }, [savedTick]);

  const applyImgSrcPatch = useCallback(
    async (url: string) => {
      if (!pageSlug) throw new Error('No page context');
      await postPatch({
        siteId,
        pageSlug,
        elementId: selected.id,
        op: { kind: 'img-src', value: url },
      });
    },
    [siteId, pageSlug, selected.id],
  );

  const onPickFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      const { url } = await postUpload(file);
      await applyImgSrcPatch(url);
      setSavedTick(true);
      if (onAfterPatch) onAfterPatch();
    } catch (caught) {
      setErr(caught instanceof Error ? caught.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  };

  const onGenerate = async () => {
    if (!genPrompt.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const { url } = await postGenerateImage({ prompt: genPrompt.trim() });
      await applyImgSrcPatch(url);
      setSavedTick(true);
      setGenPrompt('');
      if (onAfterPatch) onAfterPatch();
    } catch (caught) {
      setErr(caught instanceof Error ? caught.message : 'Generate failed');
    } finally {
      setBusy(false);
    }
  };

  const onSubmitPrompt = async () => {
    if (!promptDraft.trim() || parentBusy) return;
    await onApply(promptDraft.trim());
    setPromptDraft('');
  };

  return (
    <>
      {currentSrc ? (
        <div>
          <FieldLabel>Current image</FieldLabel>
          <div className="mt-1 flex items-center gap-3 rounded-[10px] border border-[color:var(--sc-border)] bg-[color:var(--sc-panel-2)] p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={currentSrc}
              alt="Current"
              className="h-14 w-14 shrink-0 rounded-md object-cover"
            />
            <p className="truncate font-mono text-[10.5px] text-[color:var(--sc-muted)]">
              {currentSrc}
            </p>
          </div>
        </div>
      ) : null}

      <div>
        <div
          role="tablist"
          aria-label="Image edit mode"
          className="inline-flex items-center rounded-[10px] border border-[color:var(--sc-border)] bg-[color:var(--sc-panel-2)] p-0.5"
        >
          <ImageTabButton
            active={tab === 'upload'}
            label="Upload"
            onClick={() => setTab('upload')}
          >
            <Upload className="h-3.5 w-3.5" aria-hidden />
          </ImageTabButton>
          <ImageTabButton
            active={tab === 'generate'}
            label="Generate"
            onClick={() => setTab('generate')}
          >
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
          </ImageTabButton>
          <ImageTabButton
            active={tab === 'prompt'}
            label="Prompt"
            onClick={() => setTab('prompt')}
          >
            <Wand2 className="h-3.5 w-3.5" aria-hidden />
          </ImageTabButton>
        </div>
      </div>

      {tab === 'upload' ? (
        <div>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy || !pageSlug}
            className="inline-flex w-full items-center justify-center gap-2 rounded-[10px] border border-dashed border-[color:var(--sc-border-strong)] bg-[color:var(--sc-panel-2)] px-3 py-3 text-[12.5px] text-[color:var(--sc-ink-2)] transition-colors hover:bg-[color:var(--sc-panel)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? (
              <>
                <InlineSpinner />
                Uploading…
              </>
            ) : (
              'Choose an image from disk'
            )}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => void onPickFile(e)}
          />
        </div>
      ) : null}

      {tab === 'generate' ? (
        <div>
          <FieldLabel htmlFor="sc-img-gen">Describe the image</FieldLabel>
          <textarea
            id="sc-img-gen"
            value={genPrompt}
            onChange={(e) => setGenPrompt(e.target.value)}
            rows={3}
            placeholder="an image of a wood-fired bakery oven at dawn"
            className="mt-1 block w-full resize-y rounded-[10px] border border-[color:var(--sc-border)] bg-[color:var(--sc-panel)] px-3 py-2.5 text-[13px] leading-relaxed text-[color:var(--sc-ink)] placeholder:text-[color:var(--sc-muted-2)] transition-colors focus:border-[color:var(--sc-border-strong)] focus:outline-none"
          />
          <div className="mt-3">
            <PrimaryAction
              busy={busy}
              success={savedTick}
              disabled={busy || !genPrompt.trim() || !pageSlug}
              onClick={() => void onGenerate()}
              label="Generate"
            />
          </div>
        </div>
      ) : null}

      {tab === 'prompt' ? (
        <div>
          <FieldLabel htmlFor="sc-img-prompt">Describe the change</FieldLabel>
          <textarea
            id="sc-img-prompt"
            value={promptDraft}
            onChange={(e) => setPromptDraft(e.target.value)}
            rows={4}
            placeholder="Swap for a warmer photo with more contrast."
            className="mt-1 block w-full resize-y rounded-[10px] border border-[color:var(--sc-border)] bg-[color:var(--sc-panel)] px-3 py-2.5 text-[13px] leading-relaxed text-[color:var(--sc-ink)] placeholder:text-[color:var(--sc-muted-2)] transition-colors focus:border-[color:var(--sc-border-strong)] focus:outline-none"
          />
          <div className="mt-3">
            <PrimaryAction
              busy={parentBusy}
              success={parentSuccess}
              disabled={parentBusy || !promptDraft.trim()}
              onClick={() => void onSubmitPrompt()}
              label="Apply"
            />
          </div>
          {parentError ? <InlineError message={parentError} /> : null}
        </div>
      ) : null}

      {err ? <InlineError message={err} /> : null}
      {tab !== 'prompt' && savedTick ? (
        <p className="text-[11.5px] text-[color:var(--sc-success)]">Applied.</p>
      ) : null}
    </>
  );
}

function ImageTabButton({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
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
/* Complex kind                                                               */
/* -------------------------------------------------------------------------- */

function ComplexKind({
  onApply,
  parentBusy,
  parentError,
  parentSuccess,
}: {
  onApply: (prompt: string) => void | Promise<void>;
  parentBusy: boolean;
  parentError: string | null;
  parentSuccess?: boolean;
}) {
  const [prompt, setPrompt] = useState('');
  const [attachments, setAttachments] = useState<string[]>([]);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    requestAnimationFrame(() => taRef.current?.focus());
  }, []);

  const canSubmit = !parentBusy && (prompt.trim().length > 0 || attachments.length > 0);

  const submit = () => {
    if (!canSubmit) return;
    const lines: string[] = [];
    for (const url of attachments) {
      lines.push(`[User attached: ${url}] Use this image in the element as appropriate.`);
    }
    if (prompt.trim()) lines.push(prompt.trim());
    const combined = lines.join('\n\n');
    void onApply(combined);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  };

  return (
    <>
      <PromptBoxWithPaperclip
        value={prompt}
        onChange={setPrompt}
        onKeyDown={onKeyDown}
        attachments={attachments}
        onAttach={(url) => setAttachments((prev) => [...prev, url])}
        onRemoveAttachment={(url) =>
          setAttachments((prev) => prev.filter((u) => u !== url))
        }
        disabled={parentBusy}
        placeholder="Make the headline punchier and change the button to Reserve a Seat."
        textareaRef={taRef}
      />
      {parentError ? <InlineError message={parentError} /> : null}
      <PrimaryAction
        busy={parentBusy}
        success={parentSuccess}
        disabled={!canSubmit}
        onClick={submit}
        label="Apply"
      />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Advanced prompt details                                                    */
/* -------------------------------------------------------------------------- */

function AdvancedPromptDetails({
  onApply,
  parentBusy,
  parentError,
  parentSuccess,
}: {
  onApply: (prompt: string) => void | Promise<void>;
  parentBusy: boolean;
  parentError: string | null;
  parentSuccess?: boolean;
}) {
  const [prompt, setPrompt] = useState('');
  const canSubmit = !parentBusy && prompt.trim().length > 0;
  return (
    <details className="group rounded-[10px] border border-[color:var(--sc-border)] bg-[color:var(--sc-panel-2)] px-3 py-2">
      <summary className="cursor-pointer list-none text-[11.5px] font-medium uppercase tracking-[0.1em] text-[color:var(--sc-muted)] transition-colors hover:text-[color:var(--sc-ink)]">
        Advanced: prompt instead
      </summary>
      <div className="mt-3 flex flex-col gap-3">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              if (canSubmit) void onApply(prompt.trim());
            }
          }}
          rows={3}
          placeholder="Describe the change in plain English."
          className="block w-full resize-y rounded-[10px] border border-[color:var(--sc-border)] bg-[color:var(--sc-panel)] px-3 py-2.5 text-[13px] leading-relaxed text-[color:var(--sc-ink)] placeholder:text-[color:var(--sc-muted-2)] transition-colors focus:border-[color:var(--sc-border-strong)] focus:outline-none"
        />
        {parentError ? <InlineError message={parentError} /> : null}
        <PrimaryAction
          busy={parentBusy}
          success={parentSuccess}
          disabled={!canSubmit}
          onClick={() => {
            if (canSubmit) void onApply(prompt.trim());
          }}
          label="Apply"
        />
      </div>
    </details>
  );
}

/* -------------------------------------------------------------------------- */
/* Prompt box + paperclip                                                     */
/* -------------------------------------------------------------------------- */

interface PromptBoxProps {
  value: string;
  onChange: (next: string) => void;
  onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  attachments: string[];
  onAttach: (url: string) => void;
  onRemoveAttachment: (url: string) => void;
  disabled?: boolean;
  placeholder?: string;
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
}

function PromptBoxWithPaperclip({
  value,
  onChange,
  onKeyDown,
  attachments,
  onAttach,
  onRemoveAttachment,
  disabled,
  placeholder,
  textareaRef,
}: PromptBoxProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="relative rounded-[10px] border border-[color:var(--sc-border)] bg-[color:var(--sc-panel)] transition-colors focus-within:border-[color:var(--sc-border-strong)]">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          rows={5}
          disabled={disabled}
          placeholder={placeholder}
          className="block w-full resize-y rounded-[10px] bg-transparent px-3 py-2.5 pl-9 text-[13px] leading-relaxed text-[color:var(--sc-ink)] placeholder:text-[color:var(--sc-muted-2)] focus:outline-none disabled:opacity-60"
        />
        <div className="pointer-events-auto absolute left-2 top-2">
          <PaperclipUpload onUploaded={onAttach} disabled={disabled} />
        </div>
      </div>
      {attachments.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {attachments.map((url) => (
            <li
              key={url}
              className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--sc-border)] bg-[color:var(--sc-panel-2)] px-2 py-0.5 text-[11px] text-[color:var(--sc-ink-2)]"
            >
              <span className="max-w-[180px] truncate font-mono text-[10.5px] text-[color:var(--sc-muted)]">
                {url}
              </span>
              <button
                type="button"
                onClick={() => onRemoveAttachment(url)}
                aria-label="Remove attachment"
                className="text-[color:var(--sc-muted)] transition-colors hover:text-[color:var(--sc-ink)]"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function PaperclipUpload({
  onUploaded,
  disabled,
}: {
  onUploaded: (url: string) => void;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onPick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      const { url } = await postUpload(file);
      onUploaded(url);
    } catch (caught) {
      setErr(caught instanceof Error ? caught.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => ref.current?.click()}
        disabled={disabled || busy}
        aria-label="Attach image"
        title={err ?? 'Attach image'}
        className="inline-flex h-6 w-6 items-center justify-center rounded-md text-[color:var(--sc-muted)] transition-colors hover:bg-[color:var(--sc-panel-2)] hover:text-[color:var(--sc-ink)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? (
          <span
            aria-hidden
            className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-[color:var(--sc-muted-2)] border-t-[color:var(--sc-ink)]"
          />
        ) : (
          <Paperclip className="h-3.5 w-3.5" aria-hidden />
        )}
      </button>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => void onPick(e)}
      />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Tiny shared UI                                                             */
/* -------------------------------------------------------------------------- */

function FieldLabel({
  children,
  htmlFor,
}: {
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="block text-[10.5px] font-medium uppercase tracking-[0.12em] text-[color:var(--sc-muted)]"
    >
      {children}
    </label>
  );
}

function TextField({
  id,
  label,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <input
        id={id}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 block w-full rounded-[10px] border border-[color:var(--sc-border)] bg-[color:var(--sc-panel)] px-3 py-2 text-[13px] leading-relaxed text-[color:var(--sc-ink)] placeholder:text-[color:var(--sc-muted-2)] transition-colors focus:border-[color:var(--sc-border-strong)] focus:outline-none"
      />
    </div>
  );
}

function PrimaryAction({
  busy,
  success,
  disabled,
  onClick,
  label,
}: {
  busy: boolean;
  success?: boolean;
  disabled: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="inline-flex items-center justify-center gap-2 rounded-[10px] bg-[color:var(--sc-accent)] px-3 py-2.5 text-[13px] font-medium text-white transition-colors hover:bg-[color:var(--sc-accent-hover)] disabled:cursor-not-allowed disabled:opacity-40"
    >
      {busy ? (
        <>
          <InlineSpinner />
          Working…
        </>
      ) : success ? (
        <span style={{ color: '#ffffff' }}>Applied</span>
      ) : (
        label
      )}
    </button>
  );
}

function InlineError({ message }: { message: string }) {
  return (
    <p role="alert" className="text-[12px] leading-relaxed text-[color:var(--sc-danger)]">
      {message}
    </p>
  );
}

function InspectorHeader({
  title,
  onClear,
}: {
  title: string;
  onClear?: () => void;
}) {
  return (
    <div className="flex h-11 shrink-0 items-center justify-between border-b border-[color:var(--sc-border)] px-5">
      <span className="text-[10.5px] font-medium uppercase tracking-[0.14em] text-[color:var(--sc-muted)]">
        {title}
      </span>
      {onClear ? (
        <button
          type="button"
          onClick={onClear}
          className="text-[11.5px] text-[color:var(--sc-muted)] transition-colors hover:text-[color:var(--sc-ink)]"
          aria-label="Clear selection"
        >
          Clear
        </button>
      ) : null}
    </div>
  );
}

function InlineSpinner() {
  return (
    <span
      aria-hidden
      className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-white/30 border-t-white"
    />
  );
}
