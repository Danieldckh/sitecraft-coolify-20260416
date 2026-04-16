import { getOpenAI } from './client';
import { SECTION_SYSTEM_PROMPT } from './prompts';
import { parseGeneratedCode, type GeneratedCode } from './sections';

export type StreamEvent =
  | { type: 'partial'; delta: string }
  | { type: 'final'; html: string; css: string; js: string }
  | { type: 'error'; message: string };

export interface StreamGenerateSectionInput {
  section: {
    sectionPrompt: string;
    referenceImageUrl?: string | null;
  };
  siteContext: string;
  emit: (event: StreamEvent) => void;
  signal?: AbortSignal;
}

export async function streamGenerateSection(
  input: StreamGenerateSectionInput,
): Promise<GeneratedCode> {
  const { section, siteContext, emit, signal } = input;
  const openai = getOpenAI();

  const userContent = section.referenceImageUrl
    ? [
        { type: 'text' as const, text: section.sectionPrompt },
        {
          type: 'image_url' as const,
          image_url: { url: section.referenceImageUrl, detail: 'high' as const },
        },
      ]
    : section.sectionPrompt;

  try {
    const stream = await openai.chat.completions.create(
      {
        model: 'gpt-4o',
        stream: true,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SECTION_SYSTEM_PROMPT },
          { role: 'system', content: `Site context:\n${siteContext || '(none)'}` },
          { role: 'user', content: userContent as never },
        ],
      },
      { signal },
    );

    let accumulated = '';
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content ?? '';
      if (delta) {
        accumulated += delta;
        emit({ type: 'partial', delta });
      }
    }

    const parsed = parseGeneratedCode(accumulated);
    emit({ type: 'final', html: parsed.html, css: parsed.css, js: parsed.js });
    return parsed;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emit({ type: 'error', message });
    throw err;
  }
}
