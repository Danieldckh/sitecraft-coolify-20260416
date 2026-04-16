import { Octokit } from '@octokit/rest';
import { env } from '@/server/env';
import { prisma } from '@/server/db/client';
import type { BundleFile } from './bundler';

export const octokit = new Octokit({ auth: env.GITHUB_TOKEN });

// Only repos carrying this topic may be pushed to by Sitecraft. Prevents
// accidental overwrites of pre-existing unrelated repositories.
export const SITECRAFT_REPO_MARKER = 'sitecraft-deploy';

async function assertRepoMarker(owner: string, repo: string): Promise<void> {
  const { data } = await octokit.rest.repos.getAllTopics({ owner, repo });
  if (!data.names.includes(SITECRAFT_REPO_MARKER)) {
    throw new Error(
      `Refusing to push: GitHub repo ${owner}/${repo} lacks the required topic "${SITECRAFT_REPO_MARKER}". Add the topic if this repo is safe for Sitecraft to overwrite.`,
    );
  }
}

export interface DeployRepo {
  owner: string;
  repo: string;
  cloneUrl: string;
  htmlUrl: string;
}

async function getAuthenticatedOwner(): Promise<string> {
  const { data } = await octokit.rest.users.getAuthenticated();
  return data.login;
}

export async function ensureDeployRepo(siteId: string, siteSlug: string): Promise<DeployRepo> {
  const existing = await prisma.deployment.findFirst({
    where: { siteId, coolifyAppUuid: { not: null } },
    orderBy: { createdAt: 'desc' },
  });

  const repoName = `website-builder-deploys-${siteSlug}`;
  const owner = await getAuthenticatedOwner();

  try {
    const { data } = await octokit.rest.repos.get({ owner, repo: repoName });
    await assertRepoMarker(data.owner.login, data.name);
    return {
      owner: data.owner.login,
      repo: data.name,
      cloneUrl: data.clone_url,
      htmlUrl: data.html_url,
    };
  } catch (e: any) {
    if (e.status !== 404) throw e;
  }

  // Create new repo and immediately tag it with the marker topic.
  const { data } = await octokit.rest.repos.createForAuthenticatedUser({
    name: repoName,
    private: false,
    auto_init: true,
    description: `Sitecraft deploy bundle for ${siteSlug}`,
  });
  try {
    await octokit.rest.repos.replaceAllTopics({
      owner: data.owner.login,
      repo: data.name,
      names: [SITECRAFT_REPO_MARKER],
    });
  } catch (err) {
    console.error('[github] failed to tag repo with marker topic', err);
  }
  void existing;
  return {
    owner: data.owner.login,
    repo: data.name,
    cloneUrl: data.clone_url,
    htmlUrl: data.html_url,
  };
}

export async function pushBundle(
  owner: string,
  repo: string,
  files: BundleFile[],
  message = 'Deploy bundle update',
  branch = 'main',
): Promise<{ commitSha: string }> {
  await assertRepoMarker(owner, repo);
  const ref = await octokit.rest.git.getRef({ owner, repo, ref: `heads/${branch}` });
  const baseCommitSha = ref.data.object.sha;
  const baseCommit = await octokit.rest.git.getCommit({
    owner,
    repo,
    commit_sha: baseCommitSha,
  });
  const baseTreeSha = baseCommit.data.tree.sha;

  const blobs = await Promise.all(
    files.map(async (f) => {
      const { data } = await octokit.rest.git.createBlob({
        owner,
        repo,
        content: f.content,
        encoding: 'utf-8',
      });
      return { path: f.path, sha: data.sha };
    }),
  );

  const { data: tree } = await octokit.rest.git.createTree({
    owner,
    repo,
    base_tree: baseTreeSha,
    tree: blobs.map((b) => ({
      path: b.path,
      mode: '100644' as const,
      type: 'blob' as const,
      sha: b.sha,
    })),
  });

  const { data: commit } = await octokit.rest.git.createCommit({
    owner,
    repo,
    message,
    tree: tree.sha,
    parents: [baseCommitSha],
  });

  await octokit.rest.git.updateRef({
    owner,
    repo,
    ref: `heads/${branch}`,
    sha: commit.sha,
    force: false,
  });

  return { commitSha: commit.sha };
}
