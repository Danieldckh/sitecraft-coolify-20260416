import { test, expect } from '@playwright/test';

test.describe('01 landing', () => {
  test('root redirects to /sites', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/sites(\?|$)/);
  });

  test('sites page renders with New site button', async ({ page }) => {
    await page.goto('/sites');
    await expect(page.getByRole('button', { name: /new site/i })).toBeVisible();
  });

  test('no console errors on landing', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
    });
    await page.goto('/sites');
    await page.waitForLoadState('networkidle');
    expect(errors, errors.join('\n')).toEqual([]);
  });
});
