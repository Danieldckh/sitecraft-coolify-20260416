import { planSite, type SitePlan } from './architect';
import { designSection } from './designer';

/**
 * Orchestrator — runs the Architect once, then fans out all Designer calls for
 * a page in parallel, yielding sections in completion order (whichever model
 * response lands first wins). Pages still run strictly one-after-another so
 * yields stay organized page-by-page and concurrency is bounded to a single
 * page's fan-out.
 *
 * Each Designer call is wrapped in an exponential-backoff retry. If a section
 * still fails after all attempts, the orchestrator substitutes a tasteful
 * placeholder <section> (so the build completes) rather than failing the run.
 * Only an Architect failure (or a programming error outside Designer calls)
 * yields `{ type: 'error' }`.
 *
 * The caller (the API route) is responsible for persistence and SSE framing.
 */

export type BuildEvent =
  | { type: 'plan'; plan: SitePlan }
  | { type: 'section'; pageSlug: string; id: string; html: string }
  | { type: 'done' }
  | { type: 'error'; message: string };

type PageSection = SitePlan['pages'][number]['sections'][number];
type PlanPage = SitePlan['pages'][number];
type NavEntry = { slug: string; name: string };

interface DesignSectionInput {
  plan: SitePlan;
  page: PlanPage;
  section: PageSection;
  nav: NavEntry[];
}

/**
 * Designer retry wrapper — exponential backoff (500ms, 1000ms, 2000ms) between
 * attempts, up to `maxAttempts` total attempts. Re-throws the last error if
 * every attempt fails; the caller is expected to catch and substitute a
 * placeholder rather than fail the whole build.
 */
