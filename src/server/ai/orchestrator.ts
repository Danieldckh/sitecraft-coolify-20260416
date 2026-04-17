import { planSite, type SitePlan } from './architect';
import { designSection } from './designer';

/**
 * Orchestrator — runs the Architect once, then each Designer sequentially,
 * page by page, section by section, yielding events as it goes. Pure
 * generator: no DB writes, no SSE formatting.
 *
 * Sequential order is REQUIRED (not just a convenience): each Designer is
 * given the prior sections of the SAME page as cohesion context, and pages
 * are also run in order (home first) to keep the build deterministic. No
 * parallel fan-out — the spec's design rationale explicitly calls for
 * sequential cohesion.
 *
 * The caller (the API route) is responsible for persistence and SSE framing.
 */

export type BuildEvent =
  | { type: 'plan'; plan: SitePlan }
  | { type: 'section'; pageSlug: string; id: string; html: string }
  | { type: 'done' }
  | { type: 'error'; message: string };

export async function* buildSite(userPrompt: string): AsyncGenerator<BuildEvent> {
  let plan: SitePlan;
  try {
    plan = await planSite(userPrompt);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    yield { type: 'error', message };
    return;
  }

  yield { type: 'plan', plan };

  // Nav list is the same for every section on every page: all pages in plan order.
  const nav = plan.pages.map((p) => ({ slug: p.slug, name: p.name }));

  for (const page of plan.pages) {
    const priorHtml: string[] = [];
    for (const section of page.sections) {
      let html: string;
      try {
        html = await designSection({
          plan,
          page,
          section,
          priorSectionsHtml: priorHtml,
          nav,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        yield { type: 'error', message };
        return;
      }

      priorHtml.push(html);
      yield { type: 'section', pageSlug: page.slug, id: section.id, html };
    }
  }

  yield { type: 'done' };
}
