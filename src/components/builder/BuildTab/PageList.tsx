'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import {
  ChevronDown,
  Copy,
  FilePlus,
  GripVertical,
  Lock,
  LockOpen,
  MoreHorizontal,
  Plus,
  Trash2,
} from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { AlertDialog } from '@/components/ui/AlertDialog';
import { cn } from '@/lib/cn';
import { useEditorStore } from '@/stores/editor';
import {
  useAddPage,
  useDeletePage,
  usePages,
  usePatchPage,
} from '@/hooks/use-site';
import type { PageDTO } from '@/types/models';

interface SuggestedPage {
  name: string;
  slug: string;
  prompt?: string;
}

const SUGGESTED: SuggestedPage[] = [
  { name: 'Home', slug: 'home' },
  { name: 'About', slug: 'about' },
  { name: 'Services', slug: 'services' },
  { name: 'Contact', slug: 'contact' },
  { name: 'Blog', slug: 'blog' },
  { name: 'Pricing', slug: 'pricing' },
  { name: 'FAQ', slug: 'faq' },
  { name: 'Portfolio', slug: 'portfolio' },
  { name: 'Testimonials', slug: 'testimonials' },
];

export function PageList({ siteId }: { siteId: string }) {
  const { data: pages, isLoading } = usePages(siteId);
  const addPage = useAddPage(siteId);
  const patchPage = usePatchPage(siteId);
  const deletePage = useDeletePage(siteId);
  const selectedPageId = useEditorStore((s) => s.selectedPageId);
  const setSelectedPageId = useEditorStore((s) => s.setSelectedPageId);
  const streamingPageId = useEditorStore((s) => s.streamingPageId);
  const streamingState = useEditorStore((s) => s.streamingState);

  const [adding, setAdding] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<PageDTO | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  const existingSlugs = useMemo(() => new Set((pages ?? []).map((p) => p.slug)), [pages]);

  const handleAddSuggested = useCallback(
    async (s: SuggestedPage) => {
      if (existingSlugs.has(s.slug)) return;
      await addPage.mutateAsync({ name: s.name, slug: s.slug, pagePrompt: s.prompt ?? '' });
    },
    [addPage, existingSlugs],
  );

  const handleReorder = useCallback(
    async (srcId: string, destId: string) => {
      if (!pages) return;
      if (srcId === destId) return;
      const ordered = [...pages].sort((a, b) => a.orderIdx - b.orderIdx);
      const fromIdx = ordered.findIndex((p) => p.id === srcId);
      const toIdx = ordered.findIndex((p) => p.id === destId);
      if (fromIdx < 0 || toIdx < 0) return;
      const [moved] = ordered.splice(fromIdx, 1);
      ordered.splice(toIdx, 0, moved);
      // Persist new orderIdx values.
      await Promise.all(
        ordered.map((p, i) =>
          p.orderIdx === i ? null : patchPage.mutateAsync({ id: p.id, patch: { orderIdx: i } }),
        ),
      );
    },
    [pages, patchPage],
  );

  return (
    <aside className="flex min-h-0 flex-col rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
      <div className="flex items-center justify-between px-3 py-2.5">
        <div className="text-[11px] font-medium uppercase tracking-[var(--ls-wide)] text-[var(--text-muted)]">
          Pages
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setAdding((v) => !v)}
          leftIcon={<Plus className="h-3 w-3" aria-hidden />}
          aria-expanded={adding}
        >
          Add
        </Button>
      </div>

      {adding ? (
        <AddPagePanel
          siteId={siteId}
          existingSlugs={existingSlugs}
          onAddSuggested={handleAddSuggested}
          onAddCustom={async ({ name, slug, prompt }) => {
            await addPage.mutateAsync({ name, slug, pagePrompt: prompt });
          }}
          onClose={() => setAdding(false)}
        />
      ) : null}

      <div className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-1.5 pb-2">
        {isLoading ? (
          <div className="px-2 py-4 text-xs text-[var(--text-muted)]">Loading…</div>
        ) : !pages || pages.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-3 py-8 text-center">
            <div className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--bg-sunken)] text-[var(--text-muted)]">
              <FilePlus className="h-4 w-4" aria-hidden />
            </div>
            <p className="text-sm text-[var(--text-secondary)]">Add your first page</p>
            <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
              Pick pages
            </Button>
          </div>
        ) : (
          [...pages]
            .sort((a, b) => a.orderIdx - b.orderIdx)
            .map((page) => {
              const isSelected = page.id === selectedPageId;
              const isStreaming = streamingPageId === page.id;
              const status = isStreaming
                ? streamingState?.status ?? 'streaming'
                : page.lastGeneratedAt
                  ? 'ready'
                  : 'idle';
              return (
                <PageRow
                  key={page.id}
                  page={page}
                  selected={isSelected}
                  status={status}
                  dragging={dragId === page.id}
                  onSelect={() => setSelectedPageId(page.id)}
                  onRename={(name) =>
                    patchPage.mutate({ id: page.id, patch: { name } })
                  }
                  onToggleLock={() =>
                    patchPage.mutate({ id: page.id, patch: { locked: !page.locked } })
                  }
                  onDuplicate={() =>
                    addPage.mutate({
                      name: `${page.name} (copy)`,
                      slug: `${page.slug}-copy`,
                      pagePrompt: page.pagePrompt,
                    })
                  }
                  onRequestDelete={() => setPendingDelete(page)}
                  onDragStart={(e) => {
                    setDragId(page.id);
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', page.id);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const srcId = e.dataTransfer.getData('text/plain');
                    if (srcId) handleReorder(srcId, page.id);
                    setDragId(null);
                  }}
                  onDragEnd={() => setDragId(null)}
                />
              );
            })
        )}
      </div>

      <AlertDialog
        open={!!pendingDelete}
        onOpenChange={(o) => !o && setPendingDelete(null)}
        title={`Delete "${pendingDelete?.name ?? 'page'}"?`}
        description="This removes the page and all its generated content. This cannot be undone."
        confirmLabel="Delete page"
        destructive
        loading={deletePage.isPending}
        onConfirm={async () => {
          if (!pendingDelete) return;
          await deletePage.mutateAsync(pendingDelete.id);
          if (selectedPageId === pendingDelete.id) setSelectedPageId(null);
          setPendingDelete(null);
        }}
      />
    </aside>
  );
}

