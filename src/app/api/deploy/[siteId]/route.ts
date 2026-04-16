import { NextResponse } from 'next/server';
import { prisma } from '@/server/db/client';
import { toDeploymentDTO } from '@/server/db/mappers';
import { bundleSite } from '@/server/deploy/bundler';
import { ensureDeployRepo, pushBundle } from '@/server/deploy/github';
import {
  ensureStaticApp,
  triggerDeploy,
  waitForDeploy,
  getApp,
} from '@/server/deploy/coolify';

export const runtime = 'nodejs';
export const maxDuration = 300;

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'site'
  );
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ siteId: string }> },
) {
  const { siteId } = await params;

  const site = await prisma.site.findUnique({ where: { id: siteId } });
  if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 });

  const siteSlug = slugify(site.name) + '-' + site.id.slice(-6);

  const prior = await prisma.deployment.findFirst({
    where: { siteId, coolifyAppUuid: { not: null } },
    orderBy: { createdAt: 'desc' },
  });

  const deployment = await prisma.deployment.create({
    data: {
      siteId,
      status: 'pending',
      coolifyAppUuid: prior?.coolifyAppUuid ?? null,
      logs: '',
    },
  });

  let logs = '';
  const appendLog = (m: string) => {
    logs += (logs ? '\n' : '') + `[${new Date().toISOString()}] ${m}`;
  };

  try {
    appendLog('Bundling site');
    const files = await bundleSite(siteId);
    appendLog(`Bundled ${files.length} files`);

    appendLog('Ensuring GitHub deploy repo');
    const repo = await ensureDeployRepo(siteId, siteSlug);
    appendLog(`Repo: ${repo.htmlUrl}`);

    appendLog('Pushing bundle');
    const { commitSha } = await pushBundle(
      repo.owner,
      repo.repo,
      files,
      `Sitecraft deploy ${new Date().toISOString()}`,
    );
    appendLog(`Commit: ${commitSha}`);

    await prisma.deployment.update({
      where: { id: deployment.id },
      data: { status: 'building', logs },
    });

    appendLog('Ensuring Coolify application');
    const app = await ensureStaticApp({
      siteId,
      siteSlug,
      repoUrl: `https://github.com/${repo.owner}/${repo.repo}`,
      branch: 'main',
      existingAppUuid: prior?.coolifyAppUuid ?? null,
    });
    appendLog(`App UUID: ${app.uuid}`);

    appendLog('Triggering deploy');
    const isFirst = !prior?.coolifyAppUuid;
    const trig = await triggerDeploy(app.uuid, isFirst);
    const deploymentUuid = trig.deployments?.[0]?.deployment_uuid;
    if (!deploymentUuid) throw new Error('Coolify did not return a deployment_uuid');
    appendLog(`Deployment UUID: ${deploymentUuid}`);

    await prisma.deployment.update({
      where: { id: deployment.id },
      data: {
        status: 'deploying',
        coolifyAppUuid: app.uuid,
        deploymentUuid,
        logs,
      },
    });

    const final = await waitForDeploy(deploymentUuid);
    appendLog(`Deploy status: ${final.status}`);

    const refreshed = await getApp(app.uuid).catch(() => app);
    const url = refreshed.fqdn
      ? (refreshed.fqdn.startsWith('http') ? refreshed.fqdn : `https://${refreshed.fqdn}`)
      : null;

    const combinedLogs = final.logs ? `${logs}\n---\n${final.logs}` : logs;

    const updated = await prisma.deployment.update({
      where: { id: deployment.id },
      data: {
        status: 'success',
        url,
        logs: combinedLogs,
      },
    });

    await prisma.changeLogEntry.create({
      data: {
        siteId,
        scope: 'site',
        targetId: siteId,
        actor: 'system',
        summary: `Deployed to ${url ?? 'Coolify'}`,
        diffJson: JSON.stringify({
          deploymentId: updated.id,
          coolifyAppUuid: app.uuid,
          commitSha,
          url,
        }),
      },
    });

    return NextResponse.json({ deployment: toDeploymentDTO(updated) });
  } catch (err: any) {
    appendLog(`ERROR: ${err?.message ?? String(err)}`);
    const failed = await prisma.deployment.update({
      where: { id: deployment.id },
      data: { status: 'failed', logs },
    });
    return NextResponse.json(
      { deployment: toDeploymentDTO(failed), error: err?.message ?? 'Deploy failed' },
      { status: 500 },
    );
  }
}
