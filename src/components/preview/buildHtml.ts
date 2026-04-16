import type { PageDTO, SectionDTO } from '@/types/models';
import { scopeCss } from './scopeCss';

export interface BuildHtmlInput {
  page: PageDTO & { sections: SectionDTO[] };
  sitemap: PageDTO[];
}

export interface BuiltParts {
  html: string;
  css: string;
  js: string;
  fullDoc: string;
}

function renderNav(sitemap: PageDTO[], currentId: string) {
  const items = [...sitemap]
    .filter((p) => p.navVisible)
    .sort((a, b) => a.orderIdx - b.orderIdx);
  if (items.length === 0) return '';
  const links = items
    .map((p) => {
      const active = p.id === currentId ? ' aria-current="page"' : '';
      return `<a href="#page-${p.slug}"${active} data-page-slug="${p.slug}">${escapeHtml(p.name)}</a>`;
    })
    .join('');
  return `<nav class="__sc-nav">${links}</nav>`;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export function buildPreview({ page, sitemap }: BuildHtmlInput): BuiltParts {
  const sections = [...page.sections].sort((a, b) => a.orderIdx - b.orderIdx);

  const htmlParts: string[] = [];
  const cssParts: string[] = [];
  const jsParts: string[] = [];

  for (const s of sections) {
    htmlParts.push(`<section id="section-${s.id}" data-section-type="${s.type}">${s.html || ''}</section>`);
    if (s.css) cssParts.push(`/* section ${s.type} (${s.id}) */\n${scopeCss(s.css, s.id)}`);
    if (s.js) jsParts.push(`/* section ${s.type} (${s.id}) */\n(function(){\ntry {\n${s.js}\n} catch (e) { console.error('[sitecraft] section ${s.id} failed:', e); }\n})();`);
  }

  const html = htmlParts.join('\n');
  const css = cssParts.join('\n\n');
  const js = jsParts.join('\n\n');

  const nav = renderNav(sitemap, page.id);

  const slugMap = JSON.stringify(
    Object.fromEntries(sitemap.map((p) => [p.slug.toLowerCase(), p.slug])),
  );
  const navBridge = `
    (function(){
      var slugs = ${slugMap};
      function resolve(href){
        if (!href) return null;
        var h = String(href).trim().toLowerCase();
        if (h.startsWith('#page-')) return slugs[h.slice(6)] || null;
        if (h.startsWith('#')) return null;
        // strip origin, query, trailing slash, .html
        h = h.replace(/^https?:\\/\\/[^\\/]+/, '').split('?')[0].split('#')[0];
        h = h.replace(/\\.html?$/, '').replace(/^\\//, '').replace(/\\/$/, '');
        if (!h || h === 'index' || h === 'home') return slugs['home'] || null;
        return slugs[h] || null;
      }
      document.addEventListener('click', function(e){
        var a = e.target && e.target.closest ? e.target.closest('a') : null;
        if (!a) return;
        var slug = a.getAttribute('data-page-slug') || resolve(a.getAttribute('href'));
        if (!slug) { e.preventDefault(); return; }
        e.preventDefault();
        parent.postMessage({ type: 'sitecraft:navigate', slug: slug }, '*');
      }, true);
    })();
  `;

  const baseCss = `
    *, *::before, *::after { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; color: #0b0d12; background: #fff; }
    .__sc-nav { position: sticky; top: 0; z-index: 100; display: flex; gap: 1.25rem; padding: 0.875rem 1.5rem; background: rgba(255,255,255,0.85); backdrop-filter: blur(8px); border-bottom: 1px solid rgba(0,0,0,0.06); font-size: 0.875rem; }
    .__sc-nav a { color: #1a1d26; text-decoration: none; }
    .__sc-nav a[aria-current="page"] { color: #4f46e5; font-weight: 600; }
  `;

  const fullDoc = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapeHtml(page.name)}</title>
<style>${baseCss}</style>
<style>${css}</style>
</head>
<body>
${nav}
<main>${html}</main>
<script>${navBridge}</script>
<script>${js}</script>
</body>
</html>`;

  return { html, css, js, fullDoc };
}
