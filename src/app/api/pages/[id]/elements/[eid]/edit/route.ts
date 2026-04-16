import { z } from 'zod';
import { handleError, parseJson } from '@/server/http';
import { editElement } from '@/server/services/elementService';
import { enforceRateLimit } from '@/server/rateLimit';

export const runtime = 'nodejs';

const Body = z.object({ instruction: z.string().min(1).max(4000), force: z.boolean().optional() });

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; eid: string }> },
) {
  try {
    const limited = enforceRateLimit(req, 'ai');
    if (limited) return limited;
    const { id, eid } = await params;
    const body = Body.parse(await parseJson(req));
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const emit = (event: string, data: unknown) => {
          const frame =
            event === 'delta'
              ? `data: ${JSON.stringify(data)}\n\n`
              : `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
          controller.enqueue(encoder.encode(frame));
        };
        try {
          const element = await editElement(id, eid, body.instruction, {
            signal: req.signal,
            force: body.force,
            onEvent: (ev) => {
              if (ev.type === 'partial') emit('delta', { delta: ev.delta });
              else if (ev.type === 'error') emit('error', { message: ev.message });
            },
          });
          emit('done', { element });
        } catch (err) {
          emit('error', { message: err instanceof Error ? err.message : String(err) });
        } finally {
          controller.close();
        }
      },
    });
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
      },
    });
  } catch (err) {
    return handleError(err);
  }
}
