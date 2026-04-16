# Sitecraft – API Research

Target stack per plan: Next.js 15 (App Router, TS), OpenAI SDK, Coolify REST, GitHub REST (Octokit), React Flow v12 (`@xyflow/react`).

`.env` verified at `C:\Users\pamde\Desktop\Website Builder\.env` — keys present: `OPENAI_API_KEY`, `COOLIFY_API_TOKEN`, `COOLIFY_BASE_URL=https://coolify.proagrihub.com`, `GITHUB_TOKEN`. (Values not printed.)

---

## 1. OpenAI SDK (`openai`, v5+)

Install: `npm i openai zod`.

### 1.1 Structured outputs (`{pages: Page[]}` with JSON schema)

Use `chat.completions.parse()` with `zodResponseFormat()` for strict, typed JSON. The SDK converts the Zod schema to JSON Schema and sets `response_format: { type: 'json_schema', json_schema: { strict: true, ... } }` internally.

```ts
// src/server/ai/sitemap.ts
import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import { z } from 'zod';

const Page = z.object({
  name: z.string(),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  pagePrompt: z.string(),
});
const PageList = z.object({ pages: z.array(Page) });
export type Page = z.infer<typeof Page>;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function generateSitemap(sitePrompt: string, memorySummary: string) {
  const completion = await openai.chat.completions.parse({
    model: 'gpt-4o-2024-08-06', // structured outputs requires this snapshot or newer
    messages: [
      { role: 'system', content: SITE_SYSTEM_PROMPT }, // keep this IDENTICAL across calls for cache
      { role: 'system', content: `Memory summary:\n${memorySummary}` },
      { role: 'user', content: sitePrompt },
    ],
    response_format: zodResponseFormat(PageList, 'page_list'),
  });
  const parsed = completion.choices[0]?.message.parsed;
  if (!parsed) throw new Error('No structured output');
  return parsed.pages; // typed as Page[]
}
```

If you prefer plain JSON schema without Zod, pass `response_format: { type: 'json_schema', json_schema: { name: 'page_list', strict: true, schema: {...} } }`.

### 1.2 Vision (image_url on gpt-4o)

Remote URL and base64 data URL both work — same content block shape.

```ts
// src/server/ai/vision.ts
import OpenAI from 'openai';
import fs from 'node:fs/promises';
const openai = new OpenAI();

export async function analyzeReferenceImage(
  imageSource: { url: string } | { filePath: string; mime: string },
  sectionPrompt: string,
) {
  const image_url =
    'url' in imageSource
      ? imageSource.url
      : `data:${imageSource.mime};base64,${(await fs.readFile(imageSource.filePath)).toString('base64')}`;

  const res = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: 'Return JSON: {html, css, js}. Match the reference image layout.' },
      {
        role: 'user',
        content: [
          { type: 'text', text: sectionPrompt },
          { type: 'image_url', image_url: { url: image_url, detail: 'high' } },
        ],
      },
    ],
    response_format: { type: 'json_object' },
  });
  return JSON.parse(res.choices[0].message.content!);
}
```

### 1.3 Streaming → SSE in Next.js Route Handler

The SDK returns an async iterable when `stream: true`. Forward `delta.content` as SSE frames.

```ts
// src/app/api/sections/[id]/generate/route.ts
import OpenAI from 'openai';
export const runtime = 'nodejs';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const openai = new OpenAI();
  const { prompt } = await req.json();

  const stream = await openai.chat.completions.create({
    model: 'gpt-4o',
    stream: true,
    stream_options: { include_usage: true },
    messages: [
      { role: 'system', content: SECTION_SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ],
  });

  const encoder = new TextEncoder();
  const body = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta?.content ?? '';
          if (delta) controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta })}\n\n`));
        }
        controller.enqueue(encoder.encode(`event: done\ndata: {}\n\n`));
      } catch (err: any) {
        controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ message: err.message })}\n\n`));
      } finally {
        controller.close();
      }
    },
    cancel() { stream.controller.abort(); },
  });

  return new Response(body, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
```

Client-side: `new EventSource('/api/sections/abc/generate')` — or for POST with body, use `fetch` + `ReadableStream.getReader()`.

### 1.4 Prompt caching on gpt-4o

OpenAI automatically caches the **static prefix** of requests ≥1024 tokens. Practical rules:

- Put **stable content first** (system prompt → tool/schema definitions → long examples → memory summary). Variable user input goes **last**.
- Keep system prompts byte-identical across calls (no timestamps, no UUIDs).
- Reuse a single giant `SECTION_SYSTEM_PROMPT` string constant in `src/server/ai/prompts.ts`; compose per-call variance by appending user messages, not by editing the system string.
- Check `usage.prompt_tokens_details.cached_tokens` in the response to confirm cache hits.

### 1.5 Model selection

