import { NextResponse } from 'next/server';
import { z } from 'zod';
import { handleError, parseJson } from '@/server/http';
import { startClarifierTurn } from '@/server/services/conversationService';
import { enforceRateLimit } from '@/server/rateLimit';

export const runtime = 'nodejs';

const Body = z.object({
  scope: z.enum(['site', 'page', 'element']),
  targetId: z.string().min(1),
  scopeBrief: z.string().max(8000).optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const limited = enforceRateLimit(req, 'ai');
    if (limited) return limited;
    const { id } = await params;
    const body = Body.parse(await parseJson(req));
    const convo = await startClarifierTurn({
      siteId: id,
      scope: body.scope,
      targetId: body.targetId,
      scopeBrief: body.scopeBrief,
    });
    return NextResponse.json({ conversation: convo }, { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}
