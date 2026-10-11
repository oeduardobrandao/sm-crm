import { test, expect, type Page } from '@playwright/test';

// Phone smoke (crm-phone project, 390px wide): every in-shell route renders without
// horizontal overflow. The phase F rule "no `.header` on phones" is added per route as
// each lane ports its screens.
//
// Runs against whatever CRM_BASE_URL points at with the E2E account: read-only, it only
// navigates. Skipped without the E2E secrets, like the rest of the CRM suite.
test.skip(!process.env.E2E_CRM_EMAIL || !process.env.E2E_CRM_PASSWORD, 'E2E_CRM_* not set');

/**
 * Static routes inside AppLayout (apps/crm/src/App.tsx). Parameterised ones
 * (/clientes/:id/*, /equipe/:id, /analytics/:id, /relatorios/:id, /relatorios/modelos/:id,
 * /mensagens/:clienteId, /ajuda/:slug, /ajuda/secao/:category, /ajuda/video/:slug) need
 * ids from the account's data: `/clientes/:id` tabs are reached below from the first
 * client in the list; the rest are left to the lanes that port them.
 */
const STATIC_ROUTES = [
  '/dashboard',
  '/clientes',
  '/financeiro',
  '/contratos',
  '/leads',
  '/equipe',
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
  '/calendario',
  '/entregas',
  '/tarefas',
  '/post-express',
  '/arquivos',
  '/analytics',
  '/relatorios/modelos/padrao',
  '/analytics-fluxos',
  '/ideias',
  '/mensagens',
  '/automacoes',
  '/importar',
  '/ajuda',
];

/**
 * Routes whose phone layout has landed (phase F): they render a PhonePageHeader, so the
 * desktop `.header` must not show. Each lane adds its routes here.
 */
const PORTED_ROUTES = new Set(['/clientes', '/leads']);

const CLIENTE_TABS = [
  'visao-geral',
  'entregas',
  'redes-sociais',
  'relatorios',
  'hub/acesso',
  'hub/briefing',
  'hub/marca',
  'hub/paginas',
  'hub/ideias',
  'arquivos',
  'financeiro',
];

async function settle(page: Page) {
  // The shell is up once the phone tab bar renders; then give lazy pages and their
  // first queries a moment. networkidle can hang on polling/realtime, so it is capped.
  await expect(page.locator('#mobile-nav')).toBeVisible({ timeout: 15_000 });
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
  await page.waitForTimeout(300);
}

async function expectNoHorizontalOverflow(page: Page, route: string) {
  const { scrollWidth, clientWidth, offenders } = await page.evaluate(() => {
    const root = document.documentElement;
    const width = root.clientWidth;
    // Names a few elements sticking out past the viewport, to make a failure actionable.
    const offenders = Array.from(document.querySelectorAll<HTMLElement>('body *'))
      .filter((el) => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.right > width + 1;
      })
      .slice(0, 5)
      .map((el) => {
        const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/)[0] : '';
        return `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''}`;
      });
    return { scrollWidth: root.scrollWidth, clientWidth: width, offenders };
  });
  expect(
    scrollWidth,
    `${route}: page is ${scrollWidth}px wide in a ${clientWidth}px viewport (${offenders.join(', ')})`,
  ).toBeLessThanOrEqual(clientWidth + 1);
}

for (const route of STATIC_ROUTES) {
  test(`no horizontal overflow at 390px: ${route}`, async ({ page }) => {
    await page.goto(route);
    await settle(page);
    await expectNoHorizontalOverflow(page, route);
    if (PORTED_ROUTES.has(route)) {
      await expect(
        page.locator('.main-content .header'),
        `${route}: .header on a phone`,
      ).toHaveCount(0);
    }
  });
}

test('no horizontal overflow at 390px: /clientes/:id tabs', async ({ page }) => {
  await page.goto('/clientes');
  await settle(page);
  const href = await page
    .locator('a[href^="/clientes/"]')
    .first()
    .getAttribute('href', { timeout: 5_000 })
    .catch(() => null);
  const id = href?.match(/^\/clientes\/(\d+)/)?.[1];
  test.skip(!id, 'the E2E account has no client to open');

  for (const tab of CLIENTE_TABS) {
    const route = `/clientes/${id}/${tab}`;
    await page.goto(route);
    await settle(page);
    await expectNoHorizontalOverflow(page, route);
  }
});
