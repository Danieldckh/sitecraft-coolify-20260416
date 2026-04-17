// Site-wide prompt classifier.
//
// A single Haiku call that distinguishes between:
//   - 'theme'      → palette / typography / mood change only
//   - 'structural' → content edits: add/remove sections, rewrite copy, new
//                    pages, etc.
//
// Used by /api/revise to pick between the fast theme-only swap path and the
// full structural rebuild path.
//
// Defensive default: any ambiguity or parsing weirdness → 'structural'. It's
// safer to rebuild than to silently skip a structural change the user wanted.

import { anthropic, MODELS } from './anthropic';

export type ClassifiedMode = 'theme' | 'structural';

const CLASSIFIER_SYSTEM = `You are a strict two-way classifier. Decide whether a user's change request to their website is purely a VISUAL/THEME change or a STRUCTURAL/CONTENT change.

- "theme" means: colors, palette, fonts, typography, mood, tone, brightness, darkness, vibe. Nothing about the actual words, sections, pages, layout, or content.
- "structural" means: adding/removing/rewriting sections, copy, headlines, pages, layout; changing what the site says or shows; adding or removing features or links.

Output EXACTLY one word: either "theme" or "structural". No punctuation, no explanation, no quotes, no anything else.`;

/**
 * Classify a site-wide prompt as a theme-only or structural change.
 *
 * Runs a single Haiku call with max_tokens=8 and a strict one-word contract.
 * On ANY parsing weirdness (model says something else, API fails, etc.) the
 * default is 'structural' — a full rebuild is the safer fallback when we
 * can't confidently tell what the user wanted.
 */
export async function classifyPrompt(prompt: string): Promise<ClassifiedMode> {
  if (typeof prompt !== 'string' || prompt.trim().length === 0) {
    return 'structural';
  }

  let rawText = '';
  try {
    const response = await anthropic.messages.create({
      model: MODELS.fast,
      max_tokens: 8,
      system: CLASSIFIER_SYSTEM,
      messages: [
        {
          role: 'user',
          content: prompt.trim(),
        },
      ],
    });

    const firstBlock = response.content.find((b) => b.type === 'text');
    if (firstBlock && firstBlock.type === 'text') {
      rawText = firstBlock.text;
    }
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    const safe = raw.replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]');
    // eslint-disable-next-line no-console
    console.error('[classifier] Haiku call failed; defaulting to structural.', safe);
    return 'structural';
  }

  const normalized = rawText.trim().toLowerCase();
  // Strip any stray punctuation/quoting the model might add despite instructions.
  const firstWord = normalized.replace(/[^a-z]/g, '');

  if (firstWord === 'theme') return 'theme';
  if (firstWord === 'structural') return 'structural';

  // Any other response (empty, "both", "theme.", etc.) → safer to rebuild.
  return 'structural';
}
