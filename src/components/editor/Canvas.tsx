'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  ReactFlowProvider,
  useReactFlow,
  type Node,
  type Edge,
  type NodeMouseHandler,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Plus } from 'lucide-react';
import * as Select from '@radix-ui/react-select';

import { nodeTypes, type PageNode, type SectionNode } from './nodes';
import { autoLayout } from './layout';
import { useEditorStore } from '@/stores/editor';
import {
  usePages,
  useSections,
  useAddPage,
  useAddSection,
} from '@/hooks/use-site';
import type { SectionType, GenerationStatus } from '@/types/models';
import { DEFAULT_SECTION_TYPES } from '@/types/models';
import { slugify } from '@/lib/utils';

const ALL_SECTION_TYPES: SectionType[] = [...DEFAULT_SECTION_TYPES, 'gallery', 'testimonials', 'pricing', 'faq', 'contact', 'custom'];

function statusFor(section: { html: string; lastGeneratedAt: string | null }, generating?: boolean): GenerationStatus {
  if (generating) return 'generating';
  if (section.lastGeneratedAt && section.html) return 'ready';
  return 'idle';
}

function CanvasInner({ siteId }: { siteId: string }) {
  const { data: pages = [] } = usePages(siteId);
  const { data: sections = [] } = useSections(siteId);
  const addPage = useAddPage(siteId);
  const addSection = useAddSection(siteId);
  const select = useEditorStore((s) => s.select);
  const generating = useEditorStore((s) => s.generating);
  const setStoreNodes = useEditorStore((s) => s.setNodes);
  const setStoreEdges = useEditorStore((s) => s.setEdges);
  const rf = useReactFlow();
  const [pendingAddFor, setPendingAddFor] = useState<string | null>(null);

  const handleAddSection = useCallback((pageId: string) => {
    setPendingAddFor(pageId);
  }, []);

  const { nodes, edges } = useMemo(() => {
    const pageNodes: PageNode[] = pages.map((p) => ({
      id: `page-${p.id}`,
      type: 'page',
      position: { x: 0, y: 0 },
      data: { name: p.name, slug: p.slug, locked: p.locked, onAddSection: handleAddSection },
      style: { width: 300, height: 300 },
    }));

    const sectionNodes: SectionNode[] = sections
      .filter((s) => pages.some((p) => p.id === s.pageId))
      .map((s) => ({
        id: `section-${s.id}`,
        type: 'section',
        parentId: `page-${s.pageId}`,
        extent: 'parent' as const,
        position: { x: 0, y: 0 },
        data: {
          type: s.type,
          locked: s.locked,
          status: statusFor(s, generating[s.id]),
        },
        draggable: false,
      }));

    const allNodes: Node[] = [...pageNodes, ...sectionNodes];
    const allEdges: Edge[] = [];
    for (let i = 0; i < pages.length - 1; i++) {
      allEdges.push({
        id: `e-${pages[i].id}-${pages[i + 1].id}`,
        source: `page-${pages[i].id}`,
        target: `page-${pages[i + 1].id}`,
        style: { stroke: '#d1d5db', strokeWidth: 1.5 },
      });
    }
    return { nodes: autoLayout(allNodes, allEdges), edges: allEdges };
  }, [pages, sections, generating, handleAddSection]);

  const lastFitRef = useRef(0);
  useEffect(() => {
    setStoreNodes(nodes);
    setStoreEdges(edges);
    const now = Date.now();
    if (now - lastFitRef.current > 500) {
      lastFitRef.current = now;
      queueMicrotask(() => rf.fitView({ padding: 0.2, duration: 300 }));
    }
  }, [nodes, edges, rf, setStoreNodes, setStoreEdges]);

  const onNodeClick: NodeMouseHandler = useCallback(
    (_e, node) => {
      if (node.type === 'page') {
        const id = node.id.replace(/^page-/, '');
        select({ kind: 'page', id });
      } else if (node.type === 'section') {
        const id = node.id.replace(/^section-/, '');
        select({ kind: 'section', id });
      }
    },
    [select],
  );

  const onPaneClick = useCallback(() => {
    select({ kind: 'site', id: siteId });
  }, [select, siteId]);

  const handleAddPage = () => {
    const existing = pages?.length ?? 0;
    const name = `New Page ${existing + 1}`;
    addPage.mutate({ name, slug: slugify(name), pagePrompt: '' });
  };

  const pickSectionType = (type: SectionType) => {
    if (!pendingAddFor) return;
    const pageId = pendingAddFor.replace(/^page-/, '');
    addSection.mutate({ pageId, type });
    setPendingAddFor(null);
  };

  return (
    <div className="relative h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={24} size={1} color="#e5e7eb" />
        <MiniMap pannable zoomable className="!bg-paper-raised !border !border-black/10 !rounded-lg" />
        <Controls className="!shadow-sm" />
      </ReactFlow>

      <button
        type="button"
        onClick={handleAddPage}
        className="btn-primary absolute left-4 top-4 shadow-sm"
      >
        <Plus className="h-4 w-4" /> Add page
      </button>

      {pendingAddFor && (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center bg-ink/20 backdrop-blur-sm"
          onClick={() => setPendingAddFor(null)}
        >
          <div
            className="card w-80 p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 text-sm font-semibold">Add section</div>
            <div className="grid grid-cols-2 gap-2">
              {ALL_SECTION_TYPES.map((t) => (
                <button
                  key={t}
                  className="btn-ghost justify-center capitalize"
                  onClick={() => pickSectionType(t)}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function Canvas({ siteId }: { siteId: string }) {
  return (
    <ReactFlowProvider>
      <CanvasInner siteId={siteId} />
    </ReactFlowProvider>
  );
}
