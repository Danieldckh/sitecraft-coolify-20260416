'use client';

import type { CSSProperties } from 'react';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import type { StyleDraft } from './StyleTab';

interface Props {
  draft: StyleDraft;
}

export function TokenPreview({ draft }: Props) {
  const { palette, tokens, primaryFont, secondaryFont } = draft;

  const scopeStyle: CSSProperties & Record<string, string> = {
    ['--sc-primary']: palette.primary,
    ['--sc-secondary']: palette.secondary,
    ['--sc-accent']: palette.accent,
    ['--sc-surface']: palette.surface,
    ['--sc-ink']: palette.ink,
    ['--sc-muted']: palette.muted,
    ['--sc-radius-sm']: tokens.radius.sm,
    ['--sc-radius-md']: tokens.radius.md,
    ['--sc-radius-lg']: tokens.radius.lg,
    ['--sc-shadow-sm']: tokens.shadow.sm,
    ['--sc-shadow-md']: tokens.shadow.md,
    ['--sc-shadow-lg']: tokens.shadow.lg,
    ['--sc-duration']: `${tokens.motion.durationMs}ms`,
    ['--sc-display']: `"${primaryFont}", serif`,
    ['--sc-body']: `"${secondaryFont}", system-ui, sans-serif`,
    color: 'var(--sc-ink)',
    background: 'var(--sc-surface)',
    fontFamily: 'var(--sc-body)',
  };

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>Live preview</CardTitle>
      </CardHeader>
      <CardBody className="space-y-4">
        <div
          className="rounded-xl border border-[var(--border-subtle)] p-6"
          style={scopeStyle}
        >
          {/* Hero */}
          <div
            className="mb-4 p-6"
            style={{
              borderRadius: 'var(--sc-radius-lg)',
              background: `linear-gradient(135deg, ${palette.primary} 0%, ${palette.secondary} 100%)`,
              color: palette.surface,
              boxShadow: 'var(--sc-shadow-lg)',
            }}
          >
            <div
              className="text-[11px] uppercase tracking-[0.12em]"
              style={{ opacity: 0.8 }}
            >
              Chapter one
            </div>
            <h1
              className="mt-2 text-3xl leading-tight"
              style={{ fontFamily: 'var(--sc-display)', fontWeight: 600 }}
            >
              A measured opening line
            </h1>
            <p
              className="mt-2 text-sm"
              style={{ fontFamily: 'var(--sc-body)', opacity: 0.92 }}
            >
              Short lede copy gives the design system a chance to sing.
            </p>
          </div>

          {/* Buttons */}
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              aria-hidden
              tabIndex={-1}
              className="px-4 py-2 text-sm"
              style={{
                color: palette.surface,
                background: palette.primary,
                borderRadius: 'var(--sc-radius-md)',
                boxShadow: 'var(--sc-shadow-md)',
                transition: `transform var(--sc-duration) ease`,
              }}
            >
              Primary
            </button>
            <button
              type="button"
              aria-hidden
              tabIndex={-1}
              className="px-4 py-2 text-sm"
              style={{
                color: palette.ink,
                background: 'transparent',
                border: `1px solid ${palette.ink}`,
                borderRadius: 'var(--sc-radius-md)',
              }}
            >
              Secondary
            </button>
            <button
              type="button"
              aria-hidden
              tabIndex={-1}
              className="px-4 py-2 text-sm"
              style={{
                color: palette.surface,
                background: palette.accent,
                borderRadius: 'var(--sc-radius-md)',
              }}
            >
              Accent
            </button>
          </div>

          {/* Card */}
          <div
            className="mb-4 p-4"
            style={{
              borderRadius: 'var(--sc-radius-md)',
              background: palette.surface,
              border: `1px solid ${palette.muted}33`,
              boxShadow: 'var(--sc-shadow-sm)',
            }}
          >
            <h3
              className="text-lg"
              style={{ fontFamily: 'var(--sc-display)', color: palette.ink, fontWeight: 600 }}
            >
              Card title
            </h3>
            <p
              className="mt-1 text-sm"
              style={{ color: palette.muted, fontFamily: 'var(--sc-body)' }}
            >
              Supporting copy lives here; radius and shadow reflect the current tokens.
            </p>
          </div>

          {/* Heading scale */}
          <div className="space-y-1" style={{ fontFamily: 'var(--sc-display)', color: palette.ink }}>
            <div className="text-4xl font-semibold leading-tight">H1 Scale</div>
            <div className="text-3xl font-semibold leading-tight">H2 Scale</div>
            <div className="text-2xl font-semibold leading-tight">H3 Scale</div>
            <div className="text-xl font-medium leading-tight">H4 Scale</div>
          </div>
        </div>

        {/* Token list */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-sunken)] p-4 font-mono text-[11px]">
          <TokenRow k="primary" v={palette.primary} swatch={palette.primary} />
          <TokenRow k="secondary" v={palette.secondary} swatch={palette.secondary} />
          <TokenRow k="accent" v={palette.accent} swatch={palette.accent} />
          <TokenRow k="surface" v={palette.surface} swatch={palette.surface} />
          <TokenRow k="ink" v={palette.ink} swatch={palette.ink} />
          <TokenRow k="muted" v={palette.muted} swatch={palette.muted} />
          <TokenRow k="display" v={primaryFont} />
          <TokenRow k="body" v={secondaryFont} />
          <TokenRow k="radius.md" v={tokens.radius.md} />
          <TokenRow k="shadow.md" v={tokens.shadow.md.length > 24 ? tokens.shadow.md.slice(0, 22) + '…' : tokens.shadow.md} />
          <TokenRow k="spacing[1]" v={`${tokens.spacing[1] ?? 8}px`} />
          <TokenRow k="motion" v={`${tokens.motion.durationMs}ms · ${tokens.motion.style}`} />
        </div>
      </CardBody>
    </Card>
  );
}

function TokenRow({ k, v, swatch }: { k: string; v: string; swatch?: string }) {
  return (
    <div className="flex items-center gap-2 truncate">
      {swatch ? (
        <span
          aria-hidden
          className="inline-block h-3 w-3 shrink-0 rounded-sm border border-[var(--border-subtle)]"
          style={{ background: swatch }}
        />
      ) : null}
      <span className="text-[var(--text-muted)]">{k}</span>
      <span className="truncate text-[var(--text-primary)]" title={v}>
        {v}
      </span>
    </div>
  );
}
