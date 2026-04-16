# Sitecraft Test Report — Pass 1 (2026-04-16)

Tester: Claude (E2E)
Site under test: `Demo Co` (`cmo0zw1vr0003c88dmiw0mvxo`), seeded via `/sites` dialog.
Dev server: http://localhost:3000 (Next.js 15, SQLite).

## Summary

| # | Scenario                                      | Result   |
|---|-----------------------------------------------|----------|
| 1 | Landing / site list (`/sites`)                | PARTIAL  |
| 2 | Create site via dialog                        | PARTIAL  |
| 3 | Sitemap auto-generation (4 pages)             | PASS     |
| 4 | Select page node -> inspector (5 sections)    | PARTIAL  |
| 5 | Select hero section -> inspector              | PASS     |
| 6 | Generate section (SSE)                        | PASS     |
| 7 | Lock section / change page prompt invariant   | PASS     |
| 8 | Image upload + `analyze-image` vision         | FAIL     |
| 9 | `/sites/[id]/changes` viewer                  | FAIL (API OK) |
|10 | Deploy to Coolify via GitHub                 | FAIL (GitHub creds) |

Golden path breaks at the Changes page (runtime crash) and at Deploy (upstream auth). Core data model, sitemap auto-gen, SSE streaming, and lock cascade invariants all work.

## Findings

### P0 (blocks golden path)

- [ ] **`GET /api/sites` returns `{ sites: [...] }` but `/sites` page expects an array.** Client code: `src/app/(dashboard)/sites/page.tsx:13` — `fetchSites(): Promise<SiteWithMeta[]>` does `return r.json()`, then `sites.length === 0` is always true because `r.json()` is `{sites:[...]}`. The empty-state card renders forever even after creating sites. Evidence: `sites-list.png` shows empty list though `curl /api/sites` returns 2 sites.
- [ ] **`POST /api/sites` returns `{ site: {...} }` but create-site mutation expects `SiteDTO` with `.id`.** `onSuccess: (site) => router.push(/sites/${site.id})` in `page.tsx:188`. After submitting the New Site form, user stays on `/sites` with no redirect. The site is actually created (visible via API), but the UX suggests failure.
- [ ] **`/sites/[id]/changes` page crashes at runtime.** `TypeError: Cannot read properties of undefined (reading 'name')` at `changes/page.tsx:130`. The changes API (`GET /api/sites/[id]/changes`) returns a plain array of 40 log entries (correct); the UI component appears to destructure `entries.name` or expects a wrapping envelope. Overlay visible in `changes-page-crash.png`.
- [ ] **`POST /api/sections/[id]/analyze-image` cannot fetch relative image URLs.** `analyze-image` endpoint validates as multipart with an `image` file field, but once the image is stored at `/uploads/...`, the subsequent OpenAI vision call errors out: `"400 Failed to download image from /uploads/... Image URL is invalid."` OpenAI requires an absolute, publicly reachable URL, a data URL, or base64. The dev server needs to either pass `file://` / base64 / public ORIGIN prefix. Also, the endpoint response `Missing "image" field` when given URL-only form suggests no URL-reupload path — confusing API shape (why store image via `/api/upload` at all if `analyze-image` insists on the raw file?).
- [ ] **Deploy fails on GitHub credentials.** `POST /api/deploy/cmo0zw1vr0003c88dmiw0mvxo` returns `status: "failed"`, logs: `ERROR: Bad credentials - https://docs.github.com/rest`. `.env` has `GITHUB_TOKEN=ghp_iY...pIEt` — token looks syntactically valid but is rejected by GitHub API. Could not verify any downstream Coolify step or the reachable deployment URL. **Needs a working token (fine-grained PAT with `repo` + `workflow` scopes) before this path can be validated.**

### P1 (UX-critical, not blocking)

