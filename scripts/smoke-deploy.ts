/* eslint-disable no-console */
// Phase 5 deploy smoke — writes bundle to .deploy-dryrun/ and asserts shape.
//
// Run:  npm run smoke:deploy

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
  // .env optional
}

process.env.DATABASE_URL ||= 'file:./dev.db';
process.env.OPENAI_API_KEY ||= 'sk-smoke';
process.env.COOLIFY_BASE_URL ||= 'http://localhost';
process.env.COOLIFY_API_TOKEN ||= 'smoke';
process.env.GITHUB_TOKEN ||= 'smoke';

import { mkdir, rm, writeFile, readdir } from 'node:fs/promises';
import { prisma } from '../src/server/db/client';
import { bundleSite } from '../src/server/deploy/bundler';

async function main() {
  const candidates = await prisma.site.findMany({ include: { pages: true, theme: true } });
  const site = candidates.find(
    (s) => s.theme && s.pages.some((p) => p.pageHtml && p.pageHtml.length > 0),
  );
  if (!site) {
    console.error('SKIP: no seeded site with theme + generated page. Run `npx tsx scripts/seed-v2.ts` first.');
    process.exit(2);
  }
  console.log(`Using site "${site.name}" (${site.id}) — ${site.pages.length} pages`);

  const out = path.resolve(process.cwd(), '.deploy-dryrun');
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });

  const bundleStart = Date.now();
  const files = await bundleSite(site.id);
  console.log(`Bundled ${files.length} files in ${Date.now() - bundleStart}ms`);

  for (const f of files) {
    const dest = path.resolve(out, f.path);
    const destDir = path.dirname(dest);
    await mkdir(destDir, { recursive: true });
    await writeFile(dest, f.content, 'utf8');
  }

  console.log('\nTree:');
  const tree = await readdir(out);
  for (const name of tree) console.log(' ', name);

  let failed = 0;
  const ok = (m: string) => console.log('  PASS —', m);
  const bad = (m: string) => { failed++; console.error('  FAIL —', m); };

  if (files.find((f) => f.path === 'index.html')) ok('index.html present');
  else bad('missing index.html');
  if (files.find((f) => f.path === 'README.md')) ok('README.md present');
  else bad('missing README.md');

  for (const p of site.pages) {
    if (!p.pageHtml) continue;
    const expected = p.slug === 'home' ? 'index.html' : `${p.slug}.html`;
    if (files.find((f) => f.path === expected)) ok(`page file ${expected}`);
    else bad(`missing page file ${expected}`);
  }

  // Sanity: no raw <script> in outputs.
  for (const f of files) {
    if (/<script[>\s]/i.test(f.content)) {
      bad(`script tag leaked into ${f.path}`);
    }
  }

  if (process.env.GITHUB_TOKEN && process.env.GITHUB_TOKEN !== 'smoke') {
    console.log('\nGITHUB_TOKEN present — live push check is OPT-IN; skipping to avoid accidental writes. Run the full deploy route for a real push.');
  } else {
    console.log('\nGITHUB_TOKEN not set — live push skipped.');
  }

  await prisma.$disconnect();
  console.log(`\n=== smoke:deploy ${failed === 0 ? 'PASS' : 'FAIL'} ===`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error('fatal:', err);
  try { await prisma.$disconnect(); } catch {}
  process.exit(1);
});
