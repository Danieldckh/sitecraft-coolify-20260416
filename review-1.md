## Security

### HIGH

1. **Path traversal in `resolveImageUrlForOpenAI`** — `src/server/ai/imageUrl.ts:16-26`. Input is only checked against `http(s)://` / `data:` prefixes, otherwise it's passed through `path.join(cwd, 'public', relative)` with no normalization or containment check. A caller supplying `/uploads/../../.env`, `/../../prisma/dev.db`, or on Windows `\..\..\...` yields arbitrary file reads (then exfiltrated as a base64 data URL to OpenAI). `referenceImageUrl` on a section is user-controllable (PATCH validates only `z.string().url()`, which rejects relative paths — but `analyze-image` and internal flows feed stored `url` values here too). Fix: resolve to absolute, then assert `fullPath.startsWith(path.resolve(publicRoot) + path.sep)`; reject anything containing `..`.

2. **Stored XSS / script execution in iframe preview** — `src/components/preview/IframePreview.tsx:40` sets `sandbox="allow-scripts"` without `allow-same-origin`, which is correct for origin isolation, BUT section `html`/`css`/`js` are accepted verbatim via PATCH (`src/app/api/sections/[id]/route.ts:28-38`, no sanitization, no length cap on html/css/js) and inlined raw into `buildHtml.ts:42-44` and `bundler.ts:129,139`. In the in-app preview this is contained by sandbox, but the deployed bundle (`bundler.ts`) ships the same unvalidated HTML/JS to the public Coolify site with no sandbox — i.e. any attacker who can call the (unauth, v1) API can plant arbitrary JS that runs on the deployed domain. The AI itself can also inject `<script src="…attacker…">`. Load-bearing because deployed artifacts are public. Fix: cap field sizes, strip `<script src>` to same-origin, and/or run DOMPurify-equivalent on html before bundling.

### MEDIUM

3. **GitHub repo name injection via site name** — `src/app/api/deploy/[siteId]/route.ts:16-35` slugifies site.name, but the 40-char truncation + `-<6 id>` can collide across sites whose slugs share a prefix, and `ensureDeployRepo` (`src/server/deploy/github.ts:29`) will then *return an existing repo it did not create* and push arbitrary content into it. If the token's account has unrelated repos matching `website-builder-deploys-<x>`, those become writable targets. Fix: tag created repos (topic/description marker) and assert it before pushing to a pre-existing repo.

4. **No MIME/content verification on uploads** — `src/app/api/upload/route.ts:18` and `sections/[id]/analyze-image/route.ts:26` trust `file.type` (client-supplied). An attacker can upload HTML/SVG-with-JS labeled `image/png` to `/public/uploads/...`, served same-origin from the Next app — XSS on the builder UI origin. Fix: sniff magic bytes, or serve uploads with `Content-Type` override + `Content-Disposition: attachment` for non-sniffed types; reject SVG.

5. **Prompt injection via uploaded image + section prompt** — `analyze-image/route.ts:42-47` concatenates `site.sitePrompt`, `page.pagePrompt`, `section.sectionPrompt` and the image into the Vision request; results are written back as executable html/css/js with no review. Combined with (2), a malicious reference image or prompt can steer the model to emit attacker-chosen JS that ships to production. Mitigation belongs with (2) — treat AI output as untrusted.

### LOW

6. **Deployment tokens in logs** — `coolify.ts:14` includes full Coolify error body (`await res.text()`) in thrown `Error.message`, which propagates into `deploy/[siteId]/route.ts:143` `appendLog` and is persisted to `deployment.logs` + returned in the API response. If Coolify ever echoes the Authorization header or tokenized URLs on error, they leak. Redact before logging.

7. **`referenceImageUrl` accepts any URL** — `sections/[id]/route.ts:36` uses `z.string().url()`, enabling SSRF when that URL is later fetched by `resolveImageUrlForOpenAI` (currently only local paths are fetched server-side, but the schema invites future SSRF). Constrain to same-origin `/uploads/<siteId>/…` or https with an allowlist.

8. **`public/uploads/<siteId>` trusts path-segment siteId** — `storage/index.ts:14` joins `siteId` directly. Upload routes validate via DB lookup first, but `analyze-image` uses `section.page.siteId` (safe). Still, add a `/^[a-z0-9-]+$/` guard in `LocalDiskStorage.put` as defense-in-depth against future callers.

## Architecture

