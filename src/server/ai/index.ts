import type { SectionType } from '@/types/models';
import { regenerateSitemap as _regenerateSitemap } from './sitemap';
import {
  regenerateSections as _regenerateSections,
  generateSection as _generateSection,
  type GeneratedCode,
} from './sections';
import { analyzeImage as _analyzeImage } from './vision';
import { streamGenerateSection as _streamGenerateSection } from './stream';
import {
  appendMemory as _appendMemory,
  buildSiteContext as _buildSiteContext,
} from './memory';

export interface SitemapInput {
  sitePrompt: string;
  memorySummary: string;
  existingPages: { slug: string; name: string; locked: boolean; pagePrompt?: string }[];
}

export interface SectionPlanInput {
  pagePrompt: string;
  siteContext: string;
  existingSections: { type: string; locked: boolean; sectionPrompt?: string; orderIdx?: number }[];
}

export interface GenerateSectionInput {
  sectionPrompt: string;
  siteContext: string;
  referenceImageUrl?: string | null;
}

export interface AnalyzeImageInput {
  imageUrl: string;
  sectionPrompt: string;
  siteContext: string;
}

export type { GeneratedCode };

export interface StreamEmit {
  (event: 'delta' | 'done' | 'error', data: unknown): void;
}

export async function regenerateSitemap(
  input: SitemapInput,
): Promise<{ name: string; slug: string; pagePrompt: string }[]> {
  return _regenerateSitemap({
    sitePrompt: input.sitePrompt,
    memorySummary: input.memorySummary,
    existingPages: input.existingPages.map((p) => ({
      name: p.name,
      slug: p.slug,
      pagePrompt: p.pagePrompt ?? '',
      locked: p.locked,
    })),
  });
}

export async function regenerateSections(
  input: SectionPlanInput,
): Promise<{ type: SectionType; sectionPrompt: string }[]> {
  return _regenerateSections({
    pagePrompt: input.pagePrompt,
    siteContext: input.siteContext,
    existingSections: input.existingSections.map((s, i) => ({
      type: (s.type as SectionType) ?? 'custom',
      sectionPrompt: s.sectionPrompt ?? '',
      locked: s.locked,
      orderIdx: s.orderIdx ?? i,
    })),
  });
}

export async function generateSection(input: GenerateSectionInput): Promise<GeneratedCode> {
  return _generateSection(input);
}

export async function analyzeImage(input: AnalyzeImageInput): Promise<GeneratedCode> {
  return _analyzeImage(input);
}

export async function streamGenerateSection(
  _sectionId: string,
  params: GenerateSectionInput,
  emit: StreamEmit,
): Promise<void> {
  await _streamGenerateSection({
    section: {
      sectionPrompt: params.sectionPrompt,
      referenceImageUrl: params.referenceImageUrl ?? null,
    },
    siteContext: params.siteContext,
    emit: (event) => {
      if (event.type === 'partial') emit('delta', { delta: event.delta });
      else if (event.type === 'final')
        emit('done', { html: event.html, css: event.css, js: event.js });
      else if (event.type === 'error') emit('error', { message: event.message });
    },
  });
}

export async function appendMemory(
  siteId: string,
  entry: { role: 'system' | 'user' | 'ai'; kind: string; content: string },
): Promise<void> {
  await _appendMemory(siteId, {
    role: entry.role,
    kind: entry.kind as 'change_request' | 'decision' | 'generation' | 'vision',
    content: entry.content,
  });
}

export async function buildSiteContext(
  siteId: string,
): Promise<{ memorySummary: string; recentEntries: { role: string; kind: string; content: string }[] }> {
  const ctx = await _buildSiteContext(siteId);
  return {
    memorySummary: ctx.memorySummary,
    recentEntries: ctx.recentEntries.map((e) => ({
      role: e.role,
      kind: e.kind,
      content: e.content,
    })),
  };
}

export {
  SITE_SYSTEM_PROMPT,
  PAGE_SYSTEM_PROMPT,
  SECTION_SYSTEM_PROMPT,
  DEFAULT_SECTION_PROMPTS,
} from './prompts';
