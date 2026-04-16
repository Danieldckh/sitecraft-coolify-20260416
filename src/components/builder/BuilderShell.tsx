'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ExternalLink, Rocket, Loader2 } from 'lucide-react';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/Tabs';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Skeleton, SkeletonText } from '@/components/common/SkeletonLoader';
import { BuildTab } from '@/components/builder/BuildTab/BuildTab';
import { StyleTab } from '@/components/builder/StyleTab/StyleTab';
import { useSite, usePatchSite, useStylePresets } from '@/hooks/use-site';
import { useEditorStore, type EditorTab } from '@/stores/editor';
import { cn } from '@/lib/cn';
import type { DeploymentDTO } from '@/types/models';

const TABS: { id: EditorTab; label: string; hint: string }[] = [
  { id: 'build', label: 'Build', hint: '⌘1' },
  { id: 'preview', label: 'Preview', hint: '⌘2' },
  { id: 'style', label: 'Style', hint: '⌘3' },
];

function isValidTab(v: string | null): v is EditorTab {
  return v === 'build' || v === 'preview' || v === 'style';
}

export function BuilderShell({ siteId }: { siteId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlTab = searchParams.get('tab');
  const tab: EditorTab = isValidTab(urlTab) ? urlTab : 'build';

  const storeTab = useEditorStore((s) => s.tab);
  const setStoreTab = useEditorStore((s) => s.setTab);

  // Keep store + URL in sync (URL is the source of truth).
  useEffect(() => {
    if (storeTab !== tab) setStoreTab(tab);
  }, [tab, storeTab, setStoreTab]);

  const setTab = useCallback(
    (next: EditorTab) => {
      if (next === tab) return;
      const params = new URLSearchParams(searchParams.toString());
      params.set('tab', next);
      router.replace(`/sites/${siteId}?${params.toString()}`, { scroll: false });
    },
    [tab, searchParams, router, siteId],
  );

  // Keyboard shortcuts: Cmd/Ctrl + 1/2/3
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return;
      }
      if (e.key === '1') { e.preventDefault(); setTab('build'); }
      else if (e.key === '2') { e.preventDefault(); setTab('preview'); }
      else if (e.key === '3') { e.preventDefault(); setTab('style'); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setTab]);

  return (
    <div className="flex h-screen min-h-0 flex-col bg-[var(--bg-base)] text-[var(--text-primary)]">
      <Tabs value={tab} onValueChange={(v) => isValidTab(v) && setTab(v)} className="flex min-h-0 flex-1 flex-col">
        <TopBar siteId={siteId} />
        <div className="flex min-h-0 flex-1">
          <SiteRail siteId={siteId} />
          <main className="min-w-0 flex-1 overflow-auto">
            <TabsContent value="build" className="m-0 p-0">
              <BuildTab siteId={siteId} />
            </TabsContent>
            <TabsContent value="preview" className="m-0 p-6">
              <PreviewTabStub />
            </TabsContent>
            <TabsContent value="style" className="m-0 p-0">
              <StyleTab siteId={siteId} />
            </TabsContent>
          </main>
        </div>
      </Tabs>
    </div>
  );
}

// ─── Top bar ──────────────────────────────────────────────────────────────

function TopBar({ siteId }: { siteId: string }) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4">
      <div className="flex min-w-0 items-center">
        <TabsList className="border-b-0">
          {TABS.map((t) => (
            <TabsTrigger key={t.id} value={t.id} className="gap-2">
              <span>{t.label}</span>
              <kbd
                aria-hidden
                className="hidden rounded border border-[var(--border-subtle)] bg-[var(--bg-sunken)] px-1 py-0.5 font-mono text-[10px] text-[var(--text-muted)] lg:inline-block"
              >
                {t.hint}
              </kbd>
            </TabsTrigger>
          ))}
        </TabsList>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <Link
          href={`/preview/${siteId}`}
          target="_blank"
          rel="noreferrer"
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm',
            'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--state-hover)]',
            'outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]',
          )}
          aria-label="Open preview in new tab"
        >
          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          Open
        </Link>
        <DeployButton siteId={siteId} />
      </div>
    </header>
  );
}

// ─── Site rail ────────────────────────────────────────────────────────────

