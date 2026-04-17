import { anthropic, MODELS } from './anthropic';
import type { SitePlan } from './architect';

/**
 * Designer — produces a single finished section as HTML + scoped CSS.
 *
 * Uses the primary (Sonnet) model — the workhorse for polished, detailed
 * HTML/CSS output. Each Designer call runs sequentially and is given the
 * previously-rendered sections so the section-to-section transitions feel
 * cohesive (shared rhythm, consistent type scale, motif continuity).
 */

const DESIGNER_SYSTEM = `You are a staff-level front-end designer at a boutique studio. Your only job is to produce ONE polished HTML section for a website. You will be given:
  - The site's name, palette (5 hex colors), and typography (2 Google Fonts).
  - A brief describing exactly this section's role and content.
  - Optionally, the HTML of sections that already exist above this one — use them to maintain visual cohesion (spacing rhythm, type scale, motif, voice).

Non-negotiable output rules:
  1. Return exactly one <section> element followed by exactly one <style> element. NOTHING ELSE. No prose, no comments before/after, no markdown code fences.
  2. The <section> MUST have both class="<id>" and data-el-id="<id>" attributes set to the section id provided to you.
  3. ALL styles must live in the <style> block immediately after the section. Scope every rule under .<id> so sections do not bleed into each other. No inline style attributes except where strictly necessary for dynamic values.
  4. Import Google Fonts at the top of the <style> block via @import url("https://fonts.googleapis.com/css2?family=..."). Use ONLY the two fonts provided in typography.
  5. Use ONLY the palette colors provided. No other colors except neutral white/black when truly necessary for contrast.
  6. No external resources except images from https://images.unsplash.com/... hotlinks. If you use an Unsplash image, append the query string ?auto=format&fit=crop&w=1600&q=80 and always include descriptive alt text.
  7. No <script> tags. No JavaScript. No external CSS links (except the Google Fonts @import described above). No CDN resets.
  8. Write REAL copy relevant to the user's site — headlines, subheads, body, labels, button text. Never "Lorem ipsum", never "Feature one / Feature two / Feature three", never "Company Name" as a placeholder.
  9. Favor editorial, distinctive, crafted layouts. Use asymmetry, considered whitespace, unusual grid structures, confident type scale. Avoid the generic SaaS template pattern (three centered cards in a row with tiny icons).
  10. Ensure basic mobile-safety: sections should collapse gracefully on narrow viewports. A single @media (max-width: 720px) block inside the scoped style is usually sufficient.
  11. Keep total output under ~6000 characters when possible. Concise, crafted, complete.

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
  section: SitePlan['sections'][number];
  priorSectionsHtml: string[];
}): Promise<string> {
  const { plan, section, priorSectionsHtml } = input;
  if (!section || typeof section.id !== 'string') {
    throw new Error('designSection: section.id is required.');
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

  // Cap cohesion context to the last 2 prior sections to keep prompts lean —
  // Designers mostly need the immediately preceding rhythm, not the whole site.
  const cohesionContext = priorSectionsHtml.slice(-2);
  const priorBlock = cohesionContext.length
    ? cohesionContext
        .map((html, i) => `--- Prior section ${i + 1} (for cohesion reference only, do NOT duplicate) ---\n${html}`)
        .join('\n\n')
    : '(This is the first section of the site — establish the visual language.)';

  const userMessage = [
    `Site: ${plan.siteName}`,
    ``,
    `Palette:`,
    paletteLines,
    ``,
    `Typography (Google Fonts):`,
    typographyLines,
    ``,
    `Section to build:`,
    `  id:    ${section.id}`,
    `  role:  ${section.role}`,
    `  brief: ${section.brief}`,
    ``,
    `Prior sections for visual cohesion:`,
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
    throw new Error(`Designer call failed for section "${section.id}": ${safe}`);
  }

  const cleaned = stripCodeFences(rawText);
  if (!/<section\b/i.test(cleaned)) {
    throw new Error(
      `Designer output for section "${section.id}" did not contain a <section> tag.`,
    );
  }

  return ensureDataElId(cleaned, section.id);
}
