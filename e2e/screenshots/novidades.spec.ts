import { test, expect, type Page } from '@playwright/test';
import { installSafetyNet, assertNoViolations } from './safety';
import { shoot } from './capture';

// Captures for the /novidades changelog entries of the 2026-08-08 release.
// Output goes to e2e/.shots/novidades/; each PNG is reviewed by hand before
// being committed as public/novidades/pr-<n>.png (see scripts/changelog/runbook.md).
const SLUG = 'novidades';

/** Wait out the .animate-up fadeInUp so shots aren't captured mid-fade. */
async function waitForFadeIn(page: Page): Promise<void> {
  const target = page.locator('.animate-up').last();
  await target.waitFor();
  await expect
    .poll(async () => target.evaluate((el) => getComputedStyle(el).opacity))
    .toBe('1');
}

test('pr-307: configuração — guia de agentes de IA (MCP)', async ({ page }) => {
  const violations = await installSafetyNet(page);
  await page.goto('/configuracao/mcp');
  await page.getByText('Agentes (MCP)').first().waitFor();
  await waitForFadeIn(page);
  await shoot(page, SLUG, 307, 'configuracao-agentes-ia');
  assertNoViolations(violations);
});

test('pr-299: entregas — seleção de etapas no wizard de fluxo', async ({ page }) => {
  const violations = await installSafetyNet(page);
  await page.goto('/entregas');
  await page.getByRole('heading', { name: 'Entregas', exact: true }).waitFor();
  await page.locator('.board-card').first().waitFor();
  await page.getByRole('button', { name: 'Novo Fluxo', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  await shoot(page, SLUG, 299, 'entregas-wizard-etapas');
  await page.keyboard.press('Escape');
  assertNoViolations(violations);
});

test('pr-308: cliente — conexão do Instagram por link', async ({ page }) => {
  const violations = await installSafetyNet(page);
  await page.goto('/clientes');
  await page.getByText('Studio Bem-Estar').first().click();
  await page.waitForURL(/\/clientes\/\d+/);
  await page.getByRole('heading', { name: 'Studio Bem-Estar' }).first().waitFor();
  await page.waitForLoadState('networkidle');
  // ConnectLinkRow renders one of these two labels depending on link state.
  const row = page.getByText(/Gerar link para o cliente|Link de conexão do Instagram/).first();
  await row.waitFor();
  await row.scrollIntoViewIfNeeded();
  await shoot(page, SLUG, 308, 'cliente-conexao-instagram');
  assertNoViolations(violations);
});

test('pr-311: importar — wizard de importação', async ({ page }) => {
  const violations = await installSafetyNet(page);
  await page.goto('/importar');
  // ImportarPage renders no .animate-up wrapper; settle on its heading + network.
  await page.getByRole('heading', { name: /importar/i }).first().waitFor();
  await page.waitForLoadState('networkidle');
  await shoot(page, SLUG, 311, 'importar-wizard');
  assertNoViolations(violations);
});
