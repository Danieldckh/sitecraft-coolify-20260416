import * as cheerio from 'cheerio';

/**
 * Walk a section's HTML and assign a unique `data-el-id` to every descendant
 * element that doesn't already have one. This is what lets the inspector
 * click-to-edit *any* element inside a section, not just the section itself.
 *
 * The outer `<section>` already carries the section id (e.g. `data-el-id="hero"`)
 * assigned by the Designer. Descendants become `hero-1`, `hero-2`, etc.
 *
 * Siblings outside the <section> (e.g. the trailing <style> block) are left
 * alone — they're not interactive targets.
 */
export function injectElementIds(sectionHtml: string, sectionId: string): string {
  const $ = cheerio.load(`<div id="__sc_wrap__">${sectionHtml}</div>`, null, false);
  let counter = 0;

  $('#__sc_wrap__ *').each((_, el) => {
    if (el.type !== 'tag') return;
    const tag = el.tagName.toLowerCase();
    if (tag === 'style' || tag === 'script' || tag === 'link' || tag === 'meta') return;

    const $el = $(el);
    if ($el.attr('data-el-id')) return;

    counter += 1;
    $el.attr('data-el-id', `${sectionId}-${counter}`);
  });

  return $('#__sc_wrap__').html() ?? sectionHtml;
}

/**
 * Find an element in a full-document HTML string by its `data-el-id` and
 * return `{ outerHtml, replace(newOuterHtml) }`. If not found, returns null.
 *
 * The `replace` function serializes the mutated document and returns the
 * new full HTML.
 */
export function findElementById(fullHtml: string, dataElId: string):
  | { outerHtml: string; replace: (newOuterHtml: string) => string }
  | null {
  const $ = cheerio.load(fullHtml);
  const selector = `[data-el-id="${cssAttrEscape(dataElId)}"]`;
  const target = $(selector).first();
  if (target.length === 0) return null;

  const outer = $.html(target);
  return {
    outerHtml: outer,
    replace(newOuterHtml: string): string {
      target.replaceWith(newOuterHtml);
      return $.html();
    },
  };
}

function cssAttrEscape(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
