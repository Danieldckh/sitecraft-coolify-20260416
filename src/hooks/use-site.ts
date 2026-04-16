'use client';

import { useCallback, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  SiteDTO,
  PageDTO,
  ThemeDTO,
  AssetDTO,
  ConversationDTO,
  ElementDTO,
} from '@/types/models';
import type { StylePreset } from '@/server/ai/stylePresets';
import { useEditorStore, type StreamingState } from '@/stores/editor';

async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json() as Promise<T>;
}

// ─── Sites ────────────────────────────────────────────────────────────────

export function useSites() {
  return useQuery({
    queryKey: ['sites'],
    queryFn: () => j<SiteDTO[]>('/api/sites'),
  });
}

export function useSite(id: string) {
  return useQuery({
    queryKey: ['site', id],
    queryFn: () => j<SiteDTO>(`/api/sites/${id}`),
    enabled: !!id,
  });
}

export interface CreateSiteInput {
  name: string;
  sitePrompt: string;
  stylePresetId: string;
}

export function useCreateSite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSiteInput) =>
      j<SiteDTO>('/api/sites', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sites'] }),
  });
}

export function useRenameSite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      j<{ site: SiteDTO }>(`/api/sites/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name }),
      }),
    onMutate: async ({ id, name }) => {
      await qc.cancelQueries({ queryKey: ['sites'] });
      const prev = qc.getQueryData<SiteDTO[]>(['sites']);
      if (prev) {
        qc.setQueryData<SiteDTO[]>(
          ['sites'],
          prev.map((s) => (s.id === id ? { ...s, name } : s)),
        );
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(['sites'], ctx.prev);
    },
    onSettled: (_d, _e, { id }) => {
      qc.invalidateQueries({ queryKey: ['sites'] });
      qc.invalidateQueries({ queryKey: ['site', id] });
    },
  });
}

export function useDeleteSite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => j(`/api/sites/${id}`, { method: 'DELETE' }),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ['sites'] });
      const prev = qc.getQueryData<SiteDTO[]>(['sites']);
      if (prev) qc.setQueryData<SiteDTO[]>(['sites'], prev.filter((s) => s.id !== id));
      return { prev };
    },
    onError: (_e, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(['sites'], ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['sites'] }),
  });
}

export function usePatchSite(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<SiteDTO>) =>
      j<{ site: SiteDTO }>(`/api/sites/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: ['site', id] });
      const prev = qc.getQueryData<SiteDTO>(['site', id]);
      if (prev) qc.setQueryData<SiteDTO>(['site', id], { ...prev, ...patch });
      return { prev };
    },
    onError: (_e, _p, ctx) => {
      if (ctx?.prev) qc.setQueryData(['site', id], ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['site', id] });
      qc.invalidateQueries({ queryKey: ['sites'] });
    },
  });
}

// ─── Style presets ────────────────────────────────────────────────────────

export function useStylePresets() {
  return useQuery({
    queryKey: ['style-presets'],
    queryFn: () => j<{ stylePresets: StylePreset[] }>('/api/style-presets'),
    staleTime: 60 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
  });
}

// ─── Pages ────────────────────────────────────────────────────────────────

export function usePages(siteId: string) {
  return useQuery({
    queryKey: ['pages', siteId],
    queryFn: () => j<PageDTO[]>(`/api/sites/${siteId}/pages`),
    enabled: !!siteId,
  });
}

export function usePatchPage(siteId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<PageDTO> }) =>
      j<PageDTO>(`/api/pages/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['pages', siteId] }),
  });
}

export function useAddPage(siteId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; slug: string; pagePrompt?: string }) =>
      j<PageDTO>(`/api/pages`, {
        method: 'POST',
        body: JSON.stringify({ siteId, ...body }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pages', siteId] }),
  });
}

export function useDeletePage(siteId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => j(`/api/pages/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pages', siteId] }),
  });
}

