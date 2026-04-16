// Shared types across server/client.

export type GenerationStatus = 'idle' | 'queued' | 'generating' | 'ready' | 'error';

// v2 section roles — used by the element taxonomy / variant picker.
export type SectionRole =
  | 'header-nav'
  | 'hero'
  | 'features'
  | 'cta'
  | 'testimonials'
  | 'gallery'
  | 'pricing'
  | 'faq'
  | 'contact'
  | 'about-story'
  | 'services-grid'
  | 'footer-big'
  | 'custom';

export const SECTION_ROLES: SectionRole[] = [
  'header-nav',
  'hero',
  'features',
  'cta',
  'testimonials',
  'gallery',
  'pricing',
  'faq',
  'contact',
  'about-story',
  'services-grid',
  'footer-big',
  'custom',
];

export interface SiteDTO {
  id: string;
  name: string;
  sitePrompt: string;
  stylePresetId: string | null;
  domain: string | null;
  locked: boolean;
  memorySummary: string;
  createdAt: string;
  updatedAt: string;
}

export interface PageDTO {
  id: string;
  siteId: string;
  name: string;
  slug: string;
  pagePrompt: string;
  pageHtml: string;
  pageCss: string;
  pageJs: string;
  locked: boolean;
  orderIdx: number;
  navVisible: boolean;
  lastGeneratedAt: string | null;
}

export interface ElementDTO {
  id: string;
  pageId: string;
  selectorId: string;
  role: SectionRole;
  variantId: string;
  prompt: string;
  html: string;
  css: string;
  locked: boolean;
  lastEditedAt: string | null;
}

export interface ThemePalette {
  primary: string;
  secondary: string;
  accent: string;
  surface: string;
  ink: string;
  muted: string;
}

export interface ThemeTokens {
  radius: { sm: string; md: string; lg: string; pill: string };
  shadow: { sm: string; md: string; lg: string };
  spacing: number[];
  typeScale: number[];
  motion: { easing: string; durationMs: number; style: 'subtle' | 'editorial' | 'playful' | 'kinetic' };
  grid: { maxWidth: string; gutter: string; columns: number };
}

export interface ThemeLibrary {
  Header: { html: string; css: string };
  Footer: { html: string; css: string };
  Button: { html: string; css: string };
  Card: { html: string; css: string };
}

export interface ThemeDTO {
  id: string;
  siteId: string;
  stylePresetId: string;
  tokens: ThemeTokens;
  signatureMotif: string;
  library: ThemeLibrary;
  primaryFont: string;
  secondaryFont: string;
  palette: ThemePalette;
  lastGeneratedAt: string | null;
}

export interface AssetDTO {
  id: string;
  siteId: string;
  kind: 'logo' | 'image' | 'favicon' | 'font';
  url: string;
  mime: string;
  sizeBytes: number;
  meta: Record<string, unknown>;
  createdAt: string;
}

export type ConversationScope = 'site' | 'page' | 'element';

export interface QuestionDTO {
  id: string;
  conversationId: string;
  kind: 'text' | 'choice' | 'upload' | 'boolean';
  question: string;
  choices: string[] | null;
  response: string | null;
  responseAssetId: string | null;
  orderIdx: number;
}

export interface ConversationDTO {
  id: string;
  siteId: string;
  scope: ConversationScope;
  targetId: string;
  questions: QuestionDTO[];
}

export interface ChangeLogDTO {
  id: string;
  siteId: string;
  scope: 'site' | 'theme' | 'page' | 'element' | 'section';
  targetId: string;
  actor: string;
  summary: string;
  diffJson: string;
  createdAt: string;
}

export interface DeploymentDTO {
  id: string;
  siteId: string;
  coolifyAppUuid: string | null;
  deploymentUuid: string | null;
  url: string | null;
  status: 'pending' | 'building' | 'deploying' | 'success' | 'failed';
  logs: string;
  createdAt: string;
  updatedAt: string;
}

