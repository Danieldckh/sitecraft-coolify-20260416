import { z } from 'zod';
import { zodResponseFormat } from 'openai/helpers/zod';
import { getOpenAI, withRetry } from './client';
import { PAGE_SYSTEM_PROMPT, SECTION_SYSTEM_PROMPT } from './prompts';
import { resolveImageUrlForOpenAI } from './imageUrl';
import type { SectionType } from '../../types/models';

const SECTION_TYPES = [
  'header',
  'hero',
  'features',
  'cta',
  'footer',
  'gallery',
  'testimonials',
  'pricing',
  'faq',
  'contact',
  'custom',
] as const;

const SectionItemSchema = z.object({
  type: z.enum(SECTION_TYPES),
  sectionPrompt: z.string().min(1),
});
const SectionListSchema = z.object({ sections: z.array(SectionItemSchema) });

export type GeneratedSection = { type: SectionType; sectionPrompt: string };

export interface RegenerateSectionsInput {
  pagePrompt: string;
  siteContext: string;
  existingSections: Array<{ type: SectionType; sectionPrompt: string; locked: boolean; orderIdx: number }>;
}

export async function regenerateSections(
  input: RegenerateSectionsInput,
): Promise<GeneratedSection[]> {
  const { pagePrompt, siteContext, existingSections } = input;
  const locked = existingSections.filter((s) => s.locked);
  const lockedBlock = locked.length
    ? `Locked sections (preserve exactly at their orderIdx, do not alter type or prompt):\n${locked
        .map(
          (s) =>
            `- orderIdx=${s.orderIdx} type=${s.type} sectionPrompt=${JSON.stringify(s.sectionPrompt)}`,
        )
        .join('\n')}`
    : 'Locked sections: none.';

  const openai = getOpenAI();
  const completion = await withRetry(() =>
    openai.beta.chat.completions.parse({
      model: 'gpt-4o-2024-08-06',
      messages: [
        { role: 'system', content: PAGE_SYSTEM_PROMPT },
        { role: 'system', content: `Site context:\n${siteContext || '(none)'}` },
        { role: 'system', content: lockedBlock },
        { role: 'user', content: pagePrompt || '(no page prompt provided)' },
      ],
      response_format: zodResponseFormat(SectionListSchema, 'section_list'),
    }),
  );

  const parsed = completion.choices[0]?.message.parsed;
  if (!parsed) throw new Error('Section generation returned no structured output');
  return parsed.sections as GeneratedSection[];
}

export interface GenerateSectionInput {
  sectionPrompt: string;
  siteContext: string;
  referenceImageUrl?: string | null;
}

export interface GeneratedCode {
  html: string;
  css: string;
  js: string;
}

export async function generateSection(input: GenerateSectionInput): Promise<GeneratedCode> {
  const { sectionPrompt, siteContext, referenceImageUrl } = input;
  const openai = getOpenAI();

  const resolvedImageUrl = referenceImageUrl
    ? await resolveImageUrlForOpenAI(referenceImageUrl)
    : null;
  const userContent: OpenAIUserContent = resolvedImageUrl
    ? [
        { type: 'text', text: sectionPrompt },
        { type: 'image_url', image_url: { url: resolvedImageUrl, detail: 'high' } },
      ]
    : sectionPrompt;

  const res = await withRetry(() =>
    openai.chat.completions.create({
      model: 'gpt-4o',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SECTION_SYSTEM_PROMPT },
        { role: 'system', content: `Site context:\n${siteContext || '(none)'}` },
        { role: 'user', content: userContent as never },
      ],
    }),
  );

  const raw = res.choices[0]?.message?.content;
  if (!raw) throw new Error('Section generation returned empty content');
  return parseGeneratedCode(raw);
}

type OpenAIUserContent =
  | string
  | Array<
      | { type: 'text'; text: string }
      | { type: 'image_url'; image_url: { url: string; detail?: 'low' | 'high' | 'auto' } }
    >;

export function parseGeneratedCode(raw: string): GeneratedCode {
  let text = raw.trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  }
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch (err) {
    throw new Error(`Failed to parse generated JSON: ${(err as Error).message}`);
  }
  const o = obj as { html?: unknown; css?: unknown; js?: unknown };
  return {
    html: typeof o.html === 'string' ? o.html : '',
    css: typeof o.css === 'string' ? o.css : '',
    js: typeof o.js === 'string' ? o.js : '',
  };
}
