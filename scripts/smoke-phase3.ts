/* eslint-disable no-console */
// Phase 3 smoke test: verify full-site preview doc has correct structure.
//
// Run:  npm run smoke:phase3

import { readFileSync } from 'node:fs';
import path from 'node:path';

try {
  const raw = readFileSync(path.resolve(process.cwd(), '.env'), 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    const [, k, vRaw] = m;
    if (process.env[k]) continue;
    process.env[k] = vRaw.replace(/^['"]|['"]$/g, '');
  }
} catch {
  // .env is optional
}

import { prisma } from '../src/server/db/client';
import { toPageDTO, toSiteDTO, toThemeDTO } from '../src/server/db/mappers';
import { buildFullSiteDoc } from '../src/components/builder/PreviewTab/buildFullSiteDoc';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
  console.log('  ok —', msg);
}

async function main() {
  // Find a site with >=2 generated pages.
  const candidates = await prisma.site.findMany({
    include: {
      pages: true,
      theme: true,
    },
  });

  const site = candidates.find(
    (s) =>
      s.theme &&
      s.pages.filter((p) => p.pageHtml && p.pageHtml.trim().length > 0).length >= 2,
  );

  if (!site || !site.theme) {
    console.error(
      'SKIP: no site with >=2 generated pages + theme found. Run `npx tsx scripts/seed-v2.ts` first.',
    );
    process.exit(2);
  }

  console.log(`Using site "${site.name}" (${site.id}) with ${site.pages.length} pages.`);

  // Inject a literal /<slug> href into header HTML so we can verify rewriting.
  const firstSlug = site.pages[0].slug;
  const originalHeaderLib = site.theme.libraryJson;
  const lib = JSON.parse(originalHeaderLib);
  if (lib.Header && typeof lib.Header.html === 'string') {
    // Insert a known sentinel anchor if not present.
    if (!lib.Header.html.includes(`href="/${firstSlug}"`)) {
      lib.Header.html =
        lib.Header.html.replace(/<\/nav>|<\/header>/i, (m: string) =>
          `<a href="/${firstSlug}" data-sc-smoke="1">Go</a>${m}`,
        ) || lib.Header.html + `<a href="/${firstSlug}" data-sc-smoke="1">Go</a>`;
    }
  }

  const siteDto = toSiteDTO(site);
  const themeDto = toThemeDTO({ ...site.theme, libraryJson: JSON.stringify(lib) });
  const pageDtos = site.pages.map(toPageDTO);

  const currentSlug = pageDtos[0].slug;
  const html = buildFullSiteDoc({
    site: siteDto,
    theme: themeDto,
    pages: pageDtos,
    currentSlug,
  });

  console.log('\nAssertions:');

  // One section per page.
  const sectionMatches = html.match(/<section data-sc-page-slug="/g) ?? [];
  assert(
    sectionMatches.length === pageDtos.length,
    `found ${sectionMatches.length} page sections, expected ${pageDtos.length}`,
  );

  // Each slug present exactly once.
  for (const p of pageDtos) {
    const re = new RegExp(`data-sc-page-slug="${p.slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`, 'g');
    const count = (html.match(re) || []).length;
    assert(count === 1, `slug "${p.slug}" appears ${count} times (expected 1)`);
  }

  // Exactly one section has display:block.
  const blockCount = (html.match(/data-sc-page-slug="[^"]+"[^>]*style="display:block"/g) || []).length;
  assert(blockCount === 1, `exactly one visible section (got ${blockCount})`);

  // Display:none count = pages - 1.
  const noneCount = (html.match(/data-sc-page-slug="[^"]+"[^>]*style="display:none"/g) || []).length;
  assert(
    noneCount === pageDtos.length - 1,
    `${noneCount} hidden sections (expected ${pageDtos.length - 1})`,
  );

  // Router script contains the navigate function.
  assert(
    /function\s+navigate\s*\(\s*slug/.test(html),
    'router script contains `function navigate(slug)`',
  );

  // Header anchor hrefs were rewritten: no bare href="/<slug>" remains for known slugs.
  const bareHeaderRe = new RegExp(`href="/${firstSlug}"`);
  assert(!bareHeaderRe.test(html), `no bare href="/${firstSlug}" in output (should be rewritten to #/${firstSlug})`);
  assert(html.includes(`href="#/${firstSlug}"`), `header anchor rewritten to href="#/${firstSlug}"`);

  console.log('\nPASS: Phase 3 smoke test');
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('FAIL:', err);
  try {
    await prisma.$disconnect();
  } catch {}
  process.exit(1);
});
