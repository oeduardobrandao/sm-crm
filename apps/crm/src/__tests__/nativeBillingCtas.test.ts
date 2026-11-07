import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Inside the iOS app nothing may offer a purchase (apps/mobile DECISIONS.md D5, D33):
 * App Review treats a link to billing, the trial offer or the pricing page as steering
 * to an external purchase. So every source file that names one of those destinations
 * must also import `isNativeApp` and hide the link in the app. This catches a future
 * upgrade CTA before it ships to the App Store build.
 */

const SRC = path.resolve(__dirname, '..');

/** BILLING_PATH, or the three paths as string literals in any quote style. */
const BILLING_REF = /\bBILLING_PATH\b|['"`]\/(?:configuracao\/cobranca|comecar|precos)(?=['"`?#/])/;

const IMPORTS_IS_NATIVE =
  /import\s*\{[^}]*\bisNativeApp\b[^}]*\}\s*from\s*['"][^'"]*native\/platform['"]/;

/** Public-only code, the billing pages themselves, or code behind Task 4's path guard. */
const ALLOWLIST_FILES = new Set([
  'pages/configuracao/configTabs.ts',
  'pages/configuracao/cobranca/CobrancaPage.tsx',
  'pages/configuracao/cobranca/CobrancaPhone.tsx',
  'native/blockedPaths.ts',
  // Re-export of BILLING_PATH; the tabs that render it are checked themselves.
  'pages/analytics-conta/tiktok/tiktokTabFormat.ts',
  // Gated by Task 4 (login, routes, trial redirect, workspace setup).
  'pages/login/LoginPage.tsx',
  'components/layout/ProtectedRoute.tsx',
  'components/layout/useTrialOfferRedirect.ts',
  'pages/workspace-setup/WorkspaceSetupPage.tsx',
  // Route tables, not CTAs: the paths they declare are blocked by Task 4's guard.
  'App.tsx',
  'components/layout/routePermissions.ts',
]);

const ALLOWLIST_DIRS = [
  'pages/landing/',
  'pages/precos/',
  'pages/comecar/',
  'pages/blog/',
  'pages/marketing/',
  'content/',
];

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === '__tests__' ? [] : walk(full);
    return /\.tsx?$/.test(e.name) && !/\.(test|spec|d)\.tsx?$/.test(e.name) ? [full] : [];
  });
}

function isAllowlisted(rel: string): boolean {
  return ALLOWLIST_FILES.has(rel) || ALLOWLIST_DIRS.some((d) => rel.startsWith(d));
}

describe('billing CTAs stay out of the native app', () => {
  it('every file that links to billing, the trial offer or pricing imports isNativeApp', () => {
    const offenders = walk(SRC)
      .map((file) => path.relative(SRC, file).split(path.sep).join('/'))
      .filter((rel) => !isAllowlisted(rel))
      .filter((rel) => {
        const source = fs.readFileSync(path.join(SRC, rel), 'utf8');
        return BILLING_REF.test(source) && !IMPORTS_IS_NATIVE.test(source);
      });
    expect(offenders).toEqual([]);
  });

  it('the scan still sees the files it is meant to police', () => {
    // Guards the regex itself: if it stopped matching, the check above would pass vacuously.
    const matched = walk(SRC)
      .map((file) => path.relative(SRC, file).split(path.sep).join('/'))
      .filter((rel) => BILLING_REF.test(fs.readFileSync(path.join(SRC, rel), 'utf8')));
    expect(matched).toEqual(
      expect.arrayContaining([
        'components/usage/UsageMeter.tsx',
        'components/billing/TrialNudgeCard.tsx',
        'pages/analytics-conta/AnalyticsStateCards.tsx',
      ]),
    );
  });
});
