# Iteration 1 Checklist

Derived from `test-report-1.md` (2026-04-16).

## P0 — blocks golden path

- [x] **P0-1** `GET /api/sites` returned `{sites:[]}` envelope, UI expected bare array. **Fixed** in `src/app/api/sites/route.ts:14` → returns bare `SiteDTO[]`.
- [x] **P0-2** `POST /api/sites` returned `{site:{}}` envelope, create-mutation expected `SiteDTO`. **Fixed** same file line 52 → returns bare `SiteDTO`.
- [x] **P0-3** `/sites/[id]/changes` crashed because `GET /api/memory/[siteId]` returned `{summary, recentEntries}` but UI expected `{site:{id,name,memorySummary}, entries}`. **Fixed** server to match UI shape in `src/app/api/memory/[siteId]/route.ts`.
- [x] **P0-4** Vision call failed with "Image URL is invalid" because OpenAI can't fetch `/uploads/...` local paths. **Fixed** by adding `src/server/ai/imageUrl.ts` which converts local-origin URLs to base64 data URLs; wired into `sections.ts`.
- [ ] **P0-5** Deploy fails with GitHub `Bad credentials`. The `GITHUB_TOKEN` in `.env` is rejected by GitHub API. **Cannot fix programmatically — user must provide a valid token (classic PAT with `repo` scope, or fine-grained PAT with `contents:write` + `administration:write` at user-scope so it can create new repos).**

## P1 — UX-critical

- [x] **P1-1** Inspector Name/Site-prompt fields were empty because `useSite` hook expected bare `SiteDTO` while `GET /api/sites/[id]` returned `{site, pages}` envelope. **Fixed** server → bare `SiteDTO` (removed redundant nested include; pages come from `/api/sites/[id]/pages`).
- [x] **P1-2** Sidebar page-click triggered `window.prompt('Page name?')` via the add-page handler. **Fixed** by auto-naming new pages "New Page N" (user renames via inspector).
- [ ] **P1-3** Node z-order: section nodes intercept pointer events meant for the parent page group. Requires z-index/pointer-events tweak on the page-node container in `nodes.tsx`. **Punted to iter 2** — tester to re-verify.
- [ ] **P1-4** Create-site dialog shows no error UX on silent failure. Was a symptom of P0-2 redirect failure; retest after P0-2 fix confirms symptom resolution.

## P2 — polish (defer)

- AI generates 7 sections instead of 5 on some pages (variance in template) — document or cap.
- No skeleton during SSE streaming.
- `deployedUrl` not populated on site cards after a successful deploy.
- Missing `/favicon.ico`.
- Stray "Smoke Test"/"Shape Test" sites in DB from testing.

## Next steps
1. Spawn 4 parallel reviewers (security, architecture, performance, a11y) → `review-1.md`.
2. Re-run tester for iteration 2 E2E → `test-report-2.md`.
3. User must provide working `GITHUB_TOKEN` before final deploy verification (Task #11).
