import { anthropic, MODELS } from './anthropic';

/**
 * Architect — produces the top-level JSON plan for a multi-page site.
 *
 * Uses the creative (Opus) model because editorial taste, page decomposition,
 * naming, and cohesive palette choices benefit from the strongest model.
 * Output is strict JSON, validated before returning.
 */

export interface SitePlan {
  siteName: string;
  palette: {
    primary: string;
    secondary: string;
    accent: string;
    ink: string;
    surface: string;
  };
  typography: {
    displayFont: string;
    bodyFont: string;
  };
  pages: {
    slug: string; // kebab-case; the landing page MUST be "home"
    name: string; // "Home", "About", "Store", "Contact", ...
    brief: string; // 1-2 sentence page purpose
    sections: {
      id: string; // kebab-case, unique WITHIN the page
      role: string; // hero | features | about | cta | footer | …
      brief: string; // 1-3 sentence section brief
    }[]; // 3-6 sections per page
  }[]; // 3-6 pages total; first one MUST be the Home page (slug "home")
}

const ARCHITECT_SYSTEM = `You are a senior art director laying out a small-but-complete multi-page website from a single user description. You output a strict JSON plan with:
- siteName (2–4 words, memorable)
- palette (5 hex colors: primary, secondary, accent, ink, surface)
- typography (displayFont + bodyFont, real Google Fonts family names, paired with taste)
- pages (array, first MUST have slug "home"): [{slug,name,brief,sections:[{id,role,brief}]}]

Rules:
- 3–6 pages. Pick pages that match the user's description (don't invent generic ones). Every site has Home. Common others: About, Services, Products/Store, Contact, Pricing, Journal/Blog, Case Studies.
- Each page gets 3–6 sections that make sense for THAT page. Home usually opens with hero + marquee-ish features + proof + CTA. About is story-driven. Store is a product grid + category. Contact is a short hero + form-ish visual + footer.
- One of the sections on EVERY page should be a \`role: "header-nav"\` section at the top so every page has a consistent header.
- One of the sections on EVERY page should be a \`role: "footer"\` section at the bottom.
- Favor distinctive, editorial layouts. Avoid SaaS-template vibes.
- Palette must feel cohesive and intentional. Avoid cliche SaaS blues unless the user explicitly asks.
- Typography must lean into contrast (e.g. a serif display + sans body, or a geometric sans display + warm serif body). Avoid obvious pairings (Inter + Inter, Roboto + Open Sans).
- Section \`id\` is kebab-case and unique WITHIN a page (can be "hero" in multiple pages).
- Page \`slug\` is kebab-case; the Home page MUST use slug "home" and MUST be first.
- Section \`brief\` is 1-3 sentences, specific about content — reference the user's domain, not generic placeholders.
- Do not propose sections that require user-uploaded assets; images can be sourced from Unsplash.

Output STRICT JSON only. No prose, no markdown fences.

JSON schema (strict):
{
  "siteName": string,
  "palette": { "primary": "#RRGGBB", "secondary": "#RRGGBB", "accent": "#RRGGBB", "ink": "#RRGGBB", "surface": "#RRGGBB" },
  "typography": { "displayFont": string, "bodyFont": string },
  "pages": [
    {
      "slug": string,
      "name": string,
      "brief": string,
      "sections": [ { "id": string, "role": string, "brief": string }, ... ]
    },
    ...
  ]
}`;

/**
 * Strip any markdown code fences or preamble/postamble from a model response
 * and return the raw JSON text candidate.
 */
function extractJsonCandidate(raw: string): string {
  let text = raw.trim();

  // Strip ```json ... ``` or ``` ... ``` fences if present.
  const fenceMatch = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenceMatch && fenceMatch[1]) {
    text = fenceMatch[1].trim();
  }

  // If there's leading/trailing prose, try to carve out the outermost JSON object.
  if (!text.startsWith('{')) {
    const first = text.indexOf('{');
    const last = text.lastIndexOf('}');
    if (first !== -1 && last !== -1 && last > first) {
      text = text.slice(first, last + 1);
    }
  }

  return text;
}

function isHexColor(v: unknown): v is string {
  return typeof v === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(v.trim());
}

function isKebabCase(v: unknown): v is string {
  return typeof v === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v);
}

// Fallback palette + typography so a malformed plan still produces a usable site.
const FALLBACK_PALETTE = {
  primary: '#17171a',
  secondary: '#3a3a3f',
  accent: '#c55a2a',
  ink: '#17171a',
  surface: '#faf8f4',
};
const FALLBACK_TYPOGRAPHY = { displayFont: 'Fraunces', bodyFont: 'Inter' };

function coerceString(v: unknown, fallback: string): string {
  if (typeof v === 'string') {
    const t = v.trim();
    if (t.length > 0) return t;
  }
  return fallback;
}

function slugify(v: unknown, fallback: string): string {
  const s = (typeof v === 'string' ? v : '').toLowerCase().trim();
  const kebab = s
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return kebab.length > 0 ? kebab : fallback;
}

function dedupeSlug(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let i = 2; i < 100; i += 1) {
    const candidate = `${base}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-${Math.random().toString(36).slice(2, 6)}`;
}

