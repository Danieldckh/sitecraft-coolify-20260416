import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

// Retired in v2 — use /api/sites/[id]/pages and per-page element endpoints.
export function GET() {
  return NextResponse.json({ error: 'Sections are retired in Sitecraft v2' }, { status: 410 });
}
