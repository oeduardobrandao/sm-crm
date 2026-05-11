# Playwright E2E Testing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Playwright e2e testing infrastructure for both CRM and Hub apps with auth handling, smoke tests, and CI integration.

**Architecture:** Root-level Playwright config with three projects (crm-auth setup, crm, hub). CRM auth uses a setup project that logs in through the real `/login` page and saves browser state. Hub tests navigate directly to a token-based URL. Web servers auto-start locally, but can be pointed at staging via env vars.

**Tech Stack:** Playwright Test, dotenv, Chromium

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `playwright.config.ts` | Three projects, webServer array, dotenv loading |
| Create | `e2e/crm/auth.setup.ts` | Setup project: login flow, save storage state |
| Create | `e2e/crm/smoke.spec.ts` | CRM smoke test: assert dashboard loads |
| Create | `e2e/hub/smoke.spec.ts` | Hub smoke test: assert Hub shell renders |
| Modify | `package.json` | Add npm scripts for e2e |
| Modify | `.gitignore` | Add e2e artifacts |
| Modify | `.github/workflows/ci.yml` | Add e2e job |

---

### Task 1: Install dependencies

**Files:**
- Modify: `package.json` (devDependencies + scripts)
- Modified by npm: `package-lock.json`

- [ ] **Step 1: Install @playwright/test and dotenv**

```bash
npm install -D @playwright/test dotenv
```

- [ ] **Step 2: Install Chromium browser**

```bash
npx playwright install chromium
```

- [ ] **Step 3: Add e2e npm scripts to root package.json**

In `package.json`, add these three scripts to the `"scripts"` object (after the existing `"test:coverage"` line):

