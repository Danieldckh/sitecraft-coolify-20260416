'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

export interface SelectedElement {
  id: string;
  html: string;
  role?: string;
}

export type InspectMode = 'inspect' | 'interact';

interface InspectorProps {
  selected: SelectedElement | null;
  /**
   * Slug of the page the selected element lives on. The parent uses this when
   * it POSTs to /api/edit; the inspector surface shows it subtly next to the
   * element id so the user knows which page context they're editing.
   */
  pageSlug?: string;
  onClear: () => void;
  onApply: (prompt: string) => void | Promise<void>;
  busy: boolean;
  error: string | null;
  success?: boolean;
  /**
   * Current editor interaction mode. When 'interact', clicks inside the iframe
   * pass through to the site (links, buttons, etc.) and the inspector shows a
   * quiet explanatory empty state instead of the usual "click a section" hint.
   */
  inspectMode?: InspectMode;
  /** Callback to flip back to inspect mode from the interact empty state. */
  onEnableInspect?: () => void;
}

const KNOWN_SECTION_ROLES = new Set([
  'hero',
  'header',
  'nav',
  'navigation',
  'features',
  'about',
  'story',
  'gallery',
  'grid',
  'cta',
  'testimonials',
  'testimonial',
  'contact',
  'footer',
  'pricing',
  'faq',
  'stats',
  'team',
  'services',
  'product',
  'products',
  'events',
  'press',
  'section',
]);

/** Heuristic: does this "role" string refer to a top-level section, or has
 *  injectElementIds handed us a nested fragment id like "hero-3"? */
function isSectionRole(role: string): boolean {
  if (!role) return false;
  if (/-\d+$/.test(role)) return false;
  return KNOWN_SECTION_ROLES.has(role.toLowerCase());
}

function readTagName(html: string): string {
  const m = /^\s*<\s*([a-zA-Z][a-zA-Z0-9-]*)/.exec(html);
  if (m && m[1]) return m[1].toLowerCase();
  return 'inner';
}

const HTML_PREVIEW_LIMIT = 600;

