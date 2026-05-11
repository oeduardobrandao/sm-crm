import dotenv from 'dotenv';
import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env.e2e.local') });

const CRM_BASE_URL = process.env.CRM_BASE_URL || 'http://localhost:5173';
const HUB_BASE_URL = process.env.HUB_BASE_URL || 'http://localhost:5175';

const authFile = path.join(__dirname, 'e2e', '.auth', 'crm-user.json');

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',

  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'crm-auth',
      testDir: './e2e/crm',
      testMatch: /auth\.setup\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: CRM_BASE_URL,
      },
    },
    {
      name: 'crm',
      testDir: './e2e/crm',
      testIgnore: /auth\.setup\.ts/,
      dependencies: ['crm-auth'],
      use: {
        ...devices['Desktop Chrome'],
        baseURL: CRM_BASE_URL,
        storageState: authFile,
      },
    },
    {
      name: 'hub',
      testDir: './e2e/hub',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: HUB_BASE_URL,
      },
    },
  ],

  webServer: [
    ...(!process.env.CRM_BASE_URL
      ? [
          {
            command: process.env.CRM_DEV_COMMAND || 'npm run dev',
            url: 'http://localhost:5173',
            reuseExistingServer: !process.env.CI,
          },
        ]
      : []),
    ...(!process.env.HUB_BASE_URL
      ? [
          {
            command: process.env.HUB_DEV_COMMAND || 'npx vite --config apps/hub/vite.config.ts --port 5175 --strictPort',
            url: 'http://localhost:5175',
            reuseExistingServer: !process.env.CI,
          },
        ]
      : []),
  ],
});
