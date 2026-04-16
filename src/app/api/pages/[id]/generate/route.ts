import { handleError } from '@/server/http';
import { generatePage } from '@/server/services/pageService';

export const runtime = 'nodejs';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const encoder = new TextEncoder();

    const body = new ReadableStream({
      async start(controller) {
        const emit = (event: string, data: unknown) => {
          const frame =
            event === 'delta'
              ? `data: ${JSON.stringify(data)}\n\n`
              : `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
          controller.enqueue(encoder.encode(frame));
        };
        try {
          const page = await generatePage(id, {
            signal: req.signal,
            onEvent: (ev) => {
              if (ev.type === 'partial') emit('delta', { delta: ev.delta });
              else if (ev.type === 'final') emit('final', { sections: ev.page.sections.length });
              else if (ev.type === 'error') emit('error', { message: ev.message });
            },
          });
          emit('done', { page });
        } catch (err) {
          emit('error', { message: err instanceof Error ? err.message : String(err) });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(body, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    });
  } catch (err) {
    return handleError(err);
  }
}
