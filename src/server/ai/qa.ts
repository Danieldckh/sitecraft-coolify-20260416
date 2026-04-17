// End-of-build QA pass.
//
// Two layers of review:
//
//   1. Static scan (cheerio) over every Page's pageHtml:
//      - HEAD-probe every <img> src (8 concurrent, 3s timeout per probe).
//        Non-200 → image-broken. Skip data: URIs. Relative /uploads/<name>
//        hrefs are resolved against public/uploads/<name> on disk.
//      - <img> with missing/empty alt → image-missing-alt.
//      - <a href="./slug"> where slug isn't a known page slug → link-unknown-slug.
//        External http(s) hrefs are skipped (too slow + false-positive prone).
//      - Duplicate id="..." attributes within a page → duplicate-id.
//
//   2. Claude Haiku review over a compact multi-page digest. Strict JSON output
//      ({ issues: QaIssue[] }), capped at 10 items. Parse failures fall through
//      to an empty set — QA is best-effort; we never fail the whole build on
//      Haiku hiccups.
//
// Results merge into a single QaReport, with a stable ISO timestamp. Persistence
// is handled by callers (the route + the build hook both stash JSON into
// Site.memorySummary).
//
// Bounded latency: HEAD probes dominate. With 8-way concurrency and a 3s
// timeout the worst case for a dozen images is ~5s; the Haiku call adds 2-4s.
// Well under the user-visible build time.

import * as cheerio from 'cheerio';
import { promises as fs } from 'fs';
import path from 'path';
import { prisma } from '@/server/db/client';
import { anthropic, MODELS } from './anthropic';

export type QaSeverity = 'error' | 'warn' | 'info';

export type QaKind =
  | 'image-broken'
  | 'image-missing-alt'
  | 'link-unknown-slug'
  | 'layout-risk'
  | 'copy-missing'
  | 'duplicate-id'
  | 'other';

export interface QaIssue {
  severity: QaSeverity;
  kind: QaKind;
  pageSlug: string;
  message: string;
  elementId?: string;
}

export interface QaReport {
  siteId: string;
  generatedAt: string;
  issues: QaIssue[];
}

// ---------- Static scanner ----------

const HEAD_TIMEOUT_MS = 3000;
const HEAD_CONCURRENCY = 8;

type PageRow = { slug: string; pageHtml: string };

/** Find the nearest ancestor (including self) with a data-el-id attribute. */
function nearestElementId(
  $: cheerio.CheerioAPI,
  el: ReturnType<cheerio.CheerioAPI>,
): string | undefined {
  const direct = el.attr('data-el-id');
  if (direct) return direct;
  const ancestor = el.closest('[data-el-id]');
  const found = ancestor.attr('data-el-id');
  return found || undefined;
}

/** Run HEAD probes over an array of tasks with bounded concurrency. */
async function boundedAll<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const runners: Promise<void>[] = [];
  const workerCount = Math.min(limit, items.length);
  for (let w = 0; w < workerCount; w += 1) {
    runners.push(
      (async () => {
        for (;;) {
          const idx = cursor;
          cursor += 1;
          if (idx >= items.length) return;
          out[idx] = await worker(items[idx]);
        }
      })(),
    );
  }
  await Promise.all(runners);
  return out;
}

interface ImageProbeResult {
  ok: boolean;
  reason?: string;
}

/**
 * Probe an image URL.
 *  - data: URIs are always ok (embedded).
 *  - /uploads/<name> is treated as ok iff the file exists on disk.
 *  - Relative URLs other than /uploads/ we can't probe from the server; treat
 *    them as ok (the static renderer would already 404-surface these visibly).
 *  - Absolute http(s) URLs → HEAD with 3s timeout. Non-2xx → broken.
 */
