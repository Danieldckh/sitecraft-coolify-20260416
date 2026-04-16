'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import * as Dialog from '@radix-ui/react-dialog';
import { Plus, Pencil, Trash2, ExternalLink, Globe, Loader2 } from 'lucide-react';
import type { SiteDTO } from '@/types/models';

type SiteWithMeta = SiteDTO & { deployedUrl?: string | null };

async function fetchSites(): Promise<SiteWithMeta[]> {
  const r = await fetch('/api/sites');
  if (!r.ok) throw new Error('Failed to load sites');
  return r.json();
}

async function createSite(input: { name: string; sitePrompt: string }): Promise<SiteDTO> {
  const r = await fetch('/api/sites', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!r.ok) throw new Error('Failed to create site');
  return r.json();
}

async function deleteSite(id: string) {
  const r = await fetch(`/api/sites/${id}`, { method: 'DELETE' });
  if (!r.ok) throw new Error('Failed to delete site');
}

function formatDate(iso: string) {
  const d = new Date(iso);
  const now = Date.now();
  const diff = now - d.getTime();
  const day = 24 * 60 * 60 * 1000;
  if (diff < day) return 'today';
  if (diff < 2 * day) return 'yesterday';
  if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function SitesPage() {
  const qc = useQueryClient();
  const { data: sites, isLoading, error } = useQuery({ queryKey: ['sites'], queryFn: fetchSites });
  const del = useMutation({
    mutationFn: deleteSite,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sites'] }),
  });

  return (
    <div>
      <div className="flex items-end justify-between mb-8">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Sites</h1>
          <p className="text-sm text-ink-soft/60 mt-1">Company-wide catalog of AI-generated sites.</p>
        </div>
        <NewSiteButton />
      </div>

      {isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="card p-5 h-40 animate-pulse bg-black/[0.02]" />
          ))}
        </div>
      )}

      {error && (
        <div className="card p-6 text-sm text-red-600">Failed to load sites.</div>
      )}

      {sites && sites.length === 0 && (
        <div className="card p-12 text-center">
          <div className="mx-auto h-10 w-10 rounded-full bg-accent-soft flex items-center justify-center mb-4">
            <Globe className="h-5 w-5 text-accent" />
          </div>
          <h2 className="font-medium">No sites yet</h2>
          <p className="text-sm text-ink-soft/60 mt-1">Create your first AI-generated site to get started.</p>
          <div className="mt-5 flex justify-center">
            <NewSiteButton />
          </div>
        </div>
      )}

      {sites && sites.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {sites.map((s) => (
            <SiteCard key={s.id} site={s} onDelete={() => del.mutate(s.id)} deleting={del.isPending && del.variables === s.id} />
          ))}
        </div>
      )}
    </div>
  );
}

function SiteCard({ site, onDelete, deleting }: { site: SiteWithMeta; onDelete: () => void; deleting: boolean }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  return (
    <div className="card p-5 group relative transition hover:shadow-md hover:-translate-y-0.5">
      <div className="flex items-start justify-between">
        <Link href={`/sites/${site.id}`} className="flex-1 min-w-0">
          <div className="font-medium truncate group-hover:text-accent transition">{site.name}</div>
          <div className="text-xs text-ink-soft/50 mt-1">Updated {formatDate(site.updatedAt)}</div>
        </Link>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
          <Link
            href={`/sites/${site.id}`}
            className="p-1.5 rounded-md hover:bg-black/5"
            title="Edit"
          >
            <Pencil className="h-3.5 w-3.5" />
          </Link>
          <button
            onClick={() => setConfirmOpen(true)}
            className="p-1.5 rounded-md hover:bg-red-50 hover:text-red-600"
            title="Delete"
            disabled={deleting}
          >
            {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      <p className="text-xs text-ink-soft/60 mt-3 line-clamp-2 leading-relaxed">
        {site.sitePrompt || <span className="italic opacity-50">No site prompt.</span>}
      </p>

      <div className="mt-4 flex items-center justify-between pt-3 border-t border-black/5">
        {site.deployedUrl ? (
          <a
            href={site.deployedUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-accent hover:underline truncate"
            onClick={(e) => e.stopPropagation()}
          >
            <ExternalLink className="h-3 w-3" />
            <span className="truncate">{site.deployedUrl.replace(/^https?:\/\//, '')}</span>
          </a>
        ) : (
          <span className="text-xs text-ink-soft/40">Not deployed</span>
        )}
        <Link href={`/sites/${site.id}/changes`} className="text-xs text-ink-soft/50 hover:text-ink">
          Changes
        </Link>
      </div>

      <Dialog.Root open={confirmOpen} onOpenChange={setConfirmOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-ink/40 backdrop-blur-sm z-50" />
          <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[92vw] max-w-sm z-50 card p-6">
            <Dialog.Title className="font-medium">Delete site?</Dialog.Title>
            <Dialog.Description className="text-sm text-ink-soft/60 mt-2">
              "{site.name}" and all its pages will be permanently removed.
            </Dialog.Description>
            <div className="mt-5 flex justify-end gap-2">
              <Dialog.Close className="btn-ghost">Cancel</Dialog.Close>
              <button
                className="btn bg-red-600 text-white hover:bg-red-700"
                onClick={() => { setConfirmOpen(false); onDelete(); }}
              >
                Delete
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

function NewSiteButton() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const router = useRouter();
  const qc = useQueryClient();
  const create = useMutation({
    mutationFn: createSite,
    onSuccess: (site) => {
      qc.invalidateQueries({ queryKey: ['sites'] });
      setOpen(false);
      setName('');
      setPrompt('');
      router.push(`/sites/${site.id}`);
    },
  });

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button className="btn-primary">
          <Plus className="h-4 w-4" />
          New site
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-ink/40 backdrop-blur-sm z-50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[92vw] max-w-md z-50 card p-6">
          <Dialog.Title className="text-lg font-semibold tracking-tight">Create a new site</Dialog.Title>
          <Dialog.Description className="text-sm text-ink-soft/60 mt-1">
            Describe what you want to build. Sitecraft will generate a sitemap and draft sections.
          </Dialog.Description>

          <form
            className="mt-5 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim()) return;
              create.mutate({ name: name.trim(), sitePrompt: prompt.trim() });
            }}
          >
            <div>
              <label className="block text-xs font-medium mb-1.5">Site name</label>
              <input
                className="input"
                placeholder="Acme Farms"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5">Initial prompt</label>
              <textarea
                className="textarea"
                placeholder="Modern B2B SaaS for farm logistics — 4 pages including home, features, pricing, contact."
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={4}
              />
            </div>
            {create.isError && (
              <div className="text-sm text-red-600">Something went wrong. Please try again.</div>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <Dialog.Close className="btn-ghost" type="button">Cancel</Dialog.Close>
              <button className="btn-primary" type="submit" disabled={create.isPending || !name.trim()}>
                {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Create
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
