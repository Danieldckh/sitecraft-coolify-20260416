import { test, expect } from '@playwright/test';
import { createSiteViaApi, deleteSiteViaApi } from './helpers';

test.describe('07 rate limit', () => {
  test('theme generate endpoint returns 429 under burst', async ({ request }) => {
    const site = await createSiteViaApi(request);
    try {
      const results: number[] = [];
      // Fire 40 in quick succession
      await Promise.all(
        Array.from({ length: 40 }, async () => {
          const r = await request.post(`/api/sites/${site.id}/theme/generate`, { timeout: 5000 }).catch(() => null);
          if (r) results.push(r.status());
        }),
      );
      expect(results.some((s) => s === 429)).toBeTruthy();
    } finally {
      await deleteSiteViaApi(request, site.id);
    }
  });
});
