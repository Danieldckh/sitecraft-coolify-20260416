'use client';

import { useEffect, useRef, useState } from 'react';
import { Lock } from 'lucide-react';

import { Textarea } from '@/components/ui/Textarea';

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
      <Textarea
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
        <div className="pointer-events-none absolute right-2 top-2 flex items-center gap-1 rounded bg-[var(--color-warning-50)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-warning-700)]">
          <Lock className="h-3 w-3" /> unlock to edit
        </div>
      )}
    </div>
  );
}
