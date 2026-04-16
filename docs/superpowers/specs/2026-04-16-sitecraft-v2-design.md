# Sitecraft v2 — Design Spec

**Status:** Approved (user delegated autonomous execution 2026-04-16)
**Supersedes:** section-based editor architecture (v1)

## Product thesis

One-shot, high-quality multi-page website generation. User picks which pages they want, writes a prompt per page, uploads assets (logo, images), and answers only the clarifying questions the model genuinely cannot answer itself. The AI produces a site-wide theme + header/footer + each page as a cohesive whole. User previews the full site in a dedicated tab with working cross-page navigation, and can click any element in the preview to edit it via inline prompt, inline text edit, or image upload.

The product stops being a "section painter" and becomes a **site composer**.

## User flow

1. **New site.** User types a short site description. Optionally picks a **style preset** (see §Style pool).
2. **Page picker.** User toggles which pages the site has (Home, About, Services, Contact, Blog, Pricing, FAQ, custom). Reorders.
3. **Per-page prompting.** For each page, a compact chat-style input: user writes what the page should contain.
4. **Clarification pass.** AI emits a short list of *only the questions it can't resolve itself* (e.g. "Upload your logo?", "Phone number for the contact page?", "Do you want a testimonials row — yes / no / skip?"). Each question renders as inline control: text input, file uploader, or choice chips. No question the AI could answer itself (copy, imagery mood, etc.) — those are inferred.
5. **Theme + library generation.** AI generates a `Theme` (design tokens) + shared `Library` (Header, Footer, Button, Card, etc.) FIRST. This is the anti-generic guardrail.
6. **Page generation.** Each page generated in parallel, referencing the theme + library. SSE streams content to the UI.
7. **Preview tab.** Full-site preview with real inter-page navigation (iframe-local routing).
8. **Inspector edit mode.** Toggle in preview → hover highlights elements → click opens popover with: prompt box, inline text edit, image upload. AI produces an element-level patch; page rebuilds.
9. **Style panel.** Sidebar anytime: swap font pairing, tweak palette, change radius/shadow scale. Re-renders without regenerating content.
10. **Deploy.** Unchanged from v1 (GitHub push → Coolify).

## Architecture — three-stage generation

```
  site prompt + style preset + assets + per-page prompts + answered questions
                             │
                             ▼
              ┌──────────────────────────┐
              │  Stage 1: Clarifier      │  gpt-4o-mini, structured output
              │  (questions + inferred   │
              │   defaults)              │
              └──────────────┬───────────┘
                             ▼
              ┌──────────────────────────┐
              │  Stage 2: Theme + Library│  gpt-4o, one JSON doc
              │  - design tokens         │  (palette, type, spacing,
              │  - signature motif       │   radius, shadow, motion,
              │  - Header, Footer, Button│   signature, header, footer)
              │  - page variant choices  │
              └──────────────┬───────────┘
                             ▼
              ┌──────────────────────────┐
              │  Stage 3: Pages (parallel)│  gpt-4o, streamed HTML/CSS
              │  - each page references   │  p-limit 3
              │  - theme + library        │
              │  - variantIds per section │
              │  - stable element IDs     │
              └──────────────────────────┘
```

## Anti-generic mechanics (from research)

1. **Enumerated style pool** (~12 presets: `editorial-serif`, `neo-brutalist`, `soft-glass`, `monochrome-tech`, `playful-marker`, `corporate-clean`, `magazine-split`, `dark-mode-minimal`, `warm-craft`, `swiss-grid`, `y2k-bubble`, `documentary-photojournal`). User-selectable. Baked into every prompt.
2. **Theme tokens before pages.** Model may use only CSS vars from `theme.tokens` — no raw hex, no default Tailwind blue, no generic gradients.
3. **Section variant taxonomy.** Each section type has a named variant list (`hero.split-image-left`, `hero.numbered-statement`, `hero.marquee-headline`, etc., ~8 per section type). Model picks a `variantId`; can't free-form its way back to centered-H1 every time.
4. **Per-site signature motif.** Generated once in Stage 2 (e.g. "oversized outline numerals before each H2"), applied across every page.
5. **Shared Library.** Header + Footer + Button + Card generated once per site. Pages import, don't redefine.
6. **Ban list.** Forbidden phrases ("Welcome to", "Seamlessly", "Unlock the power of"), forbidden gradients (blue→purple, purple→pink), forbidden layouts (centered hero + 3 feature cards). Negative constraints compress better than positive.
7. **Stable element IDs.** AI must emit `id="sc-el-<cuid>"` on every top-level block. Element edits reference these IDs, survive page regenerations.
8. **Element-level diffs.** Visual-inspector edits patch specific IDs, not the whole page. Preserves untouched work.

Model: `gpt-4o-2024-08-06` for theme/pages/edits (structured outputs + taste), `gpt-4o-mini` for clarifier + memory distillation. Anthropic Sonnet remains a v3 consideration; v2 stays on OpenAI (user-provided key already configured).

## Data model

Prisma schema (SQLite for dev, swappable for prod):

