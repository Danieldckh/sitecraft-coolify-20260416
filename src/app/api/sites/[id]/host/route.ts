// POST /api/sites/[id]/host — SSE stream that drives a full deploy cycle
// via `runDeploy(siteId)`. Events it emits:
//
//   event: status   data: { status, message? }
//   event: live     data: { url }
//   event: error    data: { message }
//   event: done     data: {}
//
// `done` is ALWAYS the final frame, sent after the terminal status/live/error
// so the client can tear down cleanly.
//
// Client-abort support: when req.signal fires we call generator.return() so
// the orchestrator stops on the next `await`; the Deployment row keeps
// whatever partial status it reached.

import { NextRequest, NextResponse } from 'next/server';
import { enforceRateLimit } from '@/server/rateLimit';
import { runDeploy, type DeployEvent } from '@/server/deploy/orchestrator';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function sseFrame(event: string, data: unknown): string {
  const payload = typeof data === 'string' ? data : JSON.stringify(data);
  return `event: ${event}\ndata: ${payload}\n\n`;
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse | Response> {
  const limited = enforceRateLimit(req, 'ai');
  if (limited) return limited;

  const { id: siteId } = await context.params;
  if (!siteId) {
    return NextResponse.json({ error: 'Missing site id' }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const abortController = new AbortController();
  req.signal.addEventListener('abort', () => abortController.abort(), { once: true });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enqueue = (event: string, data: unknown): void => {
        try {
          controller.enqueue(encoder.encode(sseFrame(event, data)));
        } catch {
          // Controller already closed — ignore.
        }
      };

      const generator = runDeploy(siteId);

      try {
        for await (const evt of generator as AsyncGenerator<DeployEvent>) {
          if (abortController.signal.aborted) {
            try {
              await generator.return(undefined);
            } catch {
              /* ignore */
            }
            break;
          }

          if (evt.type === 'status') {
            enqueue('status', {
              status: evt.status,
              ...(evt.message ? { message: evt.message } : {}),
            });
          } else if (evt.type === 'live') {
            enqueue('live', { url: evt.url });
          } else if (evt.type === 'error') {
            enqueue('error', { message: evt.message });
          }
        }

        if (!abortController.signal.aborted) {
          enqueue('done', {});
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Deploy failed';
        console.error('[api/sites/[id]/host] stream error', msg);
        enqueue('error', { message: msg });
        enqueue('done', {});
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
    cancel() {
      abortController.abort();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
