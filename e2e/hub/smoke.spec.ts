import { test, expect } from '@playwright/test';

test('hub shell loads with token', async ({ page }) => {
  const hubPath = process.env.E2E_HUB_PATH;
  if (!hubPath) {
    test.skip();
    return;
  }

  await page.goto(hubPath);

  await expect(page.locator('main.hub-noise')).toBeVisible({ timeout: 15_000 });
});
