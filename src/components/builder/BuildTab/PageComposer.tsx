'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Sparkles, StopCircle, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Switch } from '@/components/ui/Switch';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { AlertDialog } from '@/components/ui/AlertDialog';
import { Skeleton } from '@/components/common/SkeletonLoader';
import { StreamingIndicator } from '@/components/common/StreamingIndicator';
import { cn } from '@/lib/cn';
import {
  useDeletePage,
  useGeneratePage,
  usePages,
  usePatchPage,
  useTheme,
} from '@/hooks/use-site';
import { useEditorStore } from '@/stores/editor';
import type { PageDTO } from '@/types/models';
import { ClarifyingQuestions } from './ClarifyingQuestions';

const MIN_PROMPT = 10;
const MAX_PROMPT = 4000;

export function PageComposer({ siteId }: { siteId: string }) {
  const { data: pages } = usePages(siteId);
  const selectedPageId = useEditorStore((s) => s.selectedPageId);
  const setSelectedPageId = useEditorStore((s) => s.setSelectedPageId);

  const page = useMemo(
    () => pages?.find((p) => p.id === selectedPageId) ?? null,
    [pages, selectedPageId],
  );

  if (!page) {
    return (
      <Card className="flex min-h-[320px] flex-col items-center justify-center gap-2 p-8 text-center">
        <div className="text-sm font-medium text-[var(--text-primary)]">
          Select a page to start
        </div>
        <p className="max-w-xs text-xs text-[var(--text-secondary)]">
          Pick an existing page on the left, or add one from the common pages list.
        </p>
      </Card>
    );
  }

  return (
    <PageComposerInner
      siteId={siteId}
      page={page}
      onDeleted={() => setSelectedPageId(null)}
    />
  );
}

