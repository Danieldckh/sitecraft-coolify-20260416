import type { PageDTO, SiteDTO, ThemeDTO } from '@/types/models';
import { themeToCssVars } from './themeCss';

function escapeForScriptTag(js: string): string {
  return js.replace(/<\/script/gi, '<\\/script');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}

// Build a regex class of known slugs (escaped) for targeted anchor rewriting.
function slugPattern(slugs: string[]): RegExp | null {
  const escaped = slugs
    .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .filter(Boolean);
  if (escaped.length === 0) return null;
  return new RegExp(
    `\\bhref\\s*=\\s*(["'])(?:\\/|#\\/)(${escaped.join('|')})\\/?\\1`,
    'gi',
  );
}

function rewriteLinks(html: string, slugs: string[]): string {
  const pat = slugPattern(slugs);
  let out = html;
  if (pat) {
    out = out.replace(pat, (_m, q, slug) => `href=${q}#/${slug}${q}`);
  }
  // data-sc-page="slug" -> additionally get an href="#/slug" if the anchor
  // lacks one. Simpler: add a data attribute the router already matches.
  return out;
}

export interface BuildFullSiteDocOptions {
  site: Pick<SiteDTO, 'name'>;
  theme: ThemeDTO;
  pages: PageDTO[];
  currentSlug: string;
}

export function buildFullSiteDoc({
  site,
  theme,
  pages,
  currentSlug,
}: BuildFullSiteDocOptions): string {
  const rootVars = themeToCssVars(theme);
  const headerCss = theme.library?.Header?.css ?? '';
  const footerCss = theme.library?.Footer?.css ?? '';
  const buttonCss = theme.library?.Button?.css ?? '';
  const cardCss = theme.library?.Card?.css ?? '';
  const headerHtmlRaw = theme.library?.Header?.html ?? '';
  const footerHtmlRaw = theme.library?.Footer?.html ?? '';

  const slugs = pages.map((p) => p.slug);
  const headerHtml = rewriteLinks(headerHtmlRaw, slugs);
  const footerHtml = rewriteLinks(footerHtmlRaw, slugs);

  const sortedPages = [...pages].sort((a, b) => a.orderIdx - b.orderIdx);
  const activeSlug =
    sortedPages.find((p) => p.slug === currentSlug)?.slug ??
    sortedPages[0]?.slug ??
    '';

  const perPageCss = sortedPages
    .map((p) => p.pageCss ?? '')
    .filter(Boolean)
    .join('\n');

  const sectionsHtml = sortedPages
    .map((p) => {
      const isActive = p.slug === activeSlug;
      const hasContent = Boolean(p.pageHtml?.trim());
      const bodyHtml = hasContent
        ? rewriteLinks(p.pageHtml, slugs)
        : `<div class="sc-preview-empty"><h2>${escapeHtml(p.name)}</h2><p>This page has not been generated yet.</p></div>`;
      return `<section data-sc-page-slug="${escapeAttr(p.slug)}" data-sc-page-run="${escapeAttr(p.slug)}" style="display:${isActive ? 'block' : 'none'}">
${bodyHtml}
</section>`;
    })
    .join('\n');

  const pageScripts = sortedPages
    .map((p) => {
      const js = (p.pageJs ?? '').trim();
      if (!js) return '';
      return `(function(){try{\n${escapeForScriptTag(js)}\n}catch(err){console.error('[preview] page script error for ${p.slug}:', err);}})();`;
    })
    .filter(Boolean)
    .join('\n');

  const routerScript = `
(function(){
  var knownSlugs = ${JSON.stringify(slugs)};
  function currentFromHash(){
    var h = (location.hash || '').replace(/^#\\/?/, '').replace(/\\/$/, '');
    return h && knownSlugs.indexOf(h) !== -1 ? h : null;
  }
  function show(slug){
    var sections = document.querySelectorAll('[data-sc-page-slug]');
    for (var i = 0; i < sections.length; i++) {
      var s = sections[i];
      s.style.display = s.getAttribute('data-sc-page-slug') === slug ? 'block' : 'none';
    }
  }
  function navigate(slug, opts){
    if (knownSlugs.indexOf(slug) === -1) return;
    if (location.hash !== '#/' + slug) {
      location.hash = '#/' + slug;
    }
    show(slug);
    try { window.scrollTo(0, 0); } catch(e){}
    if (!opts || !opts.silent) {
      try { window.parent && window.parent.postMessage({ type: 'sc-navigate', slug: slug }, '*'); } catch(e){}
    }
  }
  window.__scNavigate = navigate;
  document.addEventListener('click', function(ev){
    var t = ev.target;
    while (t && t !== document.body) {
      if (t.tagName === 'A') {
        var dataSlug = t.getAttribute('data-sc-page');
        var href = t.getAttribute('href') || '';
        var slug = null;
        if (dataSlug && knownSlugs.indexOf(dataSlug) !== -1) {
          slug = dataSlug;
        } else if (href.indexOf('#/') === 0) {
          var s = href.slice(2).replace(/\\/$/, '');
          if (knownSlugs.indexOf(s) !== -1) slug = s;
        } else if (href.indexOf('/') === 0 && href.indexOf('//') !== 0) {
          var s2 = href.slice(1).replace(/\\/$/, '');
          if (knownSlugs.indexOf(s2) !== -1) slug = s2;
        }
        if (slug) {
          ev.preventDefault();
          navigate(slug);
          return;
        }
      }
      t = t.parentNode;
    }
  }, true);
  window.addEventListener('hashchange', function(){
    var s = currentFromHash();
    if (s) show(s);
  });
  window.addEventListener('message', function(ev){
    var d = ev.data;
    if (d && d.type === 'sc-navigate' && typeof d.slug === 'string') {
      navigate(d.slug, { silent: true });
    }
  });
  // Initial sync: prefer hash over server-rendered active slug.
  var initial = currentFromHash();
  if (initial) show(initial);
})();
`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(site.name)} — Preview</title>
<style>
${rootVars}
html, body { margin: 0; padding: 0; background: var(--color-surface, #fff); color: var(--color-ink, #111); font-family: var(--font-body, system-ui); }
img, svg, video { max-width: 100%; height: auto; }
.sc-preview-empty { padding: 4rem 2rem; text-align: center; color: var(--color-muted, #666); font-family: var(--font-body, system-ui); }
.sc-preview-empty h2 { margin: 0 0 0.5rem; font-family: var(--font-display, system-ui); color: var(--color-ink, #111); }
${headerCss}
${footerCss}
${buttonCss}
${cardCss}
${perPageCss}
</style>
</head>
<body>
${headerHtml}
${sectionsHtml}
${footerHtml}
<script>
${routerScript}
</script>
${pageScripts ? `<script>\n${pageScripts}\n</script>` : ''}
</body>
</html>`;
}
