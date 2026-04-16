# Generation Quality Playbook

How to make Sitecraft produce **distinctive, designed-looking** websites instead of the generic "hero + 3-col features + CTA + footer" output that vanilla LLMs default to.

Last updated: 2026-04-16. Opinionated. Paste-ready prompt scaffolds at the bottom.

---

## 1. What the leaders actually do

### 1.1 Vercel v0
- **Component-driven, not page-driven.** System prompt constrains output to shadcn/ui + Tailwind + lucide-react primitives. The model composes, it doesn't reinvent. Result: a known-good visual floor.
- **Streaming JSX with a strict schema.** v0 emits a custom MDX-ish format (`<CodeProject>`, `<QuickEdit>`) so the renderer can stream incrementally and the model knows exactly what wrappers to use.
- **Explicit "Design Inspiration" slot.** Internal prompts include a paragraph describing target aesthetic (e.g. "Linear-inspired", "Vercel-dashboard-inspired") and a palette. This is the single biggest lever against sameness.
- **No colors outside the declared palette.** System prompt explicitly forbids arbitrary hex values; the model must use CSS vars from the theme.
- **Iteration is targeted.** `QuickEdit` lets the model regenerate a sub-tree rather than the whole file; big edits go through whole-file regen with a diff view.
- **Model:** Reports strongly suggest a fine-tuned Claude Sonnet / GPT-5-class backbone for code; Sonnet is visibly better at taste.

### 1.2 Lovable (gpt-engineer.lovable.dev)
- **Full-project scaffold first.** Generates a Vite + React + Tailwind + shadcn project, then iterates. The scaffold itself is the anti-generic guardrail — shadcn components already look good.
- **Conversation loop with file-aware diffs.** Each turn sees the tree and touches only needed files. Claude Sonnet (3.5→4→4.5→Opus 4.x) is the default backbone.
- **Supabase-first data model.** Pages are grounded in real schemas, which forces non-generic copy (actual field names, actual entity relationships).
- **"Knowledge" section.** User-provided brand/voice/design docs are pinned into every system prompt. This is how Lovable keeps 20-turn sessions coherent.

### 1.3 bolt.new
- **WebContainer runtime ⇒ the model sees real errors.** Prompts include a tool to read console output, so iteration is grounded in runtime feedback rather than guessing.
- **Single-shot full-stack generation.** Less refined aesthetically than v0/Lovable but strong at "make this run." Uses Claude Sonnet.
- **Template seeds.** "Start from Astro blog / Next SaaS / Remix app" bias the generator toward proven layouts.

### 1.4 Framer AI
- **Template-constrained.** Generation is actually *template selection + content filling + token swap*, not free-form layout. This is why Framer output looks good: a human designed the skeleton.
- **Strong design tokens.** Every site gets a typed token object (colors, type scale, spacing, radii, effects) generated upfront. All components reference tokens, never raw values.
- **Breakpoint-aware.** Tokens include responsive variants; no "desktop-only" output.

### 1.5 Dora AI / Durable / Relume
- **Relume = sitemap → wireframe → design.** Three distinct LLM calls. The sitemap step is cheap and uses a taxonomy of ~150 named section patterns (Hero12, Feature44, CTA9). The model picks from the taxonomy instead of inventing. This is *the* anti-generic mechanism: forced variety via enumerated archetypes.
- **Dora.run = motion-first.** Prompt includes an "animation style" token (subtle / editorial / playful / kinetic) that governs scroll effects.
- **Durable = industry-vertical templates.** The prompt is heavily conditioned on `industry` (plumber, yoga studio, law firm). Copy and imagery archetypes are pre-loaded.

### 1.6 OpenAI Canvas / Claude Artifacts
- **Inline targeted edits.** Select a range → natural-language edit → model produces a diff patch, not a full rewrite. Preserves untouched code verbatim.
- **Artifact identity is persistent.** The same `id` is reused so the UI can diff. This pattern maps directly onto our section-level regeneration.
- **Side-by-side preview and code.** Users iterate visually, which keeps copy short and design-focused rather than wall-of-text.

---

## 2. Cross-cutting techniques that actually move the needle

