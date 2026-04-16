import { prisma } from '@/server/db/client';
import {
  regenerateSitemap,
  regenerateSections,
  generateSection,
  appendMemory,
  buildSiteContext,
} from '@/server/ai';
import { logChange } from './changelog';
import { uniquePageSlug } from './slug';
import type { SectionType } from '@/types/models';
import { DEFAULT_SECTION_TYPES } from '@/types/models';

export async function regenerateSitemapFor(siteId: string): Promise<void> {
  const site = await prisma.site.findUnique({ where: { id: siteId }, include: { pages: true } });
  if (!site) throw new Error(`Site ${siteId} not found`);

  const ctx = await buildSiteContext(siteId);

  const proposed = await regenerateSitemap({
    sitePrompt: site.sitePrompt,
    memorySummary: ctx.memorySummary,
    existingPages: site.pages.map((p) => ({ slug: p.slug, name: p.name, locked: p.locked })),
  });

  const lockedSlugs = new Set(site.pages.filter((p) => p.locked).map((p) => p.slug));
  const existingBySlug = new Map(site.pages.map((p) => [p.slug, p]));
  const proposedSlugs = new Set(proposed.map((p) => p.slug));

  // Remove unlocked pages no longer proposed.
  const toRemove = site.pages.filter((p) => !p.locked && !proposedSlugs.has(p.slug));
  for (const p of toRemove) {
    await prisma.page.delete({ where: { id: p.id } });
  }

  // Add/update proposed pages.
  const touched: string[] = [];
  let orderIdx = 0;
  for (const proposal of proposed) {
    if (lockedSlugs.has(proposal.slug)) {
      orderIdx++;
      continue;
    }
    const existing = existingBySlug.get(proposal.slug);
    if (existing) {
      const updated = await prisma.page.update({
        where: { id: existing.id },
        data: { name: proposal.name, pagePrompt: proposal.pagePrompt, orderIdx },
      });
      if (existing.pagePrompt !== proposal.pagePrompt) touched.push(updated.id);
    } else {
      const slug = await uniquePageSlug(siteId, proposal.slug);
      const created = await prisma.page.create({
        data: {
          siteId,
          slug,
          name: proposal.name,
          pagePrompt: proposal.pagePrompt,
          orderIdx,
        },
      });
      touched.push(created.id);
    }
    orderIdx++;
  }

  await logChange({
    siteId,
    scope: 'site',
    targetId: siteId,
    summary: `Regenerated sitemap (${proposed.length} pages)`,
    before: site.pages.map((p) => ({ slug: p.slug, name: p.name, locked: p.locked })),
    after: proposed,
  });

  await appendMemory(siteId, {
    role: 'ai',
    kind: 'generation',
    content: `Sitemap regenerated: ${proposed.map((p) => p.slug).join(', ')}`,
  });

  for (const pageId of touched) {
    await regeneratePageFor(pageId);
  }
}

export async function regeneratePageFor(pageId: string): Promise<void> {
  const page = await prisma.page.findUnique({
    where: { id: pageId },
    include: { sections: true, site: true },
  });
  if (!page) throw new Error(`Page ${pageId} not found`);
  if (page.locked) return;

  const ctx = await buildSiteContext(page.siteId);

  const proposed = await regenerateSections({
    pagePrompt: page.pagePrompt,
    siteContext: `${ctx.memorySummary}\nSite: ${page.site.sitePrompt}`,
    existingSections: page.sections.map((s) => ({ type: s.type, locked: s.locked })),
  });

  const lockedTypes = new Set(page.sections.filter((s) => s.locked).map((s) => s.type));
  const existingByType = new Map(page.sections.map((s) => [s.type, s]));
  const proposedTypes = new Set<string>(proposed.map((p) => p.type));

  const toRemove = page.sections.filter((s) => !s.locked && !proposedTypes.has(s.type));
  for (const s of toRemove) {
    await prisma.section.delete({ where: { id: s.id } });
  }

  const touched: string[] = [];
  let orderIdx = 0;
  for (const proposal of proposed) {
    if (lockedTypes.has(proposal.type)) {
      orderIdx++;
      continue;
    }
    const existing = existingByType.get(proposal.type);
    if (existing) {
      await prisma.section.update({
        where: { id: existing.id },
        data: { sectionPrompt: proposal.sectionPrompt, orderIdx },
      });
      if (existing.sectionPrompt !== proposal.sectionPrompt) touched.push(existing.id);
    } else {
      const created = await prisma.section.create({
        data: {
          pageId,
          type: proposal.type,
          sectionPrompt: proposal.sectionPrompt,
          orderIdx,
        },
      });
      touched.push(created.id);
    }
    orderIdx++;
  }

  await logChange({
    siteId: page.siteId,
    scope: 'page',
    targetId: pageId,
    summary: `Regenerated sections on ${page.slug} (${proposed.length})`,
    before: page.sections.map((s) => ({ type: s.type, locked: s.locked })),
    after: proposed,
  });

  await appendMemory(page.siteId, {
    role: 'ai',
    kind: 'generation',
    content: `Sections regenerated on ${page.slug}: ${proposed.map((p) => p.type).join(', ')}`,
  });

  for (const sectionId of touched) {
    await regenerateSectionFor(sectionId);
  }
}

export async function regenerateSectionFor(sectionId: string): Promise<void> {
  const section = await prisma.section.findUnique({
    where: { id: sectionId },
    include: { page: { include: { site: true } } },
  });
  if (!section) throw new Error(`Section ${sectionId} not found`);
  if (section.locked) return;

  const siteId = section.page.siteId;
  const ctx = await buildSiteContext(siteId);

  const result = await generateSection({
    sectionPrompt: section.sectionPrompt,
    siteContext: `${ctx.memorySummary}\nSite: ${section.page.site.sitePrompt}\nPage: ${section.page.pagePrompt}`,
    referenceImageUrl: section.referenceImageUrl,
  });

  const before = { html: section.html, css: section.css, js: section.js };

  await prisma.section.update({
    where: { id: sectionId },
    data: {
      html: result.html,
      css: result.css,
      js: result.js,
      lastGeneratedAt: new Date(),
    },
  });

  await logChange({
    siteId,
    scope: 'section',
    targetId: sectionId,
    summary: `Generated ${section.type} section`,
    before,
    after: result,
  });

  await appendMemory(siteId, {
    role: 'ai',
    kind: 'generation',
    content: `Generated ${section.type} section (${result.html.length} chars html)`,
  });
}

export function ensureDefaultSections(): SectionType[] {
  return [...DEFAULT_SECTION_TYPES];
}
