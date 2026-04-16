// Shared types across server/client. Impl-A owns this file.
// Implementer agents B, C, D, E are read-only on this module.

export type SectionType =
  | 'header'
  | 'hero'
  | 'features'
  | 'cta'
  | 'footer'
  | 'gallery'
  | 'testimonials'
  | 'pricing'
  | 'faq'
  | 'contact'
  | 'custom';

export const DEFAULT_SECTION_TYPES: SectionType[] = [
  'header',
  'hero',
  'features',
  'cta',
  'footer',
];

export type GenerationStatus = 'idle' | 'queued' | 'generating' | 'ready' | 'error';

export interface SiteDTO {
  id: string;
  name: string;
  sitePrompt: string;
  domain: string | null;
  locked: boolean;
  memorySummary: string;
  createdAt: string;
  updatedAt: string;
}

export interface PageDTO {
  id: string;
  siteId: string;
  name: string;
  slug: string;
  pagePrompt: string;
  locked: boolean;
  orderIdx: number;
  navVisible: boolean;
}

export interface SectionDTO {
  id: string;
  pageId: string;
  type: SectionType;
  sectionPrompt: string;
  locked: boolean;
  orderIdx: number;
  html: string;
  css: string;
  js: string;
  referenceImageUrl: string | null;
  lastGeneratedAt: string | null;
}

export interface ChangeLogDTO {
  id: string;
  siteId: string;
  scope: 'site' | 'page' | 'section';
  targetId: string;
  actor: string;
  summary: string;
  diffJson: string;
  createdAt: string;
}

export interface DeploymentDTO {
  id: string;
  siteId: string;
  coolifyAppUuid: string | null;
  deploymentUuid: string | null;
  url: string | null;
  status: 'pending' | 'building' | 'deploying' | 'success' | 'failed';
  logs: string;
  createdAt: string;
  updatedAt: string;
}
