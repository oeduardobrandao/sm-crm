# Playwright E2E Testing Setup

## Overview

Add Playwright for end-to-end testing of both CRM and Hub apps. Root-level config with two Playwright projects, real login flow for CRM auth, token-based access for Hub, and configurable base URLs for local/staging/CI.

## Project Structure

```
sm-crm/
├── playwright.config.ts
├── e2e/
│   ├── crm/
│   │   └── smoke.spec.ts
│   ├── hub/
│   │   └── smoke.spec.ts
│   ├── global-setup.ts
│   └── .auth/
│       └── crm-user.json
```

- `e2e/.auth/` is gitignored (stored browser auth state)
- `test-results/` and `playwright-report/` are gitignored

## Playwright Config

Single `playwright.config.ts` at repo root with two projects:

### CRM project

- `testDir: ./e2e/crm`
- `baseURL`: `CRM_BASE_URL` env var, defaults to `http://localhost:5173`
- Uses `global-setup.ts` for auth
- `storageState: e2e/.auth/crm-user.json`

### Hub project

- `testDir: ./e2e/hub`
- `baseURL`: `HUB_BASE_URL` env var, defaults to `http://localhost:5175`
- No auth setup (token-based URLs)

### Web servers

`webServer` array auto-starts both Vite dev servers when no `*_BASE_URL` env var is set. When env vars are set (CI/staging), dev servers are skipped.

### Browser matrix

Chromium only initially. Firefox/WebKit can be added later.

### Failure handling

- `retries: 0` locally, `retries: 2` in CI (`process.env.CI`)
- `trace: 'on-first-retry'`
- `screenshot: 'only-on-failure'`
- Output: `test-results/` and `playwright-report/`

## Auth Handling

### CRM (global-setup.ts)

1. Launch browser, navigate to `/login`
2. Fill email/password from `E2E_CRM_EMAIL` and `E2E_CRM_PASSWORD` env vars
3. Submit form, wait for redirect to `/dashboard`
4. Save storage state to `e2e/.auth/crm-user.json`
5. All CRM tests reuse this state via `storageState` config

### Hub

No auth setup needed. Tests navigate directly to token URL from `E2E_HUB_URL` env var (e.g. `/acme/hub/abc123`).

## Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `E2E_CRM_EMAIL` | Yes (for CRM tests) | Test user email for CRM login |
| `E2E_CRM_PASSWORD` | Yes (for CRM tests) | Test user password for CRM login |
| `E2E_HUB_URL` | Yes (for Hub tests) | Full Hub token URL path |
| `CRM_BASE_URL` | No | Override CRM base URL (skips dev server) |
| `HUB_BASE_URL` | No | Override Hub base URL (skips dev server) |

Stored locally in `.env.e2e` (gitignored).

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

- Navigate to `E2E_HUB_URL` token path
- Assert Hub shell renders

## Files to Create/Modify

1. **Install:** `@playwright/test` as dev dependency
2. **Create:** `playwright.config.ts`
3. **Create:** `e2e/global-setup.ts`
4. **Create:** `e2e/crm/smoke.spec.ts`
5. **Create:** `e2e/hub/smoke.spec.ts`
6. **Modify:** root `package.json` (add npm scripts)
7. **Modify:** `.gitignore` (add e2e artifacts)
