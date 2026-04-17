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

/**
 * A (pageSlug, sectionId) pair identifying a section that's already been
 * persisted to the DB and therefore must NOT be re-designed on resume.
 */
export interface CompletedSectionKey {
  pageSlug: string;
  sectionId: string;
}

/**
 * Resume an interrupted build from the next unfinished section.
 *
 * Unlike `buildSite`, this does NOT call the Architect — the saved `plan` is
 * authoritative. It yields a `plan` event first (so a reconnecting client can
 * re-populate its UI state), then iterates `plan.pages` and `page.sections`
 * in their original order, skipping any `(pageSlug, sectionId)` pair listed
 * in `completed`.
 *
 * `priorSectionsByPage` must contain the HTML (in order) of every section
 * already persisted on each page so the Designer receives proper cohesion
 * context when it fills in the gaps. As new sections complete during the
 * resume run they are pushed onto the appropriate array so later sections on
 * the same page see them.
 */
export async function* buildSiteResume(input: {
  plan: SitePlan;
  priorSectionsByPage: Record<string, string[]>;
  completed: CompletedSectionKey[];
}): AsyncGenerator<BuildEvent> {
  const { plan, priorSectionsByPage, completed } = input;

  // Fast lookup for "is this section already done?" without O(n*m) scans.
  const completedSet = new Set<string>(
    completed.map((c) => `${c.pageSlug}::${c.sectionId}`),
  );

  yield { type: 'plan', plan };

  // Mirror buildSite's nav shape so Designer prompts are identical.
  const nav = plan.pages.map((p) => ({ slug: p.slug, name: p.name }));

  for (const page of plan.pages) {
    // Start cohesion context from whatever the caller already has for this
    // page. Copy the array so we never mutate the caller's input.
    const priorHtml: string[] = [...(priorSectionsByPage[page.slug] ?? [])];

    for (const section of page.sections) {
      if (completedSet.has(`${page.slug}::${section.id}`)) {
        // Already persisted — skip the Designer call AND the section event.
        // The client either already has this section from its prior stream
        // or will re-fetch the preview. Either way we must not re-emit it.
        continue;
      }

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
