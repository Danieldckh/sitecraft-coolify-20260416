# Sitecraft

Sitecraft is an AI-native website builder. You describe a site in plain language, and a three-stage generation pipeline (theme → pages → per-element edits) turns it into a multi-page static site you can preview, inspect, tweak, and one-click deploy to Coolify via a GitHub-backed bundle. A visual inspector lets you refine any element with natural-language instructions; a per-site change log and memory summary keep edits coherent across sessions.

Live app: http://us0cs884k4wcwosc80wo8gss.148.230.100.16.sslip.io/sites

## Quick start

```bash
npm install --legacy-peer-deps
npx prisma db push
npm run dev            # http://localhost:3000/sites
npm run e2e            # golden-path service-layer smoke
```

### Required env (`.env`)

| Var | Purpose |
|---|---|
| `OPENAI_API_KEY` | GPT-4o for theme/page/element generation |
| `DATABASE_URL` | SQLite default `file:./dev.db`; Postgres works too |
| `COOLIFY_BASE_URL`, `COOLIFY_API_TOKEN` | Coolify API for deploy |
| `COOLIFY_PROJECT_UUID`, `COOLIFY_SERVER_UUID` | Optional; auto-discovered if unset |
| `GITHUB_TOKEN` | Required: bundles are pushed to a tagged GitHub repo, Coolify pulls from there |
| `MAX_UPLOAD_MB` | Optional upload cap (default `5`) |

## Architecture — three-stage generation

```
                 ┌──────────────────────┐
  site prompt ──▶│  Stage 1 · Theme     │──▶ palette, fonts, tokens, Header/Footer/Button/Card
                 └──────────────────────┘
                           │
                           ▼
                 ┌──────────────────────┐
  page prompt ──▶│  Stage 2 · Page      │──▶ html + css + [selectorId,role,variantId]*
                 └──────────────────────┘
                           │
                           ▼
                 ┌──────────────────────┐
  instruction ─▶│  Stage 3 · Element    │──▶ element.html/css replace (lock-aware)
                 └──────────────────────┘

                 ┌──────────────────────┐
  memory, ──────▶│  Deploy bundler       │──▶ DOMPurify-sanitized static files
  change log     │  → GitHub → Coolify  │     pushed to a topic-tagged repo
                 └──────────────────────┘
```

Per-site mutex (`src/server/services/mutex.ts`) serializes all write pipelines for a single site. SSE streams propagate `AbortSignal` end-to-end so closing a tab cancels the OpenAI call.

## Deployment (Coolify + GitHub)

`POST /api/deploy/[siteId]`:
1. `bundleSite` renders every page through DOMPurify into plain HTML/CSS.
2. `ensureDeployRepo` either finds a Sitecraft-owned repo (topic `sitecraft-deploy`) or creates one. Repos without the marker topic are refused — this blocks accidental writes to unrelated repos.
3. `pushBundle` writes the bundle as a single commit to `main`.
4. `ensureStaticApp` registers/updates a Coolify static app pointed at the repo, then triggers a deploy.
5. Deployment status is polled until `finished`/`failed`.

## Security posture

- SSE routes pass `req.signal` into OpenAI; client disconnect stops the stream.
- All deploy-bound HTML is DOMPurified (`<script>`, inline event handlers stripped).
- Image reference URLs are path-traversal-guarded before base64 upload to Vision.
- Asset uploads: magic-byte sniffed (PNG/JPG/WebP/GIF), SVG rejected, size-capped via `MAX_UPLOAD_MB`.
- GitHub deploy target must carry a marker topic; tokens redacted from error logs.
- Per-IP token-bucket rate limiter: 30/min on AI routes, 200/min on reads (`src/server/rateLimit.ts`).
- Security headers (`middleware.ts`): CSP, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`.

## Scripts

| Script | What |
|---|---|
| `npm run dev` | Next.js dev server on :3000 |
| `npm run build` | Production build (TS must be clean) |
| `npm run db:push` | Sync Prisma schema to DB |
| `npm run db:studio` | Prisma Studio |
| `npx tsx scripts/seed-v2.ts` | Create a demo site + theme + 4 pages + one element edit |
| `npm run smoke:phase3` | Cross-page preview smoke |
| `npm run smoke:phase4` | Element upsert/patch smoke |
| `npm run smoke:security` | Deterministic security checks (bundler sanitation, path traversal, magic bytes, redaction, rate limit) |
| `npm run smoke:deploy` | Deploy bundler dry-run into `.deploy-dryrun/` |
| `npm run e2e` | Phase 5 golden-path service-layer E2E (skips AI steps without live `OPENAI_API_KEY`) |

## Further reading

- `docs/superpowers/specs/2026-04-16-sitecraft-v2-design.md`
- `review-1.md` — v1 security/perf audit
