import { test, expect } from '@playwright/test';
import { createSiteViaApi, deleteSiteViaApi } from './helpers';

test.describe('08 keyboard + a11y', () => {
  test('ctrl+1/2/3 switches tabs', async ({ page, request }) => {
    const site = await createSiteViaApi(request);
    try {
      await page.goto(`/sites/${site.id}?tab=build`);
      await page.waitForLoadState('networkidle');
      await page.keyboard.press('Control+2');
      await expect(page).toHaveURL(/tab=preview/, { timeout: 5000 });
      await page.keyboard.press('Control+3');
      await expect(page).toHaveURL(/tab=style/, { timeout: 5000 });
      await page.keyboard.press('Control+1');
      await expect(page).toHaveURL(/tab=build/, { timeout: 5000 });
    } finally {
      await deleteSiteViaApi(request, site.id);
    }
  });

  test('all icon-only buttons have aria-label (sampled)', async ({ page }) => {
    await page.goto('/sites');
    // On sites page, there may be zero or more icon-only buttons depending on state.
    const iconButtons = page.locator('button:has(svg)').filter({ hasNotText: /./ });
    const count = await iconButtons.count();
    for (let i = 0; i < count; i++) {
      const b = iconButtons.nth(i);
      const label = await b.getAttribute('aria-label');
      expect(label, `button #${i} missing aria-label`).toBeTruthy();
    }
  });
});
