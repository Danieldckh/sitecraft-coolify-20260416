'use client';

import { create } from 'zustand';
import type { Node, Edge } from '@xyflow/react';

export type Selection =
  | { kind: 'site'; id: string }
  | { kind: 'page'; id: string }
  | { kind: 'section'; id: string }
  | null;

interface EditorState {
  siteId: string | null;
  selection: Selection;
  nodes: Node[];
  edges: Edge[];
  generating: Record<string, boolean>;
  streamBuffer: Record<string, string>;
  setSiteId: (id: string) => void;
  select: (sel: Selection) => void;
  setNodes: (nodes: Node[]) => void;
  setEdges: (edges: Edge[]) => void;
  setGenerating: (sectionId: string, on: boolean) => void;
  appendStream: (sectionId: string, chunk: string) => void;
  resetStream: (sectionId: string) => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  siteId: null,
  selection: null,
  nodes: [],
  edges: [],
  generating: {},
  streamBuffer: {},
  setSiteId: (id) => set({ siteId: id }),
  select: (selection) => set({ selection }),
  setNodes: (nodes) => set({ nodes }),
  setEdges: (edges) => set({ edges }),
  setGenerating: (sectionId, on) =>
    set((s) => ({ generating: { ...s.generating, [sectionId]: on } })),
  appendStream: (sectionId, chunk) =>
    set((s) => ({
      streamBuffer: { ...s.streamBuffer, [sectionId]: (s.streamBuffer[sectionId] ?? '') + chunk },
    })),
  resetStream: (sectionId) =>
    set((s) => {
      const next = { ...s.streamBuffer };
      delete next[sectionId];
      return { streamBuffer: next };
    }),
}));
