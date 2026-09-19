import { test as setup, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const authDir = path.join(__dirname, '..', '.auth');
const authFile = path.join(authDir, 'crm-user.json');

setup('authenticate crm user', async ({ page }) => {
  mkdirSync(authDir, { recursive: true });

  // Denied on purpose: the saved storage state is reused by every crm and
  // screenshots spec, so this one write keeps the cookie banner out of their
  // frames and keeps PostHog/Crisp from loading. Without it the banner shows
  // for an undecided visitor (the storage state otherwise has no `consent_v1`).
  await page.addInitScript(() => {
    localStorage.setItem(
      'consent_v1',
      JSON.stringify({ analytics: false, support: false, decidedAt: '2026-09-19T00:00:00.000Z' }),
    );
  });

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