1. **Enumerated style pools, not free-form "make it nice."** A string like `"editorial-serif"` or `"neo-brutalist-mono"` in the prompt does more than three paragraphs of adjectives.
2. **Tokens before pages.** Generate `theme.json` first; every downstream call references it. Blocks palette drift across pages.
3. **Section taxonomy with variants.** Relume's trick: `hero.split-image-left`, `hero.centered-oversized-type`, `hero.video-bg-muted`. Force the model to pick a variant ID.
4. **Shared component library per site.** Header/Footer/Button/Card generated ONCE and reused. Guarantees coherence and cuts tokens.
5. **Negative prompting.** Explicit "do not" list is as important as the positive brief — and more compressible.
6. **Reference grounding.** "In the spirit of linear.app / stripe.com / arc.net / cosmos.so" — named references ground the aesthetic better than any adjective.
7. **Copy constraints.** Word-count limits per element + ban on specific filler ("Welcome to", "Unlock the power of", "elevate your", "seamlessly").
8. **Runtime feedback loop (bolt).** Render → screenshot → vision model critiques → regen. Best ROI for "looks broken" class of failures.

---

## 3. Recommended Sitecraft pipeline

### Stage 1 — Discovery (ask, don't assume)

Before any generation, the model runs a short structured interview. If the user gave a detailed brief, skip questions they already answered.

**Required fields:**
- `brand.name`
- `brand.logoUrl` (or "none — generate a wordmark")
- `brand.industry` (controlled vocabulary: saas, ecommerce, agency, portfolio, restaurant, nonprofit, personal, other)
- `brand.audience` (one sentence)
- `brand.vibe` (MULTI-SELECT from a fixed pool — see 3.2)
- `brand.referenceSites` (0–3 URLs, free text OK)
- `brand.palette` (either 2–4 hex values OR "derive from logo" OR "surprise me within vibe")
- `brand.voice` (one of: confident, playful, technical, editorial, warm, irreverent, understated)
- `content.pagesRequested` (honor literally — already implemented)

**Ask format (for the model):**
> Ask up to 4 questions, one at a time, only for fields the user hasn't already given. Prefer multiple-choice with concrete examples over open-ended questions.

### Stage 2 — Theme generation (design tokens first)

Output a strict `SiteTheme` JSON **before any HTML is written**. This file is pinned into every subsequent system prompt.

```ts
type SiteTheme = {
  styleId: StylePoolId;           // see 3.2
  palette: {
    bg: string; surface: string; surfaceAlt: string;
    text: string; textMuted: string;
    brand: string; brandContrast: string;
    accent: string; accentContrast: string;
    border: string;
  };
  typography: {
    display: { family: string; weight: number; tracking: string; case: 'normal'|'upper' };
    body:    { family: string; weight: number };
    mono?:   { family: string };
    scale:   number[];            // e.g. [12,14,16,18,22,28,36,48,64,80]
  };
  spacing: number[];              // [0,4,8,12,16,24,32,48,64,96,128]
  radius:  { sm: string; md: string; lg: string; pill: string };
  shadow:  { sm: string; md: string; lg: string; glow?: string };
  motion:  { easing: string; durationMs: number; style: 'subtle'|'editorial'|'playful'|'kinetic' };
  grid:    { maxWidth: string; gutter: string; columns: number };
  signature: string;              // one visual signature, see 3.3
};
```

The theme call uses a **style pool selector** rather than asking the model to invent.

### Stage 3 — Component library (per site, not per page)

One call emits `Header`, `Footer`, `Button`, `Card`, `Input`, `SectionShell` as HTML+CSS snippets scoped to the site. All pages reuse these verbatim. Footer + Header are literally the same DOM on every page, not regenerated.

### Stage 4 — Per-page / per-section generation

Section generator prompt receives: `SiteTheme` + `ComponentLibrary` + `SectionVariantId` (from taxonomy, Relume-style) + `SectionPrompt`.

Forced variant ID prevents the model from defaulting to the same hero every time. Keep a table of ~8 variants per section type and round-robin / sample by vibe.

### Stage 5 — Refinement (Canvas-style targeted edits)

