# Simple Rebuild — 2026-04-17

## Goal

Replace the current multi-step Sitecraft builder (theme-first wizard, style presets,
asset uploader, per-site Coolify deploy) with a minimal prompt-driven flow powered by
Claude agent teams. User writes one prompt, watches the site build itself live, clicks
elements to re-prompt them, exports the result as a zip.

## User flow (entire product surface)

1. `GET /` — one textarea, one "Build" button. Nothing else.
2. Submit → `POST /api/build { prompt }` returns `{ siteId }`, redirect to `/site/[id]`.
3. `GET /site/[id]` — two-pane layout:
   - **Left (70%):** live iframe of `/preview/[id]`. Sections materialize as agents finish them.
   - **Right (30%):** inspector — empty until you click a section in the iframe, then shows
     the element's current HTML + a re-prompt textarea + "Apply" button.
   - **Top-right:** "Export ZIP" link — downloads `index.html` + tiny `README.md`.
4. Click any element in the iframe → right pane populates with that element's HTML +
   prompt box → submit → `POST /api/edit` replaces that element, iframe reloads.

No dashboards, no tabs, no menus, no multi-page, no asset library, no Coolify per-site deploy.

## Architecture

### Agent team (server-side, in `/api/build`)

Using `@anthropic-ai/sdk` directly (not the Agent SDK — we don't need tool use, just
parallel calls with shared context). Three roles, one Claude call each (except Designers which fan out):

| Role | Model | Input | Output |
|---|---|---|---|
| **Architect** | `claude-opus-4-7` | User prompt | JSON plan: `{ siteName, palette, typography, sections: [{id, role, brief}] }` |
| **Designer ×N** | `claude-sonnet-4-6` | One section brief + global palette/type + prior sections' HTML (for cohesion) | HTML+CSS for that one section, wrapped `<section data-el-id="{id}">…</section>` |
| **Element editor** *(for re-prompts)* | `claude-haiku-4-5-20251001` | Current element outerHTML + user re-prompt + palette/type | Replacement outerHTML |

Designers run sequentially (not parallel) so each one can see the previous section's
output and maintain visual cohesion. Acceptable latency cost — streaming hides it.

### Streaming protocol

`/api/build` streams text over SSE:
- `event: plan` — architect's JSON
- `event: section` — `{ id, html }` as each Designer completes
- `event: done` — final signal

Client accumulates into the DB via the API and the iframe polls `/preview/[id]` for updates.
Actually simpler: the API route does writes as it goes, and the iframe has a 500ms poll loop
while `event: done` hasn't fired.

### Data model

Use existing Prisma schema. One `Site` per build, one `Page` per site (always `slug="home"`),
sections stored as `Element` rows keyed by `data-el-id`. Full assembled HTML cached on
`Page.pageHtml`. No schema changes needed.

### Files to create

- `src/server/ai/anthropic.ts` — thin Anthropic client (replaces `src/server/ai/client.ts`)
- `src/server/ai/architect.ts` — site plan call
- `src/server/ai/designer.ts` — section HTML call
- `src/server/ai/editor.ts` — element re-prompt call
- `src/server/ai/orchestrator.ts` — ties them together, yields SSE events
- `src/app/api/build/route.ts` — POST prompt, SSE stream
- `src/app/api/edit/route.ts` — POST element edit
- `src/app/api/export/[siteId]/route.ts` — GET zip
- `src/app/page.tsx` — replace with single-prompt landing
- `src/app/site/[id]/page.tsx` — new split-view editor
- `src/app/site/[id]/inspector.tsx` — right-side re-prompt panel (client component)
- `src/app/preview/[id]/page.tsx` — keep/adapt existing preview route (serves the assembled HTML)

### Files to delete (or stop routing to)

- `src/app/(dashboard)/*` — old site list + wizard
- `src/app/(editor)/*` — old tabbed editor
- `src/app/api/deploy/*` — per-site Coolify deploy (we're exporting, not deploying)
- `src/server/ai/{clarifier,themeGen,pageGen,elementEdit,variants,stylePresets,memory,prompts,banlist,imageUrl,index}.ts` — OpenAI-era helpers. Consolidated into new `architect.ts` / `designer.ts` / `editor.ts`.
- `src/server/deploy/*` — GitHub + Coolify per-site deploy pipeline

### Files to keep intact

- `prisma/schema.prisma`
- `src/server/rateLimit.ts` — apply to new routes
- Security headers in `middleware.ts`
- Playwright e2e infrastructure

## Prompt architecture (key system prompts abbreviated)

### Architect system prompt
> You are a senior art director. Given a user's description of a site, output a JSON plan
> with: `siteName`, `palette` (primary/secondary/accent/ink/surface in hex), `typography`
> (display + body fonts from Google Fonts), and `sections` array of 5-8 section briefs.
> Each brief has `id` (kebab-case), `role` (hero|features|…|footer), and `brief` (1-3 sentence
> instruction for the designer). Favor distinctive, editorial layouts. Avoid generic
> SaaS-template patterns.

### Designer system prompt
> You write one polished HTML section with inlined CSS in a `<style>` tag scoped via the
> section's class. Use the provided palette and fonts exclusively. Produce real copy
> (not placeholder text). Output format: `<section class="{id}" data-el-id="{id}">...</section>`
> followed by `<style>.{id} { ... } </style>`. No scripts, no external resources except
> Google Fonts import at top of style. Must look crafted, not generic.

### Element editor system prompt
> Rewrite the given element per the user's instruction. Preserve the `data-el-id`.
> Keep scoped class names consistent. Keep the site's palette/typography unchanged
> unless the instruction explicitly requires otherwise.

## Non-goals (explicit YAGNI cuts)

- Multi-page sites
- Authentication
- Site persistence across server restarts in dev (SQLite is ephemeral; that's fine)
- Undo/redo history
- Asset uploads (no images → Unsplash hotlinks are fine for MVP)
- Responsive breakpoints beyond what Designer writes inline
- Coolify per-site deploy (replaced by Export ZIP)

## Success criteria

- Enter prompt on `/`, click Build, see a full site render in < 60s with visible section-by-section streaming
- Click any section, describe a change, see it applied in < 10s
- Click Export, get a zip containing working `index.html` that renders identically when opened locally
- No OpenAI imports anywhere in `src/`
