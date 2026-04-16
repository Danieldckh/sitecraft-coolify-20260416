import { Page, expect } from '@playwright/test';

export const uniqueName = (prefix = 'E2E') =>
  `${prefix} ${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

export async function gotoSitesList(page: Page) {
  await page.goto('/sites');
  await expect(page).toHaveURL(/\/sites(\?|$)/);
}

/** Create site via API (fast path for tests that don't exercise the dialog). */
export async function createSiteViaApi(
  request: import('@playwright/test').APIRequestContext,
  opts: { name?: string; sitePrompt?: string; stylePresetId?: string } = {},
) {
  const body = {
    name: opts.name ?? uniqueName('E2E'),
    sitePrompt:
      opts.sitePrompt ??
      'A small independent bakery in Portland focused on wild-yeast sourdough and seasonal pastries.',
    stylePresetId: opts.stylePresetId ?? 'editorial-serif',
  };
  const res = await request.post('/api/sites', { data: body });
  expect(res.ok()).toBeTruthy();
  const site = await res.json();
  return site as { id: string; name: string; sitePrompt: string; stylePresetId: string };
}

export async function deleteSiteViaApi(
  request: import('@playwright/test').APIRequestContext,
  id: string,
) {
  await request.delete(`/api/sites/${id}`).catch(() => void 0);
}

/** Wait for an SSE-style endpoint to finish; returns the last JSON chunk if any. */
export async function postAndDrainSSE(
  request: import('@playwright/test').APIRequestContext,
  url: string,
  body?: unknown,
  timeoutMs = 120_000,
) {
  const start = Date.now();
  const res = await request.post(url, {
    data: body ?? {},
    timeout: timeoutMs,
  });
  // We just need the body to be read to completion; API may or may not be SSE.
  const text = await res.text();
  return { status: res.status(), text, ms: Date.now() - start };
}
