import type { SectionRole } from '@/types/models';

export interface Variant {
  id: string; // role-qualified, e.g. "hero.split-copy-media-left"
  name: string;
  description: string;
}

// Enumerated per-role variant taxonomy. Model MUST pick from `id`; never free-form.
export const SECTION_VARIANTS: Record<SectionRole, Variant[]> = {
  hero: [
    { id: 'hero.split-copy-media-left', name: 'Split copy + media (left)', description: 'Two-column: 5/7 copy on left, large media block on right.' },
    { id: 'hero.split-copy-media-right', name: 'Split copy + media (right)', description: 'Two-column: 7/5 media on left, stacked copy + CTAs on right.' },
    { id: 'hero.full-bleed-photo-caption', name: 'Full-bleed photo + caption overlay', description: 'Edge-to-edge image; minimal caption anchored bottom-left with dateline.' },
    { id: 'hero.numbered-statement', name: 'Oversized numbered statement', description: 'Big "01 —" prefix, single-sentence manifesto, tiny CTA row beneath.' },
    { id: 'hero.marquee-headline', name: 'Marquee scrolling headline', description: 'Giant horizontally-scrolling wordmark/phrase, sub-copy stacked below.' },
    { id: 'hero.editorial-dropcap', name: 'Editorial dropcap paragraph', description: 'Serif dropcap opens a prose-style lead paragraph; no buttons, one inline link.' },
    { id: 'hero.bento-intro', name: 'Bento intro grid', description: '4-tile asymmetric grid mixing headline, metric, image, quote.' },
    { id: 'hero.side-rail-contents', name: 'Side-rail table of contents', description: 'Left sidebar lists page sections; right hosts the headline + short deck.' },
    { id: 'hero.centered-manifesto', name: 'Centered manifesto (small)', description: 'Tight centered block, <600px wide, ONLY for luxury-quiet / warm-craft presets.' },
  ],
  features: [
    { id: 'features.bento-asymmetric', name: 'Asymmetric bento', description: 'Mixed tile sizes (big/small/wide) with varied content kinds per cell.' },
    { id: 'features.numbered-list-vertical', name: 'Numbered vertical list', description: 'Large numerals on the left, feature title + 1-sentence blurb right-aligned.' },
    { id: 'features.horizontal-scroller', name: 'Horizontal scroller', description: 'Snap-scroll row of wide cards, visible next/prev affordance.' },
    { id: 'features.comparison-table', name: 'Comparison table', description: 'Us vs. them (or tier vs. tier) table; checkmarks/ticks; concrete claims only.' },
    { id: 'features.icon-grid-3', name: '3-column icon grid', description: 'Three parallel cards, custom glyph not emoji, short benefit, no CTAs.' },
    { id: 'features.split-accordion', name: 'Split accordion', description: 'Left: sticky heading + illustration. Right: expandable item list.' },
    { id: 'features.tabbed-showcase', name: 'Tabbed showcase', description: 'Tab strip across top; active tab swaps a large media+copy pair.' },
    { id: 'features.alternating-strips', name: 'Alternating strips', description: 'Full-width strips that alternate image-left/image-right with generous padding.' },
  ],
  cta: [
    { id: 'cta.full-bleed-banner', name: 'Full-bleed banner', description: 'Edge-to-edge colored band, oversized headline, single primary button.' },
    { id: 'cta.inline-strip', name: 'Inline strip', description: 'Thin strip inside container, left headline + right button, no decoration.' },
    { id: 'cta.split-form', name: 'Split with inline form', description: 'Left: pitch copy. Right: email input + submit, inline.' },
    { id: 'cta.oversized-word', name: 'Oversized single word', description: 'One giant verb ("Begin."), tiny supporting line + button beneath.' },
    { id: 'cta.sticky-footer-ribbon', name: 'Sticky footer ribbon', description: 'Compact ribbon before footer with one headline + one button.' },
    { id: 'cta.numbered-next-step', name: 'Numbered next-step card', description: 'Card with "Next →" ordinal, three-line instruction, button.' },
  ],
  testimonials: [
    { id: 'testimonials.single-hero-quote', name: 'Single hero quote', description: 'One giant quote, attribution small beneath, no cards.' },
    { id: 'testimonials.marquee-cards', name: 'Marquee cards', description: 'Auto-scrolling horizontal row of quote cards.' },
    { id: 'testimonials.bento-mixed-media', name: 'Bento mixed media', description: 'Mixed grid of quote tiles + logo tiles + screenshot tiles.' },
    { id: 'testimonials.magazine-pullquote', name: 'Magazine pullquote', description: 'Editorial pull-quote with rule above/below and attribution as footnote.' },
    { id: 'testimonials.logo-wall-with-quote', name: 'Logo wall + anchor quote', description: 'Grayscale customer logo wall with one featured quote overlaid.' },
    { id: 'testimonials.two-column-parallel', name: 'Two-column parallel', description: 'Two quotes side by side, portrait + metrics beneath each.' },
    { id: 'testimonials.metric-first', name: 'Metric-first card row', description: 'Card row where the lead element is a big number; quote as supporting caption.' },
  ],
  gallery: [
    { id: 'gallery.masonry', name: 'Masonry', description: 'Variable-height columns, tight gutters, captions on hover.' },
    { id: 'gallery.filmstrip', name: 'Filmstrip', description: 'Single horizontal scrolling row, consistent aspect ratio.' },
    { id: 'gallery.grid-4', name: '4-col grid', description: 'Rigid 4-column grid, uniform aspect, numbered captions.' },
    { id: 'gallery.hero-plus-thumbnails', name: 'Hero + thumbnail strip', description: 'Large featured image, smaller thumbnails beneath for navigation.' },
    { id: 'gallery.collage-overlap', name: 'Collage with overlap', description: 'Intentionally overlapping images with slight rotation; cosmos-style.' },
    { id: 'gallery.polaroid-row', name: 'Polaroid row', description: 'Images with tape-style borders and handwritten captions, rotated slightly.' },
  ],
  pricing: [
    { id: 'pricing.parallel-cards-3', name: '3 parallel tier cards', description: 'Three equal cards, middle highlighted with ring/shadow/motif.' },
    { id: 'pricing.toggle-monthly-annual', name: 'Toggle monthly/annual', description: 'Top toggle swaps prices; 3-4 tiers beneath.' },
    { id: 'pricing.single-featured', name: 'Single featured tier', description: 'One large card with full feature breakdown; no tier comparison.' },
    { id: 'pricing.comparison-matrix', name: 'Comparison matrix', description: 'Full feature × tier grid; rows group by category.' },
    { id: 'pricing.quote-based', name: 'Quote-based CTA', description: 'No prices; pitch + contact-for-quote button and short FAQ.' },
    { id: 'pricing.usage-slider', name: 'Usage slider estimator', description: 'Interactive slider showing estimated cost; tier cards beneath.' },
  ],
  faq: [
    { id: 'faq.two-column-accordion', name: 'Two-column accordion', description: 'Two columns of disclosure rows; concise one-sentence answers.' },
    { id: 'faq.single-column-long', name: 'Single-column long-form', description: 'One-column with paragraph-length answers; editorial feel.' },
    { id: 'faq.categorized-tabs', name: 'Category tabs', description: 'Tabs group FAQs by topic; rows beneath.' },
    { id: 'faq.sticky-left-index', name: 'Sticky left index + rows', description: 'Left-rail index links anchor to Q&A rows on the right.' },
    { id: 'faq.search-first', name: 'Search-first', description: 'Search input up top, trending questions chips, list beneath.' },
    { id: 'faq.inline-chat', name: 'Inline chat transcript', description: 'Each Q&A rendered as a chat bubble pair.' },
  ],
  contact: [
    { id: 'contact.split-form-info', name: 'Split form + contact info', description: 'Left: form. Right: email/phone/address with map or motif.' },
    { id: 'contact.single-form-centered', name: 'Single centered form', description: 'Narrow centered form, minimal fields (name, email, message).' },
    { id: 'contact.calendly-style-card', name: 'Scheduling card', description: 'Card with time slots / book-a-call CTA; no open-text form.' },
    { id: 'contact.office-cards-row', name: 'Office cards row', description: 'Row of city cards, each with address + coordinates.' },
    { id: 'contact.channel-list', name: 'Channel list', description: 'Vertical list of contact channels, each with one-line purpose.' },
    { id: 'contact.inline-footer-form', name: 'Inline footer form', description: 'Minimal inline strip, email input + submit, no labels.' },
  ],
  'about-story': [
    { id: 'about-story.timeline-vertical', name: 'Vertical timeline', description: 'Year → event pairs down a center rule.' },
    { id: 'about-story.manifesto-paragraphs', name: 'Manifesto paragraphs', description: 'Long-form prose with dropcaps; no images.' },
    { id: 'about-story.team-grid', name: 'Team grid', description: 'Portrait grid with name + role + one-line bio.' },
    { id: 'about-story.values-cards', name: 'Values cards', description: 'Three-to-five values as tiles with short expansion copy.' },
    { id: 'about-story.photo-chapters', name: 'Photo chapters', description: 'Alternating chapter blocks: full-bleed photo + paragraph + caption.' },
    { id: 'about-story.milestone-numbers', name: 'Milestone numbers row', description: 'Metric row (founded, customers, countries), short caption each.' },
    { id: 'about-story.founder-letter', name: 'Founder letter', description: 'Signed letter-style section, italic salutation, handwritten signature.' },
  ],
  'services-grid': [
    { id: 'services-grid.tile-grid-3', name: '3-col tile grid', description: 'Equal tiles, one glyph + title + 1-sentence scope per service.' },
    { id: 'services-grid.tile-grid-4', name: '4-col tile grid', description: 'Denser four-column tile layout.' },
    { id: 'services-grid.numbered-list', name: 'Numbered service list', description: 'Large numeral + title + paragraph, stacked vertically.' },
    { id: 'services-grid.alternating-rows', name: 'Alternating hero rows', description: 'Each service occupies a full row with image + expanded copy, alternating.' },
    { id: 'services-grid.accordion-disclosure', name: 'Accordion disclosure', description: 'Service titles as disclosure rows; expand for detail + CTA.' },
    { id: 'services-grid.pricing-adjacent', name: 'With adjacent pricing hint', description: 'Tile grid + a per-service starting-at price tag.' },
  ],
  'footer-big': [
    { id: 'footer-big.multi-column-nav', name: 'Multi-column nav', description: '4-5 grouped link columns + brand summary + tiny social row.' },
    { id: 'footer-big.oversized-wordmark', name: 'Oversized wordmark', description: 'Giant brand wordmark across the footer, small link cluster beneath.' },
    { id: 'footer-big.newsletter-first', name: 'Newsletter-first', description: 'Big email capture top; nav underneath as secondary.' },
    { id: 'footer-big.minimal-center', name: 'Minimal centered', description: 'Centered wordmark, one-line nav, copyright.' },
    { id: 'footer-big.sitemap-dense', name: 'Dense sitemap', description: 'Full nav tree, small type, columns of 8+ links.' },
    { id: 'footer-big.signature-band', name: 'Signature motif band', description: 'Footer is dominated by the site signature (marquee / rule / motif).' },
  ],
  'header-nav': [
    { id: 'header-nav.left-wordmark-right-nav', name: 'Left wordmark, right nav + CTA', description: 'Classic but tight, hairline bottom border.' },
    { id: 'header-nav.centered-serif', name: 'Centered serif wordmark + underlined nav', description: 'Editorial-leaning centered wordmark with linked nav beneath.' },
    { id: 'header-nav.brutalist-thick-border', name: 'Brutalist thick-border bar', description: 'Thick 3px bottom border, caps mono nav, no shadow.' },
    { id: 'header-nav.rail-vertical', name: 'Vertical rail', description: 'Left-side vertical navigation rail for single-page designs.' },
    { id: 'header-nav.floating-pill', name: 'Floating pill', description: 'Rounded-pill nav floating over the hero, subtle shadow.' },
    { id: 'header-nav.issue-number-bar', name: 'Issue-number bar', description: 'Top micro-bar with issue/date + main nav beneath.' },
    { id: 'header-nav.oversized-logo', name: 'Oversized logo row', description: 'Large logo on its own row, nav in a quieter row below.' },
  ],
  custom: [
    { id: 'custom.freeform', name: 'Freeform', description: 'Only use when no named variant fits. Still obey theme tokens + signature motif.' },
  ],
};

export function listVariantsFor(role: SectionRole): Variant[] {
  return SECTION_VARIANTS[role] ?? SECTION_VARIANTS.custom;
}

export function formatVariantsForPrompt(role: SectionRole): string {
  const vs = listVariantsFor(role);
  return vs.map((v) => `- ${v.id}: ${v.description}`).join('\n');
}

export function isKnownVariant(id: string): boolean {
  return Object.values(SECTION_VARIANTS).some((list) => list.some((v) => v.id === id));
}
