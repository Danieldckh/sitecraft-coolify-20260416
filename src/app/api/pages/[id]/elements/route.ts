import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db/client';
import { toElementDTO } from '@/server/db/mappers';
import { handleError, notFound, parseJson } from '@/server/http';
import { upsertElementBySelector } from '@/server/services/elementService';

export const runtime = 'nodejs';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const page = await prisma.page.findUnique({
      where: { id },
      include: { elements: true },
    });
    if (!page) return notFound('Page not found');
    return NextResponse.json({
      elements: page.elements.map(toElementDTO),
    });
  } catch (err) {
    return handleError(err);
  }
}

const Body = z.object({
  selectorId: z.string().min(1).max(128),
  role: z.string().max(64).optional(),
  variantId: z.string().max(128).optional(),
  prompt: z.string().max(8000).optional(),
  html: z.string().optional(),
  css: z.string().optional(),
  force: z.boolean().optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = Body.parse(await parseJson(req));
    const element = await upsertElementBySelector(
      id,
      {
        selectorId: body.selectorId,
        role: body.role,
        variantId: body.variantId,
        prompt: body.prompt,
        html: body.html,
        css: body.css,
      },
      { force: body.force },
    );
    return NextResponse.json({ element });
  } catch (err) {
    return handleError(err);
  }
}
