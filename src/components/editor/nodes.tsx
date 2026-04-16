'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { Lock, Loader2, CheckCircle2, AlertCircle, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { GenerationStatus, SectionType } from '@/types/models';

export type PageNodeData = {
  name: string;
  slug: string;
  locked: boolean;
  onAddSection?: (pageId: string) => void;
};

export type SectionNodeData = {
  type: SectionType;
  locked: boolean;
  status: GenerationStatus;
};

export type PageNode = Node<PageNodeData, 'page'>;
export type SectionNode = Node<SectionNodeData, 'section'>;

export const PageNodeView = memo(function PageNodeView({
  id,
  data,
  selected,
}: NodeProps<PageNode>) {
  return (
    <div
      className={cn(
        'h-full w-full rounded-2xl border bg-paper-raised shadow-sm transition',
        selected ? 'border-accent ring-2 ring-accent/30' : 'border-black/10',
      )}
    >
      <Handle type="target" position={Position.Left} className="!bg-ink/40" />
      <div className="flex items-center justify-between border-b border-black/5 px-4 py-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-ink">{data.name}</div>
          <div className="truncate text-[11px] text-ink/50">/{data.slug}</div>
        </div>
        <div className="flex items-center gap-1">
          {data.locked && (
            <span className="flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
              <Lock className="h-3 w-3" /> locked
            </span>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              data.onAddSection?.(id);
            }}
            className="rounded-md p-1 text-ink/50 hover:bg-black/5 hover:text-ink"
            title="Add section"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-ink/40" />
    </div>
  );
});

export const SectionNodeView = memo(function SectionNodeView({
  data,
  selected,
}: NodeProps<SectionNode>) {
  return (
    <div
      className={cn(
        'flex h-full w-full items-center justify-between rounded-lg border bg-white px-3 text-sm transition',
        selected ? 'border-accent ring-2 ring-accent/30' : 'border-black/10 hover:border-ink/30',
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-ink/40" />
        <span className="truncate font-medium capitalize text-ink">{data.type}</span>
      </div>
      <div className="flex items-center gap-1.5 text-ink/50">
        {data.locked && <Lock className="h-3 w-3 text-amber-600" />}
        {data.status === 'generating' && (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
        )}
        {data.status === 'ready' && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />}
        {data.status === 'error' && <AlertCircle className="h-3.5 w-3.5 text-red-600" />}
      </div>
    </div>
  );
});

export const nodeTypes = {
  page: PageNodeView,
  section: SectionNodeView,
};
