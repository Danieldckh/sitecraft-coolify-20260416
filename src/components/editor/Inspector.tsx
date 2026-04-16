'use client';

import { useMemo, useState } from 'react';
import { Sparkles, Trash2, Loader2 } from 'lucide-react';
import { useEditorStore } from '@/stores/editor';
import {
  useSite,
  usePages,
  useSections,
  usePatchSite,
  usePatchPage,
  usePatchSection,
  useDeletePage,
  useDeleteSection,
  useInvalidateSection,
} from '@/hooks/use-site';
import { LockToggle } from './LockToggle';
import { PromptEditor } from './PromptEditor';
import { ImageUpload } from './ImageUpload';
import type { SiteDTO, PageDTO, SectionDTO } from '@/types/models';

export function Inspector({ siteId }: { siteId: string }) {
  const selection = useEditorStore((s) => s.selection);
  const { data: site } = useSite(siteId);
  const { data: pages = [] } = usePages(siteId);
  const { data: sections = [] } = useSections(siteId);

  if (!selection || selection.kind === 'site') {
    return site ? <SiteInspector site={site} /> : <EmptyInspector />;
  }
  if (selection.kind === 'page') {
    const page = pages.find((p) => p.id === selection.id);
    return page ? <PageInspector siteId={siteId} page={page} /> : <EmptyInspector />;
  }
  const section = sections.find((s) => s.id === selection.id);
  return section ? <SectionInspector siteId={siteId} section={section} /> : <EmptyInspector />;
}

function EmptyInspector() {
  return (
    <div className="flex h-full items-center justify-center p-6 text-center text-sm text-ink/50">
      Select a page or section to edit its prompt.
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-ink/50">{title}</div>
      {children}
    </div>
  );
}

function SiteInspector({ site }: { site: SiteDTO }) {
  const patch = usePatchSite(site.id);
  return (
    <div className="flex h-full flex-col overflow-y-auto p-4">
      <div className="mb-4">
        <div className="text-[11px] font-medium uppercase tracking-wider text-ink/50">Site</div>
        <div className="text-lg font-semibold">{site.name}</div>
      </div>
      <div className="space-y-4">
        <Section title="Name">
          <input
            className="input"
            defaultValue={site.name}
            onBlur={(e) => {
              if (e.target.value !== site.name) patch.mutate({ name: e.target.value });
            }}
          />
        </Section>
        <Section title="Lock">
          <LockToggle
            locked={site.locked}
            onChange={(v) => patch.mutate({ locked: v })}
          />
        </Section>
        <Section title="Site prompt">
          <PromptEditor
            value={site.sitePrompt}
            locked={site.locked}
            rows={10}
            placeholder="Describe the overall site — audience, tone, goals…"
            onCommit={(v) => patch.mutate({ sitePrompt: v })}
          />
          <p className="text-[11px] text-ink/50">
            Editing this regenerates unlocked pages; locked pages stay.
          </p>
        </Section>
        <Section title="Memory summary">
          <div className="rounded-lg border border-black/10 bg-paper px-3 py-2 text-xs leading-relaxed text-ink/70 whitespace-pre-wrap">
            {site.memorySummary || <span className="text-ink/40">No memory yet.</span>}
          </div>
        </Section>
      </div>
    </div>
  );
}

function PageInspector({ siteId, page }: { siteId: string; page: PageDTO }) {
  const patch = usePatchPage(siteId);
  const del = useDeletePage(siteId);

  return (
    <div className="flex h-full flex-col overflow-y-auto p-4">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wider text-ink/50">Page</div>
          <div className="text-lg font-semibold">{page.name}</div>
          <div className="text-xs text-ink/50">/{page.slug}</div>
        </div>
        <button
          className="rounded-md p-1.5 text-ink/40 hover:bg-red-50 hover:text-red-600"
          onClick={() => {
            if (confirm(`Delete page "${page.name}"?`)) del.mutate(page.id);
          }}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-4">
        <Section title="Name">
          <input
            className="input"
            defaultValue={page.name}
            onBlur={(e) => e.target.value !== page.name && patch.mutate({ id: page.id, patch: { name: e.target.value } })}
          />
        </Section>
        <Section title="Slug">
          <input
            className="input"
            defaultValue={page.slug}
            onBlur={(e) => e.target.value !== page.slug && patch.mutate({ id: page.id, patch: { slug: e.target.value } })}
          />
        </Section>
        <Section title="Lock">
          <LockToggle
            locked={page.locked}
            onChange={(v) => patch.mutate({ id: page.id, patch: { locked: v } })}
          />
        </Section>
        <Section title="Show in nav">
          <LockToggle
            locked={page.navVisible}
            onChange={(v) => patch.mutate({ id: page.id, patch: { navVisible: v } })}
          />
        </Section>
        <Section title="Page prompt">
          <PromptEditor
            value={page.pagePrompt}
            locked={page.locked}
            rows={10}
            placeholder="Describe what belongs on this page…"
            onCommit={(v) => patch.mutate({ id: page.id, patch: { pagePrompt: v } })}
          />
          <p className="text-[11px] text-ink/50">
            Edits regenerate unlocked sections on this page.
          </p>
        </Section>
      </div>
    </div>
  );
}

