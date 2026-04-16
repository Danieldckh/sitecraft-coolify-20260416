import { NextResponse } from 'next/server';
import { z } from 'zod';
import { handleError, parseJson } from '@/server/http';
import { submitAnswers } from '@/server/services/conversationService';

export const runtime = 'nodejs';

const Body = z.object({
  answers: z.array(
    z.object({
      questionId: z.string().min(1),
      response: z.string().optional(),
      responseAssetId: z.string().optional(),
    }),
  ),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; cid: string }> }) {
  try {
    const { cid } = await params;
    const body = Body.parse(await parseJson(req));
    const convo = await submitAnswers(cid, body.answers);
    return NextResponse.json({ conversation: convo });
  } catch (err) {
    return handleError(err);
  }
}
