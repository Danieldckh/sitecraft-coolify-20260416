// GET /api/export/[siteId] — download a zip containing every page of the
// assembled site as static HTML files.
//
// Contents:
//   index.html    — the Home page (slug "home")
//   {slug}.html   — every other page, one per Page row
//   README.md     — site name + generated date + a one-liner on how to open
//
// Nav rewrites:
//   Designer output uses relative `./{slug}` hrefs (so they work inside the
//   preview iframe). For the offline zip we rewrite those to filenames:
//     ./home   -> ./index.html
//     ./about  -> ./about.html
//   External hrefs are untouched.
//
// Runtime: nodejs (adm-zip relies on Buffer / Node APIs).

import { NextRequest, NextResponse } from 'next/server';
import AdmZip from 'adm-zip';
import { prisma } from '@/server/db/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function slugify(name: string): string {
  const cleaned = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned.length > 0 ? cleaned.slice(0, 60) : 'site';
}

function pageFilenameForSlug(slug: string): string {
  return slug === 'home' ? 'index.html' : `${slug}.html`;
}

/**
 * Rewrite every `href="./{slug}"` (or `href='./{slug}'`) that matches a known
 * page slug to the corresponding output filename. Trailing slashes and hash
 * fragments on the href are preserved.
 *
 * We match against the set of known slugs only — external or unknown hrefs
 * are left alone.
 */
function rewriteNavLinks(html: string, knownSlugs: readonly string[]): string {
  if (knownSlugs.length === 0) return html;

  // Escape slugs for regex; they're kebab-case so this is mostly a no-op but
  // we keep it defensive in case a future slug contains regex metachars.
  const escaped = knownSlugs.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  // Match: href=" ./  (slug)  (optional / )  (optional #frag)  "
  //        href=' ./  (slug)  (optional / )  (optional #frag)  '
  const pattern = new RegExp(
    `href=(["'])\\.\\/(${escaped.join('|')})(\\/?)(#[^"']*)?\\1`,
    'g',
  );
  return html.replace(pattern, (_m, quote: string, slug: string, _slash: string, frag?: string) => {
    const file = pageFilenameForSlug(slug);
    const suffix = frag ?? '';
    return `href=${quote}./${file}${suffix}${quote}`;
  });
}

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ siteId: string }> },
): Promise<NextResponse> {
  const { siteId } = await context.params;
  if (!siteId) {
    return NextResponse.json({ error: 'Missing siteId' }, { status: 400 });
  }

  try {
    const site = await prisma.site.findUnique({ where: { id: siteId } });
    if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 });

    const pages = await prisma.page.findMany({
      where: { siteId },
      orderBy: { orderIdx: 'asc' },
    });
    if (pages.length === 0) {
      return NextResponse.json({ error: 'Site has no pages' }, { status: 404 });
    }

    const knownSlugs = pages.map((p) => p.slug);

    const today = new Date().toISOString().slice(0, 10);
    const readme = `# ${site.name}

Generated ${today} with Website Builder.

Open \`index.html\` in a browser.
`;

    const zip = new AdmZip();
    for (const page of pages) {
      const rewritten = rewriteNavLinks(page.pageHtml ?? '', knownSlugs);
      const filename = pageFilenameForSlug(page.slug);
      zip.addFile(filename, Buffer.from(rewritten, 'utf8'));
    }
    zip.addFile('README.md', Buffer.from(readme, 'utf8'));

    const buffer: Buffer = zip.toBuffer();
    // ArrayBuffer copy so the Response body is a plain, detached ArrayBuffer
    // (Node's Buffer shares the underlying pool — fine in practice, but this
    // keeps the Response body type-clean and Edge-deserialization-safe).
    const body = new Uint8Array(buffer.byteLength);
    body.set(buffer);

    const filename = `${slugify(site.name)}.zip`;
    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(body.byteLength),
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('[api/export] failed', err);
    return NextResponse.json({ error: 'Export failed' }, { status: 500 });
  }
}
