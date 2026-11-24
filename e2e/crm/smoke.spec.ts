import { test, expect } from '@playwright/test';

// Same guard as auth.setup.ts: without the E2E secrets there is no saved session.
test.skip(!process.env.E2E_CRM_EMAIL || !process.env.E2E_CRM_PASSWORD, 'E2E_CRM_* not set');

// A live announcement popup (global_popups) opens as a modal over the page and hides it
// from the accessibility tree, so role queries find nothing. Serve an empty list instead
// of dismissing it: dismissing writes a popup_interactions row for the E2E account.
test.beforeEach(async ({ page }) => {
  await page.route('**/rest/v1/global_popups*', (route) => route.fulfill({ json: [] }));
});

test('dashboard loads after auth', async ({ page }) => {
  await page.goto('/dashboard');

  await expect(page.locator('nav#sidebar')).toBeVisible();
  // Dashboard's primary heading (ClientHealthMonitor h1). The old `.header-title h1`
  // markup was removed when the dashboard was refocused into the health monitor (#161).
  await expect(page.locator('h1')).toBeVisible();
});
