import { anthropic, MODELS } from './anthropic';
import type { SitePlan } from './architect';

/**
 * Designer — produces a single finished section as HTML + scoped CSS, with
 * awareness of the current page and the site's nav.
 *
 * Uses the primary (Sonnet) model — the workhorse for polished, detailed
 * HTML/CSS output. Each Designer call runs sequentially and is given the
 * previously-rendered sections of the SAME page so the section-to-section
 * transitions feel cohesive (shared rhythm, consistent type scale, motif
 * continuity). Headers/footers receive the full nav list so they can emit
 * cross-page links.
 */

const DESIGNER_SYSTEM = `You write ONE polished HTML section with inlined scoped CSS in a trailing <style> tag.

Inputs (in user message):
- The site's palette + typography (obey exclusively unless instructed otherwise).
- The current page's slug + name + brief + role of THIS section.
- The nav list (all pages' slugs + names) — use this for navbars/footers/breadcrumbs.
- The last 1–2 prior sections' HTML on THIS page (for visual cohesion).

Output format:
<section data-el-id="{section.id}">…actual section markup…</section>
followed by
<style>.{section.id} { … scoped styles … }</style>

Rules:
- Output ONLY those two blocks. No prose. No markdown fences.
- The <section> MUST have both class="{section.id}" and data-el-id="{section.id}".
- Use palette colors and Google Fonts exclusively. The fonts are already imported at the document level — you may use them freely (you do NOT need to @import them again inside the style block).
- Real copy. No Lorem ipsum. No placeholder-ish text.
- Images: only https://images.unsplash.com/...?auto=format&fit=crop&w=1600&q=80. Use descriptive alt text. Never require images for section to be usable.
- For role: "header-nav" sections: emit a <nav> with links to EVERY page using relative hrefs (<a href="./{slug}">{name}</a>). Mark the current page visually (e.g., a class like "is-current", underline, or bolder weight). Include the brand/wordmark.
- For role: "footer" sections: may include a condensed nav using the same ./{slug} relative links.
- Scope all CSS classes under a class specific to this section (e.g. .hero-xyz__title, or prefix every rule with .{section.id}) so there's no collision with other sections on this page or other pages.
- No <script> tags. No JavaScript. No external CSS links. No CDN resets.
- Favor editorial, distinctive, crafted layouts. Use asymmetry, considered whitespace, unusual grid structures, confident type scale. Avoid the generic SaaS template pattern (three centered cards in a row with tiny icons).
- Ensure basic mobile-safety: sections should collapse gracefully on narrow viewports. A single @media (max-width: 720px) block inside the scoped style is usually sufficient.
- Keep total output under ~6000 characters when possible. Concise, crafted, complete.

The section is a standalone piece of a larger page — do not emit <html>, <head>, <body>, or any site-wide chrome. Just the one section and its scoped style block.`;

function stripCodeFences(text: string): string {
  let out = text.trim();
  const fence = out.match(/^```(?:html|HTML|css|CSS)?\s*([\s\S]*?)\s*```$/);
  if (fence && fence[1]) {
    out = fence[1].trim();
  }
  // Also handle stray leading/trailing fences that didn't match the full-wrap regex.
  out = out.replace(/^```(?:html|HTML|css|CSS)?\s*/i, '');
  out = out.replace(/\s*```\s*$/i, '');
  return out.trim();
}

/**
 * Ensure the outermost <section ...> tag carries data-el-id="<id>". Models
 * occasionally drop the attribute despite the system prompt — injecting it
 * defensively keeps the inspector click-to-edit flow working.
 */
function ensureDataElId(html: string, id: string): string {
  const sectionOpenRegex = /<section\b([^>]*)>/i;
  const match = html.match(sectionOpenRegex);
  if (!match) {
    // No <section> tag at all — wrap defensively.
    return `<section class="${id}" data-el-id="${id}">\n${html}\n</section>`;
  }
  const attrs = match[1] ?? '';
  if (/\bdata-el-id\s*=/.test(attrs)) {
    return html; // already present
  }
  const patched = `<section${attrs} data-el-id="${id}">`;
  return html.replace(sectionOpenRegex, patched);
}

export async function designSection(input: {
  plan: SitePlan;
  page: SitePlan['pages'][number];
  section: SitePlan['pages'][number]['sections'][number];
  priorSectionsHtml: string[];
  nav: { slug: string; name: string }[];
}): Promise<string> {
  const { plan, page, section, priorSectionsHtml, nav } = input;
  if (!section || typeof section.id !== 'string') {
    throw new Error('designSection: section.id is required.');
  }
  if (!page || typeof page.slug !== 'string') {
    throw new Error('designSection: page.slug is required.');
  }
  if (!Array.isArray(nav)) {
    throw new Error('designSection: nav must be an array.');
  }

  const paletteLines = [
    `  primary:   ${plan.palette.primary}`,
    `  secondary: ${plan.palette.secondary}`,
    `  accent:    ${plan.palette.accent}`,
    `  ink:       ${plan.palette.ink}`,
    `  surface:   ${plan.palette.surface}`,
  ].join('\n');

  const typographyLines = [
    `  display: ${plan.typography.displayFont}`,
    `  body:    ${plan.typography.bodyFont}`,
  ].join('\n');

  const navLines = nav
    .map(
      (n) =>
        `  - ${n.name} → href="./${n.slug}"${n.slug === page.slug ? '   (CURRENT PAGE — mark visually)' : ''}`,
    )
    .join('\n');

  // Cap cohesion context to the last 2 prior sections to keep prompts lean —
  // Designers mostly need the immediately preceding rhythm, not the whole site.
  const cohesionContext = priorSectionsHtml.slice(-2);
  const priorBlock = cohesionContext.length
    ? cohesionContext
        .map(
          (html, i) =>
            `--- Prior section ${i + 1} on this page (for cohesion reference only, do NOT duplicate) ---\n${html}`,
        )
        .join('\n\n')
    : '(This is the first section of this page — establish the visual language for the page.)';

  const userMessage = [
    `Site: ${plan.siteName}`,
    ``,
    `Palette:`,
    paletteLines,
    ``,
    `Typography (Google Fonts, already imported at document level):`,
    typographyLines,
    ``,
    `Current page:`,
    `  slug:  ${page.slug}`,
    `  name:  ${page.name}`,
    `  brief: ${page.brief}`,
    ``,
    `Site navigation (all pages, in order — use these for navbars/footers):`,
    navLines,
    ``,
    `Section to build:`,
    `  id:    ${section.id}`,
    `  role:  ${section.role}`,
    `  brief: ${section.brief}`,
    ``,
    `Prior sections on this page for visual cohesion:`,
    priorBlock,
    ``,
    `Produce ONLY <section class="${section.id}" data-el-id="${section.id}">...</section><style>...</style>. No markdown, no prose.`,
  ].join('\n');

  let rawText: string;
  try {
    const response = await anthropic.messages.create({
      model: MODELS.primary,
      max_tokens: 4096,
      system: DESIGNER_SYSTEM,
      messages: [{ role: 'user', content: userMessage }],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('Designer response contained no text block.');
    }
    rawText = textBlock.text;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const safe = message.replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]');
    throw new Error(
      `Designer call failed for page "${page.slug}" section "${section.id}": ${safe}`,
    );
  }

  const cleaned = stripCodeFences(rawText);
  if (!/<section\b/i.test(cleaned)) {
    throw new Error(
      `Designer output for page "${page.slug}" section "${section.id}" did not contain a <section> tag.`,
    );
  }

  return ensureDataElId(cleaned, section.id);
}
