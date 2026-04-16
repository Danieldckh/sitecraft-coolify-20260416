import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export function notFound(what = 'Not found') {
  return jsonError(what, 404);
}

export function conflict(message: string) {
  return jsonError(message, 409);
}

export async function parseJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, 'Invalid JSON body');
  }
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function handleError(err: unknown) {
  if (err instanceof HttpError) return jsonError(err.message, err.status);
  if (err instanceof ZodError) return jsonError(err.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; '), 400);
  const message = err instanceof Error ? err.message : 'Internal error';
  console.error('[api]', err);
  return jsonError(message, 500);
}
