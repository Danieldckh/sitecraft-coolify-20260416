// Deploy orchestrator.
//
// An async generator that walks a site through the bundle -> push -> deploy
// -> probe pipeline, yielding SSE-shaped events at every transition and
// persisting progress onto a single `Deployment` row as it goes.
//
// Reuse policy for the Deployment row:
//   - If the site's most-recent deployment is in a transient state
//     (queued / bundling / pushing / deploying / probing), reuse it.
//   - Otherwise (no prior deployment, or last was 'live' / 'failed'),
//     create a fresh row so history stays intact.
//
// All thrown errors are redacted before they land in logs or SSE output.

import { prisma } from '@/server/db/client';
import { bundleSite } from './bundler';
import { ensureRepo, pushFiles } from './github';
import {
  ensureStaticApp,
  triggerDeploy,
  waitForDeploy,
  getApp,
  redactSecrets,
} from './coolify';

export type DeployStatus =
  | 'queued'
  | 'bundling'
  | 'pushing'
  | 'deploying'
  | 'probing'
  | 'live'
  | 'failed';

export type DeployEvent =
  | { type: 'status'; status: DeployStatus; message?: string }
  | { type: 'live'; url: string }
  | { type: 'error'; message: string };

const TRANSIENT_STATES: ReadonlySet<string> = new Set([
  'queued',
  'bundling',
  'pushing',
  'deploying',
  'probing',
]);

interface DeploymentRow {
  id: string;
  coolifyAppUuid: string | null;
  deploymentUuid: string | null;
  url: string | null;
  status: string;
  logs: string;
}

async function loadOrCreateDeployment(siteId: string): Promise<DeploymentRow> {
  const latest = await prisma.deployment.findFirst({
    where: { siteId },
    orderBy: { createdAt: 'desc' },
  });
  if (latest && TRANSIENT_STATES.has(latest.status)) {
    // Reuse the row — re-ran while mid-flight.
    const reset = await prisma.deployment.update({
      where: { id: latest.id },
      data: { status: 'queued', logs: '' },
    });
    return {
      id: reset.id,
      coolifyAppUuid: reset.coolifyAppUuid,
      deploymentUuid: reset.deploymentUuid,
      url: reset.url,
      status: reset.status,
      logs: reset.logs,
    };
  }

  // Carry forward the previous app uuid (if any) so redeploys reuse the
  // existing Coolify app instead of creating a new one every time.
  const created = await prisma.deployment.create({
    data: {
      siteId,
      status: 'queued',
      coolifyAppUuid: latest?.coolifyAppUuid ?? null,
      logs: '',
    },
  });
  return {
    id: created.id,
    coolifyAppUuid: created.coolifyAppUuid,
    deploymentUuid: created.deploymentUuid,
    url: created.url,
    status: created.status,
    logs: created.logs,
  };
}

async function appendLog(deploymentId: string, line: string): Promise<void> {
  const stamped = `[${new Date().toISOString()}] ${redactSecrets(line)}`;
  try {
    const row = await prisma.deployment.findUnique({
      where: { id: deploymentId },
      select: { logs: true },
    });
    const next = row?.logs ? `${row.logs}\n${stamped}` : stamped;
    await prisma.deployment.update({
      where: { id: deploymentId },
      data: { logs: next },
    });
  } catch {
    // Best-effort — never fail the deploy because we couldn't append a
    // log line.
  }
}

async function setStatus(
  deploymentId: string,
  status: DeployStatus,
): Promise<void> {
  try {
    await prisma.deployment.update({
      where: { id: deploymentId },
      data: { status },
    });
  } catch {
    // Treat as transient — the next update will reconcile.
  }
}

/**
 * Poll a public URL with HEAD then GET until it returns 2xx or the timeout
 * is hit. Returns true on success, false on timeout. Errors (DNS, TLS) are
 * swallowed — common during the first seconds after Coolify finishes.
 */
async function probeUntilLive(url: string, timeoutMs = 90_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { cache: 'no-store', redirect: 'follow' });
      if (res.ok) return true;
    } catch {
      // swallow — retry
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  return false;
}

function coerceUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
  return `https://${trimmed}`;
}

/**
 * Run a full deploy cycle for `siteId`. The generator yields DeployEvent
 * frames suitable for framing into Server-Sent Events by the caller. On
 * success the final yield is `{ type: 'live', url }`; on failure it is
 * `{ type: 'error', message }`. Either way the Deployment row is persisted
 * with the terminal status before the generator returns.
 *
 * Callers should forward `generator.return(undefined)` on client abort to
 * stop the generator cleanly.
 */