- [ ] **Editor "Site" inspector shows empty Name and Site prompt** even for a just-loaded site with both fields set (verified by API). Inspector fields should hydrate from the loaded site state. Evidence: `editor-canvas.png`.
- [ ] **Clicking a page name in the left sidebar opens a JS `prompt()` asking "Page name?"** — unexpected. A single click should select the page, not trigger rename. Rename should be explicit (double-click, dedicated rename control, or the `…` menu). This was triggered clicking "Home" (`ref=e61`).
- [ ] **Page node / section node z-order overlap** — section nodes intercept clicks intended for the parent page node on the canvas (`subtree intercepts pointer events` during Playwright click on `page-*` group).
- [ ] **Create-site dialog:** no user-facing error despite silent redirect failure (see P0 #2). Mutation succeeded server-side so `isError` is false; UI just sits there.

### P2 (polish / nice-to-have)

- [ ] OpenAI sometimes returns more sections than the default template (Features page got 7 sections including 3 × `features` type). Plan says "5 default sections". Either cap at 5 or document the variance.
- [ ] `%o \n %s` console error formatting for the unhandled runtime error is noisy; dev overlay already covers it.
- [ ] No loading indicator/skeleton during section streaming generation visible in the inspector panel — user sees a static "Generate" button during the 3–6s OpenAI call.
- [ ] The sites list "deployedUrl" field is referenced by UI but never populated even if a deployment succeeds (API shape mismatch feeds into this — can't really verify yet).
- [ ] `/favicon.ico` 404 on every page load.
- [ ] 1 stray "Smoke Test" site still present from earlier — test cleanup.

## Evidence

Screenshots (in `C:\Users\pamde\Desktop\Website Builder\`):
- `sites-list.png` — list view; shows header + "New site" button but no site cards despite DB having 2 sites.
- `editor-canvas.png` — editor after navigating directly to `/sites/[id]`; 4 page nodes + section children render correctly on the React Flow canvas.
- `editor-with-inspector.png` — editor after interacting; right-hand "Site" inspector visible (empty name/prompt fields — P1).
- `inspector-section.png` — inspector in "Section" mode showing sectionPrompt, reference-image uploader, and Generate button (PASS).
- `changes-page-crash.png` — Next.js dev overlay showing runtime TypeError in `ChangesPage`.

API evidence:
- `GET /api/sites` -> `{"sites":[{...Demo Co...},{...Smoke Test...}]}` (2 sites).
- `GET /api/sites/<id>` -> `{site:{...}, pages:[4 pages with meaningful AI-generated pagePrompts]}`.
- `GET /api/pages/<homeId>` -> 5 sections, 4 of 5 already have `html`/`css` populated immediately after site creation (sitemap + section gen kicked off automatically — good).
- SSE `POST /api/sections/<footerId>/generate` streamed `data: {"delta":"..."}` tokens and populated `html` (793 chars) on completion.
- Lock invariant test: `PATCH /api/sections/<headerId> {locked:true}` → `PATCH /api/pages/<homeId> {pagePrompt:"..."}` → section `sectionPrompt` unchanged after 8s wait. ✅
- `GET /api/sites/<id>/changes` -> 40 entries of correct shape: `{scope, summary, createdAt, ...}` including "Created page", "Generated header/hero/features/cta/footer section", "Updated page prompt", etc. Memory system is logging correctly.
- `POST /api/deploy/<id>` -> `{deployment:{status:"failed", logs:"...Bundling site...Bundled 6 files...Bad credentials"}}` — bundler phase works; GitHub phase blocked on token.

Console errors observed:
- `ChangesPage` TypeError (P0) — reproducible on every load of changes page.
- No console errors during editor / sites-list pages (only a 404 for favicon).

## Recommendations (for iteration checklist)

1. Fix API-envelope mismatches: either unwrap on the server (return arrays/DTOs directly) or update all three client components (sites list, create-site mutation, changes page). Pick one and be consistent across **all** `/api/*` routes.
2. Hydrate inspector state from the loaded site (Zustand store initializer from server fetch).
3. Replace `prompt()` rename with an inline-edit or dropdown action; single-click in sidebar should only select.
4. `analyze-image` pipeline: either send base64 / data URL to OpenAI directly (preferred for dev) or guarantee an absolute `NEXT_PUBLIC_ORIGIN`-prefixed URL.
5. Re-provision `GITHUB_TOKEN` with a fine-grained PAT that has `contents:write` on the target org/user namespace and retry deploy end-to-end.
6. Add a Playwright regression covering the golden path once P0 items are fixed.
