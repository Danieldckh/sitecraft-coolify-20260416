'use client';

import { useCallback, useEffect, useMemo, useReducer } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/common/SkeletonLoader';
import { useTheme, usePatchTheme } from '@/hooks/use-site';
import type { ThemeDTO, ThemePalette, ThemeTokens } from '@/types/models';
import { cn } from '@/lib/cn';

import { PalettePanel } from './PalettePanel';
import { TypographyPanel } from './TypographyPanel';
import { ScalePanel } from './ScalePanel';
import { SignaturePanel } from './SignaturePanel';
import { TokenPreview } from './TokenPreview';

export interface StyleDraft {
  palette: ThemePalette;
  primaryFont: string;
  secondaryFont: string;
  tokens: ThemeTokens;
  signatureMotif: string;
}

type Action =
  | { type: 'hydrate'; draft: StyleDraft }
  | { type: 'setPalette'; palette: ThemePalette }
  | { type: 'setFonts'; primaryFont: string; secondaryFont: string }
  | { type: 'setTokens'; tokens: ThemeTokens }
  | { type: 'setSignature'; signatureMotif: string };

function reducer(state: StyleDraft | null, action: Action): StyleDraft | null {
  switch (action.type) {
    case 'hydrate':
      return action.draft;
    case 'setPalette':
      return state ? { ...state, palette: action.palette } : state;
    case 'setFonts':
      return state
        ? { ...state, primaryFont: action.primaryFont, secondaryFont: action.secondaryFont }
        : state;
    case 'setTokens':
      return state ? { ...state, tokens: action.tokens } : state;
    case 'setSignature':
      return state ? { ...state, signatureMotif: action.signatureMotif } : state;
    default:
      return state;
  }
}

function themeToDraft(theme: ThemeDTO): StyleDraft {
  return {
    palette: { ...theme.palette },
    primaryFont: theme.primaryFont,
    secondaryFont: theme.secondaryFont,
    tokens: JSON.parse(JSON.stringify(theme.tokens)) as ThemeTokens,
    signatureMotif: theme.signatureMotif,
  };
}

function diffDraft(draft: StyleDraft, theme: ThemeDTO): Partial<ThemeDTO> {
  const patch: Partial<ThemeDTO> = {};
  const keys: (keyof ThemePalette)[] = ['primary', 'secondary', 'accent', 'surface', 'ink', 'muted'];
  if (keys.some((k) => draft.palette[k] !== theme.palette[k])) {
    patch.palette = draft.palette;
  }
  if (draft.primaryFont !== theme.primaryFont) patch.primaryFont = draft.primaryFont;
  if (draft.secondaryFont !== theme.secondaryFont) patch.secondaryFont = draft.secondaryFont;
  if (JSON.stringify(draft.tokens) !== JSON.stringify(theme.tokens)) patch.tokens = draft.tokens;
  if (draft.signatureMotif !== theme.signatureMotif) patch.signatureMotif = draft.signatureMotif;
  return patch;
}

export function StyleTab({ siteId }: { siteId: string }) {
  const { data: theme, isLoading } = useTheme(siteId);
  const patch = usePatchTheme(siteId);
  const [draft, dispatch] = useReducer(reducer, null);

  useEffect(() => {
    if (theme) dispatch({ type: 'hydrate', draft: themeToDraft(theme) });
  }, [theme?.id, theme?.lastGeneratedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirtyPatch = useMemo(() => {
    if (!draft || !theme) return null;
    const p = diffDraft(draft, theme);
    return Object.keys(p).length ? p : null;
  }, [draft, theme]);

  const onDiscard = useCallback(() => {
    if (theme) dispatch({ type: 'hydrate', draft: themeToDraft(theme) });
  }, [theme]);

  const onApply = useCallback(() => {
    if (dirtyPatch) patch.mutate(dirtyPatch);
  }, [dirtyPatch, patch]);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-6xl p-6">
        <Skeleton className="mb-4 h-6 w-40" />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <Skeleton className="h-[560px] w-full rounded-xl" />
          <Skeleton className="h-[560px] w-full rounded-xl" />
        </div>
      </div>
    );
  }

  if (!theme || !draft) {
    return <StyleEmpty siteId={siteId} />;
  }

  return (
    <div className="relative mx-auto max-w-6xl p-6 pb-24">
      <header className="mb-6 flex items-baseline justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-[var(--ls-tight)] text-[var(--text-primary)]">
            Style
          </h2>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Tune palette, typography, scale, and signature. Changes render live; apply to persist.
          </p>
        </div>
        <Badge variant="success">Theme ready</Badge>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="space-y-5">
          <PalettePanel
            draft={draft}
            server={theme}
            onChange={(palette) => dispatch({ type: 'setPalette', palette })}
          />
          <TypographyPanel
            draft={draft}
            onChange={(primaryFont, secondaryFont) =>
              dispatch({ type: 'setFonts', primaryFont, secondaryFont })
            }
          />
          <ScalePanel
            draft={draft}
            onChange={(tokens) => dispatch({ type: 'setTokens', tokens })}
          />
          <SignaturePanel
            draft={draft}
            onChange={(signatureMotif) => dispatch({ type: 'setSignature', signatureMotif })}
          />
        </div>

        <div className="lg:sticky lg:top-4 lg:self-start">
          <TokenPreview draft={draft} />
        </div>
      </div>

      {dirtyPatch ? (
        <div
          role="status"
          aria-live="polite"
          className={cn(
            'fixed inset-x-0 bottom-0 z-20 border-t border-[var(--border-subtle)]',
            'bg-[var(--bg-surface)]/95 backdrop-blur',
          )}
        >
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-6 py-3">
            <div className="text-sm text-[var(--text-secondary)]">
              You have unsaved style changes.
              <span className="ml-2 text-[var(--text-muted)]">
                {Object.keys(dirtyPatch).join(', ')}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={onDiscard} disabled={patch.isPending}>
                Discard
              </Button>
              <Button onClick={onApply} loading={patch.isPending} disabled={patch.isPending}>
                Apply
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function StyleEmpty({ siteId }: { siteId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  return (
    <div className="mx-auto max-w-2xl p-6">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <div className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--color-brand-50)] text-[var(--color-brand-700)]">
              <Sparkles className="h-4 w-4" aria-hidden />
            </div>
            <CardTitle>No theme yet</CardTitle>
          </div>
          <CardDescription>
            Style lives on top of a generated theme. Head to the Build tab to generate one first.
          </CardDescription>
        </CardHeader>
        <CardBody>
          <Button
            onClick={() => {
              const params = new URLSearchParams(searchParams.toString());
              params.set('tab', 'build');
              router.replace(`/sites/${siteId}?${params.toString()}`, { scroll: false });
            }}
          >
            Generate theme first
          </Button>
        </CardBody>
      </Card>
    </div>
  );
}
