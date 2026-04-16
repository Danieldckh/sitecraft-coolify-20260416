'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Wand2, Type, Image as ImageIcon } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Textarea';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/Tabs';
import { FileDrop } from '@/components/common/FileDrop';
import { cn } from '@/lib/cn';
import {
  useEditElement,
  usePatchElement,
  useUploadAsset,
  useUpsertElement,
} from '@/hooks/use-site';
import type { InspectorSelection } from '@/stores/editor';

export interface InspectorPopoverProps {
  siteId: string;
  pageId: string;
  selection: InspectorSelection;
  onClose: () => void;
  onApplyReplace: (selectorId: string, html: string, css?: string) => void;
  onLiveText: (selectorId: string, text: string) => void;
  requestText: (selectorId: string) => Promise<string>;
}

const POPOVER_WIDTH = 340;
const POPOVER_HEIGHT_MAX = 420;

function clampPosition(
  rect: InspectorSelection['rect'],
  vw: number,
  vh: number,
) {
  // Prefer anchoring below the element; flip above if there is no room.
  const gap = 8;
  let top = rect.top + rect.height + gap;
  if (top + POPOVER_HEIGHT_MAX > vh - 16) {
    const above = rect.top - POPOVER_HEIGHT_MAX - gap;
    top = above >= 16 ? above : Math.max(16, vh - POPOVER_HEIGHT_MAX - 16);
  }
  let left = rect.left;
  if (left + POPOVER_WIDTH > vw - 16) left = vw - POPOVER_WIDTH - 16;
  if (left < 16) left = 16;
  return { top, left };
}

