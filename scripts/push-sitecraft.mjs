import { Octokit } from '@octokit/rest';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const TOKEN = process.env.GITHUB_TOKEN;
const REPO = 'sitecraft-app';
const o = new Octokit({ auth: TOKEN });

const SKIP_DIRS = new Set([
  'node_modules', '.next', '.git', '.playwright-mcp', '.deploy-keys', 'uploads',
]);
const SKIP_FILES = new Set([
  '.env', '.env.local', 'dev.db', 'dev.db-journal', 'tsconfig.tsbuildinfo',
]);
const SKIP_EXT = new Set(['.log', '.png', '.jpg', '.jpeg']);

async function* walk(dir, base = '') {
  for (const name of await readdir(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = path.join(dir, name);
    const rel = base ? `${base}/${name}` : name;
    const s = await stat(full);
    if (s.isDirectory()) {
      yield* walk(full, rel);
    } else {
      if (SKIP_FILES.has(name)) continue;
      const ext = path.extname(name).toLowerCase();
      if (SKIP_EXT.has(ext)) continue;
      yield { full, rel };
    }
  }
}

const { data: user } = await o.rest.users.getAuthenticated();
const owner = user.login;
console.log('owner:', owner);

let repo;
try {
  repo = (await o.rest.repos.get({ owner, repo: REPO })).data;
  console.log('reusing repo', repo.html_url);
} catch {
  repo = (
    await o.rest.repos.createForAuthenticatedUser({
      name: REPO,
      private: false,
      auto_init: true,
      description: 'Sitecraft — AI-native website builder',
    })
  ).data;
  console.log('created repo', repo.html_url);
}

const files = [];
for await (const f of walk(process.cwd())) files.push(f);
console.log('files to push:', files.length);

const { data: ref } = await o.rest.git.getRef({ owner, repo: REPO, ref: 'heads/main' });
const baseSha = ref.object.sha;
const { data: baseCommit } = await o.rest.git.getCommit({
  owner, repo: REPO, commit_sha: baseSha,
});

const blobs = [];
let i = 0;
for (const f of files) {
  const buf = await readFile(f.full);
  const content = buf.toString('base64');
  const { data } = await o.rest.git.createBlob({
    owner, repo: REPO, content, encoding: 'base64',
  });
  const normalized = f.rel.split(path.sep).join('/');
  blobs.push({ path: normalized, mode: '100644', type: 'blob', sha: data.sha });
  i++;
  if (i % 20 === 0) console.log(`  uploaded ${i}/${files.length}`);
}

const { data: tree } = await o.rest.git.createTree({
  owner, repo: REPO,
  base_tree: baseCommit.tree.sha,
  tree: blobs,
});
const { data: commit } = await o.rest.git.createCommit({
  owner, repo: REPO,
  message: 'Deploy Sitecraft',
  tree: tree.sha,
  parents: [baseSha],
});
await o.rest.git.updateRef({
  owner, repo: REPO, ref: 'heads/main', sha: commit.sha,
});
console.log('pushed', commit.sha);
console.log('REPO_HTML_URL:', repo.html_url);
console.log('REPO_CLONE_URL:', repo.clone_url);
