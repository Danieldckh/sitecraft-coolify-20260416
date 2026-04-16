import { prisma } from '@/server/db/client';
import { handleError, notFound } from '@/server/http';
import { streamGenerateSection, buildSiteContext } from '@/server/ai';
import { logChange } from '@/server/services/changelog';

export const runtime = 'nodejs';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const section = await prisma.section.findUnique({
      where: { id },
      include: { page: { include: { site: true } } },
    });
    if (!section) return notFound('Section not found');

    const siteId = section.page.siteId;
    const ctx = await buildSiteContext(siteId);

    const encoder = new TextEncoder();
    const body = new ReadableStream({
      async start(controller) {
        const emit = (event: 'delta' | 'done' | 'error', data: unknown) => {
          const frame =
            event === 'delta'
              ? `data: ${JSON.stringify(data)}\n\n`
              : `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
          controller.enqueue(encoder.encode(frame));
        };
        type Code = { html: string; css: string; js: string };
        let finalCode: Code | null = null;
        const wrappedEmit: typeof emit = (event, data) => {
          if (event === 'done' && data && typeof data === 'object') {
            finalCode = data as Code;
          }
          emit(event, data);
        };
        try {
          await streamGenerateSection(
            id,
            {
              sectionPrompt: section.sectionPrompt,
              siteContext: `${ctx.memorySummary}\nSite: ${section.page.site.sitePrompt}\nPage: ${section.page.pagePrompt}`,
              referenceImageUrl: section.referenceImageUrl,
            },
            wrappedEmit,
          );
          if (finalCode) {
            const fc: Code = finalCode;
            const before = { html: section.html, css: section.css, js: section.js };
            await prisma.section.update({
              where: { id },
              data: {
                html: fc.html,
                css: fc.css,
                js: fc.js,
                lastGeneratedAt: new Date(),
              },
            });
            await logChange({
              siteId,
              scope: 'section',
              targetId: id,
              summary: `Generated ${section.type} section (stream)`,
              before,
              after: fc,
            });
          }
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
