/* eslint-disable no-console */
// Phase 5 end-to-end golden-path smoke.
//
// Run: npm run e2e
//
// Talks directly to service-layer functions (no HTTP) for determinism — this
// is the same layer the API routes call, so a passing e2e means the full
// in-process path is healthy. For a network-level run, aim the smoke scripts
// at `npm run dev`.

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
import { generateThemeForSite } from '../src/server/services/themeService';
import { generatePage } from '../src/server/services/pageService';
import {
  upsertElementBySelector,
  patchElementDirect,
} from '../src/server/services/elementService';
import { bundleSite } from '../src/server/deploy/bundler';

const hasLiveKey = Boolean(process.env.OPENAI_API_KEY && /^sk-/.test(process.env.OPENAI_API_KEY));

interface Step {
  name: string;
  status: 'pass' | 'fail' | 'skip';
  ms: number;
  detail?: string;
}

const steps: Step[] = [];

async function run(name: string, fn: () => Promise<void>, opts: { skipWithoutAI?: boolean } = {}) {
  if (opts.skipWithoutAI && !hasLiveKey) {
    steps.push({ name, status: 'skip', ms: 0, detail: 'needs live OPENAI_API_KEY' });
    console.log(`SKIP — ${name}`);
    return;
  }
  const t0 = Date.now();
  try {
    await fn();
    const ms = Date.now() - t0;
    steps.push({ name, status: 'pass', ms });
    console.log(`PASS — ${name} (${ms}ms)`);
  } catch (err) {
    const ms = Date.now() - t0;
    const detail = err instanceof Error ? err.message : String(err);
    steps.push({ name, status: 'fail', ms, detail });
    console.error(`FAIL — ${name} (${ms}ms): ${detail}`);
  }
}

async function main() {
  const overallStart = Date.now();

  const site = await prisma.site.create({
    data: {
      name: `e2e-${Date.now()}`,
      sitePrompt: 'A tiny indie bookstore in a college town. Plain voice; no marketing fluff.',
      stylePresetId: 'warm-craft',
    },
  });
  console.log(`Site ${site.id}`);

  await run('theme.generate', async () => {
    if (!hasLiveKey) {
      const tokens = {
        radius: { sm: '4px', md: '8px', lg: '16px', pill: '999px' },
        shadow: { sm: 'none', md: 'none', lg: 'none' },
        spacing: [0, 4, 8, 12, 16, 24, 32, 48, 64, 96],
        typeScale: [12, 14, 16, 18, 22, 28, 36, 48, 64, 80],
        motion: { easing: 'ease', durationMs: 200, style: 'subtle' },
        grid: { maxWidth: '1200px', gutter: '24px', columns: 12 },
      };
      const palette = { primary: '#111', secondary: '#666', accent: '#f33', surface: '#fff', ink: '#111', muted: '#999' };
      const library = {
        Header: { html: '', css: '' },
        Footer: { html: '', css: '' },
        Button: { html: '', css: '' },
        Card: { html: '', css: '' },
      };
      await prisma.theme.create({
        data: {
          siteId: site.id,
          stylePresetId: 'warm-craft',
          tokensJson: JSON.stringify(tokens),
          libraryJson: JSON.stringify(library),
          paletteJson: JSON.stringify(palette),
          primaryFont: 'Inter',
          secondaryFont: 'Inter',
          signatureMotif: 'stub',
        },
      });
      return;
    }
    await generateThemeForSite(site.id);
  });

  const pageDefs = [
    { name: 'Home', slug: 'home', pagePrompt: 'Hero + staff picks + hours.' },
    { name: 'Events', slug: 'events', pagePrompt: 'Upcoming readings, one tile each.' },
    { name: 'About', slug: 'about', pagePrompt: 'Who we are, short.' },
  ];
  const pages: { id: string; slug: string }[] = [];
  await run('pages.create x3', async () => {
    for (let i = 0; i < pageDefs.length; i++) {
      const p = pageDefs[i];
      const row = await prisma.page.create({
        data: {
          siteId: site.id,
          name: p.name,
          slug: p.slug,
          pagePrompt: p.pagePrompt,
          orderIdx: i,
        },
      });
      pages.push({ id: row.id, slug: row.slug });
    }
  });

  await run('pages.generate in parallel', async () => {
    const results = await Promise.allSettled(pages.map((p) => generatePage(p.id)));
    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length) throw new Error(`${failed.length}/${results.length} pages failed`);
  }, { skipWithoutAI: true });

  await run('element.upsert on home', async () => {
    const home = pages[0];
    await upsertElementBySelector(home.id, {
      selectorId: 'sc-el-e2e-1',
      role: 'custom',
      html: '<p>hi</p>',
      css: '',
    });
  });

  await run('element.patch text override', async () => {
    const home = pages[0];
    const existing = await prisma.element.findUnique({
      where: { pageId_selectorId: { pageId: home.id, selectorId: 'sc-el-e2e-1' } },
    });
    if (!existing) throw new Error('upserted element missing');
    const patched = await patchElementDirect(home.id, existing.id, { html: '<p>override</p>' });
    if (patched.html !== '<p>override</p>') throw new Error('override failed');
  });

  await run('deploy.bundler dry-run', async () => {
    const files = await bundleSite(site.id);
    if (!files.find((f) => f.path === 'index.html')) throw new Error('no index.html');
  }, { skipWithoutAI: true });

  // cleanup
  await prisma.site.delete({ where: { id: site.id } }).catch(() => {});
  await prisma.$disconnect();

  const total = Date.now() - overallStart;
  const pass = steps.filter((s) => s.status === 'pass').length;
  const fail = steps.filter((s) => s.status === 'fail').length;
  const skip = steps.filter((s) => s.status === 'skip').length;

  console.log('\n--- summary ---');
  for (const s of steps) {
    console.log(`${s.status.toUpperCase().padEnd(4)} ${s.ms.toString().padStart(6)}ms  ${s.name}${s.detail ? ' — ' + s.detail : ''}`);
  }
  console.log(`\ntotal ${total}ms — pass=${pass} fail=${fail} skip=${skip}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error('fatal:', err);
  try { await prisma.$disconnect(); } catch {}
  process.exit(1);
});
