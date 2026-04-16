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

  const inspectorScript = `
(function(){
  var docEl = document.documentElement;
  var hoverEl = null;
  var selectedEl = null;
  var overlayHover = null;
  var overlaySelected = null;
  var chipHover = null;
  var chipSelected = null;

  function ensureStyles(){
    if (document.getElementById('sc-inspector-style')) return;
    var s = document.createElement('style');
    s.id = 'sc-inspector-style';
    s.textContent =
      '.sc-inspector-on, .sc-inspector-on * { cursor: crosshair !important; }' +
      '.sc-inspector-overlay { position: absolute; pointer-events: none; z-index: 2147483646; border-radius: 2px; box-sizing: border-box; transition: all 80ms ease-out; }' +
      '.sc-inspector-overlay--hover { outline: 2px solid #4f46e5; background: rgba(79,70,229,0.06); }' +
      '.sc-inspector-overlay--selected { outline: 2px solid #2563eb; box-shadow: 0 0 0 4px rgba(37,99,235,0.18); background: rgba(37,99,235,0.08); }' +
      '.sc-inspector-chip { position: absolute; z-index: 2147483647; pointer-events: none; background: #111827; color: #fff; font: 11px/1.4 ui-sans-serif,system-ui,sans-serif; padding: 2px 6px; border-radius: 4px; white-space: nowrap; max-width: 260px; overflow: hidden; text-overflow: ellipsis; }' +
      '.sc-inspector-chip--selected { background: #2563eb; }';
    document.head.appendChild(s);
  }

  function findTarget(el){
    var cur = el;
    var promoted = false;
    while (cur && cur !== document.body) {
      var id = cur.id || '';
      if (id.indexOf('sc-el-') === 0) return { el: cur, promoted: promoted };
      cur = cur.parentElement;
      promoted = true;
    }
    return null;
  }

  function measure(el){
    var r = el.getBoundingClientRect();
    var sx = window.scrollX || window.pageXOffset || 0;
    var sy = window.scrollY || window.pageYOffset || 0;
    return { top: r.top + sy, left: r.left + sx, width: r.width, height: r.height, viewportTop: r.top, viewportLeft: r.left };
  }

  function positionOverlay(overlay, chip, el, variant){
    var m = measure(el);
    overlay.style.top = m.top + 'px';
    overlay.style.left = m.left + 'px';
    overlay.style.width = m.width + 'px';
    overlay.style.height = m.height + 'px';
    chip.style.top = Math.max(0, m.top - 20) + 'px';
    chip.style.left = m.left + 'px';
    var id = (el.id || '').replace(/^sc-el-/, '');
    var trimmed = id.length > 10 ? id.slice(0, 8) + '…' : id;
    chip.textContent = el.tagName.toLowerCase() + (trimmed ? ' · ' + trimmed : '') + (variant === 'hover' ? '' : ' (selected)');
  }

  function ensureOverlays(){
    if (!overlayHover) {
      overlayHover = document.createElement('div');
      overlayHover.className = 'sc-inspector-overlay sc-inspector-overlay--hover';
      chipHover = document.createElement('div');
      chipHover.className = 'sc-inspector-chip';
    }
    if (!overlaySelected) {
      overlaySelected = document.createElement('div');
      overlaySelected.className = 'sc-inspector-overlay sc-inspector-overlay--selected';
      chipSelected = document.createElement('div');
      chipSelected.className = 'sc-inspector-chip sc-inspector-chip--selected';
    }
  }

  function attachOverlays(){
    ensureOverlays();
    if (!overlayHover.parentNode) document.body.appendChild(overlayHover);
    if (!chipHover.parentNode) document.body.appendChild(chipHover);
    hideHover();
    hideSelected();
  }

  function detachOverlays(){
    [overlayHover, overlaySelected, chipHover, chipSelected].forEach(function(n){ if (n && n.parentNode) n.parentNode.removeChild(n); });
    hoverEl = null; selectedEl = null;
  }

  function showHover(el){
    if (!overlayHover || !chipHover) return;
    if (!overlayHover.parentNode) document.body.appendChild(overlayHover);
    if (!chipHover.parentNode) document.body.appendChild(chipHover);
    overlayHover.style.display = 'block';
    chipHover.style.display = 'block';
    positionOverlay(overlayHover, chipHover, el, 'hover');
  }
  function hideHover(){
    if (overlayHover) overlayHover.style.display = 'none';
    if (chipHover) chipHover.style.display = 'none';
    hoverEl = null;
  }
  function showSelected(el){
    ensureOverlays();
    if (!overlaySelected.parentNode) document.body.appendChild(overlaySelected);
    if (!chipSelected.parentNode) document.body.appendChild(chipSelected);
    overlaySelected.style.display = 'block';
    chipSelected.style.display = 'block';
    positionOverlay(overlaySelected, chipSelected, el, 'selected');
  }
  function hideSelected(){
    if (overlaySelected) overlaySelected.style.display = 'none';
    if (chipSelected) chipSelected.style.display = 'none';
    selectedEl = null;
  }

  function onMouseOver(ev){
    if (!docEl.classList.contains('sc-inspector-on')) return;
    var hit = findTarget(ev.target);
    if (!hit) { hideHover(); return; }
    if (hit.el === selectedEl) { hideHover(); return; }
    if (hit.el === hoverEl) return;
    hoverEl = hit.el;
    showHover(hit.el);
  }
  function onMouseOut(ev){
    if (!docEl.classList.contains('sc-inspector-on')) return;
    if (!ev.relatedTarget) hideHover();
  }
  function onClick(ev){
    if (!docEl.classList.contains('sc-inspector-on')) return;
    var hit = findTarget(ev.target);
    if (!hit) return;
    ev.preventDefault();
    ev.stopPropagation();
    selectedEl = hit.el;
    hideHover();
    showSelected(hit.el);
    var r = hit.el.getBoundingClientRect();
    var text = (hit.el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 120);
    try {
      window.parent && window.parent.postMessage({
        type: 'sc-inspector-select',
        selectorId: hit.el.id,
        tagName: hit.el.tagName.toLowerCase(),
        textPreview: text,
        promoted: hit.promoted,
        boundingClientRect: { top: r.top, left: r.left, width: r.width, height: r.height, bottom: r.bottom, right: r.right }
      }, '*');
    } catch(e){}
  }

  function setMode(on){
    ensureStyles();
    if (on) {
      docEl.classList.add('sc-inspector-on');
      docEl.setAttribute('data-sc-inspector', 'on');
      attachOverlays();
    } else {
      docEl.classList.remove('sc-inspector-on');
      docEl.removeAttribute('data-sc-inspector');
      detachOverlays();
    }
  }

  function findBySelectorId(selId){
    if (!selId) return null;
    return document.getElementById(selId);
  }

  function reposition(){
    if (selectedEl && document.body.contains(selectedEl)) positionOverlay(overlaySelected, chipSelected, selectedEl, 'selected');
    if (hoverEl && document.body.contains(hoverEl)) positionOverlay(overlayHover, chipHover, hoverEl, 'hover');
  }

  window.addEventListener('message', function(ev){
    var d = ev.data;
    if (!d || typeof d !== 'object') return;
    if (d.type === 'sc-inspector-mode') {
      setMode(!!d.enabled);
    } else if (d.type === 'sc-inspector-deselect') {
      hideSelected();
    } else if (d.type === 'sc-inspector-replace' && d.selectorId) {
      var el = findBySelectorId(d.selectorId);
      if (el && typeof d.html === 'string') {
        el.innerHTML = d.html;
      }
      if (typeof d.css === 'string' && d.css) {
        var styleId = 'sc-el-style-' + d.selectorId;
        var existing = document.getElementById(styleId);
        if (existing) existing.textContent = d.css;
        else {
          var s = document.createElement('style');
          s.id = styleId;
          s.textContent = d.css;
          document.head.appendChild(s);
        }
      }
      if (el && selectedEl === el) setTimeout(reposition, 0);
    } else if (d.type === 'sc-inspector-text' && d.selectorId) {
      var el2 = findBySelectorId(d.selectorId);
      if (el2 && typeof d.text === 'string') {
        el2.textContent = d.text;
        if (selectedEl === el2) setTimeout(reposition, 0);
      }
    } else if (d.type === 'sc-inspector-get-text' && d.selectorId) {
      var el3 = findBySelectorId(d.selectorId);
      var txt = el3 ? (el3.textContent || '') : '';
      try {
        window.parent && window.parent.postMessage({
          type: 'sc-inspector-text-value',
          selectorId: d.selectorId,
          text: txt
        }, '*');
      } catch(e){}
    }
  });

  document.addEventListener('mouseover', onMouseOver, true);
  document.addEventListener('mouseout', onMouseOut, true);
  document.addEventListener('click', onClick, true);
  window.addEventListener('resize', reposition);
  window.addEventListener('scroll', reposition, true);

  ensureStyles();
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
<script>
${inspectorScript}
</script>
${pageScripts ? `<script>\n${pageScripts}\n</script>` : ''}
</body>
</html>`;
}
