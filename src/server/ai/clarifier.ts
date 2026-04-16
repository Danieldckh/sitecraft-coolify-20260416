import { z } from 'zod';
import { zodResponseFormat } from 'openai/helpers/zod';
import { getOpenAI, withRetry } from './client';
import { CLARIFIER_SYSTEM } from './prompts';
import type { ConversationScope } from '@/types/models';

const QuestionSchema = z.object({
  kind: z.enum(['text', 'choice', 'upload', 'boolean']),
  question: z.string().min(3).max(240),
  choices: z.array(z.string()).max(5).optional(),
});
const QuestionListSchema = z.object({
  questions: z.array(QuestionSchema).max(5),
});

export type ClarifierQuestion = z.infer<typeof QuestionSchema>;

export interface AskForScopeInput {
  scope: ConversationScope;
  targetId: string;
  sitePrompt: string;
  memorySummary: string;
  scopeBrief?: string; // e.g. page or element prompt
}

export async function askForScope(input: AskForScopeInput): Promise<ClarifierQuestion[]> {
  const openai = getOpenAI();
  const userBlock = [
    `Scope: ${input.scope} (${input.targetId})`,
    `Site brief: ${input.sitePrompt || '(none)'}`,
    `Memory summary: ${input.memorySummary || '(none)'}`,
    input.scopeBrief ? `Scope brief: ${input.scopeBrief}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const res = await withRetry(() =>
    openai.beta.chat.completions.parse({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: CLARIFIER_SYSTEM },
        { role: 'user', content: userBlock },
      ],
      response_format: zodResponseFormat(QuestionListSchema, 'clarifier_questions'),
    }),
  );

  const parsed = res.choices[0]?.message.parsed;
  if (!parsed) throw new Error('Clarifier returned no structured output');
  return parsed.questions;
}
