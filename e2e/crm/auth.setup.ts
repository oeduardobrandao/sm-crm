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

  await page.locator('#login-email').fill(process.env.E2E_CRM_EMAIL!);
  await page.locator('#login-password').fill(process.env.E2E_CRM_PASSWORD!);
  await page.locator('button.auth-submit').click();

  await page.waitForURL('/dashboard', { timeout: 15_000 });
  await expect(page.locator('nav#sidebar')).toBeVisible();

  await page.context().storageState({ path: authFile });
});