// ─── Theme ────────────────────────────────────────────────────────────────

export function useTheme(siteId: string) {
  return useQuery({
    queryKey: ['theme', siteId],
    queryFn: async () => {
      const r = await fetch(`/api/sites/${siteId}/theme`);
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
      const body = (await r.json()) as { theme: ThemeDTO };
      return body.theme;
    },
    enabled: !!siteId,
  });
}

export function useGenerateTheme(siteId: string) {
  const qc = useQueryClient();
  const setThemeStreaming = useEditorStore((s) => s.setThemeStreaming);
  return useMutation({
    mutationFn: async () => {
      setThemeStreaming(true);
      try {
        const r = await fetch(`/api/sites/${siteId}/theme/generate`, { method: 'POST' });
        if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
        const body = (await r.json()) as { theme: ThemeDTO };
        return body.theme;
      } finally {
        setThemeStreaming(false);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['theme', siteId] });
    },
  });
}

export function usePatchTheme(siteId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<ThemeDTO>) =>
      j<{ theme: ThemeDTO }>(`/api/sites/${siteId}/theme`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['theme', siteId] }),
  });
}

// ─── Assets ───────────────────────────────────────────────────────────────

export function useAssets(siteId: string) {
  return useQuery({
    queryKey: ['assets', siteId],
    queryFn: async () => {
      const r = await fetch(`/api/sites/${siteId}/assets`);
      if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
      const body = (await r.json()) as { assets: AssetDTO[] };
      return body.assets;
    },
    enabled: !!siteId,
  });
}

export function useUploadAsset(siteId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ file, kind }: { file: File; kind?: AssetDTO['kind'] }) => {
      const fd = new FormData();
      fd.append('file', file);
      if (kind) fd.append('kind', kind);
      const r = await fetch(`/api/sites/${siteId}/assets`, { method: 'POST', body: fd });
      if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
      const body = (await r.json()) as { asset: AssetDTO };
      return body.asset;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['assets', siteId] }),
  });
}

// ─── Clarifier conversation ───────────────────────────────────────────────

export function useConversation(siteId: string) {
  const ask = useMutation({
    mutationFn: ({
      scope,
      targetId,
      scopeBrief,
    }: {
      scope: 'site' | 'page' | 'element';
      targetId: string;
      scopeBrief?: string;
    }) =>
      j<{ conversation: ConversationDTO }>(`/api/sites/${siteId}/conversations`, {
        method: 'POST',
        body: JSON.stringify({ scope, targetId, scopeBrief }),
      }).then((b) => b.conversation),
  });

  const answer = useMutation({
    mutationFn: ({
      cid,
      answers,
    }: {
      cid: string;
      answers: Array<{ questionId: string; response?: string; responseAssetId?: string }>;
    }) =>
      j<{ conversation: ConversationDTO }>(`/api/sites/${siteId}/conversations/${cid}`, {
        method: 'PATCH',
        body: JSON.stringify({ answers }),
      }).then((b) => b.conversation),
  });

  return { ask, answer };
}

// ─── Page generation SSE ──────────────────────────────────────────────────

interface PageGenerateLocalState {
  status: 'idle' | 'streaming' | 'ready' | 'error';
  tokens: number;
  violations: string[];
  error: string | null;
  currentSection: string | null;
}

