import OpenAI from 'openai';
import { env } from '../env';

let _client: OpenAI | null = null;

export function getOpenAI(): OpenAI {
  if (!_client) {
    _client = new OpenAI({
      apiKey: env.OPENAI_API_KEY,
      timeout: 120_000,
      maxRetries: 0,
    });
  }
  return _client;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { attempts?: number; baseDelayMs?: number } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const base = opts.baseDelayMs ?? 500;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = (err as { status?: number })?.status;
      if (status && status >= 400 && status < 500 && status !== 408 && status !== 429) {
        throw err;
      }
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, base * 2 ** i));
      }
    }
  }
  throw lastErr;
}