function humanize(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function normalizeSection(raw: unknown, idx: number, taken: Set<string>): SitePlan['pages'][number]['sections'][number] {
  const sec = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const id = dedupeSlug(slugify(sec.id, `section-${idx + 1}`), taken);
  taken.add(id);
  const role = coerceString(sec.role, 'custom');
  const brief = coerceString(sec.brief, `A ${role} section.`);
  return { id, role, brief };
}

function normalizePage(raw: unknown, idx: number, takenPageSlugs: Set<string>): SitePlan['pages'][number] {
  const page = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const slug = dedupeSlug(slugify(page.slug, `page-${idx + 1}`), takenPageSlugs);
  takenPageSlugs.add(slug);
  const name = coerceString(page.name, humanize(slug));
  const brief = coerceString(page.brief, `Main content for the ${name} page.`);

  const rawSections = Array.isArray(page.sections) ? (page.sections as unknown[]) : [];
  const trimmedSections = rawSections.length > 12 ? rawSections.slice(0, 12) : rawSections;

  const sectionIds = new Set<string>();
  let sections = trimmedSections.map((s, j) => normalizeSection(s, j, sectionIds));

  if (sections.length === 0) {
    sections = [
      { id: 'hero', role: 'hero', brief: `A welcoming hero for the ${name} page.` },
      { id: 'footer', role: 'footer', brief: 'Simple footer.' },
    ];
  }

  return { slug, name, brief, sections };
}

/**
 * Normalize any JSON blob from the Architect into a valid SitePlan.
 *
 * Philosophy: NEVER throw for recoverable weirdness. Missing/malformed fields
 * are backfilled from sensible defaults so the build keeps moving. The only
 * hard guarantees:
 *   - at least one page
 *   - each page has at least one section
 *   - first page slug === "home"
 */
function validatePlan(parsed: unknown): SitePlan {
  const obj = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>;

  const siteName = coerceString(obj.siteName, 'Untitled Site');

  const rawPalette = (obj.palette && typeof obj.palette === 'object' ? obj.palette : {}) as Record<string, unknown>;
  const palette = {
    primary: isHexColor(rawPalette.primary) ? (rawPalette.primary as string).trim() : FALLBACK_PALETTE.primary,
    secondary: isHexColor(rawPalette.secondary) ? (rawPalette.secondary as string).trim() : FALLBACK_PALETTE.secondary,
    accent: isHexColor(rawPalette.accent) ? (rawPalette.accent as string).trim() : FALLBACK_PALETTE.accent,
    ink: isHexColor(rawPalette.ink) ? (rawPalette.ink as string).trim() : FALLBACK_PALETTE.ink,
    surface: isHexColor(rawPalette.surface) ? (rawPalette.surface as string).trim() : FALLBACK_PALETTE.surface,
  };

  const rawTypo = (obj.typography && typeof obj.typography === 'object' ? obj.typography : {}) as Record<string, unknown>;
  const typography = {
    displayFont: coerceString(rawTypo.displayFont, FALLBACK_TYPOGRAPHY.displayFont),
    bodyFont: coerceString(rawTypo.bodyFont, FALLBACK_TYPOGRAPHY.bodyFont),
  };

  const rawPagesInput = Array.isArray(obj.pages) ? (obj.pages as unknown[]) : [];
  const rawPages = rawPagesInput.length > 8 ? rawPagesInput.slice(0, 8) : rawPagesInput;

  const takenSlugs = new Set<string>();
  const validatedPages = rawPages.map((pg, i) => normalizePage(pg, i, takenSlugs));

  if (validatedPages.length === 0) {
    validatedPages.push({
      slug: 'home',
      name: 'Home',
      brief: 'Main landing page.',
      sections: [
        { id: 'hero', role: 'hero', brief: 'A welcoming hero introducing the site.' },
        { id: 'footer', role: 'footer', brief: 'Simple footer with contact info.' },
      ],
    });
  }

  if (validatedPages[0].slug !== 'home') {
    const existingHomeIdx = validatedPages.findIndex((p) => p.slug === 'home');
    if (existingHomeIdx > 0) {
      const [home] = validatedPages.splice(existingHomeIdx, 1);
      validatedPages.unshift(home);
    } else {
      validatedPages[0] = { ...validatedPages[0], slug: 'home' };
    }
  }

  return { siteName, palette, typography, pages: validatedPages };
}

export async function planSite(userPrompt: string): Promise<SitePlan> {
  if (typeof userPrompt !== 'string' || userPrompt.trim().length === 0) {
    throw new Error('planSite: userPrompt must be a non-empty string.');
  }

  let rawText: string;
  try {
    const response = await anthropic.messages.create({
      model: MODELS.creative,
      max_tokens: 4096,
      system: ARCHITECT_SYSTEM,
      messages: [
        {
          role: 'user',
          content: `User brief:\n${userPrompt.trim()}\n\nReturn ONLY the JSON plan.`,
        },
      ],
    });

    const firstBlock = response.content.find((b) => b.type === 'text');
    if (!firstBlock || firstBlock.type !== 'text') {
      throw new Error('Architect response contained no text block.');
    }
    rawText = firstBlock.text;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Guard against ever echoing secrets that might end up in error messages.
    const safe = message.replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]');
    throw new Error(`Architect call failed: ${safe}`);
  }

  const candidate = extractJsonCandidate(rawText);
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch (err) {
    const preview = candidate.slice(0, 200);
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Architect returned invalid JSON (${message}). First 200 chars: ${preview}`,
    );
  }

  return validatePlan(parsed);
}
