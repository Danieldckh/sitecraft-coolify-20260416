/* eslint-disable no-console */
// Phase 5 security smoke test.
//
// Run:  npm run smoke:security
//
// Deterministic — no live OpenAI/GitHub required. Verifies:
//   1. DOMPurify strips <script>/onerror from bundler output.
//   2. Ban-list image path traversal is rejected.
//   3. Magic-byte sniff rejects SVG + HTML-as-image.
//   4. Token redaction scrubs bearer + gh_ secrets.
//   5. Rate limiter flips to 429 after capacity exhausted.

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

// Soft-set required env so imports that pull env.ts don't blow up.
process.env.DATABASE_URL ||= 'file:./dev.db';
process.env.OPENAI_API_KEY ||= 'sk-smoke-fake';
process.env.COOLIFY_BASE_URL ||= 'http://localhost';
process.env.COOLIFY_API_TOKEN ||= 'smoke';
process.env.GITHUB_TOKEN ||= 'smoke';

import { bundleSite } from '../src/server/deploy/bundler';
import { prisma } from '../src/server/db/client';
import { resolveImageUrlForOpenAI } from '../src/server/ai/imageUrl';
import { sniffImageMime } from '../src/server/storage';
import { redactSecrets } from '../src/server/deploy/coolify';
import { checkRateLimit } from '../src/server/rateLimit';

let passed = 0;
let failed = 0;

function ok(msg: string) { passed++; console.log('  PASS —', msg); }
function bad(msg: string, extra?: unknown) {
  failed++;
  console.error('  FAIL —', msg, extra ?? '');
}

async function testBundlerSanitation() {
  console.log('\n[1] Bundler sanitizes page HTML');
  // Find or create a scratch site with a malicious page.
  const malicious = '<script>alert(1)</script><img src=x onerror="alert(1)"><p>ok</p>';

  const site = await prisma.site.create({
    data: { name: `smoke-${Date.now()}`, sitePrompt: '' },
  });
  try {
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
        signatureMotif: 'none',
      },
    });
    await prisma.page.create({
      data: {
        siteId: site.id,
        name: 'Home',
        slug: 'home',
        pagePrompt: '',
        pageHtml: malicious,
        pageCss: '',
        pageJs: '',
        orderIdx: 0,
      },
    });

    const files = await bundleSite(site.id);
    const home = files.find((f) => f.path === 'index.html')!;
    if (/<script/i.test(home.content)) bad('bundle contains <script>');
    else ok('bundle stripped <script>');
    if (/onerror=/i.test(home.content)) bad('bundle contains onerror=');
    else ok('bundle stripped onerror=');
    if (!/<p>ok<\/p>/.test(home.content)) bad('bundle lost benign <p>');
    else ok('bundle preserved benign <p>ok</p>');
  } finally {
    await prisma.site.delete({ where: { id: site.id } }).catch(() => {});
  }
}

async function testPathTraversal() {
  console.log('\n[2] Image URL path traversal rejected');
  const tries = ['/uploads/../../.env', '/../etc/passwd', '\\..\\..\\secret'];
  for (const t of tries) {
    try {
      await resolveImageUrlForOpenAI(t);
      bad(`accepted bad path: ${t}`);
    } catch {
      ok(`rejected: ${t}`);
    }
  }
}

function testMagicBytes() {
  console.log('\n[3] Magic-byte sniff');
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  const html = Buffer.from('<!doctype html><script>alert(1)</script>');
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  if (sniffImageMime(svg)) bad('SVG sniffed as image');
  else ok('SVG rejected by sniff');
  if (sniffImageMime(html)) bad('HTML sniffed as image');
  else ok('HTML rejected by sniff');
  if (sniffImageMime(png) === 'image/png') ok('PNG recognized');
  else bad('PNG not recognized');
}

function testRedaction() {
  console.log('\n[4] Token redaction');
  const samples = [
    'Authorization: Bearer sk-abc123DEFxyz456',
    'bearer ghp_abcdefghijklmnopqrstuvwxyz0123456789',
    'api_token="0123456789ABCDEF0123456789"',
    'Token: ghp_abcdefghijklmnopqrstuvwxyz0123456789',
  ];
  for (const s of samples) {
    const r = redactSecrets(s);
    if (/sk-abc123DEFxyz456|ghp_abcdefghij/.test(r)) bad(`leak: ${r}`);
    else ok(`redacted: ${r}`);
  }
}

function testRateLimit() {
  console.log('\n[5] Rate limiter flips to 429');
  const req = new Request('http://x', { headers: { 'x-forwarded-for': '10.0.0.1' } });
  let allowed = 0;
  let denied = 0;
  for (let i = 0; i < 35; i++) {
    const r = checkRateLimit(req, 'ai');
    if (r.ok) allowed++;
    else denied++;
  }
  if (allowed >= 29 && allowed <= 31) ok(`~30 allowed (got ${allowed})`);
  else bad(`unexpected allowed count ${allowed}`);
  if (denied >= 4) ok(`denied ${denied} over cap`);
  else bad(`not enough denied (got ${denied})`);
}

async function main() {
  await testBundlerSanitation();
  await testPathTraversal();
  testMagicBytes();
  testRedaction();
  testRateLimit();

  await prisma.$disconnect();

  console.log(`\n=== smoke:security ${failed === 0 ? 'PASS' : 'FAIL'} — ${passed} passed, ${failed} failed ===`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error('fatal:', err);
  try { await prisma.$disconnect(); } catch {}
  process.exit(1);
});
