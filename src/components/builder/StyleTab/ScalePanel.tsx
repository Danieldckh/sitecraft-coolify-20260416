'use client';

import { useMemo } from 'react';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import { Label } from '@/components/ui/Label';
import { cn } from '@/lib/cn';
import type { ThemeTokens } from '@/types/models';
import type { StyleDraft } from './StyleTab';

const SHADOW_STEPS = [
  { id: 'none', label: 'None', sm: '0 0 0 transparent', md: '0 0 0 transparent', lg: '0 0 0 transparent' },
  { id: 'subtle', label: 'Subtle', sm: '0 1px 1px rgba(15,23,42,0.04)', md: '0 1px 2px rgba(15,23,42,0.06)', lg: '0 2px 4px rgba(15,23,42,0.08)' },
  { id: 'soft', label: 'Soft', sm: '0 1px 2px rgba(15,23,42,0.06)', md: '0 6px 16px rgba(15,23,42,0.08)', lg: '0 16px 40px rgba(15,23,42,0.10)' },
  { id: 'elevated', label: 'Elevated', sm: '0 2px 4px rgba(15,23,42,0.08)', md: '0 12px 28px rgba(15,23,42,0.14)', lg: '0 32px 72px rgba(15,23,42,0.22)' },
] as const;

const SPACING_BASES = [4, 6, 8, 10] as const;

const MOTION_STYLES = [
  { id: 'calm', label: 'Calm', durationMs: 300, style: 'editorial' as const },
  { id: 'subtle', label: 'Subtle', durationMs: 150, style: 'subtle' as const },
  { id: 'lively', label: 'Lively', durationMs: 75, style: 'kinetic' as const },
] as const;

function parsePx(v: string, fallback = 12): number {
  const m = /([\d.]+)\s*px/.exec(v);
  return m ? parseFloat(m[1]) : fallback;
}

function scaleRadius(base: number): ThemeTokens['radius'] {
  return {
    sm: `${Math.max(0, Math.round(base * 0.5))}px`,
    md: `${Math.round(base)}px`,
    lg: `${Math.round(base * 1.6)}px`,
    pill: '9999px',
  };
}

function buildSpacing(base: number): number[] {
  return [0, base, base * 2, base * 3, base * 4, base * 6, base * 8, base * 12];
}

function detectShadowStep(sm: string): (typeof SHADOW_STEPS)[number]['id'] {
  const match = SHADOW_STEPS.find((s) => s.sm === sm);
  return match ? match.id : 'soft';
}

function detectSpacingBase(spacing: number[]): number {
  const b = spacing[1] ?? 8;
  const found = SPACING_BASES.find((x) => x === b);
  return found ?? 8;
}

function detectMotion(durationMs: number): (typeof MOTION_STYLES)[number]['id'] {
  if (durationMs <= 100) return 'lively';
  if (durationMs >= 250) return 'calm';
  return 'subtle';
}

interface Props {
  draft: StyleDraft;
  onChange: (tokens: ThemeTokens) => void;
}

export function ScalePanel({ draft, onChange }: Props) {
  const radiusBase = parsePx(draft.tokens.radius.md, 12);
  const shadowStep = detectShadowStep(draft.tokens.shadow.sm);
  const spacingBase = detectSpacingBase(draft.tokens.spacing);
  const motionId = detectMotion(draft.tokens.motion.durationMs);

  const previewRadius = useMemo(() => draft.tokens.radius.md, [draft.tokens.radius.md]);
  const previewShadow = useMemo(() => draft.tokens.shadow.md, [draft.tokens.shadow.md]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Scale &amp; motion</CardTitle>
      </CardHeader>
      <CardBody className="space-y-5">
        {/* Radius */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="radius-slider">Radius</Label>
            <span className="font-mono text-xs text-[var(--text-muted)]">{radiusBase}px</span>
          </div>
          <input
            id="radius-slider"
            type="range"
            min={0}
            max={24}
            step={1}
            value={radiusBase}
            aria-label="Corner radius"
            aria-valuemin={0}
            aria-valuemax={24}
            aria-valuenow={radiusBase}
            onChange={(e) => {
              const next = Number(e.target.value);
              onChange({ ...draft.tokens, radius: scaleRadius(next) });
            }}
            className="w-full accent-[var(--color-brand-600)]"
          />
          <div className="flex items-center gap-3 pt-1">
            <div
              className="h-10 w-24 border border-[var(--border-subtle)] bg-[var(--bg-sunken)]"
              style={{ borderRadius: previewRadius }}
              aria-hidden
            />
            <button
              type="button"
              aria-hidden
              tabIndex={-1}
              className="h-9 px-4 text-sm text-white"
              style={{
                borderRadius: previewRadius,
                background: draft.palette.primary,
                boxShadow: previewShadow,
              }}
            >
              Button
            </button>
          </div>
        </div>

        {/* Shadow stepper */}
        <div className="space-y-2">
          <Label>Shadow</Label>
          <div className="grid grid-cols-4 gap-2">
            {SHADOW_STEPS.map((s) => (
              <button
                key={s.id}
                type="button"
                aria-pressed={shadowStep === s.id}
                onClick={() =>
                  onChange({
                    ...draft.tokens,
                    shadow: { sm: s.sm, md: s.md, lg: s.lg },
                  })
                }
                className={cn(
                  'flex flex-col items-center gap-2 rounded-md border px-2 py-3 text-[11px]',
                  'bg-[var(--bg-base)] transition',
                  shadowStep === s.id
                    ? 'border-[var(--ring-focus)] text-[var(--text-primary)]'
                    : 'border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
                )}
              >
                <span
                  className="h-6 w-6 rounded-md bg-[var(--bg-surface)]"
                  style={{ boxShadow: s.md }}
                  aria-hidden
                />
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Spacing base */}
        <div className="space-y-2">
          <Label>Spacing rhythm</Label>
          <div className="grid grid-cols-4 gap-2">
            {SPACING_BASES.map((b) => (
              <button
                key={b}
                type="button"
                aria-pressed={spacingBase === b}
                onClick={() => onChange({ ...draft.tokens, spacing: buildSpacing(b) })}
                className={cn(
                  'rounded-md border px-2 py-2 font-mono text-xs',
                  spacingBase === b
                    ? 'border-[var(--ring-focus)] text-[var(--text-primary)] bg-[var(--bg-sunken)]'
                    : 'border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
                )}
              >
                {b}px
              </button>
            ))}
          </div>
        </div>

        {/* Motion */}
        <div className="space-y-2">
          <Label>Motion</Label>
          <div className="flex flex-wrap gap-2">
            {MOTION_STYLES.map((m) => (
              <button
                key={m.id}
                type="button"
                aria-pressed={motionId === m.id}
                onClick={() =>
                  onChange({
                    ...draft.tokens,
                    motion: {
                      ...draft.tokens.motion,
                      durationMs: m.durationMs,
                      style: m.style,
                    },
                  })
                }
                className={cn(
                  'rounded-full border px-3 py-1 text-xs',
                  motionId === m.id
                    ? 'border-[var(--ring-focus)] text-[var(--text-primary)] bg-[var(--bg-sunken)]'
                    : 'border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
                )}
              >
                {m.label} · {m.durationMs}ms
              </button>
            ))}
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