| Task | Model | Why |
|---|---|---|
| Sitemap generation (structured) | `gpt-4o-2024-08-06` | Needs strict structured outputs + quality |
| Section HTML/CSS/JS generation | `gpt-4o` | Best code quality, streams fine |
| Image-to-section (vision) | `gpt-4o` | Vision support |
| Memory summarization | `gpt-4o-mini` | Cheap, adequate for distillation |
| Slug/name normalization, routing/intent | `gpt-4o-mini` | Fast + cheap |

---

## 2. Coolify REST API — `https://coolify.proagrihub.com`

### 2.1 Docs discovery

- `GET /api/v1/openapi.json` on the instance → **404** (not enabled on this deployment).
- Official reference lives at <https://coolify.io/docs/api-reference/> and is organized by category (Applications, Deployments, Projects, Servers, Services, Teams, Databases, GitHub Apps, Private Keys, Cloud Tokens).
- **Base URL:** `https://coolify.proagrihub.com/api/v1` (the hosted instance uses HTTPS; `/health` and `/feedback` skip the `/v1` prefix).
- **Auth:** `Authorization: Bearer <COOLIFY_API_TOKEN>`. Tokens look like `3|WaobqX9tJQshKPuQFHsyApxuOOggg4wOfvGc9xa233c376d7`.

### 2.2 Endpoints we use

| Action | Method + Path |
|---|---|
| Create app from public GitHub repo | `POST /api/v1/applications/public` |
| Get application (status, `fqdn`) | `GET /api/v1/applications/{uuid}` |
| Trigger deploy | `GET /api/v1/deploy?uuid={uuid}&force=false` (POST also works) |
| Poll deployment | `GET /api/v1/deployments/{deployment_uuid}` |
| List projects / servers (to get UUIDs) | `GET /api/v1/projects`, `GET /api/v1/servers` |

Response for `/deploy`: `{ deployments: [{ message, resource_uuid, deployment_uuid }] }`.
Response for `/applications/{uuid}`: includes `uuid`, `fqdn`, `status`, `git_repository`, `git_branch`, `git_commit_sha`, `build_pack`, `config_hash`, health-check fields.

### 2.3 Minimum body to create a Static application

`POST /api/v1/applications/public`:

```json
{
  "project_uuid": "<from GET /projects>",
  "server_uuid":  "<from GET /servers>",
  "environment_name": "production",
  "git_repository": "https://github.com/<owner>/<repo>",
  "git_branch": "main",
  "build_pack": "static",
  "name": "sitecraft-<site-slug>",
  "is_static": true,
  "publish_directory": "/",
  "is_auto_deploy_enabled": true
}
```

Successful response: `201 { "uuid": "<app-uuid>" }`.

### 2.4 TypeScript client

```ts
// src/server/deploy/coolify.ts
const BASE = process.env.COOLIFY_BASE_URL!; // https://coolify.proagrihub.com
const TOKEN = process.env.COOLIFY_API_TOKEN!;

async function cf<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}/api/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(init.headers ?? {}),
    },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Coolify ${path} → ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

export async function createStaticApp(input: {
  projectUuid: string;
  serverUuid: string;
  repoUrl: string;
  branch: string;
  name: string;
}) {
  return cf<{ uuid: string }>('/applications/public', {
    method: 'POST',
    body: JSON.stringify({
      project_uuid: input.projectUuid,
      server_uuid: input.serverUuid,
      environment_name: 'production',
      git_repository: input.repoUrl,
      git_branch: input.branch,
      build_pack: 'static',
      name: input.name,
      is_static: true,
      publish_directory: '/',
      is_auto_deploy_enabled: true,
    }),
  });
}

export const deployApp = (uuid: string, force = false) =>
  cf<{ deployments: Array<{ deployment_uuid: string; resource_uuid: string; message: string }> }>(
    `/deploy?uuid=${uuid}&force=${force}`,
  );

export const getApp = (uuid: string) =>
  cf<{ uuid: string; fqdn?: string; status: string; git_commit_sha?: string }>(`/applications/${uuid}`);

export const getDeployment = (uuid: string) =>
  cf<{ deployment_uuid: string; status: string; logs?: string }>(`/deployments/${uuid}`);

export async function waitForDeploy(deploymentUuid: string, timeoutMs = 5 * 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const d = await getDeployment(deploymentUuid);
    if (['finished', 'success'].includes(d.status)) return d;
    if (['failed', 'cancelled'].includes(d.status)) throw new Error(`Deploy ${d.status}: ${d.logs ?? ''}`);
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error('Deploy timeout');
}
```

**Surprise:** this Coolify instance does **not** expose `/api/v1/openapi.json` — we rely on the official docs at coolify.io. The docs don't enumerate `status` enum values for deployments; treat it as free-form and match on `finished|success|failed|cancelled`.

