import { test, expect } from '@playwright/test';

// Phase F rule for the routes lane F2c ported (Ideias, Arquivos, Importar): at 390px the
// page shows the kit's large-title header and none of the desktop `.header`.
//
// Read-only (it only navigates), against CRM_BASE_URL with the E2E account. Kept in its
// own file so each lane's routes don't collide in phone-overflow.phone.spec.ts. Skipped
// without the E2E secrets, like the rest of the CRM suite.
test.skip(!process.env.E2E_CRM_EMAIL || !process.env.E2E_CRM_PASSWORD, 'E2E_CRM_* not set');

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
