// POST /api/generate-image — generate a PNG via OpenAI gpt-image-1 and save
// it to `public/uploads/`. Returns the same `{ url, bytes }` shape as the
// manual /api/uploads endpoint so callers can treat both paths uniformly.
//
// Flow:
//   1. Rate-limit (shared "ai" bucket — image gen is expensive).
//   2. Validate { prompt, size? } via zod.
//   3. Call generateImage() — writes PNG to disk, returns the URL.
//   4. Respond { url, bytes }.
//
// Runtime: nodejs (OpenAI SDK + fs). Long timeout because gpt-image-1 can
// take 30–90s for high-detail generations.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { enforceRateLimit } from '@/server/rateLimit';
import { generateImage } from '@/server/image/gen';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const GenerateBody = z.object({
  prompt: z.string().min(3).max(1000),
  size: z
    .enum(['1024x1024', '1024x1536', '1536x1024', 'auto'])
    .optional(),
});

export async function POST(req: NextRequest) {
  const limited = enforceRateLimit(req, 'ai');
  if (limited) return limited;

  let body: z.infer<typeof GenerateBody>;
  try {
    const raw = (await req.json()) as unknown;
    body = GenerateBody.parse(raw);
  } catch (err) {
    const message =
      err instanceof z.ZodError
        ? err.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ')
        : 'Invalid JSON body';
    return NextResponse.json({ error: message }, { status: 400 });
  }

  try {
    const result = await generateImage({ prompt: body.prompt, size: body.size });
    return NextResponse.json({ url: result.url, bytes: result.bytes });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Image generation failed';
    console.error('[api/generate-image] failed', message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
