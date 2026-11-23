import { test, expect } from '@playwright/test';

// Phase F rule for the routes lane F2c ported (Ideias, Arquivos, Importar): at 390px the
// page shows the kit's large-title header and none of the desktop `.header`.
//
// Read-only (it only navigates), against CRM_BASE_URL with the E2E account. Kept in its
// own file so each lane's routes don't collide in phone-overflow.phone.spec.ts. Skipped
// without the E2E secrets, like the rest of the CRM suite.
test.skip(!process.env.E2E_CRM_EMAIL || !process.env.E2E_CRM_PASSWORD, 'E2E_CRM_* not set');

// A live announcement popup (global_popups) opens as a modal over the page and hides it
// from the accessibility tree, so role queries find nothing. Serve an empty list instead
// of dismissing it: dismissing writes a popup_interactions row for the E2E account.
test.beforeEach(async ({ page }) => {
  await page.route('**/rest/v1/global_popups*', (route) => route.fulfill({ json: [] }));
});

const ROUTES: [string, string][] = [
  ['/ideias', 'Ideias'],
  ['/arquivos', 'Arquivos'],
  ['/importar', 'Importar dados'],
];

for (const [route, title] of ROUTES) {
  test(`kit header, no desktop .header at 390px: ${route}`, async ({ page }) => {
    await page.goto(route);
    await expect(page.locator('#mobile-nav')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator('.phone-page-header')).toHaveCount(1);
    await expect(page.locator('.main-content .header')).toHaveCount(0);
  });
}
