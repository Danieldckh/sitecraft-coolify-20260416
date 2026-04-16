# Phase 1 Implementation Plan — Backend

Goal: land the new data model, generation pipeline, and API routes behind a working seed script. No UI work in this phase — the existing v1 UI will break. That's expected; Phase 2 rebuilds it.

## Deliverables
1. Prisma schema rewritten (drop Section, add Theme/Element/Asset/Conversation/Question).
2. Dev DB reset + regenerated client.
3. Style preset catalog (`src/server/ai/stylePresets.ts`) — 12 presets with name, description, hint tokens.
4. Prompt library (`src/server/ai/prompts.ts`) — THEME, PAGE, ELEMENT_EDIT, CLARIFIER system prompts with ban list + anti-generic rules.
5. Section-variant taxonomy (`src/server/ai/variants.ts`) — ~8 variants per section role.
6. Services:
   - `themeService.generate(siteId)` — one call, structured output → Theme row + Library JSON.
   - `clarifier.askForScope(scope, targetId)` — returns `Question[]`.
   - `pageService.generate(pageId)` — SSE, theme+library+variants injected, writes Page + Elements with stable IDs.
   - `elementService.edit(pageId, elementId, prompt)` — SSE, patches single element.
   - `assetService.store(siteId, file)` — magic-byte sniff, path guard, reject SVG.
7. API routes per spec §API surface.
8. Security fixes (path traversal, lock enforcement on write routes, per-site mutex via `p-queue` concurrency=1 keyed by siteId).
9. Seed script `scripts/seed-v2.ts` creating one demo site end-to-end through the pipeline.

## File ownership (for parallel workers, if a team is spawned)

**Worker A — Data layer**
- `prisma/schema.prisma`
- `src/types/models.ts`
- `src/server/db/mappers.ts`
- `scripts/seed-v2.ts`
- `scripts/migrate-v1-to-v2.ts` (drops old Section rows if any)

**Worker B — AI layer**
- `src/server/ai/prompts.ts` (full rewrite)
- `src/server/ai/stylePresets.ts` (new)
- `src/server/ai/variants.ts` (new)
- `src/server/ai/themeGen.ts` (new)
- `src/server/ai/pageGen.ts` (new)
- `src/server/ai/elementEdit.ts` (new)
- `src/server/ai/clarifier.ts` (new)
- `src/server/ai/imageUrl.ts` (path-traversal fix)
- Delete: `src/server/ai/sections.ts`

**Worker C — Services + API**
- `src/server/services/regenerate.ts` (replaced by `siteOrchestrator.ts`)
- `src/server/services/themeService.ts` (new)
- `src/server/services/pageService.ts` (new)
- `src/server/services/elementService.ts` (new)
- `src/server/services/assetService.ts` (new)
- `src/server/services/conversationService.ts` (new)
- `src/server/services/mutex.ts` (new — `p-queue` per-site)
- `src/server/services/locks.ts` (extend to element scope)
- `src/server/storage/index.ts` (path guard + MIME sniff + magic-byte)
- All `src/app/api/**/route.ts` per the route map

**Worker D — Deploy + bundler**
- `src/server/deploy/bundler.ts` (theme + pages bundler, sanitize HTML via `isomorphic-dompurify`)
- `src/server/deploy/github.ts` (repo marker topic)
- `src/app/api/deploy/[siteId]/route.ts` (adapt to new schema)

## Integration order
1. A finishes schema → commits migration → B/C/D proceed.
2. B + C work in parallel; C depends on B's exports for route handlers but can stub until wired.
3. D last (deploy tested with a generated site).

## Verification gate
- `npm run build` passes with zero TypeScript errors.
- `scripts/seed-v2.ts` runs end-to-end: creates site → generates theme → generates 4 pages in parallel → edits one element → bundles → (deploy step dry-run if GitHub token still invalid).
- Tester agent hits every new API route with curl/fetch, confirms schemas.
