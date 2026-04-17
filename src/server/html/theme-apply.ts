// Fast theme-only page mutation.
//
// `assemblePageHtml` (src/server/html/template.ts) bakes the site's palette
// + typography into two distinct places in every page:
//
//   1. A single `<link href="https://fonts.googleapis.com/css2?family=...">`
//      tag in <head>, which loads the two Google Fonts.
//   2. A `<style>` block that opens with:
//        :root {
//          --c-primary: #RRGGBB;
//          --c-secondary: #RRGGBB;
//          --c-accent: #RRGGBB;
//          --c-ink: #RRGGBB;
//          --c-surface: #RRGGBB;
//          --f-display: "DisplayFont", serif;
//          --f-body: "BodyFont", sans-serif;
//        }
//
// This module rewrites ONLY those two fingerprints, leaving every <section>
// byte-for-byte untouched. That makes theme-only updates effectively free
// (no Designer calls) while still visually refreshing the whole site.
//
// If either fingerprint doesn't match (e.g. a future Designer hand-authored
// a page in a different shape), we log a warning and return the input HTML
// unchanged. The caller treats that as "theme-apply skipped" and should fall
// back to a full structural rebuild.

import type { SitePlan } from '@/server/ai/architect';

type Palette = SitePlan['palette'];
type Typography = SitePlan['typography'];

/** Build a fresh Google Fonts <link> tag identical in shape to template.ts. */
function buildFontsLinkTag(typography: Typography): string {
  const display = encodeURIComponent(typography.displayFont);
  const body = encodeURIComponent(typography.bodyFont);
  return `<link href="https://fonts.googleapis.com/css2?family=${display}:wght@400;600;700&family=${body}:wght@400;500;600&display=swap" rel="stylesheet">`;
}

/** Build the `:root { ... }` block identical in shape to template.ts. */
function buildRootBlock(palette: Palette, typography: Typography): string {
  return `:root {
  --c-primary: ${palette.primary};
  --c-secondary: ${palette.secondary};
  --c-accent: ${palette.accent};
  --c-ink: ${palette.ink};
  --c-surface: ${palette.surface};
  --f-display: "${typography.displayFont}", serif;
  --f-body: "${typography.bodyFont}", sans-serif;
}`;
}

/**
 * Swap only the :root CSS vars + Google Fonts <link> in an assembled page
 * HTML document. Every <section> is left intact. Used for fast theme-only
 * site-wide updates.
 *
 * Returns the mutated HTML. If EITHER pattern (the fonts.googleapis.com link
 * OR the `:root { --c-primary: ...` block) fails to match, we log a warning
 * and return the original `pageHtml` unchanged so the caller can fall back
 * to a full structural rebuild.
 */
export function applyThemeUpdate(
  pageHtml: string,
  palette: Palette,
  typography: Typography,
): string {
  if (typeof pageHtml !== 'string' || pageHtml.length === 0) {
    return pageHtml;
  }

  // 1) Replace the first <link ...fonts.googleapis.com...> tag.
  //    We match any attribute order (rel/href/crossorigin/etc.) as long as the
  //    tag contains fonts.googleapis.com.
  const fontsLinkRegex = /<link\b[^>]*fonts\.googleapis\.com[^>]*>/i;
  if (!fontsLinkRegex.test(pageHtml)) {
    // eslint-disable-next-line no-console
    console.warn(
      '[theme-apply] Google Fonts <link> fingerprint not found; skipping theme-apply.',
    );
    return pageHtml;
  }

  // 2) Match the :root block. The `s` flag lets `.` span newlines so we can
  //    grab everything from `:root {` to the first `}`.
  const rootBlockRegex = /:root\s*\{[^}]*--c-primary[^}]*\}/;
  if (!rootBlockRegex.test(pageHtml)) {
    // eslint-disable-next-line no-console
    console.warn(
      '[theme-apply] :root { --c-primary ... } fingerprint not found; skipping theme-apply.',
    );
    return pageHtml;
  }

  let out = pageHtml.replace(fontsLinkRegex, buildFontsLinkTag(typography));
  out = out.replace(rootBlockRegex, buildRootBlock(palette, typography));
  return out;
}
