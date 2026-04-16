import { z } from 'zod';
import { zodResponseFormat } from 'openai/helpers/zod';
import { getOpenAI, withRetry } from './client';
import { ELEMENT_EDIT_SYSTEM } from './prompts';
import { buildRetryDirective, validateGenerated } from './banlist';
import type { ThemeDTO } from '@/types/models';

export const ElementEditSchema = z.object({
  html: z.string().min(3),
  css: z.string().default(''),
});

export type ElementEditResult = z.infer<typeof ElementEditSchema>;

export type ElementStreamEvent =
  | { type: 'partial'; delta: string }
  | { type: 'final'; result: ElementEditResult }
  | { type: 'error'; message: string };

export interface StreamEditElementInput {
  element: { selectorId: string; role: string; variantId: string; html: string; css: string };
  instruction: string;
  theme: Pick<ThemeDTO, 'stylePresetId' | 'signatureMotif' | 'palette' | 'tokens' | 'primaryFont' | 'secondaryFont'>;
  emit: (event: ElementStreamEvent) => void;
  signal?: AbortSignal;
}

export async function streamEditElement(input: StreamEditElementInput): Promise<ElementEditResult> {
  const openai = getOpenAI();
  const themeBlock = [
    `Style preset: ${input.theme.stylePresetId}`,
    `Signature motif: ${input.theme.signatureMotif}`,
    `Palette: ${JSON.stringify(input.theme.palette)}`,
    `Fonts: display="${input.theme.primaryFont}", body="${input.theme.secondaryFont}"`,
    `Tokens: ${JSON.stringify(input.theme.tokens)}`,
  ].join('\n');

  const elementBlock = [
    `Element id: ${input.element.selectorId} (MUST preserve)`,
    `Role: ${input.element.role}`,
    `Variant: ${input.element.variantId}`,
    `Current HTML:\n${input.element.html}`,
    `Current CSS:\n${input.element.css}`,
  ].join('\n');

  const baseMessages = [
    { role: 'system' as const, content: ELEMENT_EDIT_SYSTEM },
    { role: 'system' as const, content: themeBlock },
    { role: 'system' as const, content: elementBlock },
    { role: 'user' as const, content: input.instruction },
  ];

  const runOnce = async (extraSystem?: string) => {
    const messages = extraSystem
      ? [...baseMessages, { role: 'system' as const, content: extraSystem }]
      : baseMessages;
    const res = await withRetry(() =>
      openai.beta.chat.completions.parse(
        {
          model: 'gpt-4o-2024-08-06',
          messages,
          response_format: zodResponseFormat(ElementEditSchema, 'element_edit'),
        },
        { signal: input.signal },
      ),
    );
    const parsed = res.choices[0]?.message.parsed;
    if (!parsed) throw new Error('Element edit returned no structured output');
    return parsed;
  };

  try {
    let parsed = await runOnce();
    const first = validateGenerated(`${parsed.html}\n${parsed.css}`);
    if (!first.ok) {
      parsed = await runOnce(buildRetryDirective(first.violations));
    }
    input.emit({ type: 'final', result: parsed });
    return parsed;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    input.emit({ type: 'error', message });
    throw err;
  }
}
