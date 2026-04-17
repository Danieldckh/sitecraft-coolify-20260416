import { anthropic, MODELS } from './anthropic';

/**
 * Architect — produces the top-level JSON plan for a site.
 *
 * Uses the creative (Opus) model because editorial taste, naming, and
 * cohesive palette choices benefit from the strongest model. Output is
 * strict JSON, validated before returning.
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
  sections: { id: string; role: string; brief: string }[];
}

const ARCHITECT_SYSTEM = `You are a senior art director and information architect at a boutique design studio. Given a user's description of a site, you produce a tight JSON plan that another designer will use to build each section.

Your job is to make three editorial decisions that carry the entire site:
  1. A distinctive name (if the user hasn't named it, invent a memorable one).
  2. A palette of five colors — primary, secondary, accent, ink (dark text), and surface (page background). Colors should feel cohesive and intentional, not random. Avoid cliche SaaS blues unless the user explicitly asks.
  3. A typography pair — one display font and one body font, both available on Google Fonts. Lean into contrast (e.g. a serif display + sans body, or a geometric sans display + warm serif body). Avoid the obvious pairings (Inter + Inter, Roboto + Open Sans).

Then break the site into 5-8 sections. Each section must have:
  - id: kebab-case slug, unique within the site (e.g. "hero", "featured-work", "press", "footer").
  - role: a short descriptor (hero | features | about | gallery | testimonials | pricing | faq | cta | contact | footer | manifesto | process | services | team | press).
  - brief: 1-3 sentences telling the designer exactly what this section should do, what real copy to feature, and what layout vibe to aim for. Be specific about content — reference the user's domain, not generic placeholders.

Rules:
  - Favor editorial, magazine-style layouts and distinctive structures. Avoid the generic SaaS template (hero + 3-column features + pricing + CTA).
  - First section is always a hero-like opening; last section is always a footer.
  - Do not propose sections that require user-uploaded assets; images can be sourced from Unsplash.
  - Output ONLY a single JSON object. No prose, no markdown fences, no commentary. Just the JSON.

JSON schema (strict):
{
  "siteName": string,
  "palette": { "primary": "#RRGGBB", "secondary": "#RRGGBB", "accent": "#RRGGBB", "ink": "#RRGGBB", "surface": "#RRGGBB" },
  "typography": { "displayFont": string, "bodyFont": string },
  "sections": [ { "id": string, "role": string, "brief": string }, ... ]  // 5 to 8 entries
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

  const sections = obj.sections;
  if (!Array.isArray(sections) || sections.length < 5 || sections.length > 8) {
    throw new Error(
      `Architect plan "sections" must be an array of 5-8 entries (got ${Array.isArray(sections) ? sections.length : 'non-array'}).`,
    );
  }

  const seenIds = new Set<string>();
  const validatedSections = sections.map((s, i) => {
    if (!s || typeof s !== 'object') {
      throw new Error(`Architect plan section[${i}] is not an object.`);
    }
    const sec = s as Record<string, unknown>;
    if (typeof sec.id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(sec.id)) {
      throw new Error(`Architect plan section[${i}].id is not kebab-case.`);
    }
    if (seenIds.has(sec.id)) {
      throw new Error(`Architect plan section[${i}].id "${sec.id}" is duplicated.`);
    }
    seenIds.add(sec.id);
    if (typeof sec.role !== 'string' || sec.role.trim().length === 0) {
      throw new Error(`Architect plan section[${i}].role missing.`);
    }
    if (typeof sec.brief !== 'string' || sec.brief.trim().length === 0) {
      throw new Error(`Architect plan section[${i}].brief missing.`);
    }
    return { id: sec.id, role: sec.role, brief: sec.brief };
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
    sections: validatedSections,
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
      max_tokens: 2048,
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
