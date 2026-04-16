'use client';

import { useId, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, ExternalLink, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { AlertDialog } from '@/components/ui/AlertDialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/Dialog';
import { SkeletonCard } from '@/components/common/SkeletonLoader';
import { CreateSiteDialog } from '@/components/builder/CreateSiteDialog';
import { useDeleteSite, useRenameSite, useSites } from '@/hooks/use-site';
import type { SiteDTO } from '@/types/models';
import { cn } from '@/lib/cn';

type SiteWithMeta = SiteDTO & { deployedUrl?: string | null };

// Preset → 5 color stops for the card stripe. Mirrors StylePresetPicker.
const PRESET_STRIPE: Record<string, string[]> = {
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

const FALLBACK_STRIPE = ['#E4E4E7', '#A1A1AA', '#52525B', '#27272A', '#FAFAFA'];

function formatRelative(iso: string) {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const min = 60 * 1000;
  const hr  = 60 * min;
  const day = 24 * hr;
  if (diff < min) return 'just now';
  if (diff < hr)  return `${Math.floor(diff / min)}m ago`;
  if (diff < day) return `${Math.floor(diff / hr)}h ago`;
  if (diff < 2 * day)  return 'yesterday';
  if (diff < 7 * day)  return `${Math.floor(diff / day)}d ago`;
  if (diff < 30 * day) return `${Math.floor(diff / (7 * day))}w ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function SitesPage() {
  const { data: sites, isLoading, error, refetch, isFetching } = useSites();
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <div className="space-y-8">
      <header className="flex items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-[var(--ls-wide)] text-[var(--text-secondary)]">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--text-primary)]" aria-hidden />
            Sitecraft
          </div>
          <h1 className="mt-1 text-3xl font-semibold tracking-[var(--ls-tight)] text-[var(--text-primary)]">
            Your sites
          </h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            AI-composed, multi-page websites — theme first, then pages, each as a cohesive whole.
          </p>
        </div>
        <Button
          onClick={() => setCreateOpen(true)}
          leftIcon={<Plus className="h-3.5 w-3.5" />}
          size="md"
        >
          New site
        </Button>
      </header>

      {isLoading ? (
        <SiteGrid>
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </SiteGrid>
      ) : error ? (
        <ErrorState onRetry={() => refetch()} retrying={isFetching} />
      ) : !sites || sites.length === 0 ? (
        <EmptyState onCreate={() => setCreateOpen(true)} />
      ) : (
        <SiteGrid>
          {(sites as SiteWithMeta[]).map((s) => (
            <SiteCard key={s.id} site={s} />
          ))}
        </SiteGrid>
      )}

      <CreateSiteDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}

function SiteGrid({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="grid gap-5"
      style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}
    >
      {children}
    </div>
  );
}

// ─── Empty / Error ────────────────────────────────────────────────────────

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <Card className="relative overflow-hidden p-10 sm:p-14 text-center">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-1 flex"
      >
        {['#F5EFE6', '#0066FF', '#33FF88', '#C2312D', '#A78BFA'].map((c, i) => (
          <span key={i} className="flex-1" style={{ backgroundColor: c }} />
        ))}
      </div>
      <div className="mx-auto mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--border-default)] bg-[var(--bg-sunken)]">
        <Sparkles className="h-5 w-5 text-[var(--text-primary)]" aria-hidden />
      </div>
      <h2 className="text-lg font-semibold tracking-[var(--ls-tight)] text-[var(--text-primary)]">
        Compose your first site
      </h2>
      <p className="mx-auto mt-1.5 max-w-md text-sm text-[var(--text-secondary)]">
        Describe the product, pick a style, and Sitecraft will generate a theme and every page — built
        as a coherent whole, not a grid of generic sections.
      </p>
      <div className="mt-6 flex justify-center">
        <Button onClick={onCreate} leftIcon={<Plus className="h-3.5 w-3.5" />}>
          New site
        </Button>
      </div>
    </Card>
  );
}

function ErrorState({ onRetry, retrying }: { onRetry: () => void; retrying: boolean }) {
  return (
    <Card className="p-8 text-center">
      <h2 className="text-md font-semibold text-[var(--text-primary)]">
        Couldn&rsquo;t load your sites
      </h2>
      <p className="mt-1 text-sm text-[var(--text-secondary)]">
        The network hiccuped. Give it another go.
      </p>
      <div className="mt-4 flex justify-center">
        <Button variant="secondary" onClick={onRetry} loading={retrying}>
          Retry
        </Button>
      </div>
    </Card>
  );
}

// ─── Card ─────────────────────────────────────────────────────────────────

function SiteCard({ site }: { site: SiteWithMeta }) {
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const deleteMut = useDeleteSite();

  const stripe = site.stylePresetId
    ? PRESET_STRIPE[site.stylePresetId] ?? FALLBACK_STRIPE
    : FALLBACK_STRIPE;

  const deployedLabel = site.deployedUrl?.replace(/^https?:\/\//, '').replace(/\/$/, '');

  return (
    <>
      <Card
        className={cn(
          'group relative flex flex-col overflow-hidden',
          'transition-[box-shadow,transform,border-color] duration-150 ease-out',
          'hover:-translate-y-0.5 hover:shadow-md',
          'focus-within:border-[var(--border-strong)]',
        )}
      >
        <div className="flex h-1.5 w-full" aria-hidden>
          {stripe.map((c, i) => (
            <span key={i} className="flex-1" style={{ backgroundColor: c }} />
          ))}
        </div>

        <div className="flex flex-1 flex-col gap-3 p-5">
          <div className="flex items-start justify-between gap-2">
            <Link
              href={`/sites/${site.id}?tab=build`}
              className="min-w-0 flex-1 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]"
            >
              <h3 className="truncate text-md font-semibold tracking-[var(--ls-tight)] text-[var(--text-primary)] transition-colors group-hover:text-[var(--color-brand-700)]">
                {site.name}
              </h3>
              <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                Updated {formatRelative(site.updatedAt)}
              </p>
            </Link>
            <div
              className={cn(
                'flex items-center gap-0.5 opacity-0 transition-opacity duration-150',
                'group-hover:opacity-100 group-focus-within:opacity-100',
              )}
            >
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Rename ${site.name}`}
                onClick={() => setRenameOpen(true)}
                className="h-8 w-8"
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Delete ${site.name}`}
                onClick={() => setDeleteOpen(true)}
                className="h-8 w-8 hover:text-[var(--color-danger-600)]"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          <p className="line-clamp-3 text-sm leading-relaxed text-[var(--text-secondary)] min-h-[3.75rem]">
            {site.sitePrompt ? (
              site.sitePrompt
            ) : (
              <span className="italic text-[var(--text-muted)]">No description yet.</span>
            )}
          </p>

          <div className="mt-auto flex items-center justify-between gap-2 pt-3 border-t border-[var(--border-subtle)]">
            {deployedLabel ? (
              <a
                href={site.deployedUrl!}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="min-w-0"
              >
                <Badge
                  variant="success"
                  className="max-w-full cursor-pointer hover:opacity-90"
                  title={site.deployedUrl ?? undefined}
                >
                  <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
                  <span className="truncate">{deployedLabel}</span>
                </Badge>
              </a>
            ) : (
              <span className="text-xs text-[var(--text-muted)]">Not deployed</span>
            )}
            <Link
              href={`/sites/${site.id}?tab=build`}
              className={cn(
                'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs',
                'text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
                'outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]',
              )}
              aria-label={`Open ${site.name}`}
            >
              Open
              <ArrowUpRight className="h-3 w-3" aria-hidden />
            </Link>
          </div>
        </div>
      </Card>

      <RenameSiteDialog
        site={site}
        open={renameOpen}
        onOpenChange={setRenameOpen}
      />

      <AlertDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete "${site.name}"?`}
        description="This permanently removes the site and every page, theme, and asset attached to it. This cannot be undone."
        confirmLabel="Delete site"
        destructive
        loading={deleteMut.isPending}
        onConfirm={async () => {
          await deleteMut.mutateAsync(site.id);
          setDeleteOpen(false);
        }}
      />
    </>
  );
}

