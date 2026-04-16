'use client';

import { useEffect, useRef } from 'react';
import type { KeyboardEvent } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/cn';
import { STYLE_PRESETS, type StylePreset } from '@/server/ai/stylePresets';

// Curated 5-swatch palette previews per preset id.
// Pure presentation data — not fed to the model.
const PRESET_SWATCHES: Record<string, string[]> = {
  'editorial-serif':          ['#F5EFE6', '#1A1A1A', '#B7512F', '#9A8F7D', '#E3D9C6'],
  'neo-brutalist':            ['#FFE94A', '#0066FF', '#FAF7F2', '#0A0A0A', '#FF3B3B'],
  'soft-glass':               ['#0B1020', '#1B2444', '#7DD3FC', '#A78BFA', '#F5F6FA'],
  'monochrome-tech':          ['#0A0A0A', '#1C1C1C', '#33FF88', '#6E6E6E', '#E2E2E2'],
  'playful-marker':           ['#FFD3B6', '#C9F0D8', '#FFF1A8', '#1F1F1F', '#FFFFFF'],
  'corporate-clean':          ['#0B1220', '#F6F8FB', '#2563EB', '#1F2937', '#E5E7EB'],
  'magazine-split':           ['#F4EFE6', '#111111', '#C2312D', '#8A8A8A', '#FFFFFF'],
  'dark-mode-minimal':        ['#0A0A0A', '#EDEDED', '#7CFFCB', '#1E1E1E', '#3A3A3A'],
  'warm-craft':               ['#F4EADF', '#B4532A', '#2F4A37', '#2A2520', '#D9C6A9'],
  'swiss-grid':               ['#FFFFFF', '#000000', '#E4312B', '#7A7A7A', '#EFEFEF'],
  'y2k-bubble':               ['#B8F1FF', '#F7B8D6', '#D7D7E4', '#FAFAFC', '#1C1C2A'],
  'documentary-photojournal': ['#EFEBE3', '#121212', '#8A5A2B', '#5A534A', '#D7CCB8'],
};

export interface StylePresetPickerProps {
  value: string | null;
  onChange: (id: string) => void;
  presets?: StylePreset[];
  className?: string;
}

export function StylePresetPicker({
  value,
  onChange,
  presets = STYLE_PRESETS,
  className,
}: StylePresetPickerProps) {
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const activeIndex = Math.max(
    0,
    presets.findIndex((p) => p.id === value),
  );

  // Keep refs array aligned with preset count.
  useEffect(() => {
    itemRefs.current = itemRefs.current.slice(0, presets.length);
  }, [presets.length]);

  const move = (delta: number) => {
    const cols = 3;
    const total = presets.length;
    let next: number;
    if (delta === -cols || delta === cols) {
      next = activeIndex + delta;
      if (next < 0 || next >= total) return;
    } else {
      next = (activeIndex + delta + total) % total;
    }
    const target = presets[next];
    onChange(target.id);
    itemRefs.current[next]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    switch (e.key) {
      case 'ArrowRight': e.preventDefault(); move(1); break;
      case 'ArrowLeft':  e.preventDefault(); move(-1); break;
      case 'ArrowDown':  e.preventDefault(); move(3); break;
      case 'ArrowUp':    e.preventDefault(); move(-3); break;
      case 'Home':       e.preventDefault(); onChange(presets[0].id); itemRefs.current[0]?.focus(); break;
      case 'End':        e.preventDefault(); onChange(presets[presets.length - 1].id); itemRefs.current[presets.length - 1]?.focus(); break;
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label="Style preset"
      onKeyDown={onKeyDown}
      className={cn('grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3', className)}
    >
      {presets.map((preset, i) => {
        const selected = preset.id === value;
        const swatches = PRESET_SWATCHES[preset.id] ?? ['#E4E4E7', '#A1A1AA', '#52525B', '#27272A', '#FAFAFA'];
        return (
          <button
            key={preset.id}
            ref={(el) => {
              itemRefs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected || (value === null && i === 0) ? 0 : -1}
            onClick={() => onChange(preset.id)}
            className={cn(
              'group relative flex flex-col gap-3 rounded-xl border p-4 text-left',
              'bg-[var(--card-bg)] shadow-xs',
              'transition-[border-color,background-color,box-shadow,transform] duration-150 ease-out',
              'hover:border-[var(--border-strong)] hover:shadow-sm',
              selected
                ? 'border-[var(--text-primary)] ring-1 ring-[var(--text-primary)]'
                : 'border-[var(--card-border)]',
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="text-sm font-semibold tracking-[var(--ls-tight)] text-[var(--text-primary)]">
                {preset.name}
              </div>
              {selected ? (
                <span
                  aria-hidden
                  className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[var(--text-primary)] text-[var(--text-inverse)]"
                >
                  <Check className="h-3 w-3" />
                </span>
              ) : null}
            </div>
            <p className="line-clamp-3 text-xs leading-relaxed text-[var(--text-secondary)]">
              {preset.description}
            </p>
            <div className="flex gap-1.5" aria-hidden>
              {swatches.map((hex, idx) => (
                <span
                  key={idx}
                  className="h-5 w-5 rounded-md border border-[var(--border-subtle)]"
                  style={{ backgroundColor: hex }}
                />
              ))}
            </div>
          </button>
        );
      })}
    </div>
  );
}