- **Element-level edit:** user selects a node → prompt receives the node's outerHTML + scoped CSS + edit instruction → model returns a patch.
- **Whole-section regen:** keep existing theme + variant, re-roll content only.
- **Re-theme:** swap `SiteTheme` only; rerun component library; re-apply to all sections without regenerating layout. Cheap.

---

## 3.2 The Style Pool (controlled vocabulary)

Pick ONE as `styleId`. Describe each in 2–3 sentences in the prompt so the model has concrete direction.

| id | Short description |
|---|---|
| `editorial-serif` | Magazine-like. Large serif display, generous leading, asymmetric grid, thin rules, b/w photos. Think NYT, It's Nice That. |
| `swiss-minimal` | Helvetica/Inter, strict grid, heavy whitespace, monochrome + single accent. Think Braun, Vercel docs. |
| `neo-brutalist` | Mono/sans caps, thick black borders, hard shadows (4px 4px 0), saturated blocks, no gradients. Think Gumroad-2022, Figma community. |
| `glassmorphism-dark` | Dark bg, blurred translucent panels, soft glows, subtle noise, Inter. Think Arc, Linear. |
| `playful-rounded` | Big radii, bouncy easing, pastel palette, hand-drawn micro-illustrations. Think Duolingo, Notion-lite. |
| `tech-monospace` | Terminal vibe. Mono type for UI labels, CRT-green or amber accents on near-black, ASCII dividers. Think Vercel changelog, Railway. |
| `luxury-quiet` | Cream/ivory bg, thin serif, lowercase, hairline borders, slow fades. Think Aesop, Glossier editorial. |
| `cosmos-collage` | Overlapping images, tape/sticker affordances, rotated cards, mixed fonts intentionally. Think cosmos.so, Are.na. |
| `corporate-confident` | Clean sans, 8px grid, single brand color + deep neutrals, subtle shadows, charts. Think Stripe, Linear marketing. |
| `kinetic-gradient` | Animated mesh gradients, large italic display, scroll-driven motion. Think Stripe Sessions, Framer showcase. |

Map `brand.vibe` + `brand.industry` to a default styleId but let the user override.

## 3.3 Signature element

Every site picks exactly **one** visual signature to carry across pages. This is the anti-sameness secret weapon. Examples:
- Oversized outline number before every H2
- Marquee strip dividing sections
- Hairline 1px border on all cards, no shadows, ever
- Rotated sticker-tag above every hero
- Full-bleed photo with a serif caption at the bottom of every page
- Mono footnote numbers `[01]` next to headings
- Asymmetric offset grid where every even row shifts 40px right

Store as `theme.signature` and include in every section prompt: *"Remember: this site's signature is X — apply it where natural."*

---

## 4. Anti-patterns to explicitly block (put in every system prompt)

```
NEVER:
- Use Tailwind `blue-500`, `indigo-600`, `purple-500`, or any default Tailwind brand hue unless it IS the chosen brand color.
- Emit a linear-gradient from blue to purple, or any "AI-default" purple→pink gradient.
- Write copy starting with "Welcome to", "Unlock", "Empower", "Seamlessly", "Revolutionize", "Elevate", "At [Brand], we believe".
- Use Lorem ipsum or "Your tagline here" style placeholders.
- Produce a hero that is: centered H1 + subhead + two buttons + screenshot below. This is banned unless explicitly requested.
- Emit a 3-column icon-title-description feature grid without a strong reason. Prefer: bento, split copy+media, numbered list, horizontal scroller, comparison table.
- Use emoji as icons.
- Use stock phrases: "cutting-edge", "best-in-class", "world-class", "next-generation", "game-changing".
- Use generic shadow `box-shadow: 0 10px 30px rgba(0,0,0,0.1)` — derive shadow from theme.
- Use border-radius 8px everywhere. Match theme.radius exactly.
- Import fonts other than those declared in theme.typography.
- Put a newsletter CTA in the footer unless brand.industry warrants it.
- Output more than 14 words in any H1.
```

---

## 5. Prompt scaffolds (paste-ready)

### 5.1 Discovery system prompt

