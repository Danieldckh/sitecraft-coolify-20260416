// Coolify API client.
//
// All calls go through `cf<T>(path, init)` which bearers on
// COOLIFY_API_TOKEN, sets JSON headers, and throws with a *redacted* error
// body so tokens / gh keys never surface in logs or Deployment.logs rows.
//
// Public surface:
//   - cf<T>                 — typed fetch wrapper
//   - redactSecrets         — scrubs bearer tokens / gh_* keys from strings
//   - ensureStaticApp       — create or fetch a static-buildpack app
//   - triggerDeploy         — POST /deploy?uuid=...
//   - getApp / getDeployment
//   - waitForDeploy         — long-poll a deployment until terminal state

import { env } from '@/server/env';

/** Strip any authorization bearer tokens or gh_* style keys from a string. */
export function redactSecrets(s: string): string {
  return s
    .replace(/(authorization\s*:\s*)(bearer\s+)?[A-Za-z0-9._\-+/=]+/gi, '$1[redacted]')
    .replace(/\bbearer\s+[A-Za-z0-9._\-+/=]+/gi, 'bearer [redacted]')
    .replace(
      /\b(api[_-]?token|access[_-]?token|api[_-]?key)"?\s*[:=]\s*"?[A-Za-z0-9._\-+/=]+"?/gi,
      '$1=[redacted]',
    )
    .replace(/gh[pousr]_[A-Za-z0-9]{20,}/g, '[redacted-token]');
}

export async function cf<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${env.COOLIFY_BASE_URL}/api/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.COOLIFY_API_TOKEN}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(init.headers ?? {}),
    },
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Coolify ${path} -> ${res.status} ${redactSecrets(body)}`);
  }
  return (await res.json()) as T;
}

export interface CoolifyApp {
  uuid: string;
  fqdn?: string | null;
  /**
   * Coolify's POST /applications/public create response returns the public
   * URL under `domains` (e.g. "http://<uuid>.<ip>.sslip.io"). Subsequent
   * GET /applications/<uuid> responses expose it under `fqdn`. Both may be
   * null on very fresh apps — the orchestrator falls through them in order.
   */
  domains?: string | null;
  status?: string;
  git_repository?: string;
  git_branch?: string;
  git_commit_sha?: string;
}

export interface CoolifyDeployment {
  deployment_uuid?: string;
  uuid?: string;
  status: string;
  logs?: string;
}

interface DiscoveredIds {
  projectUuid: string;
  serverUuid: string;
}

async function discoverProjectAndServer(): Promise<DiscoveredIds> {
  const projects = await cf<Array<{ uuid: string }>>('/projects');
  const servers = await cf<Array<{ uuid: string }>>('/servers');
  if (!projects[0] || !servers[0]) {
    throw new Error(
      'Coolify: no projects or servers found — set COOLIFY_PROJECT_UUID / COOLIFY_SERVER_UUID',
    );
  }
  return { projectUuid: projects[0].uuid, serverUuid: servers[0].uuid };
}

export interface EnsureStaticAppInput {
  siteId: string;
  siteSlug: string;
  repoUrl: string;
  branch?: string;
  existingAppUuid?: string | null;
}

/**
 * If `existingAppUuid` is given, return the existing app unchanged.
 * Otherwise create a new public static-buildpack application wired up to
 * the given GitHub repo and return it.
 */
export async function ensureStaticApp(input: EnsureStaticAppInput): Promise<CoolifyApp> {
  if (input.existingAppUuid) {
    return getApp(input.existingAppUuid);
  }

  let projectUuid = env.COOLIFY_PROJECT_UUID;
  let serverUuid = env.COOLIFY_SERVER_UUID;
  if (!projectUuid || !serverUuid) {
    const d = await discoverProjectAndServer();
    projectUuid = projectUuid || d.projectUuid;
    serverUuid = serverUuid || d.serverUuid;
  }

  const body = {
    project_uuid: projectUuid,
    server_uuid: serverUuid,
    environment_name: 'production',
    git_repository: input.repoUrl,
    git_branch: input.branch ?? 'main',
    build_pack: 'static',
    name: `sitecraft-${input.siteSlug}`.slice(0, 60),
    is_static: true,
    publish_directory: '/',
    ports_exposes: '80',
  };

  const created = await cf<{ uuid: string; domains?: string | null }>(
    '/applications/public',
    { method: 'POST', body: JSON.stringify(body) },
  );
  // The create response carries the auto-assigned public URL under `domains`
  // (typically http://<uuid>.<ip>.sslip.io). Preserve it on the returned app
  // object — `getApp()` sometimes doesn't populate `fqdn` until after the
  // first deploy lands.
  const app = await getApp(created.uuid);
  if (!app.fqdn && !app.domains && created.domains) {
    app.domains = created.domains;
  }
  return app;
}

export function triggerDeploy(
  appUuid: string,
  force = false,
): Promise<{
  deployments: Array<{ deployment_uuid: string; resource_uuid: string; message: string }>;
}> {
  return cf<{
    deployments: Array<{ deployment_uuid: string; resource_uuid: string; message: string }>;
  }>(`/deploy?uuid=${encodeURIComponent(appUuid)}&force=${force}`);
}

export function getApp(uuid: string): Promise<CoolifyApp> {
  return cf<CoolifyApp>(`/applications/${uuid}`);
}

export function getDeployment(uuid: string): Promise<CoolifyDeployment> {
  return cf<CoolifyDeployment>(`/deployments/${uuid}`);
}

/**
 * Poll `deploymentUuid` every 3s until it reaches a terminal state.
 * Resolves with the final deployment row on success; throws on failure or
 * timeout (default 5 minutes).
 */
export async function waitForDeploy(
  deploymentUuid: string,
  timeoutMs = 5 * 60_000,
): Promise<CoolifyDeployment> {
  const start = Date.now();
  let last: CoolifyDeployment | null = null;
  while (Date.now() - start < timeoutMs) {
    try {
      last = await getDeployment(deploymentUuid);
      const s = (last.status || '').toLowerCase();
      if (['finished', 'success', 'succeeded'].includes(s)) return last;
      if (['failed', 'cancelled', 'canceled', 'error'].includes(s)) {
        throw new Error(`Deploy ${s}: ${redactSecrets(last.logs ?? '')}`);
      }
    } catch (e) {
      // Tolerate transient Coolify errors, but bail if the timeout window
      // is almost up.
      if (Date.now() - start > timeoutMs - 3000) throw e;
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`Deploy timeout (last status: ${last?.status ?? 'unknown'})`);
}
