import { test, expect } from '@playwright/test';

test('dashboard loads after auth', async ({ page }) => {
  await page.goto('/dashboard');

  await expect(page.locator('nav#sidebar')).toBeVisible();
  await expect(page.locator('.header-title h1')).toBeVisible();
});