**Surprise:** `project_uuid` and `server_uuid` are **required** — our code must either hard-code them via env (`COOLIFY_PROJECT_UUID`, `COOLIFY_SERVER_UUID`) or discover them via `GET /projects` and `GET /servers` at startup. Recommend env vars.

---

## 3. GitHub REST API (Octokit)

Install: `npm i @octokit/rest`.

### 3.1 Create repo under the authenticated user

```ts
// src/server/deploy/github.ts
import { Octokit } from '@octokit/rest';
export const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

export async function createDeployRepo(slug: string) {
  const { data } = await octokit.rest.repos.createForAuthenticatedUser({
    name: `website-builder-deploys-${slug}`,
    private: true,
    auto_init: true, // creates initial commit on `main` so we have a ref to update
    description: `Sitecraft deploy bundle for ${slug}`,
  });
  return { owner: data.owner.login, repo: data.name, cloneUrl: data.clone_url, htmlUrl: data.html_url };
}
```

### 3.2 Push a set of files in one commit (Git Data API)

Atomic: create blobs → tree → commit → update `refs/heads/main`.

```ts
export async function pushFilesOneCommit(args: {
  owner: string; repo: string; branch?: string;
  files: Array<{ path: string; content: string | Buffer }>;
  message: string;
}) {
  const { owner, repo, branch = 'main', files, message } = args;

  // 1. current commit SHA for the branch
  const ref = await octokit.rest.git.getRef({ owner, repo, ref: `heads/${branch}` });
  const baseCommitSha = ref.data.object.sha;
  const baseCommit = await octokit.rest.git.getCommit({ owner, repo, commit_sha: baseCommitSha });
  const baseTreeSha = baseCommit.data.tree.sha;

  // 2. blob per file
  const blobs = await Promise.all(
    files.map(async (f) => {
      const content = Buffer.isBuffer(f.content) ? f.content.toString('base64') : f.content;
      const encoding = Buffer.isBuffer(f.content) ? 'base64' : 'utf-8';
      const { data } = await octokit.rest.git.createBlob({ owner, repo, content, encoding });
      return { path: f.path, sha: data.sha };
    }),
  );

  // 3. tree
  const { data: tree } = await octokit.rest.git.createTree({
    owner, repo, base_tree: baseTreeSha,
    tree: blobs.map((b) => ({ path: b.path, mode: '100644', type: 'blob', sha: b.sha })),
  });

  // 4. commit
  const { data: commit } = await octokit.rest.git.createCommit({
    owner, repo, message, tree: tree.sha, parents: [baseCommitSha],
  });

  // 5. move branch ref
  await octokit.rest.git.updateRef({ owner, repo, ref: `heads/${branch}`, sha: commit.sha, force: false });
  return { commitSha: commit.sha };
}
```

### 3.3 Simpler single-file upsert (Contents API)

Use for one-off writes (avoid for multi-file bundles — each call is a separate commit).

```ts
export async function upsertFile(owner: string, repo: string, path: string, content: string, message: string) {
  let sha: string | undefined;
  try {
    const existing = await octokit.rest.repos.getContent({ owner, repo, path });
    if (!Array.isArray(existing.data) && 'sha' in existing.data) sha = existing.data.sha;
  } catch (e: any) { if (e.status !== 404) throw e; }

  return octokit.rest.repos.createOrUpdateFileContents({
    owner, repo, path, message,
    content: Buffer.from(content, 'utf-8').toString('base64'),
    sha,
  });
}
```

---

## 4. React Flow v12 (`@xyflow/react`)

Install: `npm i @xyflow/react dagre`. Import CSS once: `import '@xyflow/react/dist/style.css';`.

### 4.1 Custom node types — `PageNode` and `SectionNode`

```tsx
// src/components/editor/nodes.tsx
import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';

export type PageNode = Node<{ name: string; slug: string; locked: boolean }, 'page'>;
export type SectionNode = Node<
  { type: 'header'|'hero'|'features'|'cta'|'footer'|'custom'; locked: boolean; status: 'idle'|'generating'|'ready' },
  'section'
>;
export type EditorNode = PageNode | SectionNode;

export const PageNodeView = memo(({ data, selected }: NodeProps<PageNode>) => (
  <div className={`rounded-xl border-2 p-3 bg-white min-w-[260px] min-h-[200px] ${selected ? 'border-blue-500' : 'border-slate-300'}`}>
    <Handle type="target" position={Position.Top} />
    <div className="flex items-center justify-between">
      <div className="font-semibold">{data.name}</div>
      <span className="text-xs text-slate-500">/{data.slug}</span>
    </div>
    {data.locked && <span className="text-xs text-amber-600">🔒 locked</span>}
    <Handle type="source" position={Position.Bottom} />
  </div>
));

export const SectionNodeView = memo(({ data, selected }: NodeProps<SectionNode>) => (
  <div className={`rounded-md border px-3 py-2 bg-slate-50 text-sm ${selected ? 'border-blue-500' : 'border-slate-300'}`}>
    <Handle type="target" position={Position.Top} />
    <div className="flex gap-2 items-center">
      <span className="font-medium capitalize">{data.type}</span>
      {data.locked && <span>🔒</span>}
      {data.status === 'generating' && <span className="text-blue-600 animate-pulse">…</span>}
    </div>
    <Handle type="source" position={Position.Bottom} />
  </div>
));

export const nodeTypes = { page: PageNodeView, section: SectionNodeView };
```

