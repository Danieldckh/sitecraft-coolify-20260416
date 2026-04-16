import { test, expect } from '@playwright/test';
import { createSiteViaApi, deleteSiteViaApi } from './helpers';

test.describe('04 pages + generate', () => {
  test('generate page end-to-end via API', async ({ request }) => {
    test.setTimeout(240_000);
    const site = await createSiteViaApi(request);
    try {
      const themeRes = await request.post(`/api/sites/${site.id}/theme/generate`, {
        timeout: 90_000,
      });
      expect(themeRes.ok()).toBeTruthy();

      const pageRes = await request.post('/api/pages', {
        data: {
          siteId: site.id,
          name: 'Home',
          slug: 'home',
          pagePrompt:
            'Welcoming hero with seasonal pastries and a short story about our sourdough starter.',
        },
      });
      expect(pageRes.ok()).toBeTruthy();
      const createdPage = await pageRes.json();

      const genRes = await request.post(`/api/pages/${createdPage.id}/generate`, {
        timeout: 180_000,
      });
      expect(genRes.status()).toBeLessThan(500);
      // drain body
      await genRes.text();

      await expect
        .poll(
          async () => {
            const r = await request.get(`/api/pages/${createdPage.id}`);
            if (!r.ok()) return 0;
            const p = await r.json();
            const body = p.page ?? p;
            return (body.pageHtml ?? '').length;
          },
          { timeout: 30_000, intervals: [2000] },
        )
        .toBeGreaterThan(200);
    } finally {
      await deleteSiteViaApi(request, site.id);
    }
  });
});
