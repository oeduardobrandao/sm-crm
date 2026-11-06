import { test, expect, type Page } from '@playwright/test';

// Configurações and Central de Ajuda on phones (iOS plan F5, crm-phone project at 390px):
// the ported screens render the phone header, never the desktop `.header` or the tab
// strip, and the Settings list replaces the perfil redirect. Read-only: it only navigates.
// Horizontal overflow for these routes is covered by phone-overflow.phone.spec.ts.
test.skip(!process.env.E2E_CRM_EMAIL || !process.env.E2E_CRM_PASSWORD, 'E2E_CRM_* not set');

// A live announcement popup (global_popups) opens as a modal over the page and hides it
// from the accessibility tree, so role queries find nothing. Serve an empty list instead
// of dismissing it: dismissing writes a popup_interactions row for the E2E account.
test.beforeEach(async ({ page }) => {
  await page.route('**/rest/v1/global_popups*', (route) => route.fulfill({ json: [] }));
});

const PORTED_ROUTES = [
  '/configuracao',
  '/configuracao/perfil',
  '/configuracao/notificacoes',
  '/configuracao/workspace',
  '/configuracao/membros',
  '/configuracao/papeis',
  '/configuracao/relatorios',
  '/configuracao/status',
  '/configuracao/hub',
  '/configuracao/armazenamento',
  '/configuracao/mcp',
  '/configuracao/cobranca',
  '/ajuda',
];

async function settle(page: Page) {
  await expect(page.locator('#mobile-nav')).toBeVisible({ timeout: 15_000 });
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
  await page.waitForTimeout(300);
}

test('/configuracao is the Settings list on phones', async ({ page }) => {
  await page.goto('/configuracao');
  await settle(page);
  await expect(page).toHaveURL(/\/configuracao$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Configurações' })).toBeVisible();
  await expect(page.getByRole('link', { name: /^Perfil:/ })).toBeVisible();
});

for (const route of PORTED_ROUTES) {
  test(`phone header, no desktop chrome: ${route}`, async ({ page }) => {
    await page.goto(route);
    await settle(page);
    // An owner-only tab bounces other roles to perfil; either way the screen is ported.
    await expect(page.locator('.phone-large-title, .phone-nav-bar').first()).toBeVisible();
    await expect(page.locator('.main-content .header')).toHaveCount(0);
    await expect(page.locator('.config-nav')).toHaveCount(0);
  });
}