async function probeImage(src: string): Promise<ImageProbeResult> {
  if (!src || src.startsWith('data:')) return { ok: true };

  if (src.startsWith('/uploads/')) {
    const filename = src.slice('/uploads/'.length).split(/[?#]/)[0];
    if (!filename) return { ok: false, reason: 'empty upload path' };
    // Defend against traversal — uploads must be a plain filename segment.
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return { ok: false, reason: 'suspicious upload path' };
    }
    try {
      await fs.stat(path.join(process.cwd(), 'public', 'uploads', filename));
      return { ok: true };
    } catch {
      return { ok: false, reason: 'upload file missing on disk' };
    }
  }

  if (!/^https?:\/\//i.test(src)) {
    // Non-absolute, non-upload relative path. Can't probe reliably; don't flag.
    return { ok: true };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEAD_TIMEOUT_MS);
  try {
    const res = await fetch(src, { method: 'HEAD', signal: controller.signal });
    if (res.status >= 200 && res.status < 400) return { ok: true };
    return { ok: false, reason: `HTTP ${res.status}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: msg };
  } finally {
    clearTimeout(timer);
  }
}

/** Normalize an anchor href to a site slug, or null if it's external/non-slug. */
function hrefToSlug(href: string): string | null {
  if (!href) return null;
  const trimmed = href.trim();
  if (trimmed.length === 0) return null;
  if (/^https?:\/\//i.test(trimmed)) return null;
  if (trimmed.startsWith('mailto:') || trimmed.startsWith('tel:')) return null;
  if (trimmed.startsWith('#')) return null;
  // Match "./about", "about", "/about", "./about.html".
  const cleaned = trimmed.replace(/^\.?\/+/, '').replace(/\.html?$/i, '');
  const firstSeg = cleaned.split(/[?#/]/)[0];
  return firstSeg.length > 0 ? firstSeg : null;
}

interface StaticScanInput {
  pages: PageRow[];
  knownSlugs: Set<string>;
}

async function runStaticScan(input: StaticScanInput): Promise<QaIssue[]> {
  const issues: QaIssue[] = [];

  type ProbeTask = {
    src: string;
    pageSlug: string;
    elementId?: string;
  };
  const probeTasks: ProbeTask[] = [];

  for (const page of input.pages) {
    if (!page.pageHtml) continue;
    const $ = cheerio.load(page.pageHtml);

    // <img> collection
    $('img').each((_, el) => {
      const $el = $(el);
      const src = ($el.attr('src') || '').trim();
      const elementId = nearestElementId($, $el);
      const alt = $el.attr('alt');
      if (alt === undefined || alt.trim().length === 0) {
        issues.push({
          severity: 'warn',
          kind: 'image-missing-alt',
          pageSlug: page.slug,
          message: 'Image is missing descriptive alt text.',
          elementId,
        });
      }
      if (src) {
        probeTasks.push({ src, pageSlug: page.slug, elementId });
      }
    });

    // <a href="..."> — relative slug validation
    $('a[href]').each((_, el) => {
      const $el = $(el);
      const href = ($el.attr('href') || '').trim();
      if (!href) return;
      const slug = hrefToSlug(href);
      if (slug === null) return; // external / anchor / mailto — skip
      if (!input.knownSlugs.has(slug)) {
        issues.push({
          severity: 'warn',
          kind: 'link-unknown-slug',
          pageSlug: page.slug,
          message: `Link points to unknown page slug "${slug}".`,
          elementId: nearestElementId($, $el),
        });
      }
    });

    // Duplicate id="..." within a single page (skip empty/whitespace-only ids)
    const idSeen = new Map<string, number>();
    $('[id]').each((_, el) => {
      const raw = $(el).attr('id');
      if (!raw) return;
      const id = raw.trim();
      if (id.length === 0) return;
      idSeen.set(id, (idSeen.get(id) ?? 0) + 1);
    });
    for (const [id, count] of idSeen) {
      if (count > 1) {
        issues.push({
          severity: 'warn',
          kind: 'duplicate-id',
          pageSlug: page.slug,
          message: `Duplicate id="${id}" appears ${count} times on this page.`,
        });
      }
    }
  }

  // HEAD-probe all image URLs, bounded concurrency.
  if (probeTasks.length > 0) {
    const results = await boundedAll(probeTasks, HEAD_CONCURRENCY, async (task) => {
      const r = await probeImage(task.src);
      return { task, result: r };
    });
    for (const { task, result } of results) {
      if (!result.ok) {
        issues.push({
          severity: 'error',
          kind: 'image-broken',
          pageSlug: task.pageSlug,
          message: `Image failed to load (${result.reason ?? 'unknown'}): ${task.src}`,
          elementId: task.elementId,
        });
      }
    }
  }

  return issues;
}

// ---------- Claude Haiku review ----------

/**
 * Strip high-token noise from a page HTML before packing it into the digest:
 * inline <style> blocks, <script> blocks, and base64 data: image payloads.
 * The stripped markup keeps tag structure and copy, which is all the reviewer
 * needs.
 */
function stripForDigest(html: string): string {
  if (!html) return '';
  const $ = cheerio.load(html);
  $('style').remove();
  $('script').remove();
  $('link[rel="stylesheet"]').remove();
  $('img').each((_, el) => {
    const src = $(el).attr('src');
    if (src && src.startsWith('data:')) {
      // Keep the <img> tag but drop the heavy payload.
      $(el).attr('src', '<data-uri-removed>');
    }
  });
  const body = $('body').html();
  return (body ?? $.root().html() ?? '').trim();
}

const QA_SYSTEM_PROMPT = `You are a QA reviewer. Given a small multi-page site's HTML digest, find additional issues the static scan might miss: missing copy where a section clearly needs it, headline+body mismatch, layout risk (copy likely to overflow on mobile), contrast concerns flagged from palette hints, or anything else that would hurt the user's first impression.
Output STRICT JSON: {"issues":[{"severity":"error"|"warn"|"info","kind":"layout-risk"|"copy-missing"|"other","pageSlug":"string","message":"string","elementId":"string?"},...]}. Keep the list short (max 10 items) and only include concrete issues — no generic advice. If there are no issues, output {"issues":[]}.`;

const ALLOWED_HAIKU_KINDS: ReadonlySet<QaKind> = new Set<QaKind>([
  'layout-risk',
  'copy-missing',
  'other',
]);

const ALLOWED_SEVERITIES: ReadonlySet<QaSeverity> = new Set<QaSeverity>([
  'error',
  'warn',
  'info',
]);

/**
 * Extract a JSON object substring from a larger model response. Finds the
 * outermost `{...}` pair; tolerant of prose wrappers. Returns null if no
 * balanced object is found.
 */
function extractJsonObject(raw: string): string | null {
  const start = raw.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < raw.length; i += 1) {
    const ch = raw[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return raw.slice(start, i + 1);
      }
    }
  }
  return null;
}

function coerceHaikuIssues(
  raw: unknown,
  knownSlugs: Set<string>,
): QaIssue[] {
  if (!raw || typeof raw !== 'object') return [];
  const obj = raw as Record<string, unknown>;
  const arr = obj.issues;
  if (!Array.isArray(arr)) return [];

  const out: QaIssue[] = [];
  for (const entry of arr) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const severity = typeof e.severity === 'string' ? e.severity : '';
    const kind = typeof e.kind === 'string' ? e.kind : '';
    const pageSlug = typeof e.pageSlug === 'string' ? e.pageSlug : '';
    const message = typeof e.message === 'string' ? e.message : '';
    const elementId = typeof e.elementId === 'string' ? e.elementId : undefined;

    if (!ALLOWED_SEVERITIES.has(severity as QaSeverity)) continue;
    if (!ALLOWED_HAIKU_KINDS.has(kind as QaKind)) continue;
    if (!message || message.trim().length === 0) continue;

    const resolvedSlug =
      pageSlug && knownSlugs.has(pageSlug)
        ? pageSlug
        : // If Haiku hallucinates a slug, attribute the issue to the first page
          // we have rather than dropping it silently.
          [...knownSlugs][0] ?? '';
    if (!resolvedSlug) continue;

    out.push({
      severity: severity as QaSeverity,
      kind: kind as QaKind,
      pageSlug: resolvedSlug,
      message: message.trim(),
      elementId,
    });
    if (out.length >= 10) break;
  }
  return out;
}

async function runHaikuReview(
  siteName: string,
  pages: PageRow[],
  knownSlugs: Set<string>,
): Promise<QaIssue[]> {
  if (pages.length === 0) return [];

  const digestParts: string[] = [`# Site ${siteName}`];
  for (const page of pages) {
    digestParts.push(`## Page: ${page.slug}`);
    digestParts.push(stripForDigest(page.pageHtml));
  }
  const digest = digestParts.join('\n\n');

  let rawText = '';
  try {
    const response = await anthropic.messages.create({
      model: MODELS.fast,
      max_tokens: 1500,
      system: QA_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: digest,
        },
      ],
    });
    const block = response.content.find((b) => b.type === 'text');
    if (block && block.type === 'text') rawText = block.text;
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    const safe = raw.replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]');
    // eslint-disable-next-line no-console
    console.error('[qa] Haiku review failed; skipping.', safe);
    return [];
  }

  if (!rawText || rawText.trim().length === 0) return [];

  // Try direct parse first (model was obedient), then fall back to balanced
  // extraction if there's prose wrapping.
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    const chunk = extractJsonObject(rawText);
    if (chunk) {
      try {
        parsed = JSON.parse(chunk);
      } catch {
        parsed = null;
      }
    }
  }

  if (parsed === null) {
    // eslint-disable-next-line no-console
    console.warn('[qa] Haiku response did not contain parseable JSON; ignoring.');
    return [];
  }

  return coerceHaikuIssues(parsed, knownSlugs);
}