export function useGeneratePage(pageId: string, siteId: string) {
  const qc = useQueryClient();
  const abortRef = useRef<AbortController | null>(null);
  const setStreamingState = useEditorStore((s) => s.setStreamingState);
  const setStreamingPageId = useEditorStore((s) => s.setStreamingPageId);
  const [state, setState] = useState<PageGenerateLocalState>({
    status: 'idle',
    tokens: 0,
    violations: [],
    error: null,
    currentSection: null,
  });

  const publish = useCallback(
    (next: PageGenerateLocalState) => {
      setState(next);
      const mapped: StreamingState | null =
        next.status === 'idle'
          ? null
          : {
              pageId,
              status: next.status,
              tokensReceived: next.tokens,
              violations: next.violations,
              currentSection: next.currentSection,
              error: next.error,
            };
      setStreamingState(mapped);
      setStreamingPageId(next.status === 'streaming' ? pageId : null);
    },
    [pageId, setStreamingState, setStreamingPageId],
  );

  const start = useCallback(async () => {
    if (abortRef.current) abortRef.current.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    let local: PageGenerateLocalState = {
      status: 'streaming',
      tokens: 0,
      violations: [],
      error: null,
      currentSection: null,
    };
    publish(local);

    try {
      const r = await fetch(`/api/pages/${pageId}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
        signal: ac.signal,
      });
      if (!r.ok || !r.body) throw new Error(`${r.status} ${r.statusText}`);

      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      // Parse SSE frames. Events are either `data: …\n\n` (default event)
      // or `event: NAME\ndata: …\n\n`.
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          if (!frame.trim()) continue;
          let eventName = 'message';
          const dataLines: string[] = [];
          for (const line of frame.split('\n')) {
            if (line.startsWith('event:')) eventName = line.slice(6).trim();
            else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
          }
          const dataRaw = dataLines.join('\n');
          let payload: unknown = null;
          if (dataRaw) {
            try {
              payload = JSON.parse(dataRaw);
            } catch {
              payload = dataRaw;
            }
          }

          if (eventName === 'message') {
            // default `data: {delta:"..."}` frame from generate route.
            const delta =
              payload && typeof payload === 'object' && 'delta' in payload
                ? String((payload as { delta: unknown }).delta ?? '')
                : typeof payload === 'string'
                  ? payload
                  : '';
            if (delta) {
              local = { ...local, tokens: local.tokens + Math.max(1, Math.ceil(delta.length / 4)) };
              // Heuristic: extract section name hint if present.
              const m = /<section[^>]*data-section="([^"]+)"/i.exec(delta);
              if (m) local = { ...local, currentSection: m[1] };
              publish(local);
            }
          } else if (eventName === 'final') {
            if (payload && typeof payload === 'object' && 'sections' in payload) {
              const n = (payload as { sections: number }).sections;
              local = { ...local, currentSection: `${n} sections` };
              publish(local);
            }
          } else if (eventName === 'violation') {
            const phrases =
              payload && typeof payload === 'object' && 'phrases' in payload
                ? ((payload as { phrases: string[] }).phrases ?? [])
                : [];
            local = { ...local, violations: [...local.violations, ...phrases] };
            publish(local);
          } else if (eventName === 'error') {
            const message =
              payload && typeof payload === 'object' && 'message' in payload
                ? String((payload as { message: unknown }).message)
                : 'Generation failed';
            local = { ...local, status: 'error', error: message };
            publish(local);
          } else if (eventName === 'done') {
            local = { ...local, status: 'ready' };
            publish(local);
          }
        }
      }

      if (local.status === 'streaming') {
        local = { ...local, status: 'ready' };
        publish(local);
      }

      await qc.invalidateQueries({ queryKey: ['pages', siteId] });
      await qc.invalidateQueries({ queryKey: ['page', pageId] });
    } catch (e: unknown) {
      if (ac.signal.aborted) {
        publish({ ...local, status: 'idle' });
        return;
      }
      const message = e instanceof Error ? e.message : 'Generation failed';
      publish({ ...local, status: 'error', error: message });
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
    }
  }, [pageId, siteId, publish, qc]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  return { start, stop, state };
}

// ─── Elements ─────────────────────────────────────────────────────────────

export function useElements(pageId: string) {
  return useQuery({
    queryKey: ['elements', pageId],
    queryFn: async () => {
      const r = await fetch(`/api/pages/${pageId}/elements`);
      if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
      const body = (await r.json()) as { elements: ElementDTO[] };
      return body.elements;
    },
    enabled: !!pageId,
  });
}

export interface UpsertElementInput {
  selectorId: string;
  role?: string;
  variantId?: string;
  prompt?: string;
  html?: string;
  css?: string;
  force?: boolean;
}

export function useUpsertElement(pageId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpsertElementInput) => {
      const r = await fetch(`/api/pages/${pageId}/elements`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
      const body = (await r.json()) as { element: ElementDTO };
      return body.element;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['elements', pageId] }),
  });
}

export function usePatchElement(pageId: string, elementId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: {
      html?: string;
      css?: string;
      locked?: boolean;
      force?: boolean;
    }) => {
      const r = await fetch(`/api/pages/${pageId}/elements/${elementId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
      const body = (await r.json()) as { element: ElementDTO };
      return body.element;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['elements', pageId] });
    },
  });
}

