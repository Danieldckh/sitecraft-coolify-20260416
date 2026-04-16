import { NextResponse } from 'next/server';
import { z } from 'zod';
import { handleError, parseJson } from '@/server/http';
import { patchElementDirect } from '@/server/services/elementService';

export const runtime = 'nodejs';

const Body = z.object({
  html: z.string().optional(),
  css: z.string().optional(),
  locked: z.boolean().optional(),
  force: z.boolean().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; eid: string }> },
) {
  try {
    const { id, eid } = await params;
    const body = Body.parse(await parseJson(req));
    const element = await patchElementDirect(id, eid, body, { force: body.force });
    return NextResponse.json({ element });
  } catch (err) {
    return handleError(err);
  }
}
