import { test as setup, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const authDir = path.join(__dirname, '..', '.auth');
const authFile = path.join(authDir, 'crm-user.json');

setup('authenticate crm user', async ({ page }) => {
  mkdirSync(authDir, { recursive: true });

  await page.goto('/login');

  const loginForm = page.locator('form.auth-form');
  await loginForm.locator('#login-email').fill(process.env.E2E_CRM_EMAIL!);
  await loginForm.locator('#login-password').fill(process.env.E2E_CRM_PASSWORD!);
  await loginForm.locator('button[type="submit"]').click();

  await page.waitForURL(/\/dashboard/, { timeout: 15_000 });
  await expect(page).not.toHaveURL(/workspace-setup/);
  await expect(page.locator('nav#sidebar')).toBeVisible();

  await page.context().storageState({ path: authFile });
});
