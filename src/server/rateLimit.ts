// In-process token-bucket rate limiter. Keyed by client IP, scoped by bucket
// name (e.g. "ai" or "read"). Survives only for the life of the Node process;
// acceptable for single-instance Coolify deploys. Swap for Redis if we go HA.
//
// Public API:
//   checkRateLimit(req, 'ai') -> { ok: true } | { ok: false, retryAfter: N }
//   rateLimitResponse(retryAfter) -> NextResponse with 429 + Retry-After header
//
// Tuning rationale:
//   - AI bucket: 30/min. OpenAI calls cost money + take 5-15s; this caps a
//     single runaway client at ~900 calls/hr without blocking normal editing.
//   - READ bucket: 200/min. Canvas invalidations can fire a handful of GETs
//     per interaction; 200 leaves headroom for polling while still catching
//     scraper-grade abuse.
//
// The buckets refill continuously (not per fixed window) so a burst is
// allowed up to the capacity then throttled by the refill rate.

import { NextResponse } from 'next/server';

export type BucketName = 'ai' | 'read';

interface BucketConfig {
  capacity: number;
  refillPerSec: number;
}

const BUCKETS: Record<BucketName, BucketConfig> = {
  ai: { capacity: 30, refillPerSec: 30 / 60 },
  read: { capacity: 200, refillPerSec: 200 / 60 },
};

interface BucketState {
  tokens: number;
  updatedAt: number;
}

// key = `${bucketName}:${ip}`
const state = new Map<string, BucketState>();

function now(): number {
  return Date.now();
}

function clientIp(req: Request): string {
  const h = req.headers;
  const xff = h.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  const real = h.get('x-real-ip');
  if (real) return real.trim();
  return 'unknown';
}

export function checkRateLimit(
  req: Request,
  bucket: BucketName,
): { ok: true } | { ok: false; retryAfter: number } {
  const cfg = BUCKETS[bucket];
  const key = `${bucket}:${clientIp(req)}`;
  const t = now();

  let s = state.get(key);
  if (!s) {
    s = { tokens: cfg.capacity, updatedAt: t };
    state.set(key, s);
  } else {
    const elapsed = Math.max(0, (t - s.updatedAt) / 1000);
    s.tokens = Math.min(cfg.capacity, s.tokens + elapsed * cfg.refillPerSec);
    s.updatedAt = t;
  }

  if (s.tokens >= 1) {
    s.tokens -= 1;
    return { ok: true };
  }
  const needed = 1 - s.tokens;
  const retryAfter = Math.max(1, Math.ceil(needed / cfg.refillPerSec));
  return { ok: false, retryAfter };
}

export function rateLimitResponse(retryAfter: number): NextResponse {
  return NextResponse.json(
    { error: 'Too many requests', retryAfter },
    { status: 429, headers: { 'Retry-After': String(retryAfter) } },
  );
}

// Convenience: if the limiter trips, return a Response; else null.
export function enforceRateLimit(req: Request, bucket: BucketName): NextResponse | null {
  const r = checkRateLimit(req, bucket);
  if (r.ok) return null;
  return rateLimitResponse(r.retryAfter);
}
