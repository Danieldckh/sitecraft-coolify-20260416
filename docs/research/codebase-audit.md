# Codebase Audit — Pivot to Page-Based Generation

Source files in `src/`: **63** — KEEP 31, REFACTOR 23, DELETE 9.

## Module-by-module verdicts

| File | Verdict | Reason |
|------|---------|--------|
| `src/app/page.tsx` | KEEP | Root redirect |
| `src/app/layout.tsx` | KEEP | Basic Next.js layout |
| `src/app/providers.tsx` | KEEP | TanStack Query + Zustand setup |
| `src/app/(dashboard)/sites/page.tsx` | KEEP | Sites list; minor UX fixes (P1-2 rename prompt) |
| `src/app/(editor)/sites/[id]/page.tsx` | REFACTOR | Drop React Flow canvas, keep shell |
| `src/app/(editor)/sites/[id]/changes/page.tsx` | KEEP | Change log viewer works |
| `src/app/api/sites/route.ts` | KEEP | Fixed in P0-1/2 |
| `src/app/api/sites/[id]/route.ts` | KEEP | Remove redundant findUnique |
| `src/app/api/sites/[id]/pages/route.ts` | KEEP | Add pagination later |
| `src/app/api/sites/[id]/sections/route.ts` | REFACTOR | Becomes `/pages` list with field select |
| `src/app/api/sites/[id]/changes/route.ts` | KEEP | |
| `src/app/api/pages/route.ts` | DELETE | Superseded by per-site routes |
| `src/app/api/pages/[id]/route.ts` | REFACTOR | Remove section-concat logic |
| `src/app/api/sections/route.ts` | DELETE | Section concept retired |
| `src/app/api/sections/[id]/route.ts` | DELETE | Section concept retired |
| `src/app/api/sections/[id]/generate/route.ts` | DELETE | Replaced by `/api/pages/[id]/generate` |
| `src/app/api/sections/[id]/analyze-image/route.ts` | REFACTOR | Move to element-scope vision |
| `src/app/api/upload/route.ts` | REFACTOR | Add MIME sniff + magic bytes (sec-#4) |
| `src/app/api/deploy/[siteId]/route.ts` | REFACTOR | Page-based bundler |
| `src/app/api/deploy/[siteId]/status/route.ts` | KEEP | Status polling |
| `src/app/api/memory/[siteId]/route.ts` | KEEP | |
| `src/app/api/debug/github/route.ts` | DELETE | Debug only |
| `src/components/editor/Canvas.tsx` | DELETE | React Flow canvas retired |
| `src/components/editor/nodes.tsx` | DELETE | Section node retired |
| `src/components/editor/layout.ts` | DELETE | dagre layout retired |
| `src/components/editor/Inspector.tsx` | REFACTOR | Generalize to element-level edits |
| `src/components/editor/SiteInfoPanel.tsx` | REFACTOR | Site/theme/style panel |
| `src/components/editor/TopBar.tsx` | REFACTOR | Add tabs: Build / Preview / Style |
| `src/components/editor/PromptEditor.tsx` | KEEP | Reuse for page prompts |
| `src/components/editor/ImageUpload.tsx` | KEEP | Reuse for assets |
| `src/components/editor/LockToggle.tsx` | KEEP | |
| `src/components/preview/IframePreview.tsx` | REFACTOR | Full-site multi-page |
| `src/components/preview/FullSitePreview.tsx` | REFACTOR | Becomes primary preview |
| `src/components/preview/CodeTabs.tsx` | KEEP | |
| `src/components/preview/buildHtml.ts` | REFACTOR | Theme + pages composition |
| `src/components/preview/scopeCss.ts` | KEEP | |
| `src/components/library/SiteCardPreview.tsx` | KEEP | |
| `src/hooks/use-site.ts` | REFACTOR | Drop section mutations, add theme/element |
| `src/stores/editor.ts` | REFACTOR | Element selection, style panel state |
| `src/types/models.ts` | REFACTOR | Theme/Asset/Element/Question DTOs |
| `src/lib/utils.ts` | KEEP | |
| `src/server/ai/client.ts` | KEEP | |
| `src/server/ai/index.ts` | REFACTOR | Re-exports for new pipeline |
| `src/server/ai/prompts.ts` | REFACTOR | THEME_, PAGE_, ELEMENT_EDIT_ prompts |
| `src/server/ai/sitemap.ts` | REFACTOR | Still used for page-list discovery |
| `src/server/ai/sections.ts` | DELETE | Section concept retired |
| `src/server/ai/stream.ts` | KEEP | Reuse for page/element streams |
| `src/server/ai/vision.ts` | KEEP | |
| `src/server/ai/memory.ts` | KEEP | |
| `src/server/ai/imageUrl.ts` | REFACTOR | Add path-traversal guard (sec-#1) |
| `src/server/db/client.ts` | KEEP | |
| `src/server/db/mappers.ts` | REFACTOR | New DTOs |
| `src/server/deploy/coolify.ts` | KEEP | |
| `src/server/deploy/github.ts` | KEEP | Add repo marker (sec-#3) |
| `src/server/deploy/bundler.ts` | REFACTOR | Theme + multi-page bundle |
| `src/server/services/changelog.ts` | KEEP | |
| `src/server/services/locks.ts` | REFACTOR | Extend to element locks |
| `src/server/services/regenerate.ts` | REFACTOR | theme/page/element pipeline, parallel |
| `src/server/services/slug.ts` | KEEP | |
| `src/server/storage/index.ts` | REFACTOR | Path guards (sec-#8) + MIME sniff |
| `src/server/env.ts` | KEEP | |
| `src/server/http.ts` | KEEP | |

## Reusable plumbing
- OpenAI SDK + SSE streaming (`ai/stream.ts`) — reuse for page and element streams
- Coolify + GitHub deploy — unchanged
- Prisma + TanStack Query patterns — unchanged
- Memory / change-log concept — extended to theme + element scopes

## Must go
React Flow canvas, section nodes, section DB model, section API routes, per-section buildHtml concat, dagre layout.

## New Prisma schema (proposed)

```prisma
model Site { … pages, theme, assets, conversations, memoryEntries, changeLog, deployments }
model Theme { siteId @unique, primaryColor, secondaryColor, fontFamily, headerHtml/Css, footerHtml/Css, tokensJson }
model Page { siteId, slug, pagePrompt, pageHtml/Css/Js, orderIdx, navVisible, locked }
model Element { pageId, selectorId (stable sc-el-<cuid>), prompt, html, css, locked }
model Asset { siteId, kind (logo|image|font), url, mime, sizeBytes }
model Conversation { siteId, scope (site|page|element), targetId → Question[] }
model Question { conversationId, question, response, kind (text|upload|choice) }
model MemoryEntry / ChangeLogEntry / Deployment (unchanged shape; extended enums)
```

## API route map

| Old | New |
|-----|-----|
| `POST /api/sections` | (removed) |
| `POST /api/sections/[id]/generate` | `POST /api/pages/[id]/generate` (SSE) |
| `PATCH /api/sections/[id]` | `PATCH /api/elements/[id]` |
| `POST /api/sections/[id]/analyze-image` | `POST /api/elements/[id]/analyze-image` |
| *(new)* | `POST /api/sites/[id]/theme/generate` |
| *(new)* | `GET/PATCH /api/sites/[id]/theme` |
| *(new)* | `POST /api/sites/[id]/conversations` — ask+answer clarifying questions |
| *(new)* | `POST /api/sites/[id]/assets` — logo/image upload |
| *(new)* | `POST /api/pages/[id]/element-edit` — stream element edit |
| `POST /api/deploy/[siteId]` | unchanged path, page-based bundler |

## Top refactor risks
1. **Prisma migration** — drop Section; SQLite is dev only, so `prisma migrate reset` + regenerate seeds is acceptable for dev, but prod data has to be discarded. Document this explicitly.
2. **Streaming race on same page** — per-page in-process mutex (`p-queue` concurrency 1 keyed by pageId).
3. **Stable element selectors** — require AI to inject `id="sc-el-<cuid>"` on every meaningful block; element picker uses those IDs, never positional selectors.
4. **Full-site preview with cross-page nav** — iframe intercepts link clicks, posts `{type:'navigate', slug}` back to parent; parent swaps iframe `srcDoc` without reload.
5. **Parallelizing page generation** — `Promise.allSettled` with p-limit=3 across pages; per-page mutex still enforced.