export async function* runDeploy(siteId: string): AsyncGenerator<DeployEvent> {
  // 1. Make sure the site exists before we even create a Deployment row.
  const site = await prisma.site.findUnique({ where: { id: siteId } });
  if (!site) {
    yield { type: 'error', message: 'Site not found' };
    return;
  }

  const deployment = await loadOrCreateDeployment(siteId);
  const existingAppUuid = deployment.coolifyAppUuid;

  yield { type: 'status', status: 'queued' };

  try {
    // 2. Bundle.
    await setStatus(deployment.id, 'bundling');
    await appendLog(deployment.id, 'Bundling site');
    yield { type: 'status', status: 'bundling', message: 'Assembling pages…' };

    const { files, slug } = await bundleSite(siteId);
    await appendLog(deployment.id, `Bundled ${files.length} files`);

    // 3. Push to GitHub.
    await setStatus(deployment.id, 'pushing');
    yield { type: 'status', status: 'pushing', message: 'Publishing to GitHub…' };

    const repoName = `website-builder-deploys-${slug}`;
    const repo = await ensureRepo(repoName);
    await appendLog(deployment.id, `Repo ready: ${repo.htmlUrl}`);

    const pushed = await pushFiles(
      repo.owner,
      repo.repo,
      files,
      `Sitecraft deploy ${new Date().toISOString()}`,
    );
    await appendLog(deployment.id, `Commit: ${pushed.sha}`);

    // 4. Deploy via Coolify.
    await setStatus(deployment.id, 'deploying');
    yield { type: 'status', status: 'deploying', message: 'Deploying to Coolify…' };

    const app = await ensureStaticApp({
      siteId,
      siteSlug: slug,
      repoUrl: `https://github.com/${repo.owner}/${repo.repo}`,
      branch: 'main',
      existingAppUuid: existingAppUuid ?? null,
    });
    await appendLog(deployment.id, `Coolify app: ${app.uuid}`);
    await prisma.deployment.update({
      where: { id: deployment.id },
      data: { coolifyAppUuid: app.uuid },
    });

    const triggered = await triggerDeploy(app.uuid, !existingAppUuid);
    const deploymentUuid = triggered.deployments?.[0]?.deployment_uuid;
    if (!deploymentUuid) {
      throw new Error('Coolify did not return a deployment_uuid');
    }
    await appendLog(deployment.id, `Coolify deployment: ${deploymentUuid}`);
    await prisma.deployment.update({
      where: { id: deployment.id },
      data: { deploymentUuid },
    });

    const finalDeploy = await waitForDeploy(deploymentUuid);
    await appendLog(
      deployment.id,
      `Coolify deploy settled: ${finalDeploy.status}`,
    );

    // 5. Probe the public URL.
    await setStatus(deployment.id, 'probing');
    yield { type: 'status', status: 'probing', message: 'Waiting for live response…' };

    const refreshed = await getApp(app.uuid).catch(() => app);
    // Coolify populates either `fqdn` or `domains` depending on lifecycle —
    // prefer fqdn (canonical after first deploy) and fall back to domains
    // from the create response.
    const url =
      coerceUrl(refreshed.fqdn) ??
      coerceUrl(refreshed.domains) ??
      coerceUrl(app.fqdn) ??
      coerceUrl(app.domains);
    if (!url) {
      throw new Error('Coolify did not expose a public URL for this deploy');
    }
    await appendLog(deployment.id, `Probing ${url}`);
    const ok = await probeUntilLive(url);
    if (!ok) {
      await appendLog(deployment.id, `Probe timeout for ${url}`);
      throw new Error(`Site did not respond at ${url} within 90s`);
    }

    // 6. Persist terminal "live" state.
    await prisma.deployment.update({
      where: { id: deployment.id },
      data: {
        status: 'live',
        url,
      },
    });
    await appendLog(deployment.id, `Live at ${url}`);
    yield { type: 'live', url };
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    const safe = redactSecrets(raw);
    console.error('[deploy/orchestrator] failure', safe);
    try {
      await appendLog(deployment.id, `ERROR: ${safe}`);
      await prisma.deployment.update({
        where: { id: deployment.id },
        data: { status: 'failed' },
      });
    } catch {
      // already logged — swallow
    }
    yield { type: 'error', message: safe };
  }
}
