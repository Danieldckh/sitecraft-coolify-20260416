import type { Site, Page, Section, ChangeLogEntry, Deployment, MemoryEntry } from '@prisma/client';
import type {
  SiteDTO, PageDTO, SectionDTO, ChangeLogDTO, DeploymentDTO, SectionType,
} from '@/types/models';

export function toSiteDTO(s: Site): SiteDTO {
  return {
    id: s.id,
    name: s.name,
    sitePrompt: s.sitePrompt,
    domain: s.domain,
    locked: s.locked,
    memorySummary: s.memorySummary,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

export function toPageDTO(p: Page): PageDTO {
  return {
    id: p.id,
    siteId: p.siteId,
    name: p.name,
    slug: p.slug,
    pagePrompt: p.pagePrompt,
    locked: p.locked,
    orderIdx: p.orderIdx,
    navVisible: p.navVisible,
  };
}

export function toSectionDTO(s: Section): SectionDTO {
  return {
    id: s.id,
    pageId: s.pageId,
    type: s.type as SectionType,
    sectionPrompt: s.sectionPrompt,
    locked: s.locked,
    orderIdx: s.orderIdx,
    html: s.html,
    css: s.css,
    js: s.js,
    referenceImageUrl: s.referenceImageUrl,
    lastGeneratedAt: s.lastGeneratedAt?.toISOString() ?? null,
  };
}

export function toChangeLogDTO(c: ChangeLogEntry): ChangeLogDTO {
  return {
    id: c.id,
    siteId: c.siteId,
    scope: c.scope as ChangeLogDTO['scope'],
    targetId: c.targetId,
    actor: c.actor,
    summary: c.summary,
    diffJson: c.diffJson,
    createdAt: c.createdAt.toISOString(),
  };
}

export function toDeploymentDTO(d: Deployment): DeploymentDTO {
  return {
    id: d.id,
    siteId: d.siteId,
    coolifyAppUuid: d.coolifyAppUuid,
    deploymentUuid: d.deploymentUuid,
    url: d.url,
    status: d.status as DeploymentDTO['status'],
    logs: d.logs,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

export function toMemoryEntry(m: MemoryEntry) {
  return {
    id: m.id,
    siteId: m.siteId,
    role: m.role,
    kind: m.kind,
    content: m.content,
    createdAt: m.createdAt.toISOString(),
  };
}
