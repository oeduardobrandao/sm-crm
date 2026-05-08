# Playwright E2E Testing Setup

## Overview

Add Playwright for end-to-end testing of both CRM and Hub apps. Root-level config with three Playwright projects (auth setup + two test suites), real login flow for CRM auth, token-based access for Hub, and configurable base URLs for local/staging/CI.

## Project Structure

```
sm-crm/
├── playwright.config.ts
├── e2e/
│   ├── crm/
│   │   ├── auth.setup.ts       # Setup project: logs in, saves state
│   │   └── smoke.spec.ts
│   ├── hub/
│   │   └── smoke.spec.ts
│   └── .auth/                  # Created at runtime by auth.setup.ts
│       └── crm-user.json
```

- `e2e/.auth/` is created at runtime by `auth.setup.ts` (not tracked by git)
- `test-results/` and `playwright-report/` are gitignored

## Playwright Config

Single `playwright.config.ts` at repo root. Loads env vars from `.env.e2e.local` via `dotenv`.

### Projects

Three projects with dependencies:

1. **`crm-auth`** (setup project) — runs `e2e/crm/auth.setup.ts`, creates `e2e/.auth/` directory and saves browser state to `e2e/.auth/crm-user.json`
2. **`crm`** — `testDir: ./e2e/crm`, depends on `crm-auth`, uses stored `storageState`. `baseURL` from `CRM_BASE_URL` env var, defaults to `http://localhost:5173`
3. **`hub`** — `testDir: ./e2e/hub`, no auth dependency. `baseURL` from `HUB_BASE_URL` env var, defaults to `http://localhost:5175`

Running `--project=hub` does NOT trigger CRM auth. Running `--project=crm` automatically runs `crm-auth` first.

### Web servers

`webServer` array auto-starts both Vite dev servers when no `*_BASE_URL` env var is set:
- CRM: `npm run dev` (port 5173)
- Hub: `npx vite --config apps/hub/vite.config.ts --port 5175 --strictPort` (explicit port to avoid Vite auto-incrementing)

When `CRM_BASE_URL` or `HUB_BASE_URL` env vars are set, the corresponding dev server is skipped.

### Browser matrix

Chromium only initially. Firefox/WebKit can be added later.

### Failure handling

- `retries: 0` locally, `retries: 2` in CI (`process.env.CI`)
- `trace: 'on-first-retry'`
- `screenshot: 'only-on-failure'`
- Output: `test-results/` and `playwright-report/`

## Auth Handling

### CRM (e2e/crm/auth.setup.ts)

This is a Playwright **setup project**, not a `globalSetup` script. It runs as a dependency of the `crm` project only.

1. Create `e2e/.auth/` directory via `mkdirSync({ recursive: true })` if it doesn't exist
2. Launch browser, navigate to `/login`
3. Fill email/password from `E2E_CRM_EMAIL` and `E2E_CRM_PASSWORD` env vars
4. Submit form, wait for redirect to `/dashboard`
5. Save storage state to `e2e/.auth/crm-user.json`

### Hub

No auth setup needed. Tests navigate directly to the Hub token path from `E2E_HUB_PATH` env var (e.g. `/acme/hub/abc123`).

## Test Data Requirements

E2E tests require stable seeded data in the target Supabase instance:

- **CRM test user:** Must have a valid Supabase Auth account, an associated profile, and at least one workspace. The user must NOT be redirected to `/workspace-setup` on login (i.e., workspace setup must already be complete). Use `npm run seed` or `npm run seed:staging` to create this data.
- **Hub token:** Must be a valid, active hub access token for an existing workspace/client. The token path in `E2E_HUB_PATH` must resolve to a working Hub session.

## Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `E2E_CRM_EMAIL` | Yes (for CRM tests) | Test user email for CRM login |
| `E2E_CRM_PASSWORD` | Yes (for CRM tests) | Test user password for CRM login |
| `E2E_HUB_PATH` | Yes (for Hub tests) | Hub token URL path (e.g. `/acme/hub/abc123`) |
| `CRM_BASE_URL` | No | Override CRM base URL (skips dev server) |
| `HUB_BASE_URL` | No | Override Hub base URL (skips dev server) |

Stored locally in `.env.e2e.local` — this matches the existing `.env.*.local` gitignore pattern, so no gitignore changes needed for env files.

## NPM Scripts

Added to root `package.json`:

- `test:e2e` — runs all Playwright tests
- `test:e2e:crm` — runs CRM project only (`--project=crm`)
- `test:e2e:hub` — runs Hub project only (`--project=hub`)

## Smoke Tests

### CRM (`e2e/crm/smoke.spec.ts`)

- Navigate to `/dashboard` (auth state already loaded)
- Assert page loaded (visible heading or sidebar element)

### Hub (`e2e/hub/smoke.spec.ts`)

- Navigate to `E2E_HUB_PATH` token path
- Assert Hub shell renders

## CI Integration

Add a new `e2e` job to `.github/workflows/ci.yml`:

1. Checkout + setup Node 20 + `npm ci`
2. Install Playwright browsers: `npx playwright install --with-deps chromium`
3. Set env vars from GitHub Actions secrets: `E2E_CRM_EMAIL`, `E2E_CRM_PASSWORD`, `E2E_HUB_PATH`, plus `CRM_BASE_URL` and `HUB_BASE_URL` pointing to staging
4. Run `npm run test:e2e`
5. Upload `playwright-report/` as artifact on failure via `actions/upload-artifact`

## Files to Create/Modify

1. **Install:** `@playwright/test` and `dotenv` as dev dependencies + `npx playwright install chromium`
2. **Create:** `playwright.config.ts` (loads `.env.e2e.local` via dotenv)
3. **Create:** `e2e/crm/auth.setup.ts` (setup project, creates `.auth/` dir)
4. **Create:** `e2e/crm/smoke.spec.ts`
5. **Create:** `e2e/hub/smoke.spec.ts`
6. **Modify:** root `package.json` (add npm scripts)
7. **Modify:** `.gitignore` (add `e2e/.auth/`, `test-results/`, `playwright-report/`)
8. **Modify:** `.github/workflows/ci.yml` (add e2e job)
9. **Modified by npm:** `package-lock.json`
