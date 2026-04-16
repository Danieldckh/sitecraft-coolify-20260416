// Global security headers. Applied to every response; see matcher below.
//
// Notes:
//   - /preview/** must allow same-origin iframes (the builder embeds its own
//     preview routes), so we set X-Frame-Options: SAMEORIGIN there.
//   - CSP is intentionally permissive in dev so the builder's Monaco editor,
//     React Flow, and inline <style> blocks work. Tighten for prod later.

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const BASE_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy':
    "default-src 'self'; " +
    "img-src 'self' data: blob: https:; " +
    "style-src 'self' 'unsafe-inline' https:; " +
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
    "font-src 'self' data: https:; " +
    "connect-src 'self' https: wss:; " +
    "frame-src 'self' data: blob:; " +
    "frame-ancestors 'self'",
};

export function middleware(req: NextRequest) {
  const res = NextResponse.next();
  for (const [k, v] of Object.entries(BASE_HEADERS)) {
    res.headers.set(k, v);
  }
  if (req.nextUrl.pathname.startsWith('/preview')) {
    res.headers.set('X-Frame-Options', 'SAMEORIGIN');
  } else {
    res.headers.set('X-Frame-Options', 'DENY');
  }
  return res;
}

export const config = {
  matcher: [
    // Skip static/file assets but still cover api + pages.
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpe?g|webp|gif|svg|ico|css|js|map)).*)',
  ],
};
