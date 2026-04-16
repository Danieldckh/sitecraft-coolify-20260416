'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { use } from 'react';
import { ArrowLeft, Brain, ChevronDown, ChevronRight, Clock, FileEdit, Globe, Layers } from 'lucide-react';
import type { ChangeLogDTO, SiteDTO } from '@/types/models';

type Scope = 'all' | 'site' | 'page' | 'section';

interface MemoryEntryLite {
  id: string;
  role: string;
  kind: string;
  content: string;
  createdAt: string;
}

interface MemoryPayload {
  site: Pick<SiteDTO, 'id' | 'name' | 'memorySummary'>;
  entries: MemoryEntryLite[];
}

async function fetchChanges(siteId: string): Promise<ChangeLogDTO[]> {
  const r = await fetch(`/api/sites/${siteId}/changes`);
  if (!r.ok) throw new Error('Failed to load change log');
  return r.json();
}

async function fetchMemory(siteId: string): Promise<MemoryPayload> {
  const r = await fetch(`/api/memory/${siteId}`);
  if (!r.ok) throw new Error('Failed to load memory');
  return r.json();
}

function formatTimestamp(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const SCOPE_ICON: Record<Exclude<Scope, 'all'>, React.ComponentType<{ className?: string }>> = {
  site: Globe,
  page: FileEdit,
  section: Layers,
};

export default function ChangesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [scope, setScope] = useState<Scope>('all');
  const [memoryOpen, setMemoryOpen] = useState(false);

  const { data: changes, isLoading, error } = useQuery({
    queryKey: ['changes', id],
    queryFn: () => fetchChanges(id),
  });
  const { data: memory } = useQuery({ queryKey: ['memory', id], queryFn: () => fetchMemory(id) });

  const filtered = useMemo(() => {
    if (!changes) return [];
    if (scope === 'all') return changes;
    return changes.filter((c) => c.scope === scope);
  }, [changes, scope]);

  const counts = useMemo(() => {
    const c = { all: changes?.length ?? 0, site: 0, page: 0, section: 0 };
    for (const e of changes ?? []) c[e.scope as keyof typeof c]++;
    return c;
  }, [changes]);

  return (
    <div className="min-h-screen bg-paper">
      <header className="border-b border-black/5 bg-paper-raised/80 backdrop-blur sticky top-0 z-10">
        <div className="mx-auto max-w-4xl px-6 h-14 flex items-center gap-4">
          <Link href={`/sites/${id}`} className="btn-ghost !px-2">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate">{memory?.site.name ?? 'Site'}</div>
            <div className="text-xs text-ink-soft/50">Activity log</div>
          </div>
          <Link href={`/sites/${id}`} className="text-xs text-ink-soft/60 hover:text-ink">Back to editor</Link>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-8 space-y-6">
        <section className="card p-5">
          <div className="flex items-start gap-3">
            <div className="h-9 w-9 rounded-lg bg-accent-soft flex items-center justify-center shrink-0">
              <Brain className="h-4 w-4 text-accent" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="font-medium">Memory</h2>
              <p className="text-sm text-ink-soft/70 mt-1 leading-relaxed">
                {memory?.site.memorySummary?.trim() ? memory.site.memorySummary : (
                  <span className="italic text-ink-soft/40">No memory summary yet. Summaries appear once the site has generation history.</span>
                )}
              </p>
              <button
                onClick={() => setMemoryOpen((o) => !o)}
                className="mt-3 inline-flex items-center gap-1 text-xs text-ink-soft/60 hover:text-ink"
              >
                {memoryOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                Recent memory entries ({memory?.entries.length ?? 0})
              </button>
              {memoryOpen && (
                <ul className="mt-3 space-y-2 border-l border-black/10 pl-4">
                  {(memory?.entries ?? []).slice(0, 20).map((e) => (
                    <li key={e.id} className="text-xs">
                      <div className="flex items-center gap-2 text-ink-soft/50">
                        <span className="uppercase tracking-wide font-medium">{e.kind}</span>
                        <span>·</span>
                        <span>{e.role}</span>
                        <span>·</span>
                        <span>{formatTimestamp(e.createdAt)}</span>
                      </div>
                      <div className="text-ink-soft/80 mt-0.5 whitespace-pre-wrap line-clamp-3">{e.content}</div>
                    </li>
                  ))}
                  {memory && memory.entries.length === 0 && (
                    <li className="text-xs text-ink-soft/40 italic">No entries yet.</li>
                  )}
                </ul>
              )}
            </div>
          </div>
        </section>

        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold tracking-tight">Change log</h2>
            <div className="flex items-center gap-1.5 text-xs">
              {(['all', 'site', 'page', 'section'] as Scope[]).map((s) => (
                <button
                  key={s}
                  onClick={() => setScope(s)}
                  className={
                    'px-2.5 py-1 rounded-full border transition ' +
                    (scope === s
                      ? 'border-ink bg-ink text-paper'
                      : 'border-black/10 text-ink-soft/70 hover:border-black/20 hover:text-ink')
                  }
                >
                  {s} <span className="opacity-60">· {counts[s]}</span>
                </button>
              ))}
            </div>
          </div>

          {isLoading && (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="card p-4 h-16 animate-pulse bg-black/[0.02]" />
              ))}
            </div>
          )}

          {error && <div className="card p-4 text-sm text-red-600">Failed to load changes.</div>}

          {!isLoading && filtered.length === 0 && (
            <div className="card p-8 text-center text-sm text-ink-soft/60">
              No changes in this scope yet.
            </div>
          )}

          <ol className="relative space-y-2">
            {filtered.map((c) => {
              const Icon = SCOPE_ICON[c.scope];
              return (
                <li key={c.id} className="card p-4 flex gap-3">
                  <div className="h-8 w-8 rounded-lg bg-black/[0.04] flex items-center justify-center shrink-0">
                    <Icon className="h-4 w-4 text-ink-soft/70" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-4">
                      <div className="text-sm font-medium truncate">{c.summary}</div>
                      <div className="flex items-center gap-1 text-xs text-ink-soft/50 shrink-0">
                        <Clock className="h-3 w-3" />
                        {formatTimestamp(c.createdAt)}
                      </div>
                    </div>
                    <div className="text-xs text-ink-soft/50 mt-0.5">
                      <span className="uppercase tracking-wide">{c.scope}</span>
                      <span className="mx-1.5">·</span>
                      <span>by {c.actor}</span>
                    </div>
                    {c.diffJson && c.diffJson !== '{}' && (
                      <details className="mt-2">
                        <summary className="text-xs text-ink-soft/50 cursor-pointer hover:text-ink">Diff</summary>
                        <pre className="mt-1.5 text-[11px] bg-black/[0.03] rounded-md p-2 overflow-x-auto font-mono">{safeFormat(c.diffJson)}</pre>
                      </details>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      </main>
    </div>
  );
}

function safeFormat(s: string) {
  try { return JSON.stringify(JSON.parse(s), null, 2); } catch { return s; }
}
