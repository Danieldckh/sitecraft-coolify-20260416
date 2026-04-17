// Multi-page deploy bundler.
//
// Loads the Site + all Pages (orderIdx asc), rewrites intra-site nav links
// from their runtime form (`./{slug}`) to the on-disk form (`./{slug}.html`
// or `./index.html` for the home page), and returns an array of
// { path, content } files plus a filesystem-safe slug suitable for repo
// or zip naming.
//
// External hrefs (http://, https://) and hash fragments (#foo) are never
// rewritten. Only hrefs that match one of the known Page slugs are touched.

import { prisma } from '@/server/db/client';

export interface BundleFile {
  path: string;
  content: string;
}

export interface BundleResult {
  files: BundleFile[];
  slug: string;
}

/**
 * Produce a filesystem-safe slug from a site name, suitable for use as a
 * GitHub repo name suffix or a zip filename.
 */
export function slugifySite(name: string): string {
  const cleaned = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned.length > 0 ? cleaned.slice(0, 60) : 'site';
}

function filenameForSlug(slug: string): string {
  return slug === 'home' ? 'index.html' : `${slug}.html`;
}

/**
 * Rewrite every `href="./{slug}"` or `href='./{slug}'` that matches one of
 * the known page slugs to the corresponding output filename. Trailing
 * slashes and hash fragments are preserved. External hrefs and hrefs that
 * do not match a known slug are left untouched.
 */
export function rewriteNav(html: string, knownSlugs: readonly string[]): string {
  if (knownSlugs.length === 0) return html;

  // Regex-escape each slug defensively (slugs are kebab-case but stay safe
  // in case a future slug contains regex metacharacters).
  const escaped = knownSlugs.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(
    `href=(["'])\\.\\/(${escaped.join('|')})(\\/?)(#[^"']*)?\\1`,
    'g',
  );
  return html.replace(
    pattern,
    (_match, quote: string, slug: string, _slash: string, frag?: string) => {
      const file = filenameForSlug(slug);
      const suffix = frag ?? '';
      return `href=${quote}./${file}${suffix}${quote}`;
    },
  );
}

/**
 * Bundle a site into a flat set of static HTML files plus a README.
 *
 * Throws if the site doesn't exist or has no pages.
 */
export async function bundleSite(siteId: string): Promise<BundleResult> {
  const site = await prisma.site.findUnique({ where: { id: siteId } });
  if (!site) throw new Error(`Site ${siteId} not found`);

  const pages = await prisma.page.findMany({
    where: { siteId },
    orderBy: { orderIdx: 'asc' },
  });
  if (pages.length === 0) throw new Error(`Site ${siteId} has no pages`);

  const knownSlugs = pages.map((p) => p.slug);
  const files: BundleFile[] = [];

  for (const page of pages) {
    const rewritten = rewriteNav(page.pageHtml ?? '', knownSlugs);
    files.push({
      path: filenameForSlug(page.slug),
      content: rewritten,
    });
  }

  const today = new Date().toISOString().slice(0, 10);
  files.push({
    path: 'README.md',
    content: `# ${site.name}\n\nGenerated ${today} with Website Builder.\n\nOpen \`index.html\` in a browser.\n`,
  });

  return { files, slug: slugifySite(site.name) };
}
