'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  Loader2,
  MousePointerClick,
  Sparkles,
  X,
} from 'lucide-react';

export interface SelectedElement {
  id: string;
  html: string;
  role?: string;
}

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
 *  injectElementIds handed us a nested fragment id like "hero-3"? For the
 *  latter we want to show the tag name instead so the user understands they're
 *  editing an inner element. */
function isSectionRole(role: string): boolean {
  if (!role) return false;
  // Ids like "hero-3" / "gallery-2" are nested element tags.
  if (/-\d+$/.test(role)) return false;
  return KNOWN_SECTION_ROLES.has(role.toLowerCase());
}

/** Pull the opening tag name out of the element's outerHTML so we can label
 *  nested fragments with something accurate (e.g. "<h1>", "<button>"). Falls
 *  back to "inner" when parsing fails. */
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
}: InspectorProps) {
  const [draft, setDraft] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Reset the draft whenever a new element is selected.
  const selectedId = selected?.id;
  useEffect(() => {
    setDraft('');
    if (selectedId) {
      // Focus the prompt textarea so the user can type immediately.
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [selectedId]);

  const truncatedHtml = useMemo(() => {
    if (!selected) return '';
    return selected.html.length > HTML_PREVIEW_LIMIT
      ? selected.html.slice(0, HTML_PREVIEW_LIMIT) + '…'
      : selected.html;
  }, [selected]);

  // Decide the role-pill label. Section roles (hero / footer / etc.) keep the
  // original role string; nested fragments (ids like "hero-3" or roles missing
  // from the known set) show the actual tag name so the user knows they're
  // editing a piece of a section, not the whole section.
  const pillLabel = useMemo(() => {
    if (!selected) return 'section';
    const role = (selected.role || '').trim();
    if (role && isSectionRole(role)) return role;
    // Nested element — prefer tag name, e.g. "<h1>" / "<button>".
    const tag = readTagName(selected.html);
    return tag === 'inner' ? 'inner' : `<${tag}>`;
  }, [selected]);

  if (!selected) {
    return (
      <div className="flex h-full flex-col">
        <InspectorHeader title="Inspector" />
        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
          <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-full border border-[color:var(--sc-border)] bg-[color:var(--sc-panel-2)]">
            <MousePointerClick className="h-4 w-4 text-[color:var(--sc-muted)]" />
          </div>
          <p className="text-[13.5px] font-medium text-[color:var(--sc-ink)]">
            Click any section to edit
          </p>
          <p className="mt-1.5 max-w-[240px] text-[12px] leading-relaxed text-[color:var(--sc-muted)]">
            Hover the preview to see the outlines, then click a section to open
            its prompt editor here.
          </p>
          <div className="mt-6 flex items-center gap-1.5 text-[11px] text-[color:var(--sc-muted-2)]">
            <kbd className="rounded border border-[color:var(--sc-border)] bg-[color:var(--sc-panel)] px-1.5 py-0.5 font-sans text-[10px] text-[color:var(--sc-ink-2)]">
              ⌘
            </kbd>
            <span>+</span>
            <kbd className="rounded border border-[color:var(--sc-border)] bg-[color:var(--sc-panel)] px-1.5 py-0.5 font-sans text-[10px] text-[color:var(--sc-ink-2)]">
              ⏎
            </kbd>
            <span className="ml-1">to apply a change</span>
          </div>
        </div>
      </div>
    );
  }

  const canSubmit = !busy && draft.trim().length > 0;

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      if (canSubmit) void onApply(draft.trim());
    }
  }

  return (
    <div className="flex h-full flex-col">
      <InspectorHeader title="Inspector" onClear={onClear} />

      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 pb-4 pt-4">
        {/* Role pill + id (+ page context) */}
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full border border-[color:var(--sc-border-strong)] bg-[color:var(--sc-panel-2)] px-2 py-0.5 text-[10.5px] font-medium uppercase tracking-[0.08em] text-[color:var(--sc-ink-2)]">
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

        {/* HTML preview */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label className="block text-[11px] font-medium uppercase tracking-[0.12em] text-[color:var(--sc-muted)]">
              Current HTML
            </label>
            <span className="font-mono text-[10.5px] text-[color:var(--sc-muted-2)]">
              {selected.html.length.toLocaleString()} chars
            </span>
          </div>
          <pre className="max-h-44 overflow-auto rounded-md border border-[color:var(--sc-border)] bg-[color:var(--sc-panel-2)] p-3 font-mono text-[11px] leading-[1.55] text-[color:var(--sc-ink-2)]">
            <code>{colorizeHtml(truncatedHtml)}</code>
          </pre>
        </div>

        {/* Re-prompt */}
        <div>
          <label
            htmlFor="sc-reprompt"
            className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.12em] text-[color:var(--sc-muted)]"
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
            placeholder='e.g. "Make the headline punchier and change the CTA to Reserve a Seat."'
            className="block w-full resize-y rounded-md border border-[color:var(--sc-border)] bg-[color:var(--sc-panel)] px-3 py-2.5 text-[13px] leading-relaxed text-[color:var(--sc-ink)] placeholder:text-[color:var(--sc-muted-2)] shadow-[inset_0_1px_0_rgba(23,23,26,0.02)] transition-colors focus:border-[color:var(--sc-ink)] focus:outline-none focus:ring-2 focus:ring-[color:var(--sc-focus)]"
          />
        </div>

        {/* Status row */}
        {error ? (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md border border-[color:var(--sc-border)] bg-[color:var(--sc-panel-2)] p-2.5 text-[12px] text-[color:var(--sc-danger)]"
          >
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        ) : success ? (
          <div className="flex items-center gap-2 rounded-md border border-[color:var(--sc-border)] bg-[color:var(--sc-panel-2)] p-2.5 text-[12px] text-[color:var(--sc-success)]">
            <Check className="h-3.5 w-3.5 shrink-0" />
            <span>Change applied. Reloading preview…</span>
          </div>
        ) : null}

        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => onApply(draft.trim())}
          className="inline-flex items-center justify-center gap-2 rounded-md bg-[color:var(--sc-accent)] px-3 py-2.5 text-[13px] font-medium text-white shadow-sm transition-colors hover:bg-[color:var(--sc-accent-hover)] disabled:cursor-not-allowed disabled:bg-[color:var(--sc-border-strong)] disabled:text-white/90"
        >
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Applying change…
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" />
              Apply change
              <span className="ml-1 hidden rounded border border-white/20 bg-white/5 px-1 text-[10px] font-medium text-white/80 sm:inline">
                ⌘⏎
              </span>
            </>
          )}
        </button>
      </div>
    </div>
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
    <div className="flex h-11 shrink-0 items-center justify-between border-b border-[color:var(--sc-border)] px-4">
      <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[color:var(--sc-muted)]">
        {title}
      </span>
      {onClear ? (
        <button
          type="button"
          onClick={onClear}
          className="inline-flex h-6 w-6 items-center justify-center rounded text-[color:var(--sc-muted)] transition-colors hover:bg-[color:var(--sc-panel-2)] hover:text-[color:var(--sc-ink)]"
          aria-label="Clear selection"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}

/* Tiny HTML colorizer — no dependencies. Tags dim, attribute names pop slightly,
 * attribute values take a warm accent. Everything else is neutral.
 */
function colorizeHtml(input: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const tagRegex = /<\/?[a-zA-Z][^>]*>/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = tagRegex.exec(input)) !== null) {
    const before = input.slice(lastIndex, match.index);
    if (before) parts.push(<span key={key++}>{before}</span>);
    parts.push(
      <span
        key={key++}
        style={{ color: 'rgba(23, 23, 26, 0.55)' }}
      >
        {colorizeTag(match[0], key++)}
      </span>,
    );
    lastIndex = match.index + match[0].length;
  }
  const tail = input.slice(lastIndex);
  if (tail) parts.push(<span key={key++}>{tail}</span>);
  return parts;
}

function colorizeTag(tag: string, baseKey: number): React.ReactNode {
  // Inside a tag, color attributes: name="value"
  const attrRegex = /([a-zA-Z-:]+)(=)("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = baseKey;
  while ((match = attrRegex.exec(tag)) !== null) {
    const before = tag.slice(lastIndex, match.index);
    if (before) parts.push(<span key={key++}>{before}</span>);
    parts.push(
      <span key={key++} style={{ color: 'rgba(23, 23, 26, 0.85)' }}>
        {match[1]}
      </span>,
      <span key={key++}>{match[2]}</span>,
      <span key={key++} style={{ color: '#6a5b2f' }}>
        {match[3]}
      </span>,
    );
    lastIndex = match.index + match[0].length;
  }
  const tail = tag.slice(lastIndex);
  if (tail) parts.push(<span key={key++}>{tail}</span>);
  return parts;
}