```prisma
model Site { id, name, sitePrompt, stylePresetId, domain, locked, memorySummary, ts, pages[], theme?, assets[], conversations[], memoryEntries[], changeLog[], deployments[] }
model Theme { id, siteId @unique, stylePresetId, tokensJson, signatureMotif, libraryJson (Header/Footer/Button/Card as {html,css}), primaryFont, secondaryFont, palette {primary,secondary,accent,surface,ink,muted}, lastGeneratedAt, ts }
model Page { id, siteId, slug, name, pagePrompt, pageHtml, pageCss, pageJs, orderIdx, navVisible, locked, lastGeneratedAt, ts }
model Element { id, pageId, selectorId (="sc-el-<id>"), role (hero|features|cta|custom|...), variantId, prompt, html, css, locked, lastEditedAt, ts }
model Asset { id, siteId, kind (logo|image|favicon|font), url, mime, sizeBytes, meta jsonText, ts }
model Conversation { id, siteId, scope (site|page|element), targetId, questions[] }
model Question { id, conversationId, kind (text|choice|upload|boolean), question, choicesJson?, response?, responseAssetId?, orderIdx, ts }
model MemoryEntry { id, siteId, role, kind, content, ts }
model ChangeLogEntry { id, siteId, scope, targetId, actor, summary, diffJson, ts }
model Deployment { id, siteId, coolifyAppUuid?, deploymentUuid?, url?, status, logs, ts }
```

SQLite migration: `prisma migrate reset` + regenerate (dev DB is disposable; documented in the plan).

## API surface

```
POST   /api/sites                               create site (pick style preset)
GET    /api/sites / GET /api/sites/[id]         list / fetch
PATCH  /api/sites/[id]                          rename, style preset, lock
DELETE /api/sites/[id]

POST   /api/sites/[id]/assets                   upload (logo/image/favicon); magic-byte sniff
GET    /api/sites/[id]/assets

POST   /api/sites/[id]/conversations            start clarifier turn (scope, targetId)
PATCH  /api/sites/[id]/conversations/[cid]      submit answers (text / uploaded asset id / choice)

POST   /api/sites/[id]/theme/generate           Stage 2 (SSE, returns theme+library)
GET    /api/sites/[id]/theme
PATCH  /api/sites/[id]/theme                    manual style panel edits (palette, fonts)

GET    /api/sites/[id]/pages
POST   /api/sites/[id]/pages                    add page from picker (name, slug, optional prompt)
PATCH  /api/pages/[id]                          rename/reorder/navVisible/lock/prompt
DELETE /api/pages/[id]

POST   /api/pages/[id]/generate                 Stage 3 page gen (SSE, theme+library injected)

POST   /api/pages/[id]/elements/[eid]/edit      element-level patch (SSE)
PATCH  /api/pages/[id]/elements/[eid]           direct text/image override (no AI)

POST   /api/deploy/[siteId]                     bundles theme + all pages; unchanged downstream

GET    /api/sites/[id]/changes                  change log (unchanged)
GET    /api/memory/[siteId]                     unchanged
```

## UI (Phase 2 preview)

Top-level editor has three tabs: **Build · Preview · Style**.

- **Build tab:** left rail = page list (checkbox add, drag reorder, lock). Main pane = selected page's chat-style composer (prompt textarea + clarifying-question cards with inline inputs/uploaders). Right rail = assets drawer.
- **Preview tab:** full-site iframe. Top-bar page selector maps to in-iframe nav. Toggle: "Edit mode" — hovering elements highlights them (outline + label), click opens popover: prompt / text / upload. Changes stream in-place.
- **Style tab:** palette swatches, font-pairing picker, radius/shadow scale sliders, motion style, signature-motif editor. Live re-render without regenerating content.
- Design system: tokens → semantic → component layering (per `design-system-patterns` skill). Theme switching (light/dark builder chrome). CVA variants on all builder buttons. Reduced-motion respected.

## Security (from review-1)

- **HIGH:** path-traversal guard in `imageUrl.ts` (normalize + `startsWith(publicRoot)`).
- **HIGH:** sanitize generated HTML before *deployment* bundle (DOMPurify on server). Preview iframe keeps sandbox isolation.
- **HIGH:** enforce locks on any code-writing route (elements/pages/theme).
- **MED:** magic-byte MIME sniff on uploads, reject SVG, `Content-Disposition: attachment` for non-image types.
- **MED:** per-site in-process mutex on regen pipelines.
- **MED:** tag created GitHub deploy repos with marker topic; refuse to push to pre-existing repos lacking marker.
- **LOW:** redact Authorization header from logged error bodies.

## Phase sequence

| Phase | Scope | Output |
|-------|-------|--------|
| 0 | Research + audit | ✅ done |
| 1 | Backend: schema, services, AI prompts, API routes, security | working API + seed script |
| 2 | Frontend: Build / Preview / Style tabs, wizard UI, design-system foundation | functional editor against real API |
| 3 | Full-site preview with cross-page nav | end-to-end generation loop |
| 4 | Visual inspector (click-to-edit, text/image/prompt) | element edits shipping |
| 5 | Hardening: fix review-1 HIGHs, E2E Playwright, deploy verified | prod-ready |

Each phase ends in a tester agent verifying before the next phase starts.
