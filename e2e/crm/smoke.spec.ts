import { test, expect } from '@playwright/test';

test('dashboard loads after auth', async ({ page }) => {
  await page.goto('/dashboard');

  await expect(page.locator('nav#sidebar')).toBeVisible();
  // Dashboard's primary heading (ClientHealthMonitor h1). The old `.header-title h1`
  // markup was removed when the dashboard was refocused into the health monitor (#161).
  await expect(page.locator('h1')).toBeVisible();
});
