import { planSite, type SitePlan } from './architect';
import { designSection } from './designer';

/**
 * Orchestrator — runs the Architect once, then each Designer sequentially,
 * yielding events as it goes. Pure generator: no DB writes, no SSE formatting.
 *
 * The caller (the API route) is responsible for persistence and SSE framing.
 */

export type BuildEvent =
  | { type: 'plan'; plan: SitePlan }
  | { type: 'section'; id: string; html: string }
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

  const priorHtml: string[] = [];
  for (const section of plan.sections) {
    let html: string;
    try {
      html = await designSection({
        plan,
        section,
        priorSectionsHtml: priorHtml,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      yield { type: 'error', message };
      return;
    }

    priorHtml.push(html);
    yield { type: 'section', id: section.id, html };
  }

  yield { type: 'done' };
}
