import { prisma } from '@/server/db/client';
import { askForScope } from '@/server/ai/clarifier';
import { toConversationDTO } from '@/server/db/mappers';
import { withSiteLock } from './mutex';
import type { ConversationDTO, ConversationScope } from '@/types/models';

export async function startClarifierTurn(input: {
  siteId: string;
  scope: ConversationScope;
  targetId: string;
  scopeBrief?: string;
}): Promise<ConversationDTO> {
  const site = await prisma.site.findUnique({ where: { id: input.siteId } });
  if (!site) throw new Error('Site not found');

  return withSiteLock(input.siteId, async () => {
    const questions = await askForScope({
      scope: input.scope,
      targetId: input.targetId,
      sitePrompt: site.sitePrompt,
      memorySummary: site.memorySummary,
      scopeBrief: input.scopeBrief,
    });

    const convo = await prisma.conversation.create({
      data: {
        siteId: input.siteId,
        scope: input.scope,
        targetId: input.targetId,
        questions: {
          create: questions.map((q, i) => ({
            kind: q.kind,
            question: q.question,
            choicesJson: q.choices ? JSON.stringify(q.choices) : null,
            orderIdx: i,
          })),
        },
      },
      include: { questions: true },
    });
    return toConversationDTO(convo);
  });
}

export async function submitAnswers(
  conversationId: string,
  answers: Array<{ questionId: string; response?: string; responseAssetId?: string }>,
): Promise<ConversationDTO> {
  const convo = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: { questions: true },
  });
  if (!convo) throw new Error('Conversation not found');

  return withSiteLock(convo.siteId, async () => {
    for (const a of answers) {
      await prisma.question.update({
        where: { id: a.questionId },
        data: {
          ...(a.response !== undefined ? { response: a.response } : {}),
          ...(a.responseAssetId !== undefined ? { responseAssetId: a.responseAssetId } : {}),
        },
      });
    }
    const fresh = await prisma.conversation.findUniqueOrThrow({
      where: { id: conversationId },
      include: { questions: true },
    });
    return toConversationDTO(fresh);
  });
}
