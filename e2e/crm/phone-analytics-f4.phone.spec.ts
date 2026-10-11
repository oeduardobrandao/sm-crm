import { test, expect, type Page } from '@playwright/test';

// Phase F lane F4 (analytics, reports, Post express, automations) at 390px: the ported
// screens render the phone header instead of the desktop `.header`, and the account
// page (/analytics/:id, parameterised, so not in phone-overflow's static list) has no
// horizontal overflow. Its own file so the per-lane checks don't collide in
// phone-overflow.phone.spec.ts.
//
// Read-only: it only navigates. Skipped without the E2E secrets.
test.skip(!process.env.E2E_CRM_EMAIL || !process.env.E2E_CRM_PASSWORD, 'E2E_CRM_* not set');

const ROUTES = [
  '/analytics',
  '/analytics-fluxos',
  '/post-express',
  '/automacoes',
  '/relatorios/modelos/padrao',
];

async function settle(page: Page) {
  await expect(page.locator('#mobile-nav')).toBeVisible({ timeout: 15_000 });
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
  await page.waitForTimeout(300);
}

for (const route of ROUTES) {
  test(`phone header instead of .header at 390px: ${route}`, async ({ page }) => {
    await page.goto(route);
    await settle(page);
    await expect(page.locator('h1').first()).toBeVisible();
    await expect(page.locator('.header')).toHaveCount(0);
  });
}

test('account analytics at 390px: nav bar, no .header, no horizontal overflow', async ({
  page,
}) => {
  await page.goto('/analytics');
  await settle(page);
  const href = await page
    .locator('a[href^="/analytics/"]')
    .first()
    .getAttribute('href', { timeout: 5_000 })
    .catch(() => null);
  test.skip(!href, 'the E2E account has no connected Instagram account');

  await page.goto(href!);
  await settle(page);
  await expect(page.locator('h1').first()).toBeVisible();
  await expect(page.locator('.header')).toHaveCount(0);
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
});
