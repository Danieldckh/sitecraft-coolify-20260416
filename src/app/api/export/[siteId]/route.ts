// GET /api/export/[siteId] — download a zip containing the assembled site.
//
// Contents:
//   index.html — Page.pageHtml of the "home" page
//   README.md  — site name + generated date + a one-liner on how to open
//
// Runtime: nodejs (adm-zip relies on Buffer / Node APIs).

import { NextRequest, NextResponse } from 'next/server';
import AdmZip from 'adm-zip';
import { prisma } from '@/server/db/client';

export const runtime = 'nodejs';

function slugify(name: string): string {
  const cleaned = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned.length > 0 ? cleaned.slice(0, 60) : 'site';
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

    const page = await prisma.page.findUnique({
      where: { siteId_slug: { siteId, slug: 'home' } },
    });
    if (!page) return NextResponse.json({ error: 'Page not found' }, { status: 404 });

    const today = new Date().toISOString().slice(0, 10);
    const readme = `# ${site.name}

Generated ${today} with Website Builder.

Open \`index.html\` in a browser.
`;

    const zip = new AdmZip();
    zip.addFile('index.html', Buffer.from(page.pageHtml ?? '', 'utf8'));
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
