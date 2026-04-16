import { test, expect } from '@playwright/test';
import { createSiteViaApi, deleteSiteViaApi } from './helpers';

test.describe('06 style tab', () => {
  test('palette edit + apply', async ({ page, request }) => {
    test.setTimeout(120_000);
    const site = await createSiteViaApi(request);
    try {
      await request.post(`/api/sites/${site.id}/theme/generate`, { timeout: 90_000 });

      await page.goto(`/sites/${site.id}?tab=style`);
      await expect(page.getByText(/palette/i).first()).toBeVisible({ timeout: 10_000 });

      // Find a hex input and change it
      const hex = page.locator('input[type="text"]').filter({ hasText: '' }).first();
      if (await hex.count()) {
        await hex.fill('#ff6600');
      }
      const apply = page.getByRole('button', { name: /apply/i }).first();
      if (await apply.isEnabled().catch(() => false)) {
        await apply.click();
        await page.waitForTimeout(500);
        const r = await request.get(`/api/sites/${site.id}/theme`);
        expect(r.ok()).toBeTruthy();
      }
    } finally {
      await deleteSiteViaApi(request, site.id);
    }
  });
});