// ─── Add page panel ──────────────────────────────────────────────────────

function AddPagePanel({
  siteId: _siteId,
  existingSlugs,
  onAddSuggested,
  onAddCustom,
  onClose,
}: {
  siteId: string;
  existingSlugs: Set<string>;
  onAddSuggested: (p: SuggestedPage) => void | Promise<void>;
  onAddCustom: (p: { name: string; slug: string; prompt: string }) => void | Promise<void>;
  onClose: () => void;
}) {
  const [customOpen, setCustomOpen] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [prompt, setPrompt] = useState('');
  const [submitting, setSubmitting] = useState(false);

  return (
    <div className="mx-2 mb-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-sunken)] p-2">
      <div className="mb-1.5 px-1 text-[11px] font-medium uppercase tracking-[var(--ls-wide)] text-[var(--text-muted)]">
        Common pages
      </div>
      <ul className="mb-2 flex flex-wrap gap-1">
        {SUGGESTED.map((s) => {
          const added = existingSlugs.has(s.slug);
          return (
            <li key={s.slug}>
              <button
                type="button"
                disabled={added}
                onClick={() => onAddSuggested(s)}
                className={cn(
                  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs',
                  'transition-colors duration-150 ease-out',
                  added
                    ? 'border-[var(--border-subtle)] bg-transparent text-[var(--text-muted)] cursor-not-allowed'
                    : 'border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:bg-[var(--state-hover)]',
                )}
              >
                {added ? '✓' : '+'} {s.name}
              </button>
            </li>
          );
        })}
      </ul>

      {customOpen ? (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!name.trim()) return;
            setSubmitting(true);
            try {
              await onAddCustom({
                name: name.trim(),
                slug: slug.trim() || name.trim().toLowerCase().replace(/\s+/g, '-'),
                prompt: prompt.trim(),
              });
              setName('');
              setSlug('');
              setPrompt('');
              setCustomOpen(false);
            } finally {
              setSubmitting(false);
            }
          }}
          className="space-y-1.5"
        >
          <Input
            size="sm"
            placeholder="Page name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
          <Input
            size="sm"
            placeholder="slug (optional)"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
          />
          <div className="flex gap-1.5">
            <Button type="submit" size="sm" loading={submitting} disabled={!name.trim()}>
              Add page
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setCustomOpen(false)}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex justify-between gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCustomOpen(true)}
            leftIcon={<Plus className="h-3 w-3" aria-hidden />}
          >
            Custom page
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Done
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Page row ────────────────────────────────────────────────────────────