function SectionInspector({ siteId, section }: { siteId: string; section: SectionDTO }) {
  const patch = usePatchSection(siteId);
  const del = useDeleteSection(siteId);
  const invalidate = useInvalidateSection(siteId);
  const generating = useEditorStore((s) => s.generating[section.id]);
  const streamBuf = useEditorStore((s) => s.streamBuffer[section.id] ?? '');
  const setGenerating = useEditorStore((s) => s.setGenerating);
  const appendStream = useEditorStore((s) => s.appendStream);
  const resetStream = useEditorStore((s) => s.resetStream);
  const [err, setErr] = useState<string | null>(null);

  async function handleGenerate() {
    setErr(null);
    resetStream(section.id);
    setGenerating(section.id, true);
    try {
      const r = await fetch(`/api/sections/${section.id}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: section.sectionPrompt }),
      });
      if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);

      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const frames = buf.split('\n\n');
        buf = frames.pop() ?? '';
        for (const frame of frames) {
          const lines = frame.split('\n');
          let event = 'message';
          let data = '';
          for (const line of lines) {
            if (line.startsWith('event:')) event = line.slice(6).trim();
            else if (line.startsWith('data:')) data += line.slice(5).trim();
          }
          if (event === 'done') {
            invalidate(section.id);
          } else if (event === 'error') {
            try {
              const p = JSON.parse(data || '{}');
              setErr(p.message ?? 'Error');
            } catch {
              setErr('Error');
            }
          } else if (data) {
            try {
              const p = JSON.parse(data);
              if (p.delta) appendStream(section.id, p.delta);
            } catch {
              /* ignore */
            }
          }
        }
      }
    } catch (e: any) {
      setErr(e?.message ?? 'Generation failed');
    } finally {
      setGenerating(section.id, false);
    }
  }

  async function handleAnalyze(url: string) {
    try {
      await fetch(`/api/sections/${section.id}/analyze-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      invalidate(section.id);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto p-4">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wider text-ink/50">Section</div>
          <div className="text-lg font-semibold capitalize">{section.type}</div>
        </div>
        <button
          className="rounded-md p-1.5 text-ink/40 hover:bg-red-50 hover:text-red-600"
          onClick={() => {
            if (confirm(`Delete ${section.type} section?`)) del.mutate(section.id);
          }}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-4">
        <Section title="Lock">
          <LockToggle
            locked={section.locked}
            onChange={(v) => patch.mutate({ id: section.id, patch: { locked: v } })}
          />
        </Section>

        <Section title="Section prompt">
          <PromptEditor
            value={section.sectionPrompt}
            locked={section.locked}
            rows={8}
            placeholder="Describe this section — layout, content, vibe…"
            onCommit={(v) => patch.mutate({ id: section.id, patch: { sectionPrompt: v } })}
          />
        </Section>

        <Section title="Reference image">
          <ImageUpload
            value={section.referenceImageUrl}
            onChange={(url) => patch.mutate({ id: section.id, patch: { referenceImageUrl: url } })}
            onAnalyze={handleAnalyze}
          />
        </Section>

        <button
          type="button"
          onClick={handleGenerate}
          disabled={generating || section.locked}
          className="btn-accent w-full justify-center disabled:cursor-not-allowed disabled:opacity-60"
        >
          {generating ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Generating…
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" /> Generate
            </>
          )}
        </button>

        {err && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {err}
          </div>
        )}

        {(generating || streamBuf) && (
          <Section title={generating ? 'Generating…' : 'Last stream'}>
            <pre className="max-h-48 overflow-auto rounded-lg border border-black/10 bg-paper px-3 py-2 text-[11px] leading-relaxed text-ink/70 whitespace-pre-wrap">
              {streamBuf || '…'}
            </pre>
          </Section>
        )}

        {section.lastGeneratedAt && (
          <div className="text-[11px] text-ink/40">
            Last generated {new Date(section.lastGeneratedAt).toLocaleString()}
          </div>
        )}
      </div>
    </div>
  );
}
