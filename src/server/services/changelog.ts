import { prisma } from '@/server/db/client';

export type ChangeScope = 'site' | 'theme' | 'page' | 'element' | 'section';

export async function logChange(args: {
  siteId: string;
  scope: ChangeScope;
  targetId: string;
  summary: string;
  before?: unknown;
  after?: unknown;
  actor?: string;
}) {
  return prisma.changeLogEntry.create({
    data: {
      siteId: args.siteId,
      scope: args.scope,
      targetId: args.targetId,
      summary: args.summary,
      actor: args.actor ?? 'user',
      diffJson: JSON.stringify({ before: args.before ?? null, after: args.after ?? null }),
    },
  });
}