### Layering — mostly clean, one leak
- `src/app/api/**/route.ts` → `src/server/services/*` → `src/server/ai` + `src/server/db` separation is consistent. Good.
- **[MEDIUM]** `src/app/api/sections/[id]/generate/route.ts:51-67` bypasses the services layer and writes directly to `prisma.section` + `logChange`. Duplicates the logic in `regenerateSectionFor` (`src/server/services/regenerate.ts:160-203`). Drift risk: any invariant added to the service (memory append, cascade, validation) won't apply to the streaming path. Extract a `persistSectionCode(sectionId, code)` helper and call from both.

### Lock invariants — inconsistently enforced
- **[HIGH]** `src/app/api/sections/[id]/generate/route.ts:11-47` never checks `section.locked`. A locked section's code can be overwritten by POSTing to `/generate`. Compare to `regenerateSectionFor` (`regenerate.ts:166`) which guards with `if (section.locked) return;` and to PATCH (`sections/[id]/route.ts:51`) which calls `enforceLock`. Add `enforceLock(section, false, 'Section')` or short-circuit.
- **[MEDIUM]** `locks.ts:3` only guards prompt writes. Site/Page/Section PATCH routes still allow non-prompt mutations on locked records (e.g. rename, reorder, toggle `navVisible`). The plan §1.4 says "a locked record's prompt and children are immutable" — current behavior matches the letter but `html`/`css`/`js` direct PATCH on a locked section (`sections/[id]/route.ts:60-62`) is not blocked. Decide and document.

### Prisma usage
- **[HIGH] N+1 in cascade regen.** `regenerateSitemapFor` (`regenerate.ts:82-84`) awaits `regeneratePageFor` sequentially per touched page; each calls `regenerateSectionFor` sequentially per touched section (`:155-157`). Each section call is an OpenAI round-trip. For a 4-page site with ~5 sections each that's 20 serial LLM calls. Plan §9 explicitly calls for parallel section generation on page regen. Use `Promise.all` inside `regeneratePageFor` for the section loop, and optionally `Promise.allSettled` across pages.
- **[HIGH] Missing transaction boundaries.** `regeneratePageFor` (`:107-138`) deletes removed sections, updates existing, and creates new ones as separate awaits. A mid-flight failure leaves the page with a partial section set and a stale `ChangeLogEntry` (or none). Wrap the diff-apply block in `prisma.$transaction` (interactive form), then do LLM regen *after* commit.
- **[LOW]** No index on `Section(pageId, type)` though `regenerate.ts:104,119` builds a `Map` by type per page — fine at current scale, but consider if per-type queries appear.
- **[LOW]** `ChangeLogEntry.diffJson` is `String` storing JSON; querying by content is impossible. Acceptable for v1.

### Race conditions on concurrent regen
- **[HIGH]** Nothing serializes concurrent PATCHes on the same site. Two `sitePrompt` edits in flight will both call `regenerateSitemapFor(siteId)`; both read `site.pages` independently and race their deletes/creates on unique `(siteId, slug)`, producing P2002 errors or lost updates. Add a per-site in-process mutex in `regenerate.ts` or an advisory lock column.

### Error handling
- **[MEDIUM]** `src/server/http.ts` is used uniformly for API route catch-blocks (good). But regen failures are swallowed with `console.error` at call sites (`sites/route.ts:48`, `sites/[id]/route.ts:64`, `pages/[id]/route.ts:80`, `sections/[id]/route.ts:80`) — the PATCH returns 200 with stale data. Either return a `regenerateStatus: 'failed'` field or enqueue via a job and surface status. Silent failure breaks the golden path UX.

### UI coupling
- `src/components/editor/Canvas.tsx` uses `usePages`/`useSections`/`useAddPage`/`useAddSection` via TanStack Query hooks — no direct fetch. Good. Zustand store (`useEditorStore`) is used only for transient UI state (selection, generating map, mirrored nodes/edges), not server truth — correct separation.
- **[LOW]** `Canvas.tsx:96-103` mirrors nodes/edges into the Zustand store on every memo change; only `TopBar`/inspectors need selection, not the full node array. Minor duplication; no correctness issue.

### React Flow parent/child
- `Canvas.tsx:70-79` sets `parentId: 'page-...'` + `extent: 'parent'` on section nodes and `draggable: false`. Correct v12 API. Page nodes have fixed `style: { width: 300, height: 300 }` (`:62`) — `autoLayout` (`components/editor/layout.ts`) must size pages to fit N children or sections will clip at `extent: parent`. Verify layout grows page height with section count; otherwise sections beyond ~5 disappear.

