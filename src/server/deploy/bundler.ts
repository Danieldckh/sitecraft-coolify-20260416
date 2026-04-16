import { prisma } from '@/server/db/client';

export interface BundleFile {
  path: string;
  content: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function prefixCss(css: string, prefix: string): string {
  if (!css.trim()) return '';
  // Parse roughly by tracking braces. Skip prefixing @keyframes, @font-face, :root.
  const out: string[] = [];
  let i = 0;
  while (i < css.length) {
    // skip whitespace/comments
    const wsMatch = css.slice(i).match(/^\s+/);
    if (wsMatch) {
      out.push(wsMatch[0]);
      i += wsMatch[0].length;
      continue;
    }
    if (css.startsWith('/*', i)) {
      const end = css.indexOf('*/', i + 2);
      const stop = end === -1 ? css.length : end + 2;
      out.push(css.slice(i, stop));
      i = stop;
      continue;
    }
    // Read a selector / at-rule prelude up to '{' or ';'
    let j = i;
    let depth = 0;
    while (j < css.length) {
      const c = css[j];
      if (c === '{' && depth === 0) break;
      if (c === ';' && depth === 0) break;
      if (c === '(') depth++;
      else if (c === ')') depth--;
      j++;
    }
    const prelude = css.slice(i, j).trim();
    if (j >= css.length) {
      out.push(css.slice(i));
      break;
    }
    if (css[j] === ';') {
      // at-rule without block (e.g. @import)
      out.push(css.slice(i, j + 1));
      i = j + 1;
      continue;
    }
    // css[j] === '{' — find matching close
    let k = j + 1;
    let bdepth = 1;
    while (k < css.length && bdepth > 0) {
      const c = css[k];
      if (c === '{') bdepth++;
      else if (c === '}') bdepth--;
      k++;
    }
    const block = css.slice(j, k); // includes { ... }
    const isAt = prelude.startsWith('@');
    const skipPrefix =
      isAt && /^@(keyframes|-webkit-keyframes|font-face|charset|import|supports|media)/i.test(prelude);

    if (skipPrefix && /^@(keyframes|-webkit-keyframes|font-face)/i.test(prelude)) {
      // Leave as-is.
      out.push(prelude + block);
    } else if (/^@(media|supports)/i.test(prelude)) {
      // Prefix inner rules.
      const inner = block.slice(1, -1);
      out.push(prelude + '{' + prefixCss(inner, prefix) + '}');
    } else if (prelude.startsWith('@')) {
      out.push(prelude + block);
    } else {
      // Prefix each selector in the comma-separated list.
      const selectors = prelude
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((sel) => {
          if (sel === ':root' || sel === 'html' || sel === 'body') return prefix;
          return `${prefix} ${sel}`;
        })
        .join(', ');
      out.push(selectors + block);
    }
    i = k;
  }
  return out.join('');
}

function buildNav(
  pages: { slug: string; name: string; navVisible: boolean; orderIdx: number }[],
  currentSlug: string,
): string {
  const visible = pages
    .filter((p) => p.navVisible)
    .sort((a, b) => a.orderIdx - b.orderIdx);
  if (visible.length === 0) return '';
  const links = visible
    .map((p) => {
      const href = p.slug === 'home' ? '/index.html' : `/${p.slug}.html`;
      const active = p.slug === currentSlug ? ' aria-current="page"' : '';
      return `<a href="${href}"${active}>${escapeHtml(p.name)}</a>`;
    })
    .join('\n      ');
  return `<nav class="site-nav">\n      ${links}\n    </nav>`;
}

function renderPage(
  site: { name: string },
  page: {
    slug: string;
    name: string;
    sections: { id: string; html: string; css: string; js: string }[];
  },
  allPages: { slug: string; name: string; navVisible: boolean; orderIdx: number }[],
): string {
  const nav = buildNav(allPages, page.slug);

  const sectionsHtml = page.sections
    .map((s) => `<section id="section-${s.id}">\n${s.html || ''}\n</section>`)
    .join('\n');

  const css = page.sections
    .map((s) => prefixCss(s.css || '', `#section-${s.id}`))
    .filter(Boolean)
    .join('\n\n');

  const js = page.sections
    .filter((s) => (s.js || '').trim())
    .map((s) => `(() => {\ntry {\n${s.js}\n} catch (e) { console.error('section ${s.id}', e); }\n})();`)
    .join('\n');

  const title = `${escapeHtml(page.name)} — ${escapeHtml(site.name)}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<style>
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
.site-nav { display: flex; gap: 1rem; padding: 0.75rem 1.25rem; border-bottom: 1px solid #eee; background: #fff; position: sticky; top: 0; z-index: 100; }
.site-nav a { text-decoration: none; color: #111; font-weight: 500; }
.site-nav a[aria-current="page"] { color: #2563eb; }
${css}
</style>
</head>
<body>
${nav}
<main>
${sectionsHtml}
</main>
<script>
${js}
</script>
</body>
</html>
`;
}

export async function bundleSite(siteId: string): Promise<BundleFile[]> {
  const site = await prisma.site.findUniqueOrThrow({
    where: { id: siteId },
    include: {
      pages: {
        orderBy: { orderIdx: 'asc' },
        include: { sections: { orderBy: { orderIdx: 'asc' } } },
      },
    },
  });

  const navPages = site.pages.map((p) => ({
    slug: p.slug,
    name: p.name,
    navVisible: p.navVisible,
    orderIdx: p.orderIdx,
  }));

  const files: BundleFile[] = [];

  for (const page of site.pages) {
    const html = renderPage(
      { name: site.name },
      {
        slug: page.slug,
        name: page.name,
        sections: page.sections.map((s) => ({
          id: s.id,
          html: s.html,
          css: s.css,
          js: s.js,
        })),
      },
      navPages,
    );
    const path = page.slug === 'home' ? 'index.html' : `${page.slug}.html`;
    files.push({ path, content: html });
  }

  // Ensure an index.html always exists.
  if (!files.some((f) => f.path === 'index.html')) {
    const first = site.pages[0];
    if (first) {
      const copy = files.find((f) => f.path === `${first.slug}.html`);
      if (copy) files.push({ path: 'index.html', content: copy.content });
    } else {
      files.push({
        path: 'index.html',
        content: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(site.name)}</title></head><body><h1>${escapeHtml(site.name)}</h1><p>No pages yet.</p></body></html>`,
      });
    }
  }

  files.push({
    path: 'README.md',
    content: `# ${site.name}\n\nStatic bundle generated by Sitecraft on ${new Date().toISOString()}.\n`,
  });

  return files;
}