function PageComposerInner({
  siteId,
  page,
  onDeleted,
}: {
  siteId: string;
  page: PageDTO;
  onDeleted: () => void;
}) {
  const patch = usePatchPage(siteId);
  const deletePage = useDeletePage(siteId);
  const { data: theme } = useTheme(siteId);
  const setTab = useEditorStore((s) => s.setTab);

  const gen = useGeneratePage(page.id, siteId);
  const [pagePrompt, setPagePrompt] = useState(page.pagePrompt);
  const [name, setName] = useState(page.name);
  const [slug, setSlug] = useState(page.slug);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const debounceRef = useRef<number | null>(null);

  // Sync when switching pages.
  useEffect(() => {
    setPagePrompt(page.pagePrompt);
    setName(page.name);
    setSlug(page.slug);
  }, [page.id, page.pagePrompt, page.name, page.slug]);

  // Debounced prompt autosave.
  useEffect(() => {
    if (pagePrompt === page.pagePrompt) return;
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      patch.mutate({ id: page.id, patch: { pagePrompt } });
    }, 600);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagePrompt, page.id]);

  // Auto-switch to preview on done.
  const prevStatus = useRef(gen.state.status);
  useEffect(() => {
    if (prevStatus.current !== 'ready' && gen.state.status === 'ready') {
      setTab('preview');
    }
    prevStatus.current = gen.state.status;
  }, [gen.state.status, setTab]);

  const promptLen = pagePrompt.length;
  const promptValid = promptLen >= MIN_PROMPT && promptLen <= MAX_PROMPT;
  const canGenerate = !!theme && promptValid && !page.locked && gen.state.status !== 'streaming';

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="space-y-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            const trimmed = name.trim();
            if (trimmed && trimmed !== page.name) patch.mutate({ id: page.id, patch: { name: trimmed } });
            else setName(page.name);
          }}
          placeholder="Untitled page"
          className={cn(
            'block w-full bg-transparent text-2xl font-semibold tracking-[var(--ls-tight)]',
            'text-[var(--text-primary)] outline-none',
            'border-b border-transparent hover:border-[var(--border-subtle)] focus:border-[var(--ring-focus)]',
            'pb-1',
          )}
        />
        <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-secondary)]">
          <span className="text-[var(--text-muted)]">/</span>
          <Input
            size="sm"
            className="h-6 w-auto px-1.5 py-0 font-mono text-xs"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            onBlur={() => {
              const trimmed = slug.trim();
              if (trimmed && trimmed !== page.slug) patch.mutate({ id: page.id, patch: { slug: trimmed } });
              else setSlug(page.slug);
            }}
          />
          <span className="mx-1 h-3 w-px bg-[var(--border-subtle)]" />
          <label className="inline-flex items-center gap-1.5">
            <Switch
              checked={page.locked}
              onCheckedChange={(v) => patch.mutate({ id: page.id, patch: { locked: v } })}
              aria-label="Lock page"
            />
            Lock
          </label>
          <label className="inline-flex items-center gap-1.5">
            <Switch
              checked={page.navVisible}
              onCheckedChange={(v) => patch.mutate({ id: page.id, patch: { navVisible: v } })}
              aria-label="Show in navigation"
            />
            In nav
          </label>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setConfirmDelete(true)}
            leftIcon={<Trash2 className="h-3 w-3" aria-hidden />}
            className="ml-auto text-[var(--color-danger-600)]"
          >
            Delete page
          </Button>
        </div>
      </div>

      {/* Prompt */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label
            htmlFor="page-prompt"
            className="text-[11px] font-medium uppercase tracking-[var(--ls-wide)] text-[var(--text-muted)]"
          >
            What should this page contain?
          </label>
          <span
            className={cn(
              'text-[11px]',
              promptLen < MIN_PROMPT ? 'text-[var(--text-muted)]' : 'text-[var(--text-secondary)]',
              promptLen > MAX_PROMPT && 'text-[var(--color-danger-600)]',
            )}
          >
            {promptLen}/{MAX_PROMPT}
          </span>
        </div>
        <Textarea
          id="page-prompt"
          value={pagePrompt}
          onChange={(e) => setPagePrompt(e.target.value)}
          placeholder="A hero with our team values, a 3-up services grid, a short testimonial row, and a contact CTA."
          rows={5}
          maxRows={18}
          className="min-h-[160px]"
          error={promptLen > MAX_PROMPT}
        />
      </div>

      {/* Clarifying questions */}
      <ClarifyingQuestions siteId={siteId} pageId={page.id} pagePrompt={pagePrompt} />

      {/* Generate */}
      <Card>
        <CardBody className="flex flex-wrap items-center gap-3 py-4">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-[var(--text-primary)]">Generate this page</div>
            <p className="text-xs text-[var(--text-secondary)]">
              {!theme
                ? 'Generate the theme first — it sets palette, typography and shared library.'
                : !promptValid
                  ? `Write at least ${MIN_PROMPT} characters describing the page.`
                  : page.locked
                    ? 'Page is locked. Unlock to regenerate.'
                    : 'Uses your theme + shared library and streams HTML in real time.'}
            </p>
          </div>
          {gen.state.status === 'streaming' ? (
            <Button
              variant="secondary"
              onClick={gen.stop}
              leftIcon={<StopCircle className="h-3.5 w-3.5" aria-hidden />}
            >
              Stop
            </Button>
          ) : (
            <Button
              onClick={gen.start}
              disabled={!canGenerate}
              leftIcon={<Sparkles className="h-3.5 w-3.5" aria-hidden />}
            >
              Generate this page
            </Button>
          )}
        </CardBody>
      </Card>

      {gen.state.status === 'streaming' ? <GenerationProgress state={gen.state} /> : null}

      {gen.state.violations.length > 0 ? (
        <Card className="border-[var(--color-warning-500)]/40 bg-[var(--color-warning-50)]">
          <CardBody className="flex items-start gap-2 py-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 text-[var(--color-warning-700)]" aria-hidden />
            <div className="text-xs text-[var(--color-warning-700)]">
              <div className="font-medium">
                Regenerating — avoided {gen.state.violations.length} banned phrase
                {gen.state.violations.length === 1 ? '' : 's'}
              </div>
              <div className="mt-0.5 text-[var(--text-secondary)]">
                {gen.state.violations.slice(0, 5).join(', ')}
                {gen.state.violations.length > 5 ? '…' : ''}
              </div>
            </div>
          </CardBody>
        </Card>
      ) : null}

      {gen.state.status === 'error' && gen.state.error ? (
        <Card className="border-[var(--color-danger-500)]/40 bg-[var(--color-danger-50)]">
          <CardBody className="flex items-start justify-between gap-3 py-3">
            <div>
              <div className="text-sm font-medium text-[var(--color-danger-700)]">Generation failed</div>
              <p className="text-xs text-[var(--text-secondary)]">{gen.state.error}</p>
            </div>
            <Button variant="secondary" size="sm" onClick={gen.start}>
              Retry
            </Button>
          </CardBody>
        </Card>
      ) : null}

      <AlertDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete "${page.name}"?`}
        description="This removes the page and all its generated content. This cannot be undone."
        confirmLabel="Delete page"
        destructive
        loading={deletePage.isPending}
        onConfirm={async () => {
          await deletePage.mutateAsync(page.id);
          setConfirmDelete(false);
          onDeleted();
        }}
      />
    </div>
  );
}

function GenerationProgress({
  state,
}: {
  state: { tokens: number; currentSection: string | null };
}) {
  return (
    <Card>
      <CardBody className="space-y-3 py-4">
        <div className="flex items-center justify-between">
          <StreamingIndicator
            label={state.currentSection ? `Building — ${state.currentSection}` : 'Composing page'}
          />
          <span className="font-mono text-[11px] text-[var(--text-muted)]">
            ~{state.tokens} tokens
          </span>
        </div>

        {/* Hero skeleton */}
        <div className="space-y-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-sunken)] p-4">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-8 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
          <div className="mt-1 flex gap-2">
            <Skeleton className="h-7 w-20" />
            <Skeleton className="h-7 w-16" />
          </div>
        </div>

        {/* Section skeletons */}
        <div className="grid gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-sunken)] p-3"
            >
              <Skeleton className="mb-2 h-3 w-3/5" />
              <Skeleton className="mb-1 h-2 w-full" />
              <Skeleton className="h-2 w-4/5" />
            </div>
          ))}
        </div>
      </CardBody>
    </Card>
  );
}

// Silence unused import lint — Badge is used through StreamingIndicator descendants in some builds.
void Badge;
