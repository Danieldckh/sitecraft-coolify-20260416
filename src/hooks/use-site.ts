'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { SiteDTO, PageDTO, SectionDTO } from '@/types/models';
import type { StylePreset } from '@/server/ai/stylePresets';

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
    staleTime: 60 * 60 * 1000, // 1 hour
    gcTime: 24 * 60 * 60 * 1000,
  });
}

// ─── Pages (kept for M3 editor; do not extend here) ───────────────────────

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

// ─── Section hooks (DEPRECATED — v1 dead code) ────────────────────────────
// TODO(m3): the legacy editor under src/components/editor still imports these.
// They will be deleted together with that editor in Milestone 3. Kept as
// no-op stubs so the build stays green until then. Do NOT wire these up to
// anything new.

export function useSections(_siteId: string) {
  return useQuery<SectionDTO[]>({
    queryKey: ['sections', _siteId, 'deprecated'],
    queryFn: async () => [],
    enabled: false,
  });
}

export function useAddSection(_siteId: string) {
  return useMutation({
    mutationFn: async (_body: unknown): Promise<SectionDTO> => {
      throw new Error('useAddSection is deprecated in v2');
    },
  });
}

export function useDeleteSection(_siteId: string) {
  return useMutation({
    mutationFn: async (_id: string): Promise<void> => {
      throw new Error('useDeleteSection is deprecated in v2');
    },
  });
}

export function usePatchSection(_siteId: string) {
  return useMutation({
    mutationFn: async (_v: { id: string; patch: Partial<SectionDTO> }): Promise<SectionDTO> => {
      throw new Error('usePatchSection is deprecated in v2');
    },
  });
}

export function useInvalidateSection(_siteId: string) {
  return (_id: string) => {
    /* no-op */
  };
}