export function Inspector({
  selected,
  pageSlug,
  onClear,
  onApply,
  busy,
  error,
  success,
  inspectMode = 'inspect',
  onEnableInspect,
}: InspectorProps) {
  const [draft, setDraft] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);
  const [uploadedName, setUploadedName] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const selectedId = selected?.id;
  useEffect(() => {
    setDraft('');
    setUploadedUrl(null);
    setUploadedName(null);
    setUploadError(null);
    if (selectedId) {
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [selectedId]);

  async function handleFilePick(ev: React.ChangeEvent<HTMLInputElement>) {
    const file = ev.target.files?.[0];
    ev.target.value = '';
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
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
      setUploadedUrl(data.url);
      setUploadedName(file.name);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  function handleApplyClick(): void {
    const base = draft.trim();
    const imgNote = uploadedUrl
      ? `The user uploaded a replacement image at "${uploadedUrl}". ` +
        `Use this exact URL as the src attribute on the <img> tag in this element ` +
        `(or as the background-image: url("${uploadedUrl}") if the element uses a CSS background).`
      : '';
    const combined = [imgNote, base].filter(Boolean).join('\n\n');
    if (!combined) return;
    void onApply(combined);
  }

  const truncatedHtml = useMemo(() => {
    if (!selected) return '';
    return selected.html.length > HTML_PREVIEW_LIMIT
      ? selected.html.slice(0, HTML_PREVIEW_LIMIT) + '…'
      : selected.html;
  }, [selected]);

  const pillLabel = useMemo(() => {
    if (!selected) return 'section';
    const role = (selected.role || '').trim();
    if (role && isSectionRole(role)) return role;
    const tag = readTagName(selected.html);
    return tag === 'inner' ? 'inner' : `<${tag}>`;
  }, [selected]);

  /* ------------------------- Empty state ------------------------- */
  if (!selected) {
    if (inspectMode === 'interact') {
      return (
        <div className="flex h-full flex-col">
          <InspectorHeader />
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
      <div className="flex h-full flex-col">
        <InspectorHeader />
        <div className="flex flex-1 flex-col items-start px-5 pt-6">
          <p className="text-[12px] leading-relaxed text-[color:var(--sc-muted)]">
            Click any section on the left to edit
          </p>
        </div>
      </div>
    );
  }

  const trimmed = draft.trim();
  // Allow submit when either a prompt is typed OR an image has been uploaded
  // (the upload alone is enough context for the Element Editor).
  const canSubmit = !busy && !uploading && (trimmed.length > 0 || uploadedUrl !== null);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      if (canSubmit) handleApplyClick();
    }
  }

  /* ------------------------- Selected state ------------------------- */
  return (
    <div className="flex h-full flex-col">
      <InspectorHeader onClear={onClear} />

      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 pb-5 pt-5">
        {/* Role pill + id (+ page context) */}
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

        {/* HTML preview (plain grayscale) */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[10.5px] font-medium uppercase tracking-[0.12em] text-[color:var(--sc-muted)]">
              Current HTML
            </span>
            <span className="font-mono text-[10.5px] text-[color:var(--sc-muted-2)]">
              {selected.html.length.toLocaleString()} chars
            </span>
          </div>
          <pre className="max-h-44 overflow-auto rounded-[10px] border border-[color:var(--sc-border)] bg-[color:var(--sc-panel-2)] p-3 font-mono text-[11px] leading-[1.55] text-[color:var(--sc-ink-2)]">
            <code>{truncatedHtml}</code>
          </pre>
        </div>

        {/* Image upload */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[10.5px] font-medium uppercase tracking-[0.12em] text-[color:var(--sc-muted)]">
              Replace image (optional)
            </span>
            {uploadedUrl ? (
              <button
                type="button"
                onClick={() => {
                  setUploadedUrl(null);
                  setUploadedName(null);
                }}
                className="text-[11px] text-[color:var(--sc-muted)] hover:text-[color:var(--sc-ink)]"
              >
                Remove
              </button>
            ) : null}
          </div>
          {uploadedUrl ? (
            <div className="flex items-center gap-3 rounded-[10px] border border-[color:var(--sc-border)] bg-[color:var(--sc-panel-2)] p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={uploadedUrl}
                alt={uploadedName ?? 'Uploaded'}
                className="h-10 w-10 shrink-0 rounded-md object-cover"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] text-[color:var(--sc-ink)]">
                  {uploadedName ?? 'Uploaded image'}
                </p>
                <p className="truncate font-mono text-[10.5px] text-[color:var(--sc-muted)]">
                  {uploadedUrl}
                </p>
              </div>
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="inline-flex w-full items-center justify-center gap-2 rounded-[10px] border border-dashed border-[color:var(--sc-border-strong)] bg-[color:var(--sc-panel-2)] px-3 py-3 text-[12.5px] text-[color:var(--sc-ink-2)] transition-colors hover:bg-[color:var(--sc-panel)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {uploading ? (
                  <>
                    <InlineSpinner />
                    Uploading…
                  </>
                ) : (
                  'Upload an image'
                )}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFilePick}
              />
            </>
          )}
          {uploadError ? (
            <p className="mt-1.5 text-[11.5px] text-[color:var(--sc-danger)]">{uploadError}</p>
          ) : null}
        </div>

        {/* Re-prompt */}
        <div>
          <label
            htmlFor="sc-reprompt"
            className="mb-1.5 block text-[10.5px] font-medium uppercase tracking-[0.12em] text-[color:var(--sc-muted)]"
          >
            Describe the change
          </label>
          <textarea
            id="sc-reprompt"
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={5}
            placeholder="Make the headline punchier and change the button to Reserve a Seat."
            className="block w-full resize-y rounded-[10px] border border-[color:var(--sc-border)] bg-[color:var(--sc-panel)] px-3 py-2.5 text-[13px] leading-relaxed text-[color:var(--sc-ink)] placeholder:text-[color:var(--sc-muted-2)] transition-colors focus:border-[color:var(--sc-border-strong)] focus:outline-none"
          />
        </div>

        {/* Inline status text */}
        {error ? (
          <p
            role="alert"
            className="-mt-2 text-[12px] leading-relaxed text-[color:var(--sc-danger)]"
          >
            {error}
          </p>
        ) : null}

        {/* Apply button */}
        <button
          type="button"
          disabled={!canSubmit}
          onClick={handleApplyClick}
          className="inline-flex items-center justify-center gap-2 rounded-[10px] bg-[color:var(--sc-accent)] px-3 py-2.5 text-[13px] font-medium text-white transition-colors hover:bg-[color:var(--sc-accent-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? (
            <>
              <InlineSpinner />
              Applying…
            </>
          ) : success ? (
            <span style={{ color: '#ffffff' }}>Applied</span>
          ) : (
            'Apply change'
          )}
        </button>
      </div>
    </div>
  );
}

function InspectorHeader({ onClear }: { onClear?: () => void }) {
  return (
    <div className="flex h-11 shrink-0 items-center justify-between border-b border-[color:var(--sc-border)] px-5">
      <span className="text-[10.5px] font-medium uppercase tracking-[0.14em] text-[color:var(--sc-muted)]">
        Inspect
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

/** Tiny inline spinner — plain 1px ring arc, no lucide icon so the chrome
 *  stays icon-free. Matches the calm editorial tone. */
function InlineSpinner() {
  return (
    <span
      aria-hidden
      className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-white/30 border-t-white"
    />
  );
}