## Accessibility

**[HIGH] Icon-only buttons missing accessible names**
- `src/app/(dashboard)/sites/page.tsx:113-123` — Pencil/Trash2 buttons use only `title` (not reliably exposed as accessible name). Add `aria-label="Edit site"` / `aria-label="Delete site"`.
- `src/components/editor/Inspector.tsx:114-121, 254-261` — Trash2 delete buttons have no label; screen readers announce bare "button".
- `src/components/editor/SiteInfoPanel.tsx:21-27, 48-54` — Collapse/Expand chevron buttons rely only on `title`. Add `aria-label` plus `aria-expanded`.
- `src/components/editor/ImageUpload.tsx:44-50` — "X" remove button has no label.
- `src/components/editor/TopBar.tsx:53-60` — Deploy button doesn't announce its loading state (Loader2 is visual only).

**[HIGH] Destructive actions use `window.confirm`**
- `Inspector.tsx:117, 257` — native `confirm()` bypasses the Radix AlertDialog pattern used in `sites/page.tsx:151` (inconsistent focus management, no Esc-to-cancel semantics preserved across all browsers/AT). Replace with Radix `AlertDialog`.

**[HIGH] Form inputs not programmatically labelled**
- `sites/page.tsx:217-234` — `<label>` elements have no `htmlFor`; inputs have no `id`. Labels are visual only.
- `Inspector.tsx:66-72, 126-130, 133-137` — site/page name & slug `<input>`s have no `<label>` at all (the `Section` wrapper `:47-54` is a `<div>`, not a label).
- `PromptEditor.tsx:31-44` — textarea has no label or `aria-label`; the locked badge (`:46-49`) is visual only, so SR users don't know why edit is disabled. Add `aria-disabled` messaging.

**[HIGH] SSE streaming has no live region**
- `Inspector.tsx:313-319` — streaming `<pre>` updates silently. Wrap with `role="status" aria-live="polite"`. The Generate button (`:290-305`) state flip is also not announced.
- `TopBar.tsx:39-48` — `deployInfo` status/URL appears silently; needs `role="status" aria-live="polite"`.

**[MEDIUM] No visible focus styles on buttons**
- `globals.css:12-15` — `.btn`, `.btn-primary`, `.btn-ghost`, `.btn-accent` define no `focus-visible` ring. Keyboard users get no focus indicator on most buttons across the app. Only `.input` (`:16`) has a focus ring.

**[MEDIUM] Custom modal bypasses dialog semantics**
- `Canvas.tsx:162-185` — "Add section" overlay is a plain `<div>`, not a Radix Dialog. No focus trap, no Escape key handler (only backdrop click), no `role="dialog"`/`aria-modal`/title association. Keyboard users can tab behind it.

**[MEDIUM] Hover-only reveal with tab-order pitfall**
- `sites/page.tsx:108` — action row `opacity-0 group-hover:opacity-100` keeps buttons in the tab order but invisible until hover. Add `group-focus-within:opacity-100`.

