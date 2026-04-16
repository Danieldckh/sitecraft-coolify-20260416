import { test, expect } from '@playwright/test';
import { createSiteViaApi, deleteSiteViaApi } from './helpers';

test.describe('03 theme generation', () => {
  test('generate theme via UI button', async ({ page, request }) => {
    test.setTimeout(120_000);
    const site = await createSiteViaApi(request);
    try {
      await page.goto(`/sites/${site.id}?tab=build`);
      const generate = page.getByRole('button', { name: /generate theme/i });
      await expect(generate).toBeVisible({ timeout: 15_000 });

      const [response] = await Promise.all([
        page.waitForResponse(
          (r) =>
            r.url().includes(`/api/sites/${site.id}/theme/generate`) &&
            r.request().method() === 'POST',
          { timeout: 90_000 },
        ),
        generate.click(),
      ]);
      expect(response.ok()).toBeTruthy();

      // Poll GET /theme until it returns a theme (API returns {theme:{...}} envelope)
      await expect
        .poll(
          async () => {
            const r = await request.get(`/api/sites/${site.id}/theme`);
            if (!r.ok()) return null;
            const body = await r.json();
            return body?.theme?.palette?.primary ?? null;
          },
          { timeout: 30_000, intervals: [1000] },
        )
        .toMatch(/^#[0-9a-f]{3,8}$/i);
    } finally {
      await deleteSiteViaApi(request, site.id);
    }
  });
});
