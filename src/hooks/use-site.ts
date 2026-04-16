'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { SiteDTO, PageDTO, SectionDTO, SectionType } from '@/types/models';

async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json() as Promise<T>;
}

export function useSite(id: string) {
  return useQuery({
    queryKey: ['site', id],
    queryFn: () => j<SiteDTO>(`/api/sites/${id}`),
    enabled: !!id,
  });
}

export function usePages(siteId: string) {
  return useQuery({
    queryKey: ['pages', siteId],
    queryFn: () => j<PageDTO[]>(`/api/sites/${siteId}/pages`),
    enabled: !!siteId,
  });
}

export function useSections(siteId: string) {
  return useQuery({
    queryKey: ['sections', siteId],
    queryFn: () => j<SectionDTO[]>(`/api/sites/${siteId}/sections`),
    enabled: !!siteId,
  });
}

export function usePatchSite(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<SiteDTO>) =>
      j<SiteDTO>(`/api/sites/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: ['site', id] });
      const prev = qc.getQueryData<SiteDTO>(['site', id]);
      if (prev) qc.setQueryData<SiteDTO>(['site', id], { ...prev, ...patch });
      return { prev };
    },
    onError: (_e, _p, ctx) => {
      if (ctx?.prev) qc.setQueryData(['site', id], ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['site', id] }),
  });
}

export function usePatchPage(siteId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<PageDTO> }) =>
      j<PageDTO>(`/api/pages/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: ['pages', siteId] });
      const prev = qc.getQueryData<PageDTO[]>(['pages', siteId]);
      if (prev) {
        qc.setQueryData<PageDTO[]>(
          ['pages', siteId],
          prev.map((p) => (p.id === id ? { ...p, ...patch } : p)),
        );
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(['pages', siteId], ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['pages', siteId] }),
  });
}

export function usePatchSection(siteId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<SectionDTO> }) =>
      j<SectionDTO>(`/api/sections/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: ['sections', siteId] });
      const prev = qc.getQueryData<SectionDTO[]>(['sections', siteId]);
      if (prev) {
        qc.setQueryData<SectionDTO[]>(
          ['sections', siteId],
          prev.map((s) => (s.id === id ? { ...s, ...patch } : s)),
        );
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(['sections', siteId], ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['sections', siteId] }),
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pages', siteId] });
      qc.invalidateQueries({ queryKey: ['sections', siteId] });
    },
  });
}

export function useAddSection(siteId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { pageId: string; type: SectionType; sectionPrompt?: string }) =>
      j<SectionDTO>(`/api/sections`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sections', siteId] }),
  });
}

export function useDeletePage(siteId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => j(`/api/pages/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pages', siteId] });
      qc.invalidateQueries({ queryKey: ['sections', siteId] });
    },
  });
}

export function useDeleteSection(siteId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => j(`/api/sections/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sections', siteId] }),
  });
}

export function useInvalidateSection(siteId: string) {
  const qc = useQueryClient();
  return (_id: string) => qc.invalidateQueries({ queryKey: ['sections', siteId] });
}
