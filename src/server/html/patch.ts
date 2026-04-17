// Cheerio-based DOM patchers for trivial edits (text content, href, img src).
//
// Used by /api/patch to skip the Claude round-trip for the small edits that
// dominate interactive editing: rename a heading, change a link URL, swap an
// image src. Each op is deterministic + fast + cheap.
//
// Page.pageHtml is the source of truth; this module takes the full HTML,
// mutates a single element by its `data-el-id`, and hands back both the
// serialized full-document HTML and the outerHTML of the patched element
// (the caller returns the latter to the inspector so it can hot-swap the
// iframe without a full reload).

import * as cheerio from 'cheerio';

export type PatchOp =
  | { kind: 'text'; value: string }
  | { kind: 'href'; value: string }
  | { kind: 'img-src'; value: string }
  | { kind: 'button-text'; value: string };

export interface PatchResult {
  fullHtml: string; // the mutated page HTML
  elementHtml: string; // outerHTML of the patched element
}

function cssAttrEscape(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Replace text content while keeping nested inline elements intact.
 *
 * If the element has zero child elements, we just set .text(value).
 * Otherwise we overwrite the direct text-node children (the loose strings
 * sandwiched between child tags) with `value` — concentrating it into the
 * first text node and blanking out the rest. Child elements are preserved
 * in place. The inspector only offers the "text" op on elements it has
 * classified as text-leaf, so the multi-text-node path is a safe fallback.
 */
function replaceTextKeepingChildren(
  $: cheerio.CheerioAPI,
  el: ReturnType<cheerio.CheerioAPI>,
  value: string,
): void {
  const node = el.get(0);
  if (!node) return;

  // Narrow: only tag-typed nodes have children we can walk.
  const asTag = node as unknown as {
    type?: string;
    children?: Array<{ type: string; data?: string }>;
  };

  const children = Array.isArray(asTag.children) ? asTag.children : [];
  const hasChildElements = children.some((c) => c.type === 'tag');

  if (!hasChildElements) {
    el.text(value);
    return;
  }

  // Walk direct children; put `value` into the first text node we see,
  // empty the rest. Elements are untouched.
  let placed = false;
  for (const c of children) {
    if (c.type !== 'text') continue;
    if (!placed) {
      c.data = value;
      placed = true;
    } else {
      c.data = '';
    }
  }

  // If there were no direct text nodes at all, prepend one with the value
  // so the edit is visible. We can't hand-construct a domhandler node
  // safely here without its type, so fall back to prepending a cheerio
  // text node via .prepend().
  if (!placed) {
    el.prepend($.root().contents()[0] ? '' : '');
    // cheerio doesn't expose a clean text-prepend; set text() as a
    // last-resort fallback. This only triggers on elements that have
    // children but zero text-node slots, which is rare for text-leaf.
    el.prepend(value);
  }
}

/**
 * Rewrite the `url(...)` inside a `background-image` declaration in an
 * inline style attribute. Returns the new style string, or null if no
 * background-image rule is present.
 */
function rewriteBackgroundImageUrl(style: string, newUrl: string): string | null {
  const re = /background-image\s*:\s*url\((['"]?)([^'")]+)\1\)/i;
  if (!re.test(style)) return null;
  return style.replace(re, (_m, quote: string) => {
    const q = quote || '';
    return `background-image: url(${q}${newUrl}${q})`;
  });
}

export function patchElement(
  fullHtml: string,
  elementId: string,
  op: PatchOp,
): PatchResult | null {
  const $ = cheerio.load(fullHtml);
  const selector = `[data-el-id="${cssAttrEscape(elementId)}"]`;
  const $el = $(selector).first();
  if ($el.length === 0) return null;

  const node = $el.get(0) as unknown as { tagName?: string } | undefined;
  const tag = (node?.tagName ?? '').toLowerCase();

  switch (op.kind) {
    case 'text': {
      replaceTextKeepingChildren($, $el, op.value);
      break;
    }

    case 'button-text': {
      // Buttons and anchors share the text-leaf pattern. Use the same
      // children-preserving rewrite so a button containing an <svg> icon
      // keeps the icon.
      replaceTextKeepingChildren($, $el, op.value);
      break;
    }

    case 'href': {
      if (tag !== 'a') return null;
      $el.attr('href', op.value);
      break;
    }

    case 'img-src': {
      if (tag === 'img') {
        $el.attr('src', op.value);
      } else {
        const style = $el.attr('style') ?? '';
        const updated = rewriteBackgroundImageUrl(style, op.value);
        if (updated === null) return null;
        $el.attr('style', updated);
      }
      break;
    }
  }

  const elementHtml = $.html($el);
  const newFull = $.html();

  return { fullHtml: newFull, elementHtml };
}