// ---------- Entry point ----------

export async function runQa(siteId: string): Promise<QaReport> {
  const generatedAt = new Date().toISOString();

  const site = await prisma.site.findUnique({
    where: { id: siteId },
    select: {
      id: true,
      name: true,
      pages: {
        select: { slug: true, pageHtml: true, orderIdx: true },
        orderBy: { orderIdx: 'asc' },
      },
    },
  });

  if (!site) {
    return { siteId, generatedAt, issues: [] };
  }

  const pages: PageRow[] = site.pages.map((p) => ({
    slug: p.slug,
    pageHtml: p.pageHtml ?? '',
  }));
  const knownSlugs = new Set<string>(pages.map((p) => p.slug));

  const [staticIssues, haikuIssues] = await Promise.all([
    runStaticScan({ pages, knownSlugs }).catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.error('[qa] static scan failed', err);
      return [] as QaIssue[];
    }),
    runHaikuReview(site.name || 'Untitled', pages, knownSlugs).catch(
      (err: unknown) => {
        // eslint-disable-next-line no-console
        console.error('[qa] haiku review failed', err);
        return [] as QaIssue[];
      },
    ),
  ]);

  return {
    siteId,
    generatedAt,
    issues: [...staticIssues, ...haikuIssues],
  };
}
