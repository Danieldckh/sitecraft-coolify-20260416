// /api/qa/[siteId]
//
// GET  — returns the most recently stored QA report for this site, parsed out
//        of Site.memorySummary (shape: { lastQa: QaReport }). 404 if there's
//        no stored report yet.
// POST — re-runs runQa, persists the report to Site.memorySummary as
//        JSON.stringify({ lastQa }), and returns it. Rate-limited on the
//        'ai' bucket (Haiku call + HEAD probes are non-trivial).
//
// Shape returned from both verbs is the QaReport from `@/server/ai/qa`.

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/server/db/client';
import { enforceRateLimit } from '@/server/rateLimit';
import { runQa, type QaReport } from '@/server/ai/qa';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseStoredReport(memorySummary: string): QaReport | null {
  if (!memorySummary || memorySummary.trim().length === 0) return null;
  try {
    const obj = JSON.parse(memorySummary) as unknown;
    if (!obj || typeof obj !== 'object') return null;
    const maybe = (obj as Record<string, unknown>).lastQa;
    if (!maybe || typeof maybe !== 'object') return null;
    const report = maybe as Record<string, unknown>;
    if (
      typeof report.siteId !== 'string' ||
      typeof report.generatedAt !== 'string' ||
      !Array.isArray(report.issues)
    ) {
      return null;
    }
    // We trust the shape because we wrote it ourselves; issues array is
    // preserved as-is. A stricter coercion would just drop legitimate fields.
    return report as unknown as QaReport;
  } catch {
    return null;
  }
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ siteId: string }> },
): Promise<NextResponse> {
  const limited = enforceRateLimit(req, 'read');
  if (limited) return limited;

  const { siteId } = await context.params;
  if (!siteId) {
    return NextResponse.json({ error: 'Missing siteId' }, { status: 400 });
  }

  try {
    const site = await prisma.site.findUnique({
      where: { id: siteId },
      select: { id: true, memorySummary: true },
    });
    if (!site) {
      return NextResponse.json({ error: 'Site not found' }, { status: 404 });
    }
    const report = parseStoredReport(site.memorySummary);
    if (!report) {
      return NextResponse.json({ error: 'No QA report yet' }, { status: 404 });
    }
    return NextResponse.json(report);
  } catch (err) {
    console.error('[api/qa] get failed', err);
    return NextResponse.json({ error: 'Failed to load QA report' }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ siteId: string }> },
): Promise<NextResponse> {
  const limited = enforceRateLimit(req, 'ai');
  if (limited) return limited;

  const { siteId } = await context.params;
  if (!siteId) {
    return NextResponse.json({ error: 'Missing siteId' }, { status: 400 });
  }

  try {
    const exists = await prisma.site.findUnique({
      where: { id: siteId },
      select: { id: true },
    });
    if (!exists) {
      return NextResponse.json({ error: 'Site not found' }, { status: 404 });
    }

    const report = await runQa(siteId);
    await prisma.site.update({
      where: { id: siteId },
      data: { memorySummary: JSON.stringify({ lastQa: report }) },
    });
    return NextResponse.json(report);
  } catch (err) {
    console.error('[api/qa] post failed', err);
    return NextResponse.json({ error: 'Failed to run QA' }, { status: 500 });
  }
}
