import { anthropic, MODELS } from './anthropic';
import type { SitePlan } from './architect';

/**
 * Element Editor — rewrites a single element per a user's re-prompt.
 *
 * Uses the fast (Haiku) model — element edits are tight, scoped, and
 * latency-sensitive. The UX is "click, type, see change in seconds."
 */

const EDITOR_SYSTEM = `You are a precise HTML/CSS editor. You will be given one element's outerHTML (often a <section>, sometimes a descendant like an <h1> or a <button>) plus a short user instruction describing how to change it. You will return the replacement outerHTML — nothing else.

Strict rules:
  1. Output ONLY the replacement outerHTML. No prose, no commentary, no markdown code fences.
  2. The replacement MUST be the same kind of element as the input (if the input is <section ...>, return a <section ...>; if the input is an <h1>, return an <h1>), and MUST preserve the original data-el-id attribute exactly.
  3. Preserve any scoped class names on the root element unless the user explicitly asks to rename them. Related scoped CSS rules elsewhere depend on those class names.
  4. Do NOT change the site's palette colors or typography unless the instruction explicitly asks for a color/font change. Keep all existing colors and fonts intact.
  5. Make the smallest change that satisfies the instruction. Do not refactor unrelated markup. Do not restructure the element wholesale unless the instruction demands it.
  6. Preserve any <style> block that was inside the element, editing only the rules that must change for the requested edit.
  7. No <script> tags. No external resources except images from https://images.unsplash.com/... with ?auto=format&fit=crop&w=1600&q=80 query and descriptive alt text.
  8. Write real copy if the user asks for a copy change — no placeholders, no Lorem ipsum.`;

function stripCodeFences(text: string): string {
  let out = text.trim();
  const fence = out.match(/^```(?:html|HTML|css|CSS)?\s*([\s\S]*?)\s*```$/);
  if (fence && fence[1]) {
    out = fence[1].trim();
  }
  out = out.replace(/^```(?:html|HTML|css|CSS)?\s*/i, '');
  out = out.replace(/\s*```\s*$/i, '');
  return out.trim();
}

/**
 * Extract the data-el-id from an outerHTML snippet's opening tag.
 * Returns null if none found.
 */
function extractDataElId(html: string): string | null {
  const openTag = html.match(/<([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>/);
  if (!openTag) return null;
  const attrs = openTag[2] ?? '';
  const match = attrs.match(/\bdata-el-id\s*=\s*(?:"([^"]+)"|'([^']+)')/);
  if (!match) return null;
  return match[1] ?? match[2] ?? null;
}

/**
 * Make sure the edited HTML keeps the original data-el-id — models
 * occasionally strip it. We inject it back into the opening tag if missing.
 */
function ensureDataElId(html: string, dataElId: string): string {
  const existing = extractDataElId(html);
  if (existing === dataElId) return html;
  if (existing && existing !== dataElId) {
    // Replace whatever id the model put in with the original one.
    return html.replace(
      /\bdata-el-id\s*=\s*(?:"[^"]*"|'[^']*')/,
      `data-el-id="${dataElId}"`,
    );
  }
  // Inject into the first opening tag.
  const openTagRegex = /<([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>/;
  const m = html.match(openTagRegex);
  if (!m) return html; // nothing we can do; caller will surface the mismatch
  const [, tag, attrs] = m;
  const patched = `<${tag}${attrs ?? ''} data-el-id="${dataElId}">`;
  return html.replace(openTagRegex, patched);
}

export async function editElement(input: {
  currentHtml: string;
  userInstruction: string;
  palette: SitePlan['palette'];
  typography: SitePlan['typography'];
}): Promise<string> {
  const { currentHtml, userInstruction, palette, typography } = input;

  if (typeof currentHtml !== 'string' || currentHtml.trim().length === 0) {
    throw new Error('editElement: currentHtml must be a non-empty string.');
  }
  if (typeof userInstruction !== 'string' || userInstruction.trim().length === 0) {
    throw new Error('editElement: userInstruction must be a non-empty string.');
  }

  const originalDataElId = extractDataElId(currentHtml);

  const paletteLines = [
    `  primary:   ${palette.primary}`,
    `  secondary: ${palette.secondary}`,
    `  accent:    ${palette.accent}`,
    `  ink:       ${palette.ink}`,
    `  surface:   ${palette.surface}`,
  ].join('\n');

  const typographyLines = [
    `  display: ${typography.displayFont}`,
    `  body:    ${typography.bodyFont}`,
  ].join('\n');

  const userMessage = [
    `Current element outerHTML:`,
    currentHtml,
    ``,
    `Site palette (do not change unless instructed):`,
    paletteLines,
    ``,
    `Site typography (do not change unless instructed):`,
    typographyLines,
    ``,
    `User instruction:`,
    userInstruction.trim(),
    ``,
    `Return ONLY the replacement outerHTML. Preserve data-el-id${originalDataElId ? `="${originalDataElId}"` : ''} exactly.`,
  ].join('\n');

  let rawText: string;
  try {
    const response = await anthropic.messages.create({
      model: MODELS.fast,
      max_tokens: 4096,
      system: EDITOR_SYSTEM,
      messages: [{ role: 'user', content: userMessage }],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('Editor response contained no text block.');
    }
    rawText = textBlock.text;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const safe = message.replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]');
    throw new Error(`Editor call failed: ${safe}`);
  }

  const cleaned = stripCodeFences(rawText);
  if (cleaned.length === 0) {
    throw new Error('Editor returned empty content.');
  }

  if (originalDataElId) {
    return ensureDataElId(cleaned, originalDataElId);
  }
  return cleaned;
}
