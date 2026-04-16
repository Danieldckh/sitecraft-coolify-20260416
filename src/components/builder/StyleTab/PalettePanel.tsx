'use client';

import { useRef } from 'react';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import type { ThemeDTO, ThemePalette } from '@/types/models';
import type { StyleDraft } from './StyleTab';

const SLOTS: { key: keyof ThemePalette; label: string; hint: string }[] = [
  { key: 'primary', label: 'Primary', hint: 'Brand anchor' },
  { key: 'secondary', label: 'Secondary', hint: 'Supporting hue' },
  { key: 'accent', label: 'Accent', hint: 'Highlights + CTAs' },
  { key: 'surface', label: 'Surface', hint: 'Page background' },
  { key: 'ink', label: 'Ink', hint: 'Primary text' },
  { key: 'muted', label: 'Muted', hint: 'Secondary text' },
];

function normalizeHex(v: string): string | null {
  const s = v.trim();
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s)) {
    return s.length === 4
      ? `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`.toLowerCase()
      : s.toLowerCase();
  }
  return null;
}

interface Props {
  draft: StyleDraft;
  server: ThemeDTO;
  onChange: (palette: ThemePalette) => void;
}

export function PalettePanel({ draft, server, onChange }: Props) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>Palette</CardTitle>
        <button
          type="button"
          className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] underline-offset-2 hover:underline"
          onClick={() => onChange({ ...server.palette })}
        >
          Reset
        </button>
      </CardHeader>
      <CardBody className="space-y-3">
        {SLOTS.map((slot) => (
          <Row
            key={slot.key}
            slotKey={slot.key}
            label={slot.label}
            hint={slot.hint}
            value={draft.palette[slot.key]}
            onChange={(hex) => onChange({ ...draft.palette, [slot.key]: hex })}
          />
        ))}
      </CardBody>
    </Card>
  );
}

function Row({
  slotKey,
  label,
  hint,
  value,
  onChange,
}: {
  slotKey: keyof ThemePalette;
  label: string;
  hint: string;
  value: string;
  onChange: (hex: string) => void;
}) {
  const hiddenRef = useRef<HTMLInputElement>(null);
  const safe = normalizeHex(value) ?? '#000000';

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        aria-label={`Pick ${label} color`}
        onClick={() => hiddenRef.current?.click()}
        className="relative h-10 w-10 shrink-0 rounded-lg border border-[var(--border-subtle)] shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]"
        style={{ background: safe }}
      />
      <input
        ref={hiddenRef}
        type="color"
        value={safe}
        onChange={(e) => onChange(e.target.value)}
        className="sr-only"
        aria-hidden
        tabIndex={-1}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <label
          htmlFor={`palette-${slotKey}`}
          className="text-xs font-medium text-[var(--text-primary)]"
        >
          {label}
        </label>
        <span className="text-[11px] text-[var(--text-muted)]">{hint}</span>
      </div>
      <Input
        id={`palette-${slotKey}`}
        aria-label={`${label} hex value`}
        value={value}
        size="sm"
        onChange={(e) => {
          const raw = e.target.value;
          onChange(raw);
        }}
        onBlur={(e) => {
          const n = normalizeHex(e.target.value);
          if (n) onChange(n);
        }}
        className="w-28 font-mono"
      />
    </div>
  );
}