### 4.2 Parent/child — sections nested inside a page

Set `parentId` to the page node's id and `extent: 'parent'` so the child is clipped to the parent's box. Child `position` is relative to the parent.

```ts
const pageNode: PageNode = {
  id: 'page-home', type: 'page',
  position: { x: 0, y: 0 },
  data: { name: 'Home', slug: 'home', locked: false },
  style: { width: 280, height: 320 },
};
const heroNode: SectionNode = {
  id: 'section-hero', type: 'section',
  parentId: 'page-home',     // v12 uses parentId (was parentNode in v11)
  extent: 'parent',
  position: { x: 10, y: 50 }, // relative to page-home
  data: { type: 'hero', locked: false, status: 'idle' },
};
```

Render with `<ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} fitView />` wrapped in `<ReactFlowProvider>`.

### 4.3 Auto layout with `dagre`

```ts
// src/components/editor/layout.ts
import dagre from 'dagre';
import type { Node, Edge } from '@xyflow/react';

const PAGE_W = 280, PAGE_H = 320, SECTION_W = 240, SECTION_H = 44;

export function autoLayout(nodes: Node[], edges: Edge[], direction: 'TB' | 'LR' = 'TB'): Node[] {
  const g = new dagre.graphlib.Graph({ compound: true });
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: direction, nodesep: 60, ranksep: 120 });

  for (const n of nodes) {
    const w = n.type === 'page' ? PAGE_W : SECTION_W;
    const h = n.type === 'page' ? PAGE_H : SECTION_H;
    g.setNode(n.id, { width: w, height: h });
    if (n.parentId) g.setParent(n.id, n.parentId);
  }
  for (const e of edges) g.setEdge(e.source, e.target);

  dagre.layout(g);

  return nodes.map((n) => {
    const { x, y, width, height } = g.node(n.id);
    // dagre returns center coords; React Flow wants top-left
    // for child nodes, keep position relative to parent
    if (n.parentId) {
      const p = g.node(n.parentId);
      return { ...n, position: { x: x - p.x - width / 2 + p.width / 2, y: y - p.y - height / 2 + p.height / 2 } };
    }
    return { ...n, position: { x: x - width / 2, y: y - height / 2 } };
  });
}
```

### 4.4 Programmatically add/remove nodes + re-layout

```tsx
import { ReactFlow, ReactFlowProvider, useNodesState, useEdgesState, useReactFlow } from '@xyflow/react';

function Editor() {
  const [nodes, setNodes, onNodesChange] = useNodesState<EditorNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const rf = useReactFlow();

  const addSection = (pageId: string, type: SectionNode['data']['type']) => {
    const id = `section-${crypto.randomUUID()}`;
    setNodes((ns) => autoLayout(
      [...ns, { id, type: 'section', parentId: pageId, extent: 'parent',
                position: { x: 0, y: 0 }, data: { type, locked: false, status: 'idle' } }],
      edges,
    ));
    queueMicrotask(() => rf.fitView({ padding: 0.2 }));
  };

  const removeNode = async (id: string) => {
    await rf.deleteElements({ nodes: [{ id }] });
    setNodes((ns) => autoLayout(ns.filter((n) => n.id !== id && n.parentId !== id), edges));
  };

  return (
    <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes}
      onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} fitView />
  );
}

export default function EditorWrapper() {
  return <ReactFlowProvider><Editor /></ReactFlowProvider>;
}
```

**v12 note:** v11's `parentNode` was renamed to `parentId` — make sure any copy-pasted snippets from older tutorials are updated.

---

## 5. Quick reference — env vars consumed

| Var | Used by |
|---|---|
| `OPENAI_API_KEY` | `src/server/ai/*` |
| `COOLIFY_BASE_URL` (`https://coolify.proagrihub.com`) | `src/server/deploy/coolify.ts` |
| `COOLIFY_API_TOKEN` | `src/server/deploy/coolify.ts` |
| `COOLIFY_PROJECT_UUID`, `COOLIFY_SERVER_UUID` *(need to add — discover once via GET /projects & /servers)* | `src/server/deploy/coolify.ts` |
| `GITHUB_TOKEN` | `src/server/deploy/github.ts` |
