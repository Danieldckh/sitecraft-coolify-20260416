/* eslint-disable no-console */
// End-to-end seed script for Sitecraft v2.
//
// Run:  npx tsx scripts/seed-v2.ts
//
// Creates a demo site, generates a theme, generates 4 pages in parallel,
// edits one element, logs all timings, and prints excerpts so a human can
// eyeball whether the output looks non-generic.

import { readFileSync } from 'node:fs';
import path from 'node:path';
// Minimal .env loader so the script runs without a dotenv dependency.
try {
  const raw = readFileSync(path.resolve(process.cwd(), '.env'), 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    const [, k, vRaw] = m;
    if (process.env[k]) continue;
    const v = vRaw.replace(/^['"]|['"]$/g, '');
    process.env[k] = v;
  }
} catch {
  // ignore; env may be provided by the shell
}
import { prisma } from '../src/server/db/client';
import { generateThemeForSite } from '../src/server/services/themeService';
import { generatePage } from '../src/server/services/pageService';
import { editElement } from '../src/server/services/elementService';

async function main() {
  const overallStart = Date.now();
  const log = (m: string) => console.log(`[seed] ${m}`);

  // 1) Create site
  log('Creating demo site');
  const site = await prisma.site.create({
    data: {
      name: `Kiln & Ember (demo ${Date.now().toString(36).slice(-4)})`,
      sitePrompt:
        'A small-batch ceramics studio in Portland, Oregon, run by two ' +
        'sisters. The site sells wheel-thrown stoneware mugs and vases, runs ' +
        'seasonal workshop sign-ups, and tells the story of the kiln room. ' +
        'Tone: warm, plainspoken, craft-forward. Not precious. Not corporate.',
      stylePresetId: 'warm-craft',
    },
  });
  log(`Site ${site.id}`);

  const pageDefs = [
    { name: 'Home', slug: 'home', pagePrompt: 'Hero with a chapter-photo intro to the studio, a row of signature pieces, a next-workshop strip, and a link over to the shop. No testimonials.' },
    { name: 'Shop', slug: 'shop', pagePrompt: 'Product gallery of current mugs/vases in stock. Each tile has title + hand-set price + one-line note. Filter by glaze family. No reviews.' },
    { name: 'Workshops', slug: 'workshops', pagePrompt: 'Seasonal wheel-throwing workshops. List dates, capacity (6 seats), and a short description each. Include a "Bring your kids on Sundays" note.' },
    { name: 'About', slug: 'about', pagePrompt: 'Photo-first chapter layout: the kiln room, the wheel, the two sisters. End with values (three) and a founder letter sentence.' },
  ];

  // Create page rows up front.
  log('Creating pages');
  const pages = await Promise.all(
    pageDefs.map((p, i) =>
      prisma.page.create({
        data: {
          siteId: site.id,
          name: p.name,
          slug: p.slug,
          pagePrompt: p.pagePrompt,
          orderIdx: i,
        },
      }),
    ),
  );

  // 2) Theme
  const themeStart = Date.now();
  log('Generating theme (Stage 2)…');
  const theme = await generateThemeForSite(site.id);
  const themeElapsed = Date.now() - themeStart;
  log(`Theme done in ${themeElapsed}ms`);
  log(`  preset = ${theme.stylePresetId}`);
  log(`  fonts  = ${theme.primaryFont} + ${theme.secondaryFont}`);
  log(`  motif  = ${theme.signatureMotif}`);
  log(`  palette = ${JSON.stringify(theme.palette)}`);

  // 3) Pages in parallel
  log('Generating 4 pages in parallel…');
  const pageStart = Date.now();
  const results = await Promise.allSettled(pages.map((p) => generatePage(p.id)));
  const pageElapsed = Date.now() - pageStart;
  log(`Pages finished in ${pageElapsed}ms`);
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      log(`  ${pages[i].slug}: OK (html ${r.value.pageHtml.length} chars)`);
    } else {
      log(`  ${pages[i].slug}: FAILED — ${String(r.reason)}`);
    }
  });

  // 4) Element edit on a hero-looking element of the home page.
  const home = await prisma.page.findFirstOrThrow({
    where: { siteId: site.id, slug: 'home' },
    include: { elements: true },
  });
  const target = home.elements.find((e) => e.role === 'hero') ?? home.elements[0];
  if (target) {
    log(`Editing element ${target.selectorId} (${target.role}/${target.variantId})…`);
    const editStart = Date.now();
    try {
      const updated = await editElement(
        home.id,
        target.id,
        'Tighten the headline to 6 words or fewer; keep the dateline caption.',
      );
      log(`Edit done in ${Date.now() - editStart}ms (html ${updated.html.length} chars)`);
    } catch (err) {
      log(`Edit FAILED: ${String(err)}`);
    }
  } else {
    log('No elements found on home — skipping edit step');
  }

  // 5) Print excerpts for human non-generic check.
  log('--- sample headline-check ---');
  const sample = await prisma.page.findFirstOrThrow({
    where: { siteId: site.id, slug: 'home' },
    include: { elements: true },
  });
  log(`home.pageHtml[0..600]:\n${sample.pageHtml.slice(0, 600)}`);

  log('--- summary ---');
  log(`total elapsed: ${Date.now() - overallStart}ms`);
  log(`site id: ${site.id}`);
  log(`theme preset: ${theme.stylePresetId}, motif: "${theme.signatureMotif}"`);
  log(`pages generated: ${results.filter((r) => r.status === 'fulfilled').length}/${results.length}`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('[seed] fatal:', err);
  await prisma.$disconnect();
  process.exit(1);
});
