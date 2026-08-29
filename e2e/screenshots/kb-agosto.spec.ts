import { test } from '@playwright/test';
import { installSafetyNet, assertNoViolations } from './safety';
import { shoot } from './capture';

// Read-only captures for the August/2026 KB batch (PR #411): billing/usage
// panels, the e-mail notification preferences tab and the Datas Comemorativas
// calendar tab. Every page here is a plain read -- no fixture, no draft, no
// write of any kind (the niche selector only touches localStorage).

test.describe.configure({ mode: 'serial' });

test('uso do plano e cobrança', async ({ page }) => {
  const violations = await installSafetyNet(page);

  await page.goto('/configuracao/cobranca');
  await page.getByText('Plano atual').first().waitFor();
  await shoot(page, 'assinatura-anual-em-12x', 1, 'aba-do-plano');

  const usage = page.getByRole('heading', { name: 'Uso do plano' });
  await usage.waitFor();
  // The panel loads its meters async; anchor on a meter label unique to the
  // panel so the shot never catches the loading state.
  await page.getByText('Chaves MCP').waitFor({ timeout: 15_000 });
  await usage.scrollIntoViewIfNeeded();
  await shoot(page, 'entendendo-o-uso-do-plano', 1, 'painel-uso-do-plano');

  assertNoViolations(violations);
});

test('notificações por e-mail', async ({ page }) => {
  const violations = await installSafetyNet(page);

  await page.goto('/configuracao/notificacoes');
  await page.getByText('Notificações por e-mail').first().waitFor();
  // Anchor on a concrete pref row so toggles have rendered (not a spinner).
  await page.getByText('Falha ao publicar').waitFor({ timeout: 15_000 });
  await shoot(page, 'notificacoes-por-email', 1, 'aba-notificacoes');

  assertNoViolations(violations);
});

test('datas comemorativas', async ({ page }) => {
  const violations = await installSafetyNet(page);

  await page.goto('/calendario');
  const tab = page.getByText('Datas Comemorativas', { exact: true });
  await tab.waitFor();
  await tab.click();
  // Default niche is Médico; wait for the niche selector to confirm the tab
  // content mounted before shooting.
  await page.getByText('Médico', { exact: true }).first().waitFor({ timeout: 15_000 });
  await shoot(page, 'usando-o-calendario-para-financas-prazos-e-datas-importantes', 1, 'datas-comemorativas');

  assertNoViolations(violations);
});
