// Shared page-assembly template used by /api/build and /api/continue.
//
// Both routes need to re-write `Page.pageHtml` as sections stream in.
// Keeping the assembly logic in one module guarantees the two routes stay
// byte-for-byte identical — the resume flow must NOT produce a different
// document than the original build for sections that were already persisted.

import type { SitePlan } from '@/server/ai/architect';

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Assemble one page's full HTML document from its ordered section HTML.
 *
 * Nav links rendered by "header-nav"/"footer" sections use relative
 * `./{slug}` hrefs. In the in-iframe preview (`/preview/[id]/[slug]`) those
 * resolve to sibling pages at `/preview/[id]/{slug}`. The export route
 * rewrites them to `./{slug}.html` for the standalone zip.
 */
export function assemblePageHtml(
  plan: SitePlan,
  currentPage: SitePlan['pages'][number],
  sections: { html: string }[],
): string {
  const sectionHtml = sections.map((s) => s.html).join('\n');
  const displayFont = plan.typography.displayFont;
  const bodyFont = plan.typography.bodyFont;
  const pageTitle =
    currentPage.slug === 'home'
      ? plan.siteName
      : `${currentPage.name} — ${plan.siteName}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(pageTitle)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=${encodeURIComponent(displayFont)}:wght@400;600;700&family=${encodeURIComponent(bodyFont)}:wght@400;500;600&display=swap" rel="stylesheet">
<style>
:root {
  --c-primary: ${plan.palette.primary};
  --c-secondary: ${plan.palette.secondary};
  --c-accent: ${plan.palette.accent};
  --c-ink: ${plan.palette.ink};
  --c-surface: ${plan.palette.surface};
  --f-display: "${displayFont}", serif;
  --f-body: "${bodyFont}", sans-serif;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: var(--c-surface); color: var(--c-ink); font-family: var(--f-body); line-height: 1.5; }
h1, h2, h3, h4 { font-family: var(--f-display); margin: 0; line-height: 1.15; }
p { margin: 0 0 1em; }
img { max-width: 100%; display: block; }
a { color: inherit; }
/* Safety-net section padding — Designer's scoped class rules (higher specificity) override this. */
body > section { padding: clamp(3rem, 7vw, 6rem) clamp(1.25rem, 5vw, 3.5rem); }
body > section:first-child { padding-top: clamp(4rem, 9vw, 7rem); }
body > section > :where(.container, .wrap, .inner) { max-width: 1200px; margin: 0 auto; }
</style>
</head>
<body>
${sectionHtml}
</body>
</html>`;
}
