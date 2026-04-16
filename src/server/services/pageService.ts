import { prisma } from '@/server/db/client';
import { randomUUID } from 'node:crypto';
import { streamGeneratePage, type PageStreamEvent } from '@/server/ai/pageGen';
import { appendMemory } from '@/server/ai/memory';
import { logChange } from './changelog';
import { enforceLock } from './locks';
import { withSiteLock } from './mutex';
import { toPageDTO, toThemeDTO } from '@/server/db/mappers';
import type { PageDTO } from '@/types/models';

export interface GeneratePageOptions {
  signal?: AbortSignal;
  onEvent?: (event: PageStreamEvent) => void;
  force?: boolean;
}

export async function generatePage(
  pageId: string,
  opts: GeneratePageOptions = {},
): Promise<PageDTO> {
  const page = await prisma.page.findUnique({
    where: { id: pageId },
    include: { site: true },
  });
  if (!page) throw new Error(`Page ${pageId} not found`);
  enforceLock(page, opts.force, 'Page');

  const themeRow = await prisma.theme.findUnique({ where: { siteId: page.siteId } });
  if (!themeRow) throw new Error(`Site ${page.siteId} has no theme — generate theme first`);
  const theme = toThemeDTO(themeRow);

  return withSiteLock(page.siteId, async () => {
    const before = { html: page.pageHtml, css: page.pageCss, sections: await prisma.element.count({ where: { pageId } }) };
    const result = await streamGeneratePage({
      pageBrief: { name: page.name, slug: page.slug, pagePrompt: page.pagePrompt },
      siteBrief: page.site.sitePrompt,
      theme,
      emit: (event) => opts.onEvent?.(event),
      signal: opts.signal,
    });

    // Replace all non-locked elements for the page. Preserve locked ones by
    // selectorId; keep their html/css and do not overwrite.
    const existing = await prisma.element.findMany({ where: { pageId } });
    const lockedBySelector = new Map(
      existing.filter((e) => e.locked).map((e) => [e.selectorId, e]),
    );

    await prisma.$transaction(async (tx) => {
      // Delete unlocked existing elements.
      await tx.element.deleteMany({ where: { pageId, locked: false } });

      await tx.page.update({
        where: { id: pageId },
        data: {
          pageHtml: result.html,
          pageCss: result.css ?? '',
          pageJs: result.js ?? '',
          lastGeneratedAt: new Date(),
        },
      });

      for (const s of result.sections) {
        // If a locked element had this selectorId, skip (keep locked content).
        if (lockedBySelector.has(s.selectorId)) continue;
        // If a non-locked element of same selectorId somehow survived, update.
        // Otherwise create fresh. Selector collision is rare given cuids.
        const finalId = lockedBySelector.has(s.selectorId)
          ? `sc-el-${randomUUID().slice(0, 8)}`
          : s.selectorId;
        await tx.element.create({
          data: {
            pageId,
            selectorId: finalId,
            role: s.role,
            variantId: s.variantId,
            prompt: s.prompt ?? '',
            html: '',
            css: '',
          },
        });
      }
    });

    await logChange({
      siteId: page.siteId,
      scope: 'page',
      targetId: pageId,
      summary: `Generated page ${page.slug} (${result.sections.length} sections)`,
      before,
      after: { sections: result.sections.map((s) => `${s.role}:${s.variantId}`) },
    });
    await appendMemory(page.siteId, {
      role: 'ai',
      kind: 'page',
      content: `Generated ${page.slug}: ${result.sections.map((s) => s.variantId).join(', ')}`,
    });

    const fresh = await prisma.page.findUniqueOrThrow({ where: { id: pageId } });
    return toPageDTO(fresh);
  });
}
