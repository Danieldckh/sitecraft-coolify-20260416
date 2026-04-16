'use client';

import { Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { Card, CardHeader, CardTitle, CardDescription, CardBody, CardFooter } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/common/SkeletonLoader';
import { StreamingIndicator } from '@/components/common/StreamingIndicator';
import { useSite, useStylePresets, useTheme, useGenerateTheme } from '@/hooks/use-site';
import { useEditorStore } from '@/stores/editor';

export function ThemeGate({ siteId }: { siteId: string }) {
  const { data: site } = useSite(siteId);
  const { data: theme, isLoading: themeLoading } = useTheme(siteId);
  const { data: presets } = useStylePresets();
  const generate = useGenerateTheme(siteId);
  const streaming = useEditorStore((s) => s.themeStreaming);

  const presetName =
    site?.stylePresetId && presets?.stylePresets
      ? presets.stylePresets.find((p) => p.id === site.stylePresetId)?.name ?? site.stylePresetId
      : null;
  const presetDesc =
    site?.stylePresetId && presets?.stylePresets
      ? presets.stylePresets.find((p) => p.id === site.stylePresetId)?.description
      : null;

  if (themeLoading) {
    return (
      <Card className="flex items-center gap-4 p-4">
        <Skeleton className="h-9 w-9 rounded-lg" />
        <div className="flex-1">
          <Skeleton className="mb-2 h-3 w-32" />
          <Skeleton className="h-2 w-48" />
        </div>
      </Card>
    );
  }

  if (theme) {
    return (
      <div className="flex items-center gap-3 text-xs text-[var(--text-secondary)]">
        <Badge variant="success">Theme ready</Badge>
        <div className="flex items-center gap-1.5">
          {(['primary', 'secondary', 'accent', 'surface', 'ink'] as const).map((k) => (
            <span
              key={k}
              title={k}
              aria-label={`${k} swatch`}
              className="inline-block h-4 w-4 rounded-full border border-[var(--border-subtle)]"
              style={{ background: theme.palette[k] }}
            />
          ))}
        </div>
        <span className="truncate">
          <span className="text-[var(--text-muted)]">Fonts — </span>
          {theme.primaryFont} · {theme.secondaryFont}
        </span>
      </div>
    );
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <div className="flex items-center gap-2">
          <div className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--color-brand-50)] text-[var(--color-brand-700)]">
            <Sparkles className="h-4 w-4" aria-hidden />
          </div>
          <CardTitle>Generate site theme to start building pages</CardTitle>
        </div>
        <CardDescription>
          {presetName ? (
            <>
              Style preset: <span className="font-medium text-[var(--text-primary)]">{presetName}</span>
              {presetDesc ? <> — {presetDesc}</> : null}
            </>
          ) : (
            <>Pick a style preset on the site, then generate the theme.</>
          )}
        </CardDescription>
      </CardHeader>

      {streaming ? (
        <CardBody>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <div className="mb-2 text-[11px] font-medium uppercase tracking-[var(--ls-wide)] text-[var(--text-muted)]">
                Palette
              </div>
              <div className="flex gap-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-8 rounded-full" />
                ))}
              </div>
            </div>
            <div>
              <div className="mb-2 text-[11px] font-medium uppercase tracking-[var(--ls-wide)] text-[var(--text-muted)]">
                Typography
              </div>
              <Skeleton className="mb-1.5 h-4 w-2/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        </CardBody>
      ) : null}

      {generate.error ? (
        <CardBody>
          <p className="text-xs text-[var(--color-danger-600)]">
            {generate.error instanceof Error ? generate.error.message : 'Theme generation failed'}
          </p>
        </CardBody>
      ) : null}

      <CardFooter>
        {streaming ? (
          <StreamingIndicator label="Composing palette, typography, signature motif" />
        ) : null}
        <Button
          onClick={() => generate.mutate()}
          loading={streaming}
          disabled={streaming || !site?.stylePresetId}
          leftIcon={!streaming ? <Sparkles className="h-3.5 w-3.5" aria-hidden /> : undefined}
        >
          Generate theme
        </Button>
      </CardFooter>
    </Card>
  );
}