export function InspectorPopover({
  siteId,
  pageId,
  selection,
  onClose,
  onApplyReplace,
  onLiveText,
  requestText,
}: InspectorPopoverProps) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [tab, setTab] = useState<'ai' | 'text' | 'image'>('ai');
  const [prompt, setPrompt] = useState('');
  const [text, setText] = useState<string>(selection.textPreview);
  const [textLoaded, setTextLoaded] = useState(false);
  const [elementId, setElementId] = useState<string | null>(null);
  const [imageBusy, setImageBusy] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);

  const upsert = useUpsertElement(pageId);
  const edit = useEditElement(pageId, elementId ?? '');
  const patch = usePatchElement(pageId, elementId ?? '');
  const upload = useUploadAsset(siteId);

  const isImageTarget = useMemo(
    () => selection.tagName === 'img',
    [selection.tagName],
  );

  // Ensure there's a DB row for the element before any AI/patch operations.
  const ensureElementId = async (): Promise<string> => {
    if (elementId) return elementId;
    const el = await upsert.mutateAsync({ selectorId: selection.selectorId });
    setElementId(el.id);
    return el.id;
  };

  // Position the popover relative to the iframe-provided viewport rect.
  const [pos, setPos] = useState<{ top: number; left: number }>(() =>
    clampPosition(selection.rect, window.innerWidth, window.innerHeight),
  );
  useEffect(() => {
    setPos(clampPosition(selection.rect, window.innerWidth, window.innerHeight));
  }, [selection.rect]);

  // Fetch the current text content on open or when switching to the text tab.
  useEffect(() => {
    let alive = true;
    if (tab !== 'text' || textLoaded) return;
    requestText(selection.selectorId).then((t) => {
      if (!alive) return;
      setText(t);
      setTextLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, [tab, textLoaded, requestText, selection.selectorId]);

  // Debounced live text preview.
  useEffect(() => {
    if (tab !== 'text' || !textLoaded) return;
    const h = setTimeout(() => {
      onLiveText(selection.selectorId, text);
    }, 120);
    return () => clearTimeout(h);
  }, [text, tab, textLoaded, selection.selectorId, onLiveText]);

  // Escape key + click outside closes.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    function onDocClick(e: MouseEvent) {
      if (!cardRef.current) return;
      if (e.target instanceof Node && cardRef.current.contains(e.target)) return;
      onClose();
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDocClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDocClick);
    };
  }, [onClose]);

  const submitAi = async () => {
    if (!prompt.trim()) return;
    const eid = await ensureElementId();
    await edit.start(prompt.trim());
    // edit.state updates via callbacks; we watch it in effect below
    void eid;
  };

  // When edit finishes, apply to iframe.
  useEffect(() => {
    if (edit.state.status === 'ready' && edit.state.element) {
      onApplyReplace(
        selection.selectorId,
        edit.state.element.html,
        edit.state.element.css,
      );
    }
  }, [edit.state.status, edit.state.element, onApplyReplace, selection.selectorId]);

  const saveText = async () => {
    const eid = await ensureElementId();
    // Text override stores the updated innerHTML (text content safely escaped).
    await patch.mutateAsync({ html: escapeHtml(text) });
    void eid;
    // Already live-reflected via onLiveText; no extra replace needed.
  };

  const onImageFiles = async (files: File[]) => {
    setImageError(null);
    const f = files[0];
    if (!f) return;
    setImageBusy(true);
    try {
      const asset = await upload.mutateAsync({ file: f, kind: 'image' });
      const eid = await ensureElementId();
      const html = `<img src="${escapeAttr(asset.url)}" alt="" />`;
      await patch.mutateAsync({ html });
      onApplyReplace(selection.selectorId, html);
      void eid;
    } catch (e: unknown) {
      setImageError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setImageBusy(false);
    }
  };

  const truncatedId = selection.selectorId.replace(/^sc-el-/, '').slice(0, 10);

  return (
    <div
      ref={cardRef}
      role="dialog"
      aria-label="Element inspector"
      className={cn(
        'fixed z-50 rounded-xl border bg-[var(--bg-elevated)] shadow-[var(--shadow-lg)]',
        'border-[var(--border-default)] text-[var(--text-primary)]',
      )}
      style={{
        top: pos.top,
        left: pos.left,
        width: POPOVER_WIDTH,
        maxHeight: POPOVER_HEIGHT_MAX,
      }}
    >
      <div className="flex items-center justify-between gap-2 border-b border-[var(--border-subtle)] px-3 py-2">
        <div className="min-w-0">
          <div className="truncate text-xs font-medium text-[var(--text-primary)]">
            {selection.tagName} · {truncatedId}
          </div>
          {selection.promoted ? (
            <div className="text-[10px] text-[var(--text-muted)]">
              Promoted to nearest tracked ancestor
            </div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close inspector"
          className="rounded-md p-1 text-[var(--text-secondary)] hover:bg-[var(--state-hover)]"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList className="mx-3 mt-2">
          <TabsTrigger value="ai" className="h-8 px-2 text-xs">
            <Wand2 className="mr-1 h-3 w-3" aria-hidden /> Ask AI
          </TabsTrigger>
          <TabsTrigger value="text" className="h-8 px-2 text-xs">
            <Type className="mr-1 h-3 w-3" aria-hidden /> Text
          </TabsTrigger>
          <TabsTrigger value="image" className="h-8 px-2 text-xs">
            <ImageIcon className="mr-1 h-3 w-3" aria-hidden /> Image
          </TabsTrigger>
        </TabsList>

        <TabsContent value="ai" className="px-3 pb-3">
          <Textarea
            placeholder="What should change here?"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            maxRows={6}
          />
          {edit.state.status === 'streaming' ? (
            <div className="mt-2 h-1 overflow-hidden rounded bg-[var(--bg-sunken)]">
              <div
                className="h-full bg-[var(--color-brand-600)] transition-[width]"
                style={{
                  width: `${Math.min(90, edit.state.tokens * 2)}%`,
                }}
              />
            </div>
          ) : null}
          {edit.state.status === 'error' ? (
            <p className="mt-2 text-xs text-[var(--color-danger-600)]" role="alert">
              {edit.state.error}
            </p>
          ) : null}
          <div className="mt-2 flex justify-end">
            <Button
              size="sm"
              onClick={submitAi}
              disabled={!prompt.trim() || edit.state.status === 'streaming'}
            >
              {edit.state.status === 'streaming' ? 'Thinking…' : 'Submit'}
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="text" className="px-3 pb-3">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            maxRows={8}
            placeholder={textLoaded ? '' : 'Loading…'}
            disabled={!textLoaded}
          />
          <div className="mt-2 flex justify-end">
            <Button
              size="sm"
              onClick={saveText}
              disabled={!textLoaded || patch.isPending}
            >
              {patch.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="image" className="px-3 pb-3">
          {isImageTarget ? (
            <>
              <FileDrop
                accept="image/*"
                maxSizeMb={10}
                onFiles={onImageFiles}
                disabled={imageBusy}
                label="Drop an image"
                hint="PNG, JPG, or WebP"
              />
              {imageError ? (
                <p className="mt-2 text-xs text-[var(--color-danger-600)]" role="alert">
                  {imageError}
                </p>
              ) : null}
            </>
          ) : (
            <p className="rounded-lg border border-dashed border-[var(--border-subtle)] p-3 text-xs text-[var(--text-muted)]">
              Image replacement available on image elements only.
            </p>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}