```
You are Sitecraft's onboarding interviewer. Your job is to gather the minimum
information needed to generate a distinctive website. Ask ONE question at a
time. Prefer multiple-choice with 3-5 concrete options over open questions.
Stop asking once you have: brand.name, brand.industry, brand.audience,
brand.vibe (styleId from the provided pool), brand.palette, brand.voice,
and any reference sites.

If the user's initial brief already supplies a field, do not re-ask it.
Never ask more than 4 questions total. If the user seems impatient, stop
and proceed with sensible defaults keyed off industry + vibe.

Output format for each turn: JSON {"question": string, "options"?: string[],
"field": string} OR {"done": true, "collected": {...}}.
```

### 5.2 Theme generation system prompt

```
You are Sitecraft's art director. Given a brand brief, output a single
SiteTheme JSON object matching the provided TypeScript type. Rules:

- Choose styleId from the provided style pool. Do not invent new ids.
- Palette: 9 colors, all passing WCAG AA for their stated role. Brand and
  accent must be distinct hues (>30° apart in HSL) unless styleId is
  "swiss-minimal" or "luxury-quiet" (monochromatic allowed).
- Typography: pick from Google Fonts OR system stacks. Max 2 families
  (plus optional mono). Display and body must contrast (serif vs sans,
  or weight gap >=400).
- Motion.style must match vibe: "subtle" for corporate/luxury, "editorial"
  for magazine, "playful" for rounded, "kinetic" for gradient/cosmos.
- signature: a one-sentence visual rule applied across every page. Be
  specific and implementable in CSS.
- Do NOT use default Tailwind brand hues unless the user supplied them.
- Do NOT use purple-to-pink or blue-to-purple gradients.

Return ONLY the JSON. No prose.
```

### 5.3 Component library system prompt

```
You are generating the shared component library for a single site. You
receive SiteTheme. Output JSON {header, footer, button, card, input,
sectionShell} where each value is {html, css}.

Rules:
- Every color, radius, shadow, and font-size MUST reference theme tokens
  via CSS variables defined at :root (already injected upstream).
- Apply theme.signature visibly in at least the header or footer.
- Header: no generic "Logo | Nav | CTA" bar. Choose a layout that fits
  styleId (e.g. brutalist = thick border + oversized wordmark; editorial
  = centered serif wordmark + underlined nav; swiss = left-aligned grid).
- Footer: distinct from the header, not a mirror. Include the signature.
- Button: 3 variants (primary, secondary, ghost) + hover/focus states
  consistent with motion.style.
- No external image URLs. SVG wordmark if no logo provided.
```

### 5.4 Section generator system prompt (upgrade to existing `SECTION_SYSTEM_PROMPT`)

Append to our current prompt:

```
You receive:
- theme: SiteTheme JSON (tokens available as CSS vars)
- library: shared component snippets (reuse them verbatim when relevant)
- variantId: the specific section variant to render (e.g. hero.split-image-left)
- sectionPrompt: the intent

Hard rules beyond the base ones:
- Match the variantId's layout archetype exactly. Do not silently fall back
  to a centered hero or a 3-column feature grid.
- Use only colors from theme.palette. Reference them via var(--color-*).
- Use only typography from theme.typography. No font-family literals.
- Apply theme.signature where it naturally fits in this section.
- Copy: concrete, specific to brand.name and brand.audience. No filler.
  H1 <= 14 words. Subhead <= 24 words. Button labels <= 3 words.
- Ban list (enforce strictly): "Welcome to", "Unlock", "Empower",
  "Seamlessly", "Elevate", "Revolutionize", "cutting-edge", "world-class",
  "next-generation", "Lorem ipsum", "Your tagline here".
- Do not invent external image URLs. Use CSS, inline SVG, or data URIs.
- If variantId implies an image, render a tasteful CSS/SVG placeholder
  that matches the style (e.g. duotone block for editorial, hatched
  rectangle for brutalist, blurred gradient mesh for glassmorphism).

Return ONLY {html, css, js}.
```

### 5.5 Section variant taxonomy (seed)

