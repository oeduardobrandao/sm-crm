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
    // Screenshot captures run against a PRODUCTION workspace (see e2e/screenshots/safety.ts).
    // This project is opt-in ONLY: it must not exist in the `projects` array unless
    // CAPTURE_SCREENSHOTS is explicitly set, because a bare `playwright test` (which is
    // what `npm run test:e2e` runs) executes every project with no --project flag given.
    // testDir scoping alone does NOT stop that -- do not "clean this up" into an
    // unconditional entry, or captures become reachable from CI / any bare invocation.
    ...(process.env.CAPTURE_SCREENSHOTS
      ? [
          {
            name: 'screenshots',
            testDir: './e2e/screenshots',
            // Collect only .spec.ts Playwright tests; __tests__/ holds Vitest units (.test.ts) that would collide with expect
            testMatch: /\.spec\.ts$/,
            dependencies: ['crm-auth'],
            use: {
              ...devices['Desktop Chrome'],
              baseURL: CRM_BASE_URL,
              storageState: authFile,
              viewport: { width: 1440, height: 900 },
              deviceScaleFactor: 2,
              colorScheme: 'light' as const,
            },
          },
        ]
      : []),
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