export interface ElementEditState {
  status: 'idle' | 'streaming' | 'ready' | 'error';
  tokens: number;
  error: string | null;
  element: ElementDTO | null;
}

export function useEditElement(pageId: string, elementId: string) {
  const qc = useQueryClient();
  const abortRef = useRef<AbortController | null>(null);
  const [state, setState] = useState<ElementEditState>({
    status: 'idle',
    tokens: 0,
    error: null,
    element: null,
  });

  const start = useCallback(
    async (instruction: string) => {
      if (abortRef.current) abortRef.current.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      let local: ElementEditState = {
        status: 'streaming',
        tokens: 0,
        error: null,
        element: null,
      };
      setState(local);

      try {
        const r = await fetch(
          `/api/pages/${pageId}/elements/${elementId}/edit`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ instruction }),
            signal: ac.signal,
          },
        );
        if (!r.ok || !r.body) throw new Error(`${r.status} ${r.statusText}`);

        const reader = r.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buf.indexOf('\n\n')) !== -1) {
            const frame = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            if (!frame.trim()) continue;
            let eventName = 'message';
            const dataLines: string[] = [];
            for (const line of frame.split('\n')) {
              if (line.startsWith('event:')) eventName = line.slice(6).trim();
              else if (line.startsWith('data:'))
                dataLines.push(line.slice(5).trim());
            }
            const dataRaw = dataLines.join('\n');
            let payload: unknown = null;
            if (dataRaw) {
              try {
                payload = JSON.parse(dataRaw);
              } catch {
                payload = dataRaw;
              }
            }

            if (eventName === 'message') {
              const delta =
                payload &&
                typeof payload === 'object' &&
                'delta' in payload
                  ? String((payload as { delta: unknown }).delta ?? '')
                  : '';
              if (delta) {
                local = {
                  ...local,
                  tokens:
                    local.tokens + Math.max(1, Math.ceil(delta.length / 4)),
                };
                setState(local);
              }
            } else if (eventName === 'error') {
              const message =
                payload &&
                typeof payload === 'object' &&
                'message' in payload
                  ? String((payload as { message: unknown }).message)
                  : 'Edit failed';
              local = { ...local, status: 'error', error: message };
              setState(local);
            } else if (eventName === 'done') {
              const element =
                payload &&
                typeof payload === 'object' &&
                'element' in payload
                  ? ((payload as { element: ElementDTO }).element ?? null)
                  : null;
              local = { ...local, status: 'ready', element };
              setState(local);
            }
          }
        }

        await qc.invalidateQueries({ queryKey: ['elements', pageId] });
      } catch (e: unknown) {
        if (ac.signal.aborted) {
          setState({ ...local, status: 'idle' });
          return;
        }
        const message = e instanceof Error ? e.message : 'Edit failed';
        setState({ ...local, status: 'error', error: message });
      } finally {
        if (abortRef.current === ac) abortRef.current = null;
      }
    },
    [pageId, elementId, qc],
  );

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState({ status: 'idle', tokens: 0, error: null, element: null });
  }, []);

  return { start, reset, state };
}
