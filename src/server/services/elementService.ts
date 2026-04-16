import { prisma } from '@/server/db/client';
import { streamEditElement, type ElementStreamEvent } from '@/server/ai/elementEdit';
import { appendMemory } from '@/server/ai/memory';
import { logChange } from './changelog';
import { enforceElementLock } from './locks';
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
