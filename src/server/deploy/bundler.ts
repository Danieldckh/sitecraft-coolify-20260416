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
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export interface BundleFile {
  path: string;
  content: string;
  /**
   * Encoding of `content`:
   *   - 'utf-8' (default) — plain text (HTML, Markdown, etc.)
   *   - 'base64'          — binary (images) already base64-encoded.
   * The github pusher forwards this as the createBlob encoding.
   */
  encoding?: 'utf-8' | 'base64';
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
      encoding: 'utf-8',
    });
  }

  // Walk the assembled HTML for any /uploads/<filename> refs and pull those
  // files off disk into the bundle (as base64 blobs). Without this the
  // deployed site would 404 on every user-uploaded image — they live in the
  // builder's public/uploads dir, which Coolify never sees.
  const uploadRefs = new Set<string>();
  const uploadRefRegex = /\/uploads\/([A-Za-z0-9._-]+)/g;
  for (const file of files) {
    let m: RegExpExecArray | null;
    while ((m = uploadRefRegex.exec(file.content)) !== null) {
      uploadRefs.add(m[1]);
    }
  }
  if (uploadRefs.size > 0) {
    const uploadsDir = path.join(process.cwd(), 'public', 'uploads');
    for (const name of uploadRefs) {
      try {
        const buf = await readFile(path.join(uploadsDir, name));
        files.push({
          path: `uploads/${name}`,
          content: buf.toString('base64'),
          encoding: 'base64',
        });
      } catch {
        // File missing on disk — skip silently. Live deploy will 404 that one
        // image, which is a less-bad outcome than failing the whole deploy.
      }
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  files.push({
    path: 'README.md',
    content: `# ${site.name}\n\nGenerated ${today} with Website Builder.\n\nOpen \`index.html\` in a browser.\n`,
    encoding: 'utf-8',
  });

  return { files, slug: slugifySite(site.name) };
}
