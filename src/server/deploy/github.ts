// GitHub deploy repo helpers.
//
// Every Sitecraft deploy target repo is tagged with the topic
// `sitecraft-deploy` ("the marker"). We refuse to push to any repo that
// doesn't carry the marker, so a stale name collision can never clobber an
// unrelated user repository.
//
// Public surface:
//   - octokit                 — authenticated Octokit singleton
//   - SITECRAFT_REPO_MARKER   — the repo-topic marker
//   - ensureRepo(name)        — fetch-or-create + marker assertion
//   - pushFiles(owner, repo, files) — batch commit to main via git tree API
//
// pushFiles handles both first-push (empty / freshly auto_init'd repo) and
// subsequent updates. It builds blobs first, then creates a tree with
// base_tree set to the current HEAD tree, then a commit, then fast-forwards
// heads/main. No force pushes. No rm-rf.

import { Octokit } from '@octokit/rest';
import { env } from '@/server/env';
import { redactSecrets } from './coolify';
import type { BundleFile } from './bundler';

export const octokit = new Octokit({ auth: env.GITHUB_TOKEN });

/** Topic that must be present on any repo Sitecraft pushes to. */
export const SITECRAFT_REPO_MARKER = 'sitecraft-deploy';

export interface EnsureRepoResult {
  owner: string;
  repo: string;
  cloneUrl: string;
  htmlUrl: string;
}

async function getAuthenticatedOwner(): Promise<string> {
  const { data } = await octokit.rest.users.getAuthenticated();
  return data.login;
}

async function assertRepoMarker(owner: string, repo: string): Promise<void> {
  const { data } = await octokit.rest.repos.getAllTopics({ owner, repo });
  if (!data.names.includes(SITECRAFT_REPO_MARKER)) {
    throw new Error(
      `Refusing to push: GitHub repo ${owner}/${repo} lacks the required topic "${SITECRAFT_REPO_MARKER}". Add the topic if this repo is safe for Sitecraft to overwrite.`,
    );
  }
}

interface GitHubErrorLike {
  status?: number;
}

function httpStatus(e: unknown): number | undefined {
  if (e && typeof e === 'object' && 'status' in e) {
    const s = (e as GitHubErrorLike).status;
    return typeof s === 'number' ? s : undefined;
  }
  return undefined;
}

/**
 * Look up an existing repo by `name` on the authenticated user. If it
 * exists, require the marker topic. If it doesn't, create a fresh public
 * repo with the marker topic applied.
 */
export async function ensureRepo(name: string): Promise<EnsureRepoResult> {
  const owner = await getAuthenticatedOwner();

  try {
    const { data } = await octokit.rest.repos.get({ owner, repo: name });
    // Throws if the repo exists but lacks the marker — never clobber
    // someone's unrelated repo.
    await assertRepoMarker(data.owner.login, data.name);
    return {
      owner: data.owner.login,
      repo: data.name,
      cloneUrl: data.clone_url,
      htmlUrl: data.html_url,
    };
  } catch (e) {
    if (httpStatus(e) !== 404) {
      throw new Error(redactSecrets(e instanceof Error ? e.message : String(e)));
    }
    // fall through to create
  }

  const { data } = await octokit.rest.repos.createForAuthenticatedUser({
    name,
    private: false,
    auto_init: true,
    description: `Sitecraft deploy bundle: ${name}`,
  });

  try {
    await octokit.rest.repos.replaceAllTopics({
      owner: data.owner.login,
      repo: data.name,
      names: [SITECRAFT_REPO_MARKER],
    });
  } catch (err) {
    // Non-fatal: if topic tagging fails the repo is still usable for this
    // initial push, but a later ensureRepo() call will fail-loud until the
    // marker is applied manually. Log a redacted version and continue.
    console.error('[github] failed to tag repo with marker topic', redactSecrets(String(err)));
  }

  return {
    owner: data.owner.login,
    repo: data.name,
    cloneUrl: data.clone_url,
    htmlUrl: data.html_url,
  };
}

export interface PushResult {
  sha: string;
}

/**
 * Commit `files` atomically to `main` using the Git tree API.
 *
 * Strategy: create blobs for every file, then a tree based on the current
 * HEAD tree, then a single commit, then fast-forward heads/main. Works for
 * both the initial commit (auto_init repos come with a README on main) and
 * subsequent updates.
 */
export async function pushFiles(
  owner: string,
  repo: string,
  files: BundleFile[],
  message = `Sitecraft deploy ${new Date().toISOString()}`,
  branch = 'main',
): Promise<PushResult> {
  if (files.length === 0) {
    throw new Error('pushFiles: empty file list');
  }
  await assertRepoMarker(owner, repo);

  // Fetch HEAD ref; auto_init=true guarantees heads/main exists.
  const ref = await octokit.rest.git.getRef({ owner, repo, ref: `heads/${branch}` });
  const baseCommitSha = ref.data.object.sha;
  const baseCommit = await octokit.rest.git.getCommit({
    owner,
    repo,
    commit_sha: baseCommitSha,
  });
  const baseTreeSha = baseCommit.data.tree.sha;

  // Create a blob per file (utf-8 payloads; bundler only emits text).
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

  return { sha: commit.sha };
}
