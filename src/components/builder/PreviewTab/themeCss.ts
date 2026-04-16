// Client-safe duplicate of `themeToCssVars` from `src/server/ai/themeGen.ts`.
// The server module imports OpenAI helpers, so we cannot reach it from a
// client component. Keep the two in sync when either changes.

import type { ThemePalette, ThemeTokens } from '@/types/models';

export function themeToCssVars(theme: {
  palette: ThemePalette;
  tokens: ThemeTokens;
  primaryFont: string;
  secondaryFont: string;
}): string {
  const { palette, tokens, primaryFont, secondaryFont } = theme;
  const spacing = tokens.spacing.map((v, i) => `  --space-${i}: ${v}px;`).join('\n');
  const type = tokens.typeScale.map((v, i) => `  --type-${i}: ${v}px;`).join('\n');
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
