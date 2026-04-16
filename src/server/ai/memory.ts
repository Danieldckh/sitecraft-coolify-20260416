import { prisma } from '../db/client';
import { getOpenAI, withRetry } from './client';

const SUMMARY_ENTRY_THRESHOLD = 20;
const SUMMARY_TOKEN_THRESHOLD = 6000;
const RECENT_ENTRY_LIMIT = 10;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface AppendMemoryInput {
  role: 'system' | 'user' | 'ai';
  kind: 'change_request' | 'decision' | 'generation' | 'vision';
  content: string;
}

export async function appendMemory(siteId: string, entry: AppendMemoryInput): Promise<void> {
  await prisma.memoryEntry.create({
    data: {
      siteId,
      role: entry.role,
      kind: entry.kind,
      content: entry.content,
    },
  });
  await maybeSummarize(siteId);
}

async function maybeSummarize(siteId: string): Promise<void> {
  const site = await prisma.site.findUnique({ where: { id: siteId } });
  if (!site) return;

  const entries = await prisma.memoryEntry.findMany({
    where: { siteId },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });

  const totalTokens = entries.reduce((s, e) => s + estimateTokens(e.content), 0);
  if (entries.length < SUMMARY_ENTRY_THRESHOLD && totalTokens < SUMMARY_TOKEN_THRESHOLD) return;

  const chronological = [...entries].reverse();
  const joined = chronological
    .map((e) => `[${e.createdAt.toISOString()}] ${e.role}/${e.kind}: ${e.content}`)
    .join('\n');

  const openai = getOpenAI();
  const res = await withRetry(() =>
    openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content:
            'You maintain a rolling project memory for an AI website builder. Given the existing summary and a log of new events, produce an updated summary of at most 800 tokens. Preserve durable facts (brand, audience, tone, explicit user decisions, locked structural choices). Drop superseded details. Return plain prose, no headings.',
        },
        { role: 'system', content: `Existing summary:\n${site.memorySummary || '(none)'}` },
        { role: 'user', content: `Event log:\n${joined}` },
      ],
    }),
  );

  const summary = res.choices[0]?.message?.content?.trim();
  if (!summary) return;

  await prisma.site.update({
    where: { id: siteId },
    data: { memorySummary: summary },
  });
}

export interface SiteContext {
  memorySummary: string;
  recentEntries: Array<{
    role: string;
    kind: string;
    content: string;
    createdAt: Date;
  }>;
}

export async function buildSiteContext(siteId: string): Promise<SiteContext> {
  const site = await prisma.site.findUnique({ where: { id: siteId } });
  const recent = await prisma.memoryEntry.findMany({
    where: { siteId },
    orderBy: { createdAt: 'desc' },
    take: RECENT_ENTRY_LIMIT,
  });
  return {
    memorySummary: site?.memorySummary ?? '',
    recentEntries: recent.reverse().map((e) => ({
      role: e.role,
      kind: e.kind,
      content: e.content,
      createdAt: e.createdAt,
    })),
  };
}

export function formatSiteContext(ctx: SiteContext): string {
  const summary = ctx.memorySummary ? `Summary:\n${ctx.memorySummary}` : 'Summary: (none)';
  const recent = ctx.recentEntries.length
    ? `Recent events:\n${ctx.recentEntries
        .map((e) => `- [${e.createdAt.toISOString()}] ${e.role}/${e.kind}: ${e.content}`)
        .join('\n')}`
    : 'Recent events: (none)';
  return `${summary}\n\n${recent}`;
}
