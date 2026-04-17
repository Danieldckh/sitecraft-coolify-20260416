'use client';

import { useEffect, useState } from 'react';
import { Loader2, MousePointer2, Sparkles, X } from 'lucide-react';

export interface SelectedElement {
  id: string;
  html: string;
  role?: string;
}

interface InspectorProps {
  selected: SelectedElement | null;
  onClear: () => void;
  onApply: (prompt: string) => void | Promise<void>;
  busy: boolean;
  error: string | null;
}

const HTML_PREVIEW_LIMIT = 300;

export function Inspector({ selected, onClear, onApply, busy, error }: InspectorProps) {
  const [draft, setDraft] = useState('');

  // Reset the draft whenever a new element is selected.
  useEffect(() => {
    setDraft('');
  }, [selected?.id]);

  if (!selected) {
    return (
      <div className="flex h-full flex-col">
        <InspectorHeader title="Inspector" />
        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
          <div className="mb-3 rounded-full border border-neutral-200 bg-neutral-50 p-3">
            <MousePointer2 className="h-5 w-5 text-neutral-400" />
          </div>
          <p className="text-sm font-medium text-neutral-800">No element selected</p>
          <p className="mt-1 max-w-[220px] text-xs text-neutral-500">
            Click any section in the preview to edit it.
          </p>
        </div>
      </div>
    );
  }

  const truncated =
    selected.html.length > HTML_PREVIEW_LIMIT
      ? selected.html.slice(0, HTML_PREVIEW_LIMIT) + '…'
      : selected.html;

  const canSubmit = !busy && draft.trim().length > 0;

  return (
    <div className="flex h-full flex-col">
      <InspectorHeader title="Inspector" onClear={onClear} />

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4 pt-3">
        {/* Role pill */}
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center rounded-full border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-neutral-600">
            {selected.role || 'section'}
          </span>
          <span className="font-mono text-[11px] text-neutral-400 truncate">
            {selected.id}
          </span>
        </div>

        {/* HTML preview */}
        <div>
          <label className="mb-1.5 block text-xs font-medium text-neutral-700">
            Current HTML
          </label>
          <pre className="max-h-40 overflow-auto rounded-md border border-neutral-200 bg-neutral-50 p-3 font-mono text-[11px] leading-relaxed text-neutral-700">
            <code>{truncated}</code>
          </pre>
        </div>

        {/* Re-prompt */}
        <div>
          <label htmlFor="sc-reprompt" className="mb-1.5 block text-xs font-medium text-neutral-700">
            Describe the change
          </label>
          <textarea
            id="sc-reprompt"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={5}
            placeholder='e.g. "Make the headline more punchy and change the CTA to Reserve a Seat."'
            className="block w-full resize-none rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
          />
        </div>

        {error ? (
          <p role="alert" className="text-xs text-red-600">
            {error}
          </p>
        ) : null}

        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => onApply(draft.trim())}
          className="inline-flex items-center justify-center gap-2 rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-300"
        >
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Applying…
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" />
              Apply change
            </>
          )}
        </button>
      </div>
    </div>
  );
}

function InspectorHeader({ title, onClear }: { title: string; onClear?: () => void }) {
  return (
    <div className="flex h-11 shrink-0 items-center justify-between border-b border-neutral-200 px-4">
      <span className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
        {title}
      </span>
      {onClear ? (
        <button
          type="button"
          onClick={onClear}
          className="inline-flex h-6 w-6 items-center justify-center rounded text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700"
          aria-label="Clear selection"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}
