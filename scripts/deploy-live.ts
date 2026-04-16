/* eslint-disable no-console */
// Live deploy — mirrors src/app/api/deploy/[siteId]/route.ts but runs standalone,
// streams progress to stdout, polls Coolify for FQDN, curls the public URL, and
// writes a dated report to docs/deploy/.

import { readFileSync, mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

// Load .env into process.env before importing any server modules that read env.
try {
  const raw = readFileSync(path.resolve(process.cwd(), '.env'), 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    const [, k, vRaw] = m;
    // Always prefer .env values (shell has stale tokens on this machine).
    process.env[k] = vRaw.replace(/^['"]|['"]$/g, '');
  }
} catch {}

process.env.DATABASE_URL ||= 'file:./dev.db';

import { prisma } from '../src/server/db/client';
import { bundleSite } from '../src/server/deploy/bundler';
import {
  ensureDeployRepo,
  pushBundle,
  SITECRAFT_REPO_MARKER,
  octokit,
} from '../src/server/deploy/github';
import {
  ensureStaticApp,
  triggerDeploy,
  waitForDeploy,
  getApp,
  getDeployment,
  redactSecrets,
} from '../src/server/deploy/coolify';

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'site'
  );
}

function ms(start: number): number {
  return Date.now() - start;
}

function fmt(d: number): string {
  if (d < 1000) return `${d}ms`;
  return `${(d / 1000).toFixed(1)}s`;
}

async function main() {
  const t0 = Date.now();
  const log = (m: string) => console.log(`[${new Date().toISOString()}] ${m}`);

  const sites = await prisma.site.findMany({ include: { pages: true, theme: true } });
  const site = sites.find((s) => s.theme && s.pages.some((p) => p.pageHtml && p.pageHtml.length > 0));
  if (!site) {
    console.error('No seeded site. Run `npx tsx scripts/seed-v2.ts`.');
    process.exit(2);
  }
  log(`Site: "${site.name}" (${site.id}) — ${site.pages.length} pages`);

  const baseSlug = slugify(site.name) + '-' + site.id.slice(-6);
  let siteSlug = baseSlug;

  const prior = await prisma.deployment.findFirst({
    where: { siteId: site.id, coolifyAppUuid: { not: null } },
    orderBy: { createdAt: 'desc' },
  });

  const deployment = await prisma.deployment.create({
    data: {
      siteId: site.id,
      status: 'pending',
      coolifyAppUuid: prior?.coolifyAppUuid ?? null,
      logs: '',
    },
  });

  const warnings: string[] = [];
  const timings: Record<string, number> = {};
  let coolifyErrorJson = '';

  try {
    // BUNDLE
    const tBundle = Date.now();
    log('Bundling site...');
    const files = await bundleSite(site.id);
    timings.bundle = ms(tBundle);
    log(`  bundled ${files.length} files in ${fmt(timings.bundle)}`);

    // REPO
    const tRepo = Date.now();
    log('Ensuring GitHub deploy repo...');
    let repo;
    try {
      repo = await ensureDeployRepo(site.id, siteSlug);
    } catch (e: any) {
      if (/lacks the required topic/i.test(String(e?.message))) {
        const suffix = randomUUID().slice(0, 8);
        siteSlug = `${baseSlug}-${suffix}`;
        warnings.push(`Existing repo missing '${SITECRAFT_REPO_MARKER}' marker; switched to UUID-suffixed slug ${siteSlug}`);
        log(`  retry with slug ${siteSlug}`);
        repo = await ensureDeployRepo(site.id, siteSlug);
      } else {
        throw e;
      }
    }
    log(`  repo: ${repo.htmlUrl} (${fmt(ms(tRepo))})`);

    // PUSH
    const tPush = Date.now();
    log('Pushing bundle...');
    const { commitSha } = await pushBundle(
      repo.owner,
      repo.repo,
      files,
      `Sitecraft live deploy ${new Date().toISOString()}`,
    );
    timings.push = ms(tPush);
    log(`  commit ${commitSha.slice(0, 10)} in ${fmt(timings.push)}`);

    await prisma.deployment.update({
      where: { id: deployment.id },
      data: { status: 'building' },
    });

    // COOLIFY APP
    const tApp = Date.now();
    log('Ensuring Coolify application...');
    const app = await ensureStaticApp({
      siteId: site.id,
      siteSlug,
      repoUrl: `https://github.com/${repo.owner}/${repo.repo}`,
      branch: 'main',
      existingAppUuid: prior?.coolifyAppUuid ?? null,
    });
    log(`  app ${app.uuid} (${fmt(ms(tApp))})`);

    // TRIGGER
    const tTrig = Date.now();
    const isFirst = !prior?.coolifyAppUuid;
    log(`Triggering deploy (first=${isFirst})...`);
    let deploymentUuid: string | undefined;
    try {
      const trig = await triggerDeploy(app.uuid, isFirst);
      deploymentUuid = trig.deployments?.[0]?.deployment_uuid;
    } catch (e: any) {
      coolifyErrorJson = redactSecrets(String(e?.message ?? e));
      throw e;
    }
    if (!deploymentUuid) throw new Error('Coolify did not return a deployment_uuid');
    log(`  deployment ${deploymentUuid} triggered in ${fmt(ms(tTrig))}`);

    await prisma.deployment.update({
      where: { id: deployment.id },
      data: { status: 'deploying', coolifyAppUuid: app.uuid, deploymentUuid },
    });

    // WAIT FOR BUILD
    const tBuild = Date.now();
    log('Waiting for Coolify build/deploy (poll every 3s)...');
    // Stream interim polls
    let lastStatus = '';
    const pollInterval = setInterval(async () => {
      try {
        const dep = await getDeployment(deploymentUuid!);
        if (dep.status !== lastStatus) {
          lastStatus = dep.status;
          log(`  deploy status: ${dep.status}`);
        }
      } catch {}
    }, 5000);
    let final;
    try {
      final = await waitForDeploy(deploymentUuid, 10 * 60_000);
    } finally {
      clearInterval(pollInterval);
    }
    timings.build = ms(tBuild);
    log(`  deploy finished (${final.status}) in ${fmt(timings.build)}`);

    // WAIT FOR FQDN
    const tFqdn = Date.now();
    log('Polling app for FQDN...');
    let refreshed = await getApp(app.uuid);
    let waited = 0;
    while (!refreshed.fqdn && waited < 60_000) {
      await new Promise((r) => setTimeout(r, 3000));
      waited += 3000;
      refreshed = await getApp(app.uuid);
    }
    const url = refreshed.fqdn
      ? (refreshed.fqdn.startsWith('http') ? refreshed.fqdn : `https://${refreshed.fqdn}`)
      : null;
    log(`  FQDN: ${url ?? '(none after 60s)'} (${fmt(ms(tFqdn))})`);

    // CURL
    const t200 = Date.now();
    let first200: number | null = null;
    let html = '';
    let httpStatus = 0;
    if (url) {
      log(`Curling ${url} until 200 (max 5min)...`);
      const dl = Date.now() + 5 * 60_000;
      while (Date.now() < dl) {
        try {
          const res = await fetch(url, { cache: 'no-store' });
          httpStatus = res.status;
          if (res.ok) {
            html = await res.text();
            first200 = ms(t200);
            log(`  ${res.status} OK in ${fmt(first200)} (${html.length} bytes)`);
            break;
          } else {
            log(`  status ${res.status}, retrying...`);
          }
        } catch (e: any) {
          log(`  fetch err: ${e?.message ?? e}`);
        }
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
    timings.first200 = first200 ?? ms(t200);

    // Content checks
    const palette = (site.theme as any)?.palette ?? null;
    const palettePrimary: string | null =
      palette && typeof palette === 'object' && typeof palette.primary === 'string' ? palette.primary : null;
    const nameInHtml = html.toLowerCase().includes(site.name.toLowerCase().split(' ')[0]);
    const paletteInHtml = palettePrimary ? html.toLowerCase().includes(palettePrimary.toLowerCase()) : false;

    await prisma.deployment.update({
      where: { id: deployment.id },
      data: { status: first200 ? 'success' : 'failed', url },
    });

    const total = ms(t0);
    log(`DONE in ${fmt(total)} — url=${url}`);

    // REPORT
    const reportDir = path.resolve(process.cwd(), 'docs', 'deploy');
    mkdirSync(reportDir, { recursive: true });
    const reportPath = path.resolve(reportDir, '2026-04-17-deploy-report.md');
    const body = `# Live Deploy Report — 2026-04-17

## Site
- **Name:** ${site.name}
- **Site ID:** ${site.id}
- **Slug used:** ${siteSlug}

## Artifacts
- **GitHub repo:** ${repo.htmlUrl}
- **Commit SHA:** ${commitSha}
- **Coolify app UUID:** ${app.uuid}
- **Coolify deployment UUID:** ${deploymentUuid}
- **Public URL:** ${url ?? '(none)'}

## Timing
| Stage | Duration |
|---|---|
| Bundle | ${fmt(timings.bundle)} |
| GitHub push | ${fmt(timings.push)} |
| Coolify build/deploy | ${fmt(timings.build)} |
| First 200 OK | ${first200 != null ? fmt(first200) : 'never (last status ' + httpStatus + ')'} |
| **Total** | ${fmt(total)} |

## HTTP verification
- **Final status:** ${httpStatus}
- **Body length:** ${html.length} bytes
- **Contains site name token ("${site.name.split(' ')[0]}"):** ${nameInHtml}
- **Contains palette primary (${palettePrimary ?? 'n/a'}):** ${paletteInHtml}

## Warnings
${warnings.length ? warnings.map((w) => `- ${w}`).join('\n') : '_none_'}

## Coolify errors
${coolifyErrorJson ? '```\n' + coolifyErrorJson + '\n```' : '_none_'}
`;
    await writeFile(reportPath, body, 'utf8');
    log(`Report: ${reportPath}`);

    await prisma.$disconnect();
    process.exit(first200 ? 0 : 1);
  } catch (err: any) {
    const msg = redactSecrets(String(err?.message ?? err));
    console.error('DEPLOY FAILED:', msg);
    await prisma.deployment.update({
      where: { id: deployment.id },
      data: { status: 'failed' },
    }).catch(() => {});

    const reportDir = path.resolve(process.cwd(), 'docs', 'deploy');
    mkdirSync(reportDir, { recursive: true });
    const reportPath = path.resolve(reportDir, '2026-04-17-deploy-report.md');
    const body = `# Live Deploy Report — 2026-04-17 (FAILED)

## Site
- **Name:** ${site.name}
- **Site ID:** ${site.id}

## Failure
\`\`\`
${msg}
\`\`\`

## Coolify error body
${coolifyErrorJson ? '```\n' + coolifyErrorJson + '\n```' : '_no coolify response body captured_'}

## Partial timings
\`\`\`
${JSON.stringify(timings, null, 2)}
\`\`\`

## Warnings
${warnings.length ? warnings.map((w) => `- ${w}`).join('\n') : '_none_'}
`;
    await writeFile(reportPath, body, 'utf8');

    await prisma.$disconnect();
    process.exit(1);
  }
}

main().catch(async (e) => {
  console.error('fatal:', e);
  try { await prisma.$disconnect(); } catch {}
  process.exit(1);
});
// suppress unused
void octokit;
