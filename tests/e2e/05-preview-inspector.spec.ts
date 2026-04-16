import { test, expect } from '@playwright/test';
import { createSiteViaApi, deleteSiteViaApi } from './helpers';

test.describe('05 preview + inspector', () => {
  test('preview renders iframe; standalone route 200', async ({ page, request }) => {
    test.setTimeout(240_000);
    const site = await createSiteViaApi(request);
    try {
      // Theme
      const t = await request.post(`/api/sites/${site.id}/theme/generate`, { timeout: 90_000 });
      expect(t.ok()).toBeTruthy();
      // Page
      const p = await request.post('/api/pages', {
        data: { siteId: site.id, name: 'Home', slug: 'home', pagePrompt: 'A warm landing with one hero, three specialties and a visit-us block.' },
      });
      expect(p.ok()).toBeTruthy();
      const pg = await p.json();
      // Generate page via API
      const gen = await request.post(`/api/pages/${pg.id}/generate`, { timeout: 150_000 });
      expect(gen.status()).toBeLessThan(500);

      await page.goto(`/sites/${site.id}?tab=preview`);
      const iframe = page.locator('iframe[title*="Preview"]');
      await expect(iframe).toBeVisible({ timeout: 15_000 });

      // Standalone route
      const standalone = await request.get(`/preview/${site.id}/home`);
      expect(standalone.status()).toBe(200);
      const html = await standalone.text();
      expect(html).toContain('iframe');
    } finally {
      await deleteSiteViaApi(request, site.id);
    }
  });
});