async function designSectionWithRetry(
  input: DesignSectionInput,
  maxAttempts = 3,
): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await designSection({
        plan: input.plan,
        page: input.page,
        section: input.section,
        // Parallel execution means there are no deterministic "prior" sections —
        // cohesion context is intentionally dropped in favor of speed.
        priorSectionsHtml: [],
        nav: input.nav,
      });
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts) {
        const backoffMs = 500 * Math.pow(2, attempt - 1); // 500, 1000, 2000
        await new Promise((r) => setTimeout(r, backoffMs));
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Designer failed');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Fallback section HTML — styled placeholder so the preview still renders
 * meaningfully when a Designer call exhausts its retries. The user can
 * re-prompt this section later from the inspector.
 */
function placeholderSectionHtml(
  section: { id: string; role: string },
  err: unknown,
): string {
  // `err` intentionally unused in the user-visible output (no token/secret
  // leaks); it's surfaced only via the console.error in the caller.
  void err;
  const safeId = escapeHtml(section.id);
  const safeRole = escapeHtml(section.role);
  return `<section class="${safeId}" data-el-id="${safeId}" style="padding:4rem 2rem;text-align:center;font-family:system-ui,sans-serif;color:#6b6b72;border-top:1px solid #e7e5df;border-bottom:1px solid #e7e5df;">
  <p style="font-size:13px;letter-spacing:0.08em;text-transform:uppercase;margin:0 0 .5rem;">${safeRole}</p>
  <p style="font-size:15px;margin:0;">This section couldn't generate. You can re-prompt it from the inspector.</p>
</section>`;
}

/**
 * Yield values from an array of promises in completion order — whichever
 * settles first is yielded first, regardless of its index. All promises must
 * be non-rejecting (callers wrap with `.catch(...)` before passing in).
 */
async function* yieldAsCompleted<T>(
  promises: Promise<T>[],
): AsyncGenerator<T> {
  // Wrap each pending promise so it resolves to `{ index, value }`; using the
  // index lets us splice the settled entry out of the pending list without
  // relying on reference equality of the original promise.
  type Indexed = { index: number; value: T };
  const pending: Array<Promise<Indexed> | null> = promises.map((p, index) =>
    p.then((value) => ({ index, value })),
  );
  let remaining = pending.length;

  while (remaining > 0) {
    // Promise.race only needs the still-pending entries.
    const live: Promise<Indexed>[] = [];
    for (const entry of pending) {
      if (entry !== null) live.push(entry);
    }
    const settled = await Promise.race(live);
    pending[settled.index] = null;
    remaining -= 1;
    yield settled.value;
  }
}

interface SectionResult {
  section: PageSection;
  html: string;
}

/**
 * Fan out every section in `sections` as a parallel Designer call, returning
 * an array of promises that always resolve (never reject) — failures become
 * a placeholder-substituted `SectionResult`.
 */
function fanOutSections(
  plan: SitePlan,
  page: PlanPage,
  sections: PageSection[],
  nav: NavEntry[],
): Promise<SectionResult>[] {
  return sections.map((section) =>
    designSectionWithRetry({ plan, page, section, nav })
      .then((html): SectionResult => ({ section, html }))
      .catch((err: unknown): SectionResult => {
        // eslint-disable-next-line no-console
        console.error(
          `[orchestrator] Designer failed for page "${page.slug}" section "${section.id}" after retries; substituting placeholder.`,
          err instanceof Error ? err.message : String(err),
        );
        return {
          section,
          html: placeholderSectionHtml(section, err),
        };
      }),
  );
}

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
  const nav: NavEntry[] = plan.pages.map((p) => ({ slug: p.slug, name: p.name }));

  // Fan out EVERY section on EVERY page at once. For a typical 4-page × 5-section
  // plan that's ~20 parallel Designer calls — well within Anthropic's concurrency
  // limits on a paid plan, and dramatically faster than per-page sequencing.
  try {
    const all: Array<Promise<{ section: PageSection; html: string; pageSlug: string }>> = [];
    for (const page of plan.pages) {
      for (const promise of fanOutSections(plan, page, page.sections, nav)) {
        all.push(promise.then((r) => ({ ...r, pageSlug: page.slug })));
      }
    }
    for await (const settled of yieldAsCompleted(all)) {
      yield {
        type: 'section',
        pageSlug: settled.pageSlug,
        id: settled.section.id,
        html: settled.html,
      };
    }
  } catch (err) {
    // Defensive: individual Designer failures are caught inside fanOutSections,
    // so reaching here means a programming error (e.g. in yieldAsCompleted).
    const message = err instanceof Error ? err.message : String(err);
    yield { type: 'error', message };
    return;
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
 * re-populate its UI state), then iterates `plan.pages` in order, fanning out
 * every not-yet-completed section of each page in parallel.
 *
 * `priorSectionsByPage` is accepted for API compatibility but is no longer
 * used — parallel execution means there are no deterministic prior sections
 * to pass to the Designer as cohesion context.
 */
export async function* buildSiteResume(input: {
  plan: SitePlan;
  priorSectionsByPage: Record<string, string[]>;
  completed: CompletedSectionKey[];
}): AsyncGenerator<BuildEvent> {
  const { plan, completed } = input;

  // Fast lookup for "is this section already done?" without O(n*m) scans.
  const completedSet = new Set<string>(
    completed.map((c) => `${c.pageSlug}::${c.sectionId}`),
  );

  yield { type: 'plan', plan };

  // Mirror buildSite's nav shape so Designer prompts are identical.
  const nav: NavEntry[] = plan.pages.map((p) => ({ slug: p.slug, name: p.name }));

  // Fan out every remaining section across every page in one big batch.
  try {
    const all: Array<Promise<{ section: PageSection; html: string; pageSlug: string }>> = [];
    for (const page of plan.pages) {
      const pending = page.sections.filter(
        (section) => !completedSet.has(`${page.slug}::${section.id}`),
      );
      if (pending.length === 0) continue;
      for (const promise of fanOutSections(plan, page, pending, nav)) {
        all.push(promise.then((r) => ({ ...r, pageSlug: page.slug })));
      }
    }
    for await (const settled of yieldAsCompleted(all)) {
      yield {
        type: 'section',
        pageSlug: settled.pageSlug,
        id: settled.section.id,
        html: settled.html,
      };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    yield { type: 'error', message };
    return;
  }

  yield { type: 'done' };
}