```
hero: centered-oversized-type | split-copy-media-left | split-copy-media-right |
      full-bleed-photo-caption | marquee-headline | numbered-statement |
      video-loop-muted | editorial-dropcap
features: bento-asymmetric | numbered-list-vertical | horizontal-scroller |
      comparison-table | icon-grid-3 | icon-grid-4 | split-accordion |
      tabbed-showcase
cta: full-bleed-banner | inline-strip | split-form | oversized-word |
     sticky-footer-ribbon
testimonials: single-hero-quote | marquee-cards | bento-mixed-media |
     magazine-pullquote | logo-wall-with-quote
pricing: parallel-cards-3 | toggle-monthly-annual | single-featured |
     comparison-matrix | quote-based
footer: multi-column-nav | minimal-wordmark-center | oversized-wordmark |
     newsletter-first | single-row-inline
```

Sampling rule: given styleId + section type, only a subset is allowed (e.g. `neo-brutalist` never gets `glassmorphism`-friendly `bento-asymmetric-soft`; `editorial-serif` should bias toward `editorial-dropcap` and `magazine-pullquote`).

### 5.6 Element-level edit prompt (Canvas-style)

```
You are editing a single element inside a generated site. You receive:
- elementHtml: the selected element's outerHTML
- elementCss: CSS rules that target this element or its descendants
- theme: SiteTheme (read-only)
- instruction: the user's natural-language edit

Rules:
- Return ONLY {html, css} where html replaces the selected element and
  css supersedes the provided rules. Preserve any classnames used by
  sibling elements.
- Do not change the element's root tag unless the instruction demands it.
- Stay within theme tokens.
- Minimal diff: keep what works, change what was asked.
```

---

## 6. Model recommendations (April 2026)

For HTML/CSS/JS generation **quality**, in order of output taste:

1. **Claude Opus 4.6 / Sonnet 4.6** — best at *designed-looking* output, strong at respecting negative prompts and long token-rich system prompts. Default choice for theme generation, component library, and section generation. Worth the cost.
2. **GPT-5 / GPT-5.1** — very strong on structure and JSON-schema adherence. Better than Claude at strictly-typed outputs (theme JSON, variant IDs). Slightly more generic aesthetic. Good default for Stage 1 (discovery) and Stage 2 schema emission.
3. **Gemini 2.5 Pro / 3** — best context window for 20+ page coherence. Aesthetic is middle-tier. Good for "re-theme existing site" bulk transforms.
4. **GPT-4o / GPT-4-turbo (legacy)** — do not use for section generation in 2026. Noticeably more generic output than frontier models. Acceptable only for cheap metadata/slug/sitemap steps.

**Recommended split for Sitecraft:**
- Stage 1 Discovery: GPT-5 (cheap, structured).
- Stage 2 Theme: Claude Sonnet 4.6 (taste matters, JSON is small).
- Stage 3 Component library: Claude Sonnet 4.6.
- Stage 4 Sections: Claude Sonnet 4.6 default; Opus 4.6 for hero + first-impression sections only.
- Stage 5 Element edit: Claude Sonnet 4.6 (best at minimal diffs).
- Vision critique loop (optional): GPT-5 vision or Claude Sonnet vision on a rendered screenshot, feeds regen.

---

## 7. Implementation checklist for our repo

- [ ] Add `SiteTheme` type + `stylePool.ts` constant with the 10 styleIds and descriptions.
- [ ] Add `sectionVariants.ts` taxonomy table + sampling function keyed by styleId.
- [ ] New Stage 2 step: `generateTheme(brief) -> SiteTheme`, persisted on `Site`.
- [ ] New Stage 3 step: `generateComponentLibrary(theme) -> ComponentLibrary`, persisted on `Site`.
- [ ] Upgrade `SECTION_SYSTEM_PROMPT` in `src/server/ai/prompts.ts` with the ban list and token-only rule from 5.4.
- [ ] Thread `theme` + `library` + `variantId` into every section call (see `src/server/ai/sections.ts`).
- [ ] Inject theme as CSS custom properties at the top of `buildHtml.ts` output.
- [ ] Add `signature` rendering helper used by Header/Footer.
- [ ] Add element-level edit endpoint (5.6) for refinement UI.
- [ ] Optional: vision-based critique pass after full-site render.

---

## 8. The one-line summary

**Generate tokens and a signature first, pick variants from a taxonomy, ban the filler, name the aesthetic — and let a tasteful model (Claude Sonnet/Opus 4.6) do the actual writing.**
