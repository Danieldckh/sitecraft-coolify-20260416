import { prisma } from '@/server/db/client';
import { streamEditElement, type ElementStreamEvent } from '@/server/ai/elementEdit';
import { appendMemory } from '@/server/ai/memory';
import { logChange } from './changelog';
import { enforceElementLock, enforceLock } from './locks';
import { withSiteLock } from './mutex';
import { toElementDTO, toThemeDTO } from '@/server/db/mappers';
import type { ElementDTO } from '@/types/models';

export interface EditElementOptions {
  signal?: AbortSignal;
  onEvent?: (event: ElementStreamEvent) => void;
  force?: boolean;
}

export async function editElement(
  pageId: string,
  elementId: string,
  instruction: string,
  opts: EditElementOptions = {},
): Promise<ElementDTO> {
  const element = await prisma.element.findFirst({
    where: { id: elementId, pageId },
    include: { page: { include: { site: true } } },
  });
  if (!element) throw new Error(`Element ${elementId} not found on page ${pageId}`);
  enforceElementLock(element, opts.force);

  const themeRow = await prisma.theme.findUnique({ where: { siteId: element.page.siteId } });
  if (!themeRow) throw new Error('Site has no theme');
  const theme = toThemeDTO(themeRow);

  return withSiteLock(element.page.siteId, async () => {
    const before = { html: element.html, css: element.css };
    const result = await streamEditElement({
      element: {
        selectorId: element.selectorId,
        role: element.role,
        variantId: element.variantId,
        html: element.html,
        css: element.css,
      },
      instruction,
      theme,
      emit: (event) => opts.onEvent?.(event),
      signal: opts.signal,
    });

    const updated = await prisma.element.update({
      where: { id: elementId },
      data: {
        html: result.html,
        css: result.css ?? '',
        lastEditedAt: new Date(),
      },
    });

    await logChange({
      siteId: element.page.siteId,
      scope: 'element',
      targetId: elementId,
      summary: `Edited ${element.role} element (${element.selectorId})`,
      before,
      after: { html: result.html, css: result.css },
    });
    await appendMemory(element.page.siteId, {
      role: 'ai',
      kind: 'element',
      content: `Edited ${element.selectorId} on ${element.page.slug}: ${instruction.slice(0, 120)}`,
    });

    return toElementDTO(updated);
  });
}

export interface UpsertElementInput {
  selectorId: string;
  role?: string;
  variantId?: string;
  prompt?: string;
  html?: string;
  css?: string;
}

export async function upsertElementBySelector(
  pageId: string,
  data: UpsertElementInput,
  opts: { force?: boolean } = {},
): Promise<ElementDTO> {
  const page = await prisma.page.findUnique({
    where: { id: pageId },
    include: { site: true },
  });
  if (!page) throw new Error(`Page ${pageId} not found`);
  enforceLock(page, opts.force, 'Page');

  return withSiteLock(page.siteId, async () => {
    const existing = await prisma.element.findUnique({
      where: { pageId_selectorId: { pageId, selectorId: data.selectorId } },
    });
    if (existing) {
      enforceElementLock(existing, opts.force);
      const updated = await prisma.element.update({
        where: { id: existing.id },
        data: {
          ...(data.role !== undefined ? { role: data.role } : {}),
          ...(data.variantId !== undefined ? { variantId: data.variantId } : {}),
          ...(data.prompt !== undefined ? { prompt: data.prompt } : {}),
          ...(data.html !== undefined ? { html: data.html } : {}),
          ...(data.css !== undefined ? { css: data.css } : {}),
          lastEditedAt: new Date(),
        },
      });
      return toElementDTO(updated);
    }
    const created = await prisma.element.create({
      data: {
        pageId,
        selectorId: data.selectorId,
        role: data.role ?? 'custom',
        variantId: data.variantId ?? '',
        prompt: data.prompt ?? '',
        html: data.html ?? '',
        css: data.css ?? '',
      },
    });
    await logChange({
      siteId: page.siteId,
      scope: 'element',
      targetId: created.id,
      summary: `Materialized element ${created.selectorId} on ${page.slug}`,
      after: { selectorId: created.selectorId, role: created.role },
    });
    return toElementDTO(created);
  });
}

export async function patchElementDirect(
  pageId: string,
  elementId: string,
  patch: Partial<{ html: string; css: string; locked: boolean }>,
  opts: { force?: boolean } = {},
): Promise<ElementDTO> {
  const element = await prisma.element.findFirst({
    where: { id: elementId, pageId },
    include: { page: true },
  });
  if (!element) throw new Error('Element not found');
  if (patch.html !== undefined || patch.css !== undefined) {
    enforceElementLock(element, opts.force);
  }
  return withSiteLock(element.page.siteId, async () => {
    const updated = await prisma.element.update({
      where: { id: elementId },
      data: {
        ...(patch.html !== undefined ? { html: patch.html } : {}),
        ...(patch.css !== undefined ? { css: patch.css } : {}),
        ...(patch.locked !== undefined ? { locked: patch.locked } : {}),
        lastEditedAt: new Date(),
      },
    });
    await logChange({
      siteId: element.page.siteId,
      scope: 'element',
      targetId: elementId,
      summary: `Patched element ${element.selectorId}`,
      before: { html: element.html, css: element.css, locked: element.locked },
      after: patch,
    });
    return toElementDTO(updated);
  });
}
