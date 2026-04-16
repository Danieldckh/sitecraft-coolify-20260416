import type {
  Site,
  Page,
  Element,
  Theme,
  Asset,
  Conversation,
  Question,
  ChangeLogEntry,
  Deployment,
  MemoryEntry,
} from '@prisma/client';
import type {
  SiteDTO,
  PageDTO,
  ElementDTO,
  ThemeDTO,
  ThemeTokens,
  ThemeLibrary,
  ThemePalette,
  AssetDTO,
  ConversationDTO,
  QuestionDTO,
  ConversationScope,
  ChangeLogDTO,
  DeploymentDTO,
  SectionRole,
} from '@/types/models';

export function toSiteDTO(s: Site): SiteDTO {
  return {
    id: s.id,
    name: s.name,
    sitePrompt: s.sitePrompt,
    stylePresetId: s.stylePresetId,
    domain: s.domain,
    locked: s.locked,
    memorySummary: s.memorySummary,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

export function toPageDTO(p: Page): PageDTO {
  return {
    id: p.id,
    siteId: p.siteId,
    name: p.name,
    slug: p.slug,
    pagePrompt: p.pagePrompt,
    pageHtml: p.pageHtml,
    pageCss: p.pageCss,
    pageJs: p.pageJs,
    locked: p.locked,
    orderIdx: p.orderIdx,
    navVisible: p.navVisible,
    lastGeneratedAt: p.lastGeneratedAt?.toISOString() ?? null,
  };
}

export function toElementDTO(e: Element): ElementDTO {
  return {
    id: e.id,
    pageId: e.pageId,
    selectorId: e.selectorId,
    role: e.role as SectionRole,
    variantId: e.variantId,
    prompt: e.prompt,
    html: e.html,
    css: e.css,
    locked: e.locked,
    lastEditedAt: e.lastEditedAt?.toISOString() ?? null,
  };
}

function safeParse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

const EMPTY_TOKENS: ThemeTokens = {
  radius: { sm: '4px', md: '8px', lg: '16px', pill: '999px' },
  shadow: { sm: 'none', md: 'none', lg: 'none' },
  spacing: [0, 4, 8, 12, 16, 24, 32, 48, 64, 96],
  typeScale: [12, 14, 16, 18, 22, 28, 36, 48, 64, 80],
  motion: { easing: 'ease', durationMs: 200, style: 'subtle' },
  grid: { maxWidth: '1200px', gutter: '24px', columns: 12 },
};

const EMPTY_LIB: ThemeLibrary = {
  Header: { html: '', css: '' },
  Footer: { html: '', css: '' },
  Button: { html: '', css: '' },
  Card: { html: '', css: '' },
};

const EMPTY_PALETTE: ThemePalette = {
  primary: '#111',
  secondary: '#666',
  accent: '#f33',
  surface: '#fff',
  ink: '#111',
  muted: '#999',
};

export function toThemeDTO(t: Theme): ThemeDTO {
  return {
    id: t.id,
    siteId: t.siteId,
    stylePresetId: t.stylePresetId,
    tokens: safeParse<ThemeTokens>(t.tokensJson, EMPTY_TOKENS),
    signatureMotif: t.signatureMotif,
    library: safeParse<ThemeLibrary>(t.libraryJson, EMPTY_LIB),
    primaryFont: t.primaryFont,
    secondaryFont: t.secondaryFont,
    palette: safeParse<ThemePalette>(t.paletteJson, EMPTY_PALETTE),
    lastGeneratedAt: t.lastGeneratedAt?.toISOString() ?? null,
  };
}

export function toAssetDTO(a: Asset): AssetDTO {
  return {
    id: a.id,
    siteId: a.siteId,
    kind: a.kind as AssetDTO['kind'],
    url: a.url,
    mime: a.mime,
    sizeBytes: a.sizeBytes,
    meta: safeParse<Record<string, unknown>>(a.meta, {}),
    createdAt: a.createdAt.toISOString(),
  };
}

export function toQuestionDTO(q: Question): QuestionDTO {
  return {
    id: q.id,
    conversationId: q.conversationId,
    kind: q.kind as QuestionDTO['kind'],
    question: q.question,
    choices: q.choicesJson ? safeParse<string[]>(q.choicesJson, []) : null,
    response: q.response,
    responseAssetId: q.responseAssetId,
    orderIdx: q.orderIdx,
  };
}

export function toConversationDTO(
  c: Conversation & { questions: Question[] },
): ConversationDTO {
  return {
    id: c.id,
    siteId: c.siteId,
    scope: c.scope as ConversationScope,
    targetId: c.targetId,
    questions: [...c.questions]
      .sort((a, b) => a.orderIdx - b.orderIdx)
      .map(toQuestionDTO),
  };
}

export function toChangeLogDTO(c: ChangeLogEntry): ChangeLogDTO {
  return {
    id: c.id,
    siteId: c.siteId,
    scope: c.scope as ChangeLogDTO['scope'],
    targetId: c.targetId,
    actor: c.actor,
    summary: c.summary,
    diffJson: c.diffJson,
    createdAt: c.createdAt.toISOString(),
  };
}

export function toDeploymentDTO(d: Deployment): DeploymentDTO {
  return {
    id: d.id,
    siteId: d.siteId,
    coolifyAppUuid: d.coolifyAppUuid,
    deploymentUuid: d.deploymentUuid,
    url: d.url,
    status: d.status as DeploymentDTO['status'],
    logs: d.logs,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

export function toMemoryEntry(m: MemoryEntry) {
  return {
    id: m.id,
    siteId: m.siteId,
    role: m.role,
    kind: m.kind,
    content: m.content,
    createdAt: m.createdAt.toISOString(),
  };
}

