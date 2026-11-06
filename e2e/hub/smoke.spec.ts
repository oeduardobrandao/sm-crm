import { test, expect } from '@playwright/test';

test('hub shell loads with token', async ({ page }) => {
  const hubPath = process.env.E2E_HUB_PATH;
  if (!hubPath) {
    test.skip();
    return;
  }

  await page.goto(hubPath);

  // The shell's <main> drops .hub-noise under the "pauta" look (feature_hub_pauta),
  // so assert on the shell itself, not on the classic look's texture class.
  await expect(page.locator('.hub-root > main')).toBeVisible({ timeout: 15_000 });
});
