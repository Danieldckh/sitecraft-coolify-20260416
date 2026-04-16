// Post-generation validator. Hard backstop for BAN_LIST violations the prompt
// didn't suppress. Kept deterministic and dependency-free so it can run in any
// pipeline (page, theme, element edit) without surprises.
//
// Source of truth for phrase bans is src/server/ai/prompts.ts BAN_LIST; the list
// below mirrors it and adds common AI-slop phrases called out in review.

export const BANNED_PHRASES: string[] = [
  // From prompts.ts BAN_LIST
  'welcome to',
  'unlock the power of',
  'unlock the power',
  'elevate your',
  'empower your',
  'seamlessly',
  'revolutionize',
  'at [brand], we believe',
  'your tagline here',
  'cutting-edge',
  'best-in-class',
  'world-class',
  'next-generation',
  'game-changing',
  'lorem ipsum',
  'discover the difference',
  // Review-1 additions / common AI slop
  'in today\'s fast-paced',
  'in todays fast-paced',
  'leverage',
  'synergy',
  'take your', // flags "take your X to the next level"
  'to the next level',
  'transform your',
  'cutting-edge solutions',
  'next-generation',
];

// Gradient patterns that scream "AI default". Case-insensitive matching is
// the caller's responsibility (all regexes below use the /i flag).
export const BANNED_GRADIENT_PATTERNS: RegExp[] = [
  // blue -> purple -> pink literal hexes in any order within one gradient
  /linear-gradient\([^)]*#?(?:3b82f6|6366f1|8b5cf6)[^)]*(?:ec4899|f472b6|d946ef)/i,
  // purple -> pink literal hexes
  /linear-gradient\([^)]*#?(?:8b5cf6|a855f7|9333ea)[^)]*(?:ec4899|f472b6|d946ef|db2777)/i,
  // Named CSS colors, blue -> purple/pink
  /linear-gradient\([^)]*\b(?:blue|indigo|violet)\b[^)]*\b(?:purple|pink|fuchsia|magenta)\b/i,
  // Tailwind gradient utility classes
  /from-blue-\d+\s+[^"']*to-purple/i,
  /from-purple-\d+\s+[^"']*to-pink/i,
  /from-indigo-\d+\s+[^"']*to-pink/i,
  /from-violet-\d+\s+[^"']*to-pink/i,
];

// External / non-local raster image usage. Only /uploads/ (Sitecraft-owned
// storage) and explicit sitecraft/localhost hosts are permitted.
export const BANNED_EXTERNAL_IMAGE_PATTERNS: RegExp[] = [
  // absolute URL that isn't sitecraft or localhost
  /<img[^>]*\ssrc=["']https?:\/\/(?!(?:[^"'\/]*\.)?sitecraft|localhost)[^"']+["'][^>]*>/i,
  // relative raster ref not under /uploads/
  /<img[^>]*\ssrc=["'](?!https?:|\/uploads\/)[^"']*\.(?:jpg|jpeg|png|webp|gif)["'][^>]*>/i,
];

export interface ValidateResult {
  ok: boolean;
  violations: string[];
}

export interface ValidateOptions {
  skipImages?: boolean;
}

export function validateGenerated(content: string, opts: ValidateOptions = {}): ValidateResult {
  const violations: string[] = [];
  if (!content) return { ok: true, violations };

  const lower = content.toLowerCase();
  const seenPhrases = new Set<string>();
  for (const phrase of BANNED_PHRASES) {
    const needle = phrase.toLowerCase();
    if (seenPhrases.has(needle)) continue;
    if (lower.includes(needle)) {
      seenPhrases.add(needle);
      violations.push(`banned phrase: "${phrase}"`);
    }
  }

  for (const rx of BANNED_GRADIENT_PATTERNS) {
    if (rx.test(content)) {
      violations.push(`banned gradient pattern: ${rx.source}`);
    }
  }

  if (!opts.skipImages) {
    for (const rx of BANNED_EXTERNAL_IMAGE_PATTERNS) {
      if (rx.test(content)) {
        violations.push(`external/non-uploads image reference: ${rx.source}`);
      }
    }
  }

  return { ok: violations.length === 0, violations };
}

// Replaces each offending <img> with a neutral placeholder div, preserving the
// alt text as aria-label. Used only as a last-resort fallback in pageGen.
export function stripExternalImages(html: string): string {
  if (!html) return html;
  const imgRx = /<img\b([^>]*)\/?>(?:<\/img>)?/gi;
  return html.replace(imgRx, (match, attrs: string) => {
    const srcMatch = /\ssrc=["']([^"']+)["']/i.exec(attrs);
    if (!srcMatch) return match;
    const src = srcMatch[1];
    const isAbsolute = /^https?:\/\//i.test(src);
    const isAllowedAbsolute = /^https?:\/\/(?:[^\/]*\.)?sitecraft|^https?:\/\/localhost/i.test(src);
    const isUpload = src.startsWith('/uploads/');
    const isRasterRelative = !isAbsolute && /\.(?:jpg|jpeg|png|webp|gif)$/i.test(src);
    const isBadAbsolute = isAbsolute && !isAllowedAbsolute;
    if (!isBadAbsolute && !(isRasterRelative && !isUpload)) return match;

    const altMatch = /\salt=["']([^"']*)["']/i.exec(attrs);
    const label = (altMatch?.[1] ?? 'image placeholder').replace(/"/g, '&quot;');
    return `<div class="sc-img-placeholder" role="img" aria-label="${label}"></div>`;
  });
}

// Helper used by all three pipelines to build the retry system message.
export function buildRetryDirective(violations: string[]): string {
  const joined = violations.map((v) => `- ${v}`).join('\n');
  return `Your previous output contained these violations:\n${joined}\nRegenerate strictly avoiding them.`;
}

export class ThemeGenerationFailed extends Error {
  readonly violations: string[];
  constructor(violations: string[]) {
    super(`Theme generation failed ban-list validation: ${violations.join('; ')}`);
    this.name = 'ThemeGenerationFailed';
    this.violations = violations;
  }
}