function SiteRail({ siteId }: { siteId: string }) {
  const { data: site } = useSite(siteId);
  const { data: presets } = useStylePresets();
  const patch = usePatchSite(siteId);
  const [collapsed, setCollapsed] = useState(false);
  const [name, setName] = useState(site?.name ?? '');

  useEffect(() => {
    if (site?.name) setName(site.name);
  }, [site?.name]);

  const presetName = useMemo(() => {
    if (!site?.stylePresetId || !presets?.stylePresets) return null;
    return presets.stylePresets.find((p) => p.id === site.stylePresetId)?.name ?? site.stylePresetId;
  }, [site?.stylePresetId, presets]);

  if (collapsed) {
    return (
      <aside className="flex w-12 shrink-0 flex-col items-center border-r border-[var(--border-subtle)] bg-[var(--bg-surface)] py-3">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Expand site rail"
          aria-expanded={false}
          onClick={() => setCollapsed(false)}
          className="h-8 w-8"
        >
          <ArrowLeft className="h-3.5 w-3.5 rotate-180" aria-hidden />
        </Button>
      </aside>
    );
  }

  return (
    <aside className="flex w-64 shrink-0 flex-col gap-4 border-r border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
      <div className="flex items-center justify-between">
        <Link
          href="/sites"
          className={cn(
            'inline-flex items-center gap-1.5 text-xs',
            'text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
          )}
        >
          <ArrowLeft className="h-3 w-3" aria-hidden />
          Back to sites
        </Link>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Collapse site rail"
          aria-expanded={true}
          onClick={() => setCollapsed(true)}
          className="h-7 w-7"
        >
          <ArrowLeft className="h-3 w-3" aria-hidden />
        </Button>
      </div>

      <div className="space-y-1.5">
        <label className="text-[11px] font-medium uppercase tracking-[var(--ls-wide)] text-[var(--text-muted)]">
          Site name
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            const trimmed = name.trim();
            if (trimmed && site && trimmed !== site.name) {
              patch.mutate({ name: trimmed });
            } else if (site) {
              setName(site.name);
            }
          }}
          className={cn(
            'block w-full rounded-md border bg-[var(--input-bg)]',
            'border-[var(--input-border)] px-2.5 py-1.5 text-sm',
            'text-[var(--text-primary)] placeholder:text-[var(--text-muted)]',
            'outline-none focus:border-[var(--ring-focus)]',
            'focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--ring-focus)_22%,transparent)]',
          )}
          placeholder={site ? 'Untitled site' : 'Loading…'}
          disabled={!site}
        />
      </div>

      <div className="space-y-1.5">
        <div className="text-[11px] font-medium uppercase tracking-[var(--ls-wide)] text-[var(--text-muted)]">
          Style preset
        </div>
        {presetName ? (
          <Badge variant="neutral" className="max-w-full truncate">
            {presetName}
          </Badge>
        ) : (
          <span className="text-xs text-[var(--text-muted)]">None</span>
        )}
      </div>
    </aside>
  );
}

// ─── Deploy button ────────────────────────────────────────────────────────

type DeployState =
  | { kind: 'idle' }
  | { kind: 'deploying' }
  | { kind: 'polling'; url: string | null }
  | { kind: 'success'; url: string | null }
  | { kind: 'error'; message: string };

function DeployButton({ siteId }: { siteId: string }) {
  const [state, setState] = useState<DeployState>({ kind: 'idle' });

  const busy = state.kind === 'deploying' || state.kind === 'polling';

  useEffect(() => {
    if (state.kind !== 'polling') return;
    let cancelled = false;
    const interval = window.setInterval(async () => {
      try {
        const r = await fetch(`/api/deploy/${siteId}/status`);
        if (!r.ok) return;
        const body = (await r.json()) as { deployment: DeploymentDTO | null };
        const d = body.deployment;
        if (!d || cancelled) return;
        if (d.status === 'success') {
          setState({ kind: 'success', url: d.url });
        } else if (d.status === 'failed') {
          setState({ kind: 'error', message: 'Deploy failed' });
        }
      } catch {
        /* keep polling */
      }
    }, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [state.kind, siteId]);

  async function handleDeploy() {
    setState({ kind: 'deploying' });
    try {
      const r = await fetch(`/api/deploy/${siteId}`, { method: 'POST' });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((body && body.error) || `HTTP ${r.status}`);
      const url: string | null = body?.url ?? body?.deployment?.url ?? null;
      setState({ kind: 'polling', url });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Deploy failed';
      setState({ kind: 'error', message });
    }
  }

  const label =
    state.kind === 'deploying'
      ? 'Deploying'
      : state.kind === 'polling'
        ? 'Building'
        : 'Deploy';

  return (
    <div className="flex items-center gap-2">
      {state.kind === 'success' && state.url ? (
        <a
          href={state.url}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-[var(--color-success-700)] hover:underline"
        >
          {state.url.replace(/^https?:\/\//, '').replace(/\/$/, '')}
        </a>
      ) : state.kind === 'error' ? (
        <span className="text-xs text-[var(--color-danger-600)]">{state.message}</span>
      ) : null}
      <Button
        onClick={handleDeploy}
        disabled={busy}
        loading={busy}
        aria-label={busy ? `${label} in progress` : 'Deploy site'}
        leftIcon={!busy ? <Rocket className="h-3.5 w-3.5" aria-hidden /> : undefined}
        size="md"
      >
        {label}
      </Button>
    </div>
  );
}

// ─── Tab stubs ────────────────────────────────────────────────────────────

function StubCard({
  title,
  subtitle,
  milestone,
}: {
  title: string;
  subtitle: string;
  milestone: string;
}) {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center gap-2">
        <Badge variant="brand">{milestone}</Badge>
        <span className="text-xs text-[var(--text-muted)]">Coming soon</span>
      </div>
      <h2 className="text-2xl font-semibold tracking-[var(--ls-tight)] text-[var(--text-primary)]">
        {title}
      </h2>
      <p className="text-sm text-[var(--text-secondary)]">{subtitle}</p>

      <Card className="space-y-4 p-6">
        <div className="flex items-center gap-3">
          <Skeleton className="h-9 w-9 rounded-lg" />
          <div className="flex-1">
            <Skeleton className="mb-2 h-4 w-1/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
        <SkeletonText lines={4} />
        <div className="flex gap-2 pt-2">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-20" />
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="p-5">
          <Skeleton className="mb-3 h-4 w-1/2" />
          <SkeletonText lines={3} />
        </Card>
        <Card className="p-5">
          <Skeleton className="mb-3 h-4 w-2/5" />
          <SkeletonText lines={3} />
        </Card>
      </div>
    </div>
  );
}

function PreviewTabStub() {
  return (
    <StubCard
      milestone="M5"
      title="Preview"
      subtitle="Full-site iframe preview with cross-page navigation and device sizes."
    />
  );
}

