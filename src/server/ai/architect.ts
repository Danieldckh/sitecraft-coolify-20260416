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

function validatePlan(parsed: unknown): SitePlan {
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Architect returned non-object JSON.');
  }
  const obj = parsed as Record<string, unknown>;

  const siteName = obj.siteName;
  if (typeof siteName !== 'string' || siteName.trim().length === 0) {
    throw new Error('Architect plan missing valid "siteName".');
  }

  const palette = obj.palette;
  if (!palette || typeof palette !== 'object') {
    throw new Error('Architect plan missing "palette" object.');
  }
  const p = palette as Record<string, unknown>;
  for (const key of ['primary', 'secondary', 'accent', 'ink', 'surface'] as const) {
    if (!isHexColor(p[key])) {
      throw new Error(`Architect plan palette.${key} is not a hex color.`);
    }
  }

  const typography = obj.typography;
  if (!typography || typeof typography !== 'object') {
    throw new Error('Architect plan missing "typography" object.');
  }
  const t = typography as Record<string, unknown>;
  if (typeof t.displayFont !== 'string' || t.displayFont.trim().length === 0) {
    throw new Error('Architect plan typography.displayFont missing.');
  }
  if (typeof t.bodyFont !== 'string' || t.bodyFont.trim().length === 0) {
    throw new Error('Architect plan typography.bodyFont missing.');
  }

  const pages = obj.pages;
  if (!Array.isArray(pages) || pages.length < 1) {
    throw new Error(
      `Architect plan "pages" must be a non-empty array (got ${Array.isArray(pages) ? pages.length : 'non-array'}).`,
    );
  }
  if (pages.length > 6) {
    throw new Error(
      `Architect plan "pages" must be 3–6 entries (got ${pages.length}).`,
    );
  }

  const seenSlugs = new Set<string>();
  const validatedPages = pages.map((pg, i) => {
    if (!pg || typeof pg !== 'object') {
      throw new Error(`Architect plan pages[${i}] is not an object.`);
    }
    const page = pg as Record<string, unknown>;

    if (!isKebabCase(page.slug)) {
      throw new Error(`Architect plan pages[${i}].slug is not kebab-case.`);
    }
    if (seenSlugs.has(page.slug)) {
      throw new Error(`Architect plan pages[${i}].slug "${page.slug}" is duplicated.`);
    }
    seenSlugs.add(page.slug);

    if (i === 0 && page.slug !== 'home') {
      throw new Error(
        `Architect plan must have pages[0].slug === "home" (got "${page.slug}").`,
      );
    }

    if (typeof page.name !== 'string' || page.name.trim().length === 0) {
      throw new Error(`Architect plan pages[${i}].name missing.`);
    }
    if (typeof page.brief !== 'string' || page.brief.trim().length === 0) {
      throw new Error(`Architect plan pages[${i}].brief missing.`);
    }

    const sections = page.sections;
    if (!Array.isArray(sections) || sections.length < 1) {
      throw new Error(
        `Architect plan pages[${i}].sections must be a non-empty array.`,
      );
    }
    if (sections.length > 8) {
      throw new Error(
        `Architect plan pages[${i}].sections has ${sections.length} entries (max ~6).`,
      );
    }

    const seenSectionIds = new Set<string>();
    const validatedSections = sections.map((s, j) => {
      if (!s || typeof s !== 'object') {
        throw new Error(`Architect plan pages[${i}].sections[${j}] is not an object.`);
      }
      const sec = s as Record<string, unknown>;
      if (!isKebabCase(sec.id)) {
        throw new Error(
          `Architect plan pages[${i}].sections[${j}].id is not kebab-case.`,
        );
      }
      if (seenSectionIds.has(sec.id)) {
        throw new Error(
          `Architect plan pages[${i}].sections[${j}].id "${sec.id}" is duplicated within page "${page.slug}".`,
        );
      }
      seenSectionIds.add(sec.id);
      if (typeof sec.role !== 'string' || sec.role.trim().length === 0) {
        throw new Error(
          `Architect plan pages[${i}].sections[${j}].role missing.`,
        );
      }
      if (typeof sec.brief !== 'string' || sec.brief.trim().length === 0) {
        throw new Error(
          `Architect plan pages[${i}].sections[${j}].brief missing.`,
        );
      }
      return { id: sec.id, role: sec.role, brief: sec.brief };
    });

    return {
      slug: page.slug,
      name: (page.name as string).trim(),
      brief: (page.brief as string).trim(),
      sections: validatedSections,
    };
  });

  return {
    siteName: siteName.trim(),
    palette: {
      primary: (p.primary as string).trim(),
      secondary: (p.secondary as string).trim(),
      accent: (p.accent as string).trim(),
      ink: (p.ink as string).trim(),
      surface: (p.surface as string).trim(),
    },
    typography: {
      displayFont: (t.displayFont as string).trim(),
      bodyFont: (t.bodyFont as string).trim(),
    },
    pages: validatedPages,
  };
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