**[MEDIUM] Color contrast below AA**
- `text-ink/50` on `bg-paper` (#0b0d12 @ 50% ≈ #858690 on #f7f7f5) ≈ 4.0:1 — fails 4.5:1 AA for normal text. Used widely: `SiteInfoPanel.tsx:37,58,74,86`, `Inspector.tsx:50,61,88,110,159,251,322`, `TopBar.tsx:31,36,40`.
- `text-ink-soft/60`, `/50`, `/40` in `sites/page.tsx:58,81,106,144` and `changes/page.tsx:80,82,94,111,117,183` are further below AA.
- `LockToggle.tsx:31` unchecked track `bg-black/15` vs `bg-paper-raised` fails 3:1 non-text UI contrast (WCAG 1.4.11).
- `.btn-accent` (`globals.css:15`) white on `#4f46e5` ≈ 4.8:1 — passes normal AA but fails AAA; OK.

**[LOW] Misc**
- `ImageUpload.tsx:43` — `alt="reference"` is non-descriptive; use `alt=""` (decorative) or section-specific context.
- `SiteInfoPanel.tsx:76,91` — lock state conveyed only by 🔒 emoji with no text alternative.
- `Canvas.tsx:137-152` — React Flow region has no `aria-label`; keyboard users land in an unlabelled graph viewport.
- `changes/page.tsx:133-147` — scope filter buttons lack `aria-pressed` to convey selected state to AT.

## Performance

### HIGH

1. **Sequential section regeneration** — `src/server/services/regenerate.ts:82-84,155-157`. After a sitemap regen touches N pages, each page is awaited serially (`for (const pageId of touched) await regeneratePageFor(pageId)`), and inside each page every touched section is awaited serially. A 5-page site with 5 sections each = 25 sequential GPT-4o calls (~6s each ≈ 150s wall clock). `Promise.all(touched.map(regenerateSectionFor))` on the section loop, and bounded-concurrency (p-limit 3-5) on the page loop, cuts this to ~15-20s. Same pattern in `regeneratePageFor:114-138` — section create/update prisma calls are serial and could be a single `$transaction([...])`.

2. **SSE has no client-disconnect abort** — `src/app/api/sections/[id]/generate/route.ts:21-75`. The `ReadableStream` never reads `_req.signal`, so if the user closes the tab mid-stream, `streamGenerateSection` keeps draining the OpenAI stream and still writes to Prisma on completion. Wire `_req.signal` → `streamGenerateSection({ signal })` (already supported at `src/server/ai/stream.ts:48`) and check `signal.aborted` before the DB write. Saves wasted tokens and prevents stale overwrites when user navigated away.

3. **No back-pressure on SSE writer** — same file, `controller.enqueue` is never gated on `controller.desiredSize`. For large sections (8k+ chars) each delta token is a frame; on slow clients this buffers unbounded in Node. Low-impact on a solo-dev build but worth a note.

### MEDIUM

4. **Full re-layout + fitView on every keystroke** — `src/components/editor/Canvas.tsx:56-103`. The `useMemo` depends on `pages, sections, generating, handleAddSection`. `generating` is a store object that changes on every streamed token arrival, causing `autoLayout` (dagre) to re-run and `rf.fitView` to fire (throttled to 500 ms but layout itself isn't). For a page with 30 sections streaming, this is a dagre run per token. Split: derive `status` separately, memoize the dagre result on `(pages, sections)` only, and pass status via a ref/context that bypasses layout.

5. **`autoLayout` re-creates whole node array** — `layout.ts:47-68` maps every node even when only section statuses changed. Combined with (4) this is a O(N) allocation per token. Cache keyed on page+section ids.

6. **IframePreview signature via `JSON.stringify`** — `src/components/preview/IframePreview.tsx:17-23`. Stringifying all sections (including html/css/js lengths — OK, but still an O(N) stringify) on every render. 200ms debounce is correct but `useMemo` runs before debounce, so stringify runs on every parent render. Move signature computation into an effect with a ref comparison, or hash ids + `updatedAt` only.

7. **Query invalidation storms** — `src/hooks/use-site.ts:111-114,131-134`. `useAddPage` and `useDeletePage` invalidate both `['pages', siteId]` and `['sections', siteId]` unconditionally. Every section PATCH (lock toggle, prompt edit) invalidates the whole `['sections', siteId]` list (`:99`), refetching every section's full html/css/js payload. Use `setQueryData` targeted updates (the optimistic path already does this — drop the `onSettled` invalidate, or scope to a per-section key).

8. **`/api/sites/[id]/sections` unbounded findMany** — `src/app/api/sites/[id]/sections/route.ts:13-16` returns every section (with full html/css/js) for the site, no pagination, no field selection. A 10-page × 5-section site with 8 KB sections = 400 KB on every invalidate. Add `select` to omit `js`/`css` for the canvas list (canvas only needs `id, pageId, type, orderIdx, locked, lastGeneratedAt, html.length`). Preview page can fetch the heavy fields on-demand.

### LOW

9. **Missing composite index** — `prisma/schema.prisma:48-65`. The sections list query filters by `page.siteId` (`sections/route.ts:14`), which requires a join through `Page`. Fine at current scale, but if you ever denormalize `siteId` onto `Section`, add `@@index([siteId, pageId, orderIdx])`.

10. **`buildSiteContext` called 3× in a sitemap→page→section cascade** — `regenerate.ts:18,95,169`. Each call re-reads memory entries. Pass `ctx` down through the cascade instead of rebuilding.

11. **PATCH site issues 3 queries** — `src/app/api/sites/[id]/route.ts:35,41,68` does findUnique → update → findUnique. The final re-read is unnecessary; `update` already returns the fresh row.
