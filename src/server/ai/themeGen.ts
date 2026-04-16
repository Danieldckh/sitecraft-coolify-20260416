import { z } from 'zod';
import { zodResponseFormat } from 'openai/helpers/zod';
import { getOpenAI, withRetry } from './client';
import { THEME_SYSTEM } from './prompts';
import { buildRetryDirective, ThemeGenerationFailed, validateGenerated } from './banlist';
import { formatStylePresetForPrompt, getStylePreset } from './stylePresets';
import type { ThemeTokens, ThemeLibrary, ThemePalette } from '@/types/models';

const PaletteSchema = z.object({
  primary: z.string(),
  secondary: z.string(),
  accent: z.string(),
  surface: z.string(),
  ink: z.string(),
  muted: z.string(),
});

const TokensSchema = z.object({
  radius: z.object({ sm: z.string(), md: z.string(), lg: z.string(), pill: z.string() }),
  shadow: z.object({ sm: z.string(), md: z.string(), lg: z.string() }),
  spacing: z.array(z.number()).min(6).max(12),
  typeScale: z.array(z.number()).min(6).max(12),
  motion: z.object({
    easing: z.string(),
    durationMs: z.number(),
    style: z.enum(['subtle', 'editorial', 'playful', 'kinetic']),
  }),
  grid: z.object({
    maxWidth: z.string(),
    gutter: z.string(),
    columns: z.number(),
  }),
});

const LibEntrySchema = z.object({ html: z.string(), css: z.string() });
const LibrarySchema = z.object({
  Header: LibEntrySchema,
  Footer: LibEntrySchema,
  Button: LibEntrySchema,
  Card: LibEntrySchema,
});

export const ThemeGenSchema = z.object({
  signatureMotif: z.string().min(10),
  primaryFont: z.string().min(2),
  secondaryFont: z.string().min(2),
  palette: PaletteSchema,
  tokens: TokensSchema,
  library: LibrarySchema,
});

export type GeneratedTheme = {
  signatureMotif: string;
  primaryFont: string;
  secondaryFont: string;
  palette: ThemePalette;
  tokens: ThemeTokens;
  library: ThemeLibrary;
};

export interface GenerateThemeInput {
  sitePrompt: string;
  stylePresetId: string;
  memorySummary: string;
  clarifierAnswers?: string;
}

export async function generateTheme(input: GenerateThemeInput): Promise<GeneratedTheme> {
  const openai = getOpenAI();
  const preset = getStylePreset(input.stylePresetId);

  const userBlock = [
    formatStylePresetForPrompt(preset),
    '',
    `Site brief: ${input.sitePrompt || '(none)'}`,
    `Memory: ${input.memorySummary || '(none)'}`,
    input.clarifierAnswers ? `Clarifier answers:\n${input.clarifierAnswers}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const baseMessages = [
    { role: 'system' as const, content: THEME_SYSTEM },
    { role: 'user' as const, content: userBlock },
  ];

  const runOnce = async (extraSystem?: string) => {
    const messages = extraSystem
      ? [...baseMessages, { role: 'system' as const, content: extraSystem }]
      : baseMessages;
    const res = await withRetry(() =>
      openai.beta.chat.completions.parse({
        model: 'gpt-4o-2024-08-06',
        messages,
        response_format: zodResponseFormat(ThemeGenSchema, 'theme'),
      }),
    );
    const parsed = res.choices[0]?.message.parsed;
    if (!parsed) throw new Error('Theme generation returned no structured output');
    return parsed;
  };

  const themeSurface = (t: { library: ThemeLibrary; signatureMotif: string }) =>
    [
      t.signatureMotif,
      t.library.Header.html,
      t.library.Header.css,
      t.library.Footer.html,
      t.library.Footer.css,
      t.library.Button.html,
      t.library.Button.css,
      t.library.Card.html,
      t.library.Card.css,
    ].join('\n');

  let parsed = await runOnce();
  const first = validateGenerated(themeSurface(parsed));
  if (!first.ok) {
    parsed = await runOnce(buildRetryDirective(first.violations));
    const second = validateGenerated(themeSurface(parsed));
    if (!second.ok) {
      throw new ThemeGenerationFailed(second.violations);
    }
  }
  return parsed as GeneratedTheme;
}

// Produce the :root CSS block that realizes the theme tokens as CSS variables.
// Pages / library references var(--color-*), var(--radius-*), etc. so this is
// the bridge between the Theme row and any rendered HTML.
export function themeToCssVars(theme: {
  palette: ThemePalette;
  tokens: ThemeTokens;
  primaryFont: string;
  secondaryFont: string;
}): string {
  const { palette, tokens, primaryFont, secondaryFont } = theme;
  const spacing = tokens.spacing
    .map((v, i) => `  --space-${i}: ${v}px;`)
    .join('\n');
  const type = tokens.typeScale
    .map((v, i) => `  --type-${i}: ${v}px;`)
    .join('\n');
  return `:root {
  --color-primary: ${palette.primary};
  --color-secondary: ${palette.secondary};
  --color-accent: ${palette.accent};
  --color-surface: ${palette.surface};
  --color-ink: ${palette.ink};
  --color-muted: ${palette.muted};
  --font-display: ${primaryFont};
  --font-body: ${secondaryFont};
  --radius-sm: ${tokens.radius.sm};
  --radius-md: ${tokens.radius.md};
  --radius-lg: ${tokens.radius.lg};
  --radius-pill: ${tokens.radius.pill};
  --shadow-sm: ${tokens.shadow.sm};
  --shadow-md: ${tokens.shadow.md};
  --shadow-lg: ${tokens.shadow.lg};
  --motion-easing: ${tokens.motion.easing};
  --motion-duration: ${tokens.motion.durationMs}ms;
  --grid-max: ${tokens.grid.maxWidth};
  --grid-gutter: ${tokens.grid.gutter};
${spacing}
${type}
}`;
}
