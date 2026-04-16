'use client';

import { create } from 'zustand';

export type EditorTab = 'build' | 'preview' | 'style';

interface EditorState {
  tab: EditorTab;
  setTab: (t: EditorTab) => void;
  selectedPageId: string | null;
  setSelectedPageId: (id: string | null) => void;
  assetsDrawerOpen: boolean;
  setAssetsDrawerOpen: (b: boolean) => void;
  streamingPageId: string | null;
  setStreamingPageId: (id: string | null) => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  tab: 'build',
  setTab: (tab) => set({ tab }),
  selectedPageId: null,
  setSelectedPageId: (selectedPageId) => set({ selectedPageId }),
  assetsDrawerOpen: false,
  setAssetsDrawerOpen: (assetsDrawerOpen) => set({ assetsDrawerOpen }),
  streamingPageId: null,
  setStreamingPageId: (streamingPageId) => set({ streamingPageId }),
}));