```json
"test:e2e": "playwright test",
"test:e2e:crm": "playwright test --project=crm",
"test:e2e:hub": "playwright test --project=hub",
```

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: install playwright and dotenv dev dependencies"
```

---

### Task 2: Update .gitignore

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Add e2e artifacts to .gitignore**

Append these lines to the end of `.gitignore`:

```gitignore
# Playwright E2E
e2e/.auth/
test-results/
playwright-report/
```

- [ ] **Step 2: Commit**

```bash
git add .gitignore
git commit -m "chore: gitignore playwright artifacts"
```

---

### Task 3: Create playwright.config.ts

**Files:**
- Create: `playwright.config.ts`

- [ ] **Step 1: Create the Playwright config at the repo root**

Create `playwright.config.ts` with this content:

```ts
import 'dotenv/config';
import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

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
            command: 'npm run dev',
            url: 'http://localhost:5173',
            reuseExistingServer: !process.env.CI,
          },
        ]
      : []),
    ...(!process.env.HUB_BASE_URL
      ? [
          {
            command: 'npx vite --config apps/hub/vite.config.ts --port 5175 --strictPort',
            url: 'http://localhost:5175',
            reuseExistingServer: !process.env.CI,
          },
        ]
      : []),
  ],
});
```

- [ ] **Step 2: Verify config loads without errors**

```bash
npx playwright test --list
```

Expected: lists 0 tests (no test files yet), no config parse errors.

- [ ] **Step 3: Commit**

```bash
git add playwright.config.ts
git commit -m "feat: add playwright config with crm, hub, and auth projects"
```

---

### Task 4: Create CRM auth setup project

**Files:**
- Create: `e2e/crm/auth.setup.ts`

- [ ] **Step 1: Create the auth setup file**

Create `e2e/crm/auth.setup.ts`:

```ts
import { test as setup, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

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
```

**Key selectors used (from `apps/crm/src/pages/login/LoginPage.tsx`):**
- `#login-email` — email input (line 114)
- `#login-password` — password input (line 125)
- `button.auth-submit` — submit button (line 135)
- `nav#sidebar` — sidebar nav confirms dashboard loaded (`apps/crm/src/components/layout/Sidebar.tsx:112-114`)

- [ ] **Step 2: Create a `.env.e2e.local` template file for reference**

Create `.env.e2e.local.example` (this IS committed — it's the template):

```env
# Copy to .env.e2e.local and fill in real values
# .env.e2e.local is gitignored via the .env.*.local pattern

E2E_CRM_EMAIL=
E2E_CRM_PASSWORD=
E2E_HUB_PATH=
# CRM_BASE_URL=http://localhost:5173
# HUB_BASE_URL=http://localhost:5175
```

- [ ] **Step 3: Commit**

```bash
git add e2e/crm/auth.setup.ts .env.e2e.local.example
git commit -m "feat: add crm auth setup project with env template"
```

---

### Task 5: Create CRM smoke test

**Files:**
- Create: `e2e/crm/smoke.spec.ts`

- [ ] **Step 1: Create the CRM smoke test**

Create `e2e/crm/smoke.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test('dashboard loads after auth', async ({ page }) => {
  await page.goto('/dashboard');

  await expect(page.locator('nav#sidebar')).toBeVisible();
  await expect(page.locator('.header-title h1')).toBeVisible();
});
```

**Selectors used:**
- `nav#sidebar` — sidebar nav (`apps/crm/src/components/layout/Sidebar.tsx:112`)
- `.header-title h1` — dashboard heading (`apps/crm/src/pages/dashboard/DashboardPage.tsx:184-185`)

- [ ] **Step 2: Verify the test is listed**

```bash
npx playwright test --list --project=crm
```

Expected: lists `smoke.spec.ts > dashboard loads after auth`.

- [ ] **Step 3: Commit**

```bash
git add e2e/crm/smoke.spec.ts
git commit -m "feat: add crm dashboard smoke test"
```

---

### Task 6: Create Hub smoke test

**Files:**
- Create: `e2e/hub/smoke.spec.ts`

- [ ] **Step 1: Create the Hub smoke test**

Create `e2e/hub/smoke.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test('hub shell loads with token', async ({ page }) => {
  const hubPath = process.env.E2E_HUB_PATH;
  if (!hubPath) {
    test.skip();
    return;
  }

  await page.goto(hubPath);

  await expect(page.locator('div.hub-root')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('main.hub-noise')).toBeVisible();
});
```

**Selectors used (from `apps/hub/src/shell/HubShell.tsx`):**
- `div.hub-root` — root wrapper (line ~61)
- `main.hub-noise` — main content area (line ~66)

- [ ] **Step 2: Verify the test is listed**

```bash
npx playwright test --list --project=hub
```

Expected: lists `smoke.spec.ts > hub shell loads with token`.

- [ ] **Step 3: Commit**

```bash
git add e2e/hub/smoke.spec.ts
git commit -m "feat: add hub shell smoke test"
```

---

### Task 7: Add CI job for e2e tests

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Add the e2e job to ci.yml**

Add a new job `e2e` after the existing `typecheck-and-test` job. The new job goes at the same indentation level as `typecheck-and-test`:

```yaml
  e2e:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - run: npm ci

      - name: Install Playwright browsers
        run: npx playwright install --with-deps chromium

      - name: Run e2e tests
        run: npm run test:e2e
        env:
          E2E_CRM_EMAIL: ${{ secrets.E2E_CRM_EMAIL }}
          E2E_CRM_PASSWORD: ${{ secrets.E2E_CRM_PASSWORD }}
          E2E_HUB_PATH: ${{ secrets.E2E_HUB_PATH }}
          CRM_BASE_URL: ${{ secrets.CRM_BASE_URL }}
          HUB_BASE_URL: ${{ secrets.HUB_BASE_URL }}

      - name: Upload Playwright report
        uses: actions/upload-artifact@v4
        if: ${{ !cancelled() }}
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 14
```

- [ ] **Step 2: Verify the YAML is valid**

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))" && echo "YAML valid"
```

Expected: `YAML valid`

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add playwright e2e test job"
```

---

### Task 8: Verify everything works end-to-end

- [ ] **Step 1: Create your `.env.e2e.local` with real credentials**

```bash
cp .env.e2e.local.example .env.e2e.local
```

Then edit `.env.e2e.local` with valid test user credentials and Hub token path.

- [ ] **Step 2: Run just the CRM e2e tests**

```bash
npm run test:e2e:crm
```

Expected: `crm-auth` setup runs first (logs in), then `crm` smoke test passes (dashboard loads).

- [ ] **Step 3: Run just the Hub e2e tests**

```bash
npm run test:e2e:hub
```

Expected: Hub smoke test passes (hub shell renders), or skips if `E2E_HUB_PATH` is not set.

- [ ] **Step 4: Run all e2e tests**

```bash
npm run test:e2e
```

Expected: all projects run, all tests pass.

- [ ] **Step 5: Verify Hub doesn't trigger CRM auth**

```bash
npm run test:e2e:hub 2>&1 | grep -c "authenticate crm user"
```

Expected: `0` (the crm-auth setup should NOT run when only Hub tests are requested).

- [ ] **Step 6: Verify typecheck still passes**

```bash
npm run build
```

Expected: tsc + vite build succeeds. `playwright.config.ts` is not included in the CRM tsconfig, so it should not affect the build.

- [ ] **Step 7: Verify unit tests still pass**

```bash
npm run test
```

Expected: all existing vitest tests pass, no regressions.
