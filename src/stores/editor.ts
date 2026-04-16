'use client';

import { create } from 'zustand';

export type EditorTab = 'build' | 'preview' | 'style';

export type PageStreamStatus = 'idle' | 'streaming' | 'ready' | 'error';

export interface StreamingState {
  pageId: string;
  status: PageStreamStatus;
  tokensReceived: number;
  violations: string[];
  currentSection: string | null;
  error: string | null;
}

interface EditorState {
  tab: EditorTab;
  setTab: (t: EditorTab) => void;
  selectedPageId: string | null;
  setSelectedPageId: (id: string | null) => void;
  assetsDrawerOpen: boolean;
  setAssetsDrawerOpen: (b: boolean) => void;
  streamingPageId: string | null;
  setStreamingPageId: (id: string | null) => void;
  streamingState: StreamingState | null;
  setStreamingState: (s: StreamingState | null) => void;
  themeStreaming: boolean;
  setThemeStreaming: (b: boolean) => void;
}

function initialAssetsDrawerOpen(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(min-width: 1536px)').matches;
}

export const useEditorStore = create<EditorState>((set) => ({
  tab: 'build',
  setTab: (tab) => set({ tab }),
  selectedPageId: null,
  setSelectedPageId: (selectedPageId) => set({ selectedPageId }),
  assetsDrawerOpen: initialAssetsDrawerOpen(),
  setAssetsDrawerOpen: (assetsDrawerOpen) => set({ assetsDrawerOpen }),
  streamingPageId: null,
  setStreamingPageId: (streamingPageId) => set({ streamingPageId }),
  streamingState: null,
  setStreamingState: (streamingState) => set({ streamingState }),
  themeStreaming: false,
  setThemeStreaming: (themeStreaming) => set({ themeStreaming }),
}));