interface PageRowProps {
  page: PageDTO;
  selected: boolean;
  status: 'idle' | 'streaming' | 'ready' | 'error';
  dragging: boolean;
  onSelect: () => void;
  onRename: (name: string) => void;
  onToggleLock: () => void;
  onDuplicate: () => void;
  onRequestDelete: () => void;
  onDragStart: (e: DragEvent<HTMLDivElement>) => void;
  onDragOver: (e: DragEvent<HTMLDivElement>) => void;
  onDrop: (e: DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
}

function PageRow({
  page,
  selected,
  status,
  dragging,
  onSelect,
  onRename,
  onToggleLock,
  onDuplicate,
  onRequestDelete,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: PageRowProps) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(page.name);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const commit = () => {
    const trimmed = name.trim();
    setEditing(false);
    if (trimmed && trimmed !== page.name) onRename(trimmed);
    else setName(page.name);
  };

  return (
    <div
      draggable={!editing}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      className={cn(
        'group relative flex items-center gap-1.5 rounded-md px-1.5 py-1.5 text-sm',
        'cursor-pointer transition-colors duration-150 ease-out',
        selected
          ? 'bg-[var(--color-brand-50)] text-[var(--color-brand-700)] ring-1 ring-[var(--color-brand-200)]'
          : 'text-[var(--text-primary)] hover:bg-[var(--state-hover)]',
        dragging && 'opacity-50',
      )}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('[data-stop-select]')) return;
        onSelect();
      }}
    >
      <span
        aria-hidden
        className="flex h-5 w-4 items-center justify-center text-[var(--text-muted)] opacity-0 group-hover:opacity-100"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </span>

      <StatusDot status={status} />

      {editing ? (
        <input
          data-stop-select
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            else if (e.key === 'Escape') {
              setName(page.name);
              setEditing(false);
            }
          }}
          className="min-w-0 flex-1 rounded border border-[var(--input-border)] bg-[var(--input-bg)] px-1 py-0.5 text-sm outline-none focus:border-[var(--ring-focus)]"
        />
      ) : (
        <span
          className="min-w-0 flex-1 truncate"
          onDoubleClick={(e) => {
            e.stopPropagation();
            setEditing(true);
          }}
        >
          {page.name}
        </span>
      )}

      <Badge variant="neutral" className="shrink-0 font-mono text-[10px]">
        /{page.slug}
      </Badge>

      <button
        type="button"
        data-stop-select
        aria-label={page.locked ? 'Unlock page' : 'Lock page'}
        onClick={(e) => {
          e.stopPropagation();
          onToggleLock();
        }}
        className={cn(
          'shrink-0 rounded p-1 text-[var(--text-muted)] hover:bg-[var(--state-hover)] hover:text-[var(--text-primary)]',
          page.locked && 'text-[var(--color-warning-700)]',
        )}
      >
        {page.locked ? <Lock className="h-3 w-3" /> : <LockOpen className="h-3 w-3" />}
      </button>

      <div className="relative" ref={menuRef} data-stop-select>
        <button
          type="button"
          aria-label="Page options"
          aria-expanded={menuOpen}
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((v) => !v);
          }}
          className="shrink-0 rounded p-1 text-[var(--text-muted)] hover:bg-[var(--state-hover)] hover:text-[var(--text-primary)]"
        >
          <MoreHorizontal className="h-3 w-3" />
        </button>
        {menuOpen ? (
          <div
            role="menu"
            onMouseLeave={() => setMenuOpen(false)}
            className="absolute right-0 top-full z-20 mt-1 w-36 rounded-md border border-[var(--border-subtle)] bg-[var(--card-bg)] p-1 shadow-lg"
          >
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs text-[var(--text-primary)] hover:bg-[var(--state-hover)]"
              onClick={() => {
                setMenuOpen(false);
                onDuplicate();
              }}
            >
              <Copy className="h-3 w-3" aria-hidden /> Duplicate
            </button>
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs text-[var(--color-danger-600)] hover:bg-[var(--state-hover)]"
              onClick={() => {
                setMenuOpen(false);
                onRequestDelete();
              }}
            >
              <Trash2 className="h-3 w-3" aria-hidden /> Delete
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function StatusDot({ status }: { status: 'idle' | 'streaming' | 'ready' | 'error' }) {
  const map = {
    idle: 'bg-[var(--text-muted)]',
    streaming: 'bg-[var(--color-brand-500)] animate-pulse',
    ready: 'bg-[var(--color-success-500)]',
    error: 'bg-[var(--color-danger-500)]',
  } as const;
  return (
    <span
      aria-label={`Status ${status}`}
      className={cn('inline-block h-1.5 w-1.5 shrink-0 rounded-full', map[status])}
    />
  );
}

// Silence unused icon imports.
void ChevronDown;
