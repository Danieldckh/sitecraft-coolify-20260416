import { test, expect } from '@playwright/test';
import { uniqueName } from './helpers';

test.describe('02 create site dialog', () => {
  test('full two-step create flow', async ({ page }) => {
    await page.goto('/sites');
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: /new site/i }).click();

    const name = uniqueName('Dialog');
    const prompt =
      'A cozy neighborhood coffee shop with pour-overs, rotating pastries, and a mid-century aesthetic.';

    await page.getByLabel('Site name').fill(name);
    await page.getByLabel('What is the site about?').fill(prompt);

    await page.getByRole('button', { name: 'Continue' }).click();

    await expect(page.getByRole('radio').first()).toBeVisible({ timeout: 15_000 });
    await page.getByRole('radio').first().click();

    const [response] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().endsWith('/api/sites') && r.request().method() === 'POST',
      ),
      page.getByRole('button', { name: 'Create site' }).click(),
    ]);
    expect(response.ok()).toBeTruthy();

    await expect(page).toHaveURL(/\/sites\/[^/]+\?tab=build/, { timeout: 15_000 });
  });

  test('validation: too-short prompt keeps user on step 1', async ({ page }) => {
    await page.goto('/sites');
    await page.getByRole('button', { name: /new site/i }).click();
    await page.getByLabel('Site name').fill('x');
    await page.getByLabel('What is the site about?').fill('short');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByText(/pick a style preset/i)).toBeHidden({ timeout: 2000 });
  });
});
