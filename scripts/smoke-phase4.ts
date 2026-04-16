/* eslint-disable no-console */
// Phase 4 smoke test: verify element upsert + direct patch flow.
//
// Run:  npm run smoke:phase4

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

import { prisma } from '../src/server/db/client';
import {
  upsertElementBySelector,
  patchElementDirect,
} from '../src/server/services/elementService';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
  console.log('  ok —', msg);
}

async function main() {
  const candidates = await prisma.site.findMany({
    include: { pages: true, theme: true },
  });
  const site = candidates.find(
    (s) => s.theme && s.pages.filter((p) => p.pageHtml && p.pageHtml.trim().length > 0).length >= 1,
  );
  if (!site) {
    console.error(
      'SKIP: no site with a generated page + theme. Run `npx tsx scripts/seed-v2.ts` first.',
    );
    process.exit(2);
  }
  const page = site.pages.find((p) => p.pageHtml && p.pageHtml.trim().length > 0)!;
  console.log(`Using site "${site.name}" page "${page.slug}" (${page.id})`);

  const selectorId = 'sc-el-smoketest';

  // Clean up any previous smoke rows.
  await prisma.element.deleteMany({ where: { pageId: page.id, selectorId } });

  console.log('\nAssertions:');

  // Upsert creates.
  const created = await upsertElementBySelector(page.id, {
    selectorId,
    role: 'custom',
    html: '<p>hello</p>',
    css: '.x{color:red}',
  });
  assert(created.selectorId === selectorId, 'upsert returns element with selectorId');
  assert(created.html === '<p>hello</p>', 'upsert stored html');
  assert(created.role === 'custom', 'upsert stored role');

  // Upsert second time updates.
  const updated = await upsertElementBySelector(page.id, {
    selectorId,
    html: '<p>hi2</p>',
  });
  assert(updated.id === created.id, 'upsert is idempotent on selectorId');
  assert(updated.html === '<p>hi2</p>', 'upsert updated html');

  // Direct patch text override.
  const patched = await patchElementDirect(page.id, created.id, {
    html: '<p>overwrite</p>',
  });
  assert(patched.html === '<p>overwrite</p>', 'patchElementDirect wrote new html');

  // Confirm via DB.
  const row = await prisma.element.findUnique({ where: { id: created.id } });
  assert(row?.html === '<p>overwrite</p>', 'DB row reflects latest html');

  // Cleanup.
  await prisma.element.delete({ where: { id: created.id } });

  console.log('\nPASS: Phase 4 smoke test');
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('FAIL:', err);
  try {
    await prisma.$disconnect();
  } catch {}
  process.exit(1);
});