// ─── Rename dialog ─────────────────────────────────────────────────────────

function RenameSiteDialog({
  site,
  open,
  onOpenChange,
}: {
  site: SiteDTO;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [value, setValue] = useState(site.name);
  const id = useId();
  const rename = useRenameSite();

  // Reset value whenever the dialog opens for this site.
  const handleChange = (next: boolean) => {
    if (next) setValue(site.name);
    onOpenChange(next);
  };

  const trimmed = value.trim();
  const error =
    trimmed.length < 1
      ? 'Name is required.'
      : trimmed.length > 80
        ? 'Max 80 characters.'
        : null;

  const submit = async () => {
    if (error || trimmed === site.name) {
      onOpenChange(false);
      return;
    }
    try {
      await rename.mutateAsync({ id: site.id, name: trimmed });
      onOpenChange(false);
    } catch {
      /* keep open, error shown below */
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Rename site</DialogTitle>
          <DialogDescription>Give this site a clearer name.</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="space-y-1.5"
        >
          <Label htmlFor={id}>Site name</Label>
          <Input
            id={id}
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            maxLength={100}
            error={!!error && trimmed.length > 0}
          />
          {rename.isError ? (
            <p role="alert" className="text-xs text-[var(--color-danger-600)]">
              {rename.error instanceof Error ? rename.error.message : 'Rename failed.'}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              loading={rename.isPending}
              disabled={!!error || trimmed === site.name}
            >
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
