export interface StylePreset {
  id: string;
  name: string;
  description: string;
  aesthetic: string;
  typography: string;
  paletteMood: string;
}

export const STYLE_PRESETS: StylePreset[] = [
  {
    id: 'editorial-serif',
    name: 'Editorial Serif',
    description:
      'Magazine-like. Large serif display, generous leading, asymmetric 12-col grid, thin hairline rules, duotone photography. Think It\'s Nice That, NYT Opinion.',
    aesthetic: 'asymmetric-grid, hairline-rules, dropcap, oversized-serif-display, duotone-images',
    typography: 'Display: Playfair Display / GT Super (serif, 600). Body: Inter (sans, 400). No mono.',
    paletteMood: 'ivory paper + deep ink + single warm accent (terracotta/ochre)',
  },
  {
    id: 'neo-brutalist',
    name: 'Neo-Brutalist',
    description:
      'Thick 3px black borders, hard offset shadows (6px 6px 0), saturated primary blocks, oversized mono caps, zero gradients, overlapping badges.',
    aesthetic: 'thick-borders, hard-shadows, caps, badges, overlapping-stickers, bright-blocks',
    typography: 'Display: Space Grotesk (heavy, 800, upper). Body: IBM Plex Sans. Mono: JetBrains Mono.',
    paletteMood: 'bright yellow + electric blue + off-white + pure black borders',
  },
  {
    id: 'soft-glass',
    name: 'Soft Glass',
    description:
      'Dark surfaces with frosted translucent panels, subtle radial glows, fine noise texture, ultra-thin borders, Inter everywhere. Arc/Linear vibe.',
    aesthetic: 'backdrop-blur, radial-glow, noise-texture, thin-borders, rounded-16px, dark-mode-default',
    typography: 'Display: Inter Display (600). Body: Inter (400). Mono: JetBrains Mono.',
    paletteMood: 'deep navy/obsidian + cyan-violet glow + near-white ink',
  },
  {
    id: 'monochrome-tech',
    name: 'Monochrome Tech',
    description:
      'Terminal vibe. Near-black surface, CRT-green or amber accent, mono type for UI labels, ASCII dividers, tabular numerals, micro-dense info layouts.',
    aesthetic: 'mono-ui, ascii-dividers, tabular-nums, info-dense, scanline-accent',
    typography: 'Display: JetBrains Mono (700). Body: Inter (400). Mono: JetBrains Mono.',
    paletteMood: 'near-black + phosphor green or amber + dim gray grid',
  },
  {
    id: 'playful-marker',
    name: 'Playful Marker',
    description:
      'Hand-drawn marker underlines, pastel blocks, slightly-rotated cards, bouncy radii (22-32px), emoji-free, doodle arrows as connectors.',
    aesthetic: 'marker-underline, rotated-cards, bouncy-radius, doodle-arrows, pastel-blocks',
    typography: 'Display: Fraunces (600, italic allowed). Body: Nunito (500). Mono: none.',
    paletteMood: 'pastel peach + mint + butter yellow + chalk black',
  },
  {
    id: 'corporate-clean',
    name: 'Corporate Clean',
    description:
      'Confident sans on strict 8px grid, single brand color + deep neutrals, soft shadows, data visualizations welcome. Stripe-marketing energy.',
    aesthetic: 'eight-px-grid, soft-shadows, data-viz, single-brand-hue, plenty-whitespace',
    typography: 'Display: Söhne / Inter (600). Body: Inter (400). Mono: IBM Plex Mono.',
    paletteMood: 'cool neutrals (#0B1220, #F6F8FB) + one saturated brand accent',
  },
  {
    id: 'magazine-split',
    name: 'Magazine Split',
    description:
      'Two-column layouts with dramatic vertical rules, pull-quotes at 2x scale, captioned photography, issue-number chrome. Think print-to-web.',
    aesthetic: 'two-column-split, vertical-rules, pull-quote-xl, issue-number-header, numbered-footnotes',
    typography: 'Display: GT Sectra / Canela (serif 500). Body: Söhne (sans 400). Mono: none.',
    paletteMood: 'newsprint cream + ink black + single red editorial accent',
  },
  {
    id: 'dark-mode-minimal',
    name: 'Dark-Mode Minimal',
    description:
      'Near-black background, a single near-white for ink, ONE accent only, zero shadows, 1px hairline borders ONLY, ultra-quiet.',
    aesthetic: 'hairline-only, no-shadow, single-accent, near-black-surface, generous-whitespace',
    typography: 'Display: Inter (600, tight tracking). Body: Inter (400). Mono: JetBrains Mono.',
    paletteMood: '#0A0A0A + #EDEDED + one muted neon accent (cyan or lime)',
  },
  {
    id: 'warm-craft',
    name: 'Warm Craft',
    description:
      'Cream surfaces, terracotta + forest accents, slab-serif headlines, textured paper backgrounds, craft-store warmth. Think artisan/handmade brands.',
    aesthetic: 'cream-paper, slab-serif-display, stitched-borders, warm-earth-palette, hand-set-captions',
    typography: 'Display: Recoleta / Roslindale (serif 700). Body: Source Serif Pro (400). Mono: none.',
    paletteMood: 'warm cream + terracotta + forest green + soft charcoal',
  },
  {
    id: 'swiss-grid',
    name: 'Swiss Grid',
    description:
      'Helvetica/Inter on a militantly strict 8-col grid, huge numerals as section markers, single accent color, zero decoration, functional to a fault.',
    aesthetic: 'strict-grid, huge-numerals, single-accent, zero-decoration, left-aligned-everything',
    typography: 'Display: Inter (800, tight). Body: Inter (400). Mono: none.',
    paletteMood: 'pure white + pure black + one saturated accent (red or blue)',
  },
  {
    id: 'y2k-bubble',
    name: 'Y2K Bubble',
    description:
      'Chrome gradients (but only on small accents), bubble-rounded buttons, frosted stickers, holographic hover states, 2000s-tech nostalgia done tastefully.',
    aesthetic: 'chrome-accents, bubble-buttons, holographic-hovers, sticker-badges, gradient-mesh-bg',
    typography: 'Display: VT323 or Rubik (800). Body: Inter (500). Mono: VT323.',
    paletteMood: 'iridescent cyan + soft pink + chrome silver + off-white',
  },
  {
    id: 'documentary-photojournal',
    name: 'Documentary Photojournal',
    description:
      'Full-bleed photography with serif captions at the bottom, dateline metadata, heavy whitespace between chapters, text-image ratio 1:3.',
    aesthetic: 'full-bleed-photo, serif-captions, dateline-metadata, chapter-breaks, photo-first',
    typography: 'Display: Freight Display (serif 500). Body: Freight Text (400). Mono: none.',
    paletteMood: 'bone white + ink black + sepia warmth',
  },
];

export const STYLE_PRESET_IDS = STYLE_PRESETS.map((p) => p.id);

export function getStylePreset(id: string | null | undefined): StylePreset {
  if (!id) return STYLE_PRESETS[0];
  return STYLE_PRESETS.find((p) => p.id === id) ?? STYLE_PRESETS[0];
}

export function formatStylePresetForPrompt(p: StylePreset): string {
  return [
    `Style preset: ${p.id} — ${p.name}`,
    `Aesthetic: ${p.description}`,
    `Aesthetic tokens: ${p.aesthetic}`,
    `Typography hint: ${p.typography}`,
    `Palette mood: ${p.paletteMood}`,
  ].join('\n');
}
