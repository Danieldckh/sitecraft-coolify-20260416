import { env } from '@/server/env';

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
    throw new Error(`Coolify ${path} → ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as T;
}

interface CoolifyApp {
  uuid: string;
  fqdn?: string | null;
  status?: string;
  git_repository?: string;
  git_branch?: string;
  git_commit_sha?: string;
}

interface CoolifyDeployment {
  deployment_uuid?: string;
  uuid?: string;
  status: string;
  logs?: string;
}

async function discoverProjectAndServer(): Promise<{ projectUuid: string; serverUuid: string }> {
  const projects = await cf<Array<{ uuid: string }>>('/projects');
  const servers = await cf<Array<{ uuid: string }>>('/servers');
  if (!projects[0] || !servers[0]) {
    throw new Error('Coolify: no projects or servers found — set COOLIFY_PROJECT_UUID / COOLIFY_SERVER_UUID');
  }
  return { projectUuid: projects[0].uuid, serverUuid: servers[0].uuid };
}

export async function ensureStaticApp(input: {
  siteId: string;
  siteSlug: string;
  repoUrl: string;
  branch?: string;
  existingAppUuid?: string | null;
}): Promise<CoolifyApp> {
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

  const created = await cf<{ uuid: string }>('/applications/public', {
    method: 'POST',
    body: JSON.stringify(body),
  });

  return getApp(created.uuid);
}

export function triggerDeploy(appUuid: string, force = false) {
  return cf<{
    deployments: Array<{ deployment_uuid: string; resource_uuid: string; message: string }>;
  }>(`/deploy?uuid=${encodeURIComponent(appUuid)}&force=${force}`);
}

export function getApp(uuid: string) {
  return cf<CoolifyApp>(`/applications/${uuid}`);
}

export function getDeployment(uuid: string) {
  return cf<CoolifyDeployment>(`/deployments/${uuid}`);
}

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
        throw new Error(`Deploy ${s}: ${last.logs ?? ''}`);
      }
    } catch (e) {
      // transient — retry
      if (Date.now() - start > timeoutMs - 3000) throw e;
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`Deploy timeout (last status: ${last?.status ?? 'unknown'})`);
}

export type { CoolifyApp, CoolifyDeployment };
