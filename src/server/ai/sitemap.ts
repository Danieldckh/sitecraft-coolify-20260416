import { z } from 'zod';
import { zodResponseFormat } from 'openai/helpers/zod';
import { getOpenAI, withRetry } from './client';
import { SITE_SYSTEM_PROMPT } from './prompts';

const PageSchema = z.object({
  name: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  pagePrompt: z.string().min(1),
});
const PageListSchema = z.object({ pages: z.array(PageSchema) });

export type GeneratedPage = z.infer<typeof PageSchema>;

export interface RegenerateSitemapInput {
  sitePrompt: string;
  memorySummary: string;
  existingPages: Array<{ name: string; slug: string; pagePrompt: string; locked: boolean }>;
}

export async function regenerateSitemap(
  input: RegenerateSitemapInput,
): Promise<GeneratedPage[]> {
  const { sitePrompt, memorySummary, existingPages } = input;
  const locked = existingPages.filter((p) => p.locked);
  const lockedBlock = locked.length
    ? `Locked pages (preserve exactly, same name/slug/pagePrompt, do not remove):\n${locked
        .map((p) => `- name="${p.name}" slug="${p.slug}" pagePrompt=${JSON.stringify(p.pagePrompt)}`)
        .join('\n')}`
    : 'Locked pages: none.';

  const openai = getOpenAI();
  const completion = await withRetry(() =>
    openai.beta.chat.completions.parse({
      model: 'gpt-4o-2024-08-06',
      messages: [
        { role: 'system', content: SITE_SYSTEM_PROMPT },
        { role: 'system', content: `Memory summary:\n${memorySummary || '(none)'}` },
        { role: 'system', content: lockedBlock },
        { role: 'user', content: sitePrompt || '(no site prompt provided)' },
      ],
      response_format: zodResponseFormat(PageListSchema, 'page_list'),
    }),
  );

  const parsed = completion.choices[0]?.message.parsed;
  if (!parsed) throw new Error('Sitemap generation returned no structured output');
  return parsed.pages;
}
