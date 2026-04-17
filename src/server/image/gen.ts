// OpenAI gpt-image-1 → PNG on disk → public URL.
//
// Used by /api/generate-image. The SDK returns `data[0].b64_json` for
// gpt-image-1 (no URL option — confirmed in openai@4.72 types). We decode
// the base64 to a Buffer, write it to `public/uploads/<id>.png`, and return
// the same shape as /api/uploads so callers can treat both paths uniformly.
//
// The OpenAI client is constructed lazily: if OPENAI_API_KEY isn't set at
// module-load time we don't throw, we just fail on the first real call.
// This keeps build-time imports safe in environments that scan bundles
// without secrets available.
//
// Error hygiene: anything thrown out of this module has `sk-...` tokens
// redacted before re-throw, so we don't leak the key through error
// propagation into API responses or logs.

import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import OpenAI from 'openai';

export interface GenerateImageInput {
  prompt: string;
  size?: '1024x1024' | '1024x1536' | '1536x1024' | 'auto';
}

export interface GenerateImageResult {
  url: string; // "/uploads/<id>.png"
  localPath: string; // absolute filesystem path
  bytes: number;
}

let cachedClient: OpenAI | null = null;

function getClient(): OpenAI {
  if (cachedClient) return cachedClient;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured');
  }
  cachedClient = new OpenAI({ apiKey });
  return cachedClient;
}

/** Redact any OpenAI-looking token in a string so we never leak secrets. */
function redact(message: string): string {
  return message.replace(/sk-[A-Za-z0-9_\-]{10,}/g, 'sk-***');
}

export async function generateImage(
  input: GenerateImageInput,
): Promise<GenerateImageResult> {
  const client = getClient();
  const size = input.size ?? '1536x1024';

  let b64: string;
  try {
    const resp = await client.images.generate({
      model: 'gpt-image-1',
      prompt: input.prompt,
      size,
      n: 1,
    });
    const first = resp.data?.[0];
    if (!first || !first.b64_json) {
      throw new Error('OpenAI response did not include image data');
    }
    b64 = first.b64_json;
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    throw new Error(`Image generation failed: ${redact(raw)}`);
  }

  let bytes: Buffer;
  try {
    bytes = Buffer.from(b64, 'base64');
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    throw new Error(`Image decode failed: ${redact(raw)}`);
  }

  const id = randomUUID().replace(/-/g, '');
  const filename = `${id}.png`;
  const uploadsDir = path.join(process.cwd(), 'public', 'uploads');
  const localPath = path.join(uploadsDir, filename);

  try {
    await mkdir(uploadsDir, { recursive: true });
    await writeFile(localPath, bytes);
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    throw new Error(`Image write failed: ${redact(raw)}`);
  }

  return {
    url: `/uploads/${filename}`,
    localPath,
    bytes: bytes.byteLength,
  };
}
