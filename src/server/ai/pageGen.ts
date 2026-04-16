import { z } from 'zod';
import { zodResponseFormat } from 'openai/helpers/zod';
import { getOpenAI, withRetry } from './client';
import { PAGE_SYSTEM } from './prompts';
import { SECTION_VARIANTS } from './variants';
import type { SectionRole, ThemeDTO } from '@/types/models';

const SECTION_ROLES = [
  'header-nav',
  'hero',
  'features',
  'cta',
  'testimonials',
  'gallery',
  'pricing',
  'faq',
  'contact',
  'about-story',
  'services-grid',
  'footer-big',
  'custom',
] as const;

const SectionEntrySchema = z.object({
  selectorId: z.string().regex(/^sc-el-[a-z0-9-]{3,40}$/),
  role: z.enum(SECTION_ROLES),
  variantId: z.string().min(3),
  prompt: z.string().default(''),
});

export const PageGenSchema = z.object({
  html: z.string().min(20),
  css: z.string().default(''),
  js: z.string().default(''),
  sections: z.array(SectionEntrySchema).min(1).max(10),
});

export type GeneratedPage = z.infer<typeof PageGenSchema>;

export type PageStreamEvent =
  | { type: 'partial'; delta: string }
  | { type: 'final'; page: GeneratedPage }
  | { type: 'error'; message: string };

export interface StreamGeneratePageInput {
  pageBrief: { name: string; slug: string; pagePrompt: string };
  siteBrief: string;
  theme: Pick<
    ThemeDTO,
    'stylePresetId' | 'signatureMotif' | 'palette' | 'tokens' | 'library' | 'primaryFont' | 'secondaryFont'
  >;
  allowedRoles?: SectionRole[];
  emit: (event: PageStreamEvent) => void;
  signal?: AbortSignal;
}

function variantCatalogFor(roles: SectionRole[]): string {
  return roles
    .filter((r) => r !== 'header-nav' && r !== 'footer-big')
    .map((role) => {
      const list = SECTION_VARIANTS[role] ?? [];
      const rows = list.map((v) => `    - ${v.id}: ${v.description}`).join('\n');
      return `  ${role}:\n${rows}`;
    })
    .join('\n');
}

export async function streamGeneratePage(input: StreamGeneratePageInput): Promise<GeneratedPage> {
  const openai = getOpenAI();
  const allowed =
    input.allowedRoles ??
    (['hero', 'features', 'cta', 'testimonials', 'gallery', 'pricing', 'faq', 'contact', 'about-story', 'services-grid', 'custom'] as SectionRole[]);

  const themeBlock = [
    `Style preset: ${input.theme.stylePresetId}`,
    `Signature motif: ${input.theme.signatureMotif}`,
    `Palette: ${JSON.stringify(input.theme.palette)}`,
    `Fonts: display="${input.theme.primaryFont}", body="${input.theme.secondaryFont}"`,
    `Tokens: ${JSON.stringify(input.theme.tokens)}`,
    `Library available (inject separately — do not emit header/footer): Header, Footer, Button, Card.`,
  ].join('\n');

  const variantBlock = `Allowed section variant IDs (pick one per section, never invent):\n${variantCatalogFor(allowed)}`;

  const pageBlock = [
    `Page: name="${input.pageBrief.name}" slug="${input.pageBrief.slug}"`,
    `Brief: ${input.pageBrief.pagePrompt || '(no specific brief — use sensible defaults for this page role)'}`,
    `Site brief: ${input.siteBrief || '(none)'}`,
  ].join('\n');

  try {
    const res = await withRetry(() =>
      openai.beta.chat.completions.parse(
        {
          model: 'gpt-4o-2024-08-06',
          messages: [
            { role: 'system', content: PAGE_SYSTEM },
            { role: 'system', content: themeBlock },
            { role: 'system', content: variantBlock },
            { role: 'user', content: pageBlock },
          ],
          response_format: zodResponseFormat(PageGenSchema, 'page'),
        },
        { signal: input.signal },
      ),
    );
    const parsed = res.choices[0]?.message.parsed;
    if (!parsed) throw new Error('Page generation returned no structured output');
    input.emit({ type: 'final', page: parsed });
    return parsed;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    input.emit({ type: 'error', message });
    throw err;
  }
}
