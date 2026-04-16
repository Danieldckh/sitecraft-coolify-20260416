'use client';

import { useMemo } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/Select';
import { Label } from '@/components/ui/Label';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import type { StyleDraft } from './StyleTab';

export interface FontPairing {
  id: string;
  name: string;
  display: string; // primaryFont
  body: string; // secondaryFont
}

export const FONT_PAIRINGS: FontPairing[] = [
  { id: 'inter-inter', name: 'Inter / Inter', display: 'Inter', body: 'Inter' },
  { id: 'playfair-source', name: 'Playfair Display / Source Sans', display: 'Playfair Display', body: 'Source Sans 3' },
  { id: 'space-grotesk-mono', name: 'Space Grotesk / Space Mono', display: 'Space Grotesk', body: 'Space Mono' },
  { id: 'dm-serif-sans', name: 'DM Serif Display / DM Sans', display: 'DM Serif Display', body: 'DM Sans' },
  { id: 'fraunces-inter', name: 'Fraunces / Inter', display: 'Fraunces', body: 'Inter' },
  { id: 'gt-sectra-sohne', name: 'GT Sectra / Söhne', display: 'Tiempos Text', body: 'Inter' },
  { id: 'ibm-plex', name: 'IBM Plex Serif / IBM Plex Sans', display: 'IBM Plex Serif', body: 'IBM Plex Sans' },
  { id: 'recoleta-inter', name: 'Recoleta / Inter', display: 'Recoleta', body: 'Inter' },
  { id: 'jetbrains-inter', name: 'JetBrains Mono / Inter', display: 'JetBrains Mono', body: 'Inter' },
  { id: 'nunito-fraunces', name: 'Fraunces / Nunito', display: 'Fraunces', body: 'Nunito' },
  { id: 'canela-sohne', name: 'Canela / Söhne', display: 'Playfair Display', body: 'Inter' },
  { id: 'space-grotesk-inter', name: 'Space Grotesk / Inter', display: 'Space Grotesk', body: 'Inter' },
];

interface Props {
  draft: StyleDraft;
  onChange: (primaryFont: string, secondaryFont: string) => void;
}

export function TypographyPanel({ draft, onChange }: Props) {
  const matchId = useMemo(() => {
    const p = FONT_PAIRINGS.find(
      (x) => x.display === draft.primaryFont && x.body === draft.secondaryFont,
    );
    return p?.id ?? 'custom';
  }, [draft.primaryFont, draft.secondaryFont]);

  const displayList = useMemo(
    () => Array.from(new Set(FONT_PAIRINGS.map((f) => f.display))).sort(),
    [],
  );
  const bodyList = useMemo(
    () => Array.from(new Set(FONT_PAIRINGS.map((f) => f.body))).sort(),
    [],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Typography</CardTitle>
      </CardHeader>
      <CardBody className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="font-pairing">Preset pairing</Label>
          <Select
            value={matchId === 'custom' ? undefined : matchId}
            onValueChange={(id) => {
              const p = FONT_PAIRINGS.find((x) => x.id === id);
              if (p) onChange(p.display, p.body);
            }}
          >
            <SelectTrigger id="font-pairing" aria-label="Font pairing preset">
              <SelectValue placeholder={matchId === 'custom' ? 'Custom pairing' : 'Pick a pairing'} />
            </SelectTrigger>
            <SelectContent>
              {FONT_PAIRINGS.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="primary-font">Display</Label>
            <Select
              value={draft.primaryFont}
              onValueChange={(v) => onChange(v, draft.secondaryFont)}
            >
              <SelectTrigger id="primary-font" aria-label="Display font">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {displayList.map((f) => (
                  <SelectItem key={f} value={f}>
                    {f}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="secondary-font">Body</Label>
            <Select
              value={draft.secondaryFont}
              onValueChange={(v) => onChange(draft.primaryFont, v)}
            >
              <SelectTrigger id="secondary-font" aria-label="Body font">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {bodyList.map((f) => (
                  <SelectItem key={f} value={f}>
                    {f}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div
          className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-sunken)] p-4"
          style={{
            ['--sc-display' as string]: `"${draft.primaryFont}", serif`,
            ['--sc-body' as string]: `"${draft.secondaryFont}", system-ui, sans-serif`,
          }}
        >
          <h1
            className="text-3xl leading-tight text-[var(--text-primary)]"
            style={{ fontFamily: 'var(--sc-display)' }}
          >
            The quick brown fox
          </h1>
          <h2
            className="mt-2 text-xl text-[var(--text-primary)]"
            style={{ fontFamily: 'var(--sc-display)' }}
          >
            jumps over the lazy dog
          </h2>
          <p
            className="mt-3 text-sm text-[var(--text-secondary)]"
            style={{ fontFamily: 'var(--sc-body)' }}
          >
            Body copy sets the rhythm — lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed
            do eiusmod tempor incididunt ut labore et dolore magna aliqua.
          </p>
          <p
            className="mt-2 text-[11px] uppercase tracking-[var(--ls-wide)] text-[var(--text-muted)]"
            style={{ fontFamily: 'var(--sc-body)' }}
          >
            Caption — 12 Apr 2026
          </p>
        </div>
      </CardBody>
    </Card>
  );
}
