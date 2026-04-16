'use client';

import { useEffect, useRef, useState } from 'react';
import { Lock } from 'lucide-react';

export function PromptEditor({
  value,
  locked,
  placeholder,
  onCommit,
  rows = 6,
}: {
  value: string;
  locked: boolean;
  placeholder?: string;
  onCommit: (next: string) => void;
  rows?: number;
}) {
  const [draft, setDraft] = useState(value);
  const lastValueRef = useRef(value);

  useEffect(() => {
    if (value !== lastValueRef.current) {
      setDraft(value);
      lastValueRef.current = value;
    }
  }, [value]);

  return (
    <div className="relative">
      <textarea
        className="textarea disabled:cursor-not-allowed disabled:opacity-60"
        value={draft}
        disabled={locked}
        rows={rows}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== value) {
            lastValueRef.current = draft;
            onCommit(draft);
          }
        }}
      />
      {locked && (
        <div className="pointer-events-none absolute right-2 top-2 flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
          <Lock className="h-3 w-3" /> unlock to edit
        </div>
      )}
    </div>
  );
}
