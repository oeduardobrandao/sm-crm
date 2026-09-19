# Cookie Consent (Opt-in Gate) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nothing non-essential (PostHog incl. session replay, Crisp chat) runs in the CRM bundle until the visitor opts in, with an equal-weight banner, a preferences dialog, and withdrawal reachable everywhere.

**Architecture:** A React-free consent store (`lib/consent.ts`, localStorage `consent_v1`) is the single source of truth. A boot-time `installConsentEffects()` subscribes to it and starts/stops PostHog and the Crisp loader; React code reads it through a `useSyncExternalStore` hook. `AuthContext` gates its Crisp identify effect on support consent and mirrors its existing sign-out teardown on revoke. UI is one banner + one dialog mounted once in `App.tsx`.

**Tech Stack:** React 19, TypeScript, Vitest + Testing Library (jsdom), shadcn/ui (Radix `Dialog`, `Switch`), `react-i18next`, posthog-js 1.402.3, `@sentry/react`.

Spec: `docs/superpowers/specs/2026-09-19-cookie-consent-design.md` (read it first; it holds the reasoning behind every decision below).

## Global Constraints

- Working directory / branch: this worktree, branch `claude/cookie-consent-prompt-93848e`. Do not switch branches. Use the path `/Users/eduardosouza/projects/sm-crm/.claude/worktrees/cookie-consent-prompt-93848e` (lowercase `projects`).
- Consent storage key is exactly `consent_v1`; value is `{ analytics: boolean, support: boolean, decidedAt: string }`.
- Two categories only: `analytics` (PostHog, including session replay and heatmaps) and `support` (Crisp). Sentry error reporting and Vercel Analytics stay on (legitimate interest); Sentry has NO replay.
- PostHog session replay stays enabled for users who consent (no `disable_session_recording`).
- User-facing copy is pt-BR, and contains **no em-dashes** (use period or colon). Banner/dialog strings go through i18n (`common` namespace, keys under `cookies.*`, pt and en). Landing and legal pages are hardcoded pt.
- `lib/consent.ts`, `lib/legacyStorage.ts` and `components/consent/CookiePreferencesLink.tsx` must have **no `window` / `localStorage` / `document` / `import.meta.env` access at module scope**: `LgpdPage` imports them and `scripts/seo/prerender.tsx` runs it in Node under `tsconfig.scripts.json`.
- Every storage access is wrapped in try/catch (private mode, blocked storage). Collect localStorage keys first, remove after (CLAUDE.md gotcha).
- Never use `useBlocker`. Icons are `lucide-react`. Toasts are `sonner` (none needed here).
- Keep `window.$crisp = []` and `window.CRISP_WEBSITE_ID` in `apps/crm/index.html`: five call sites push to `$crisp` and must stay harmless before the widget loads.
- Commit trailer on every commit: `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`. Never `--no-verify`.
- Before the final push, all of these must pass (CI runs them): `npm run lint`, `npm run format:check`, `npx tsc -p apps/crm/tsconfig.json --noEmit`, `npx tsc -p apps/hub/tsconfig.json --noEmit`, `npx tsc -p apps/admin/tsconfig.json --noEmit`, `npx tsc -p tsconfig.scripts.json`, `npm run test`.

## File Structure

| File | Responsibility |
|---|---|
| `apps/crm/src/lib/consent.ts` (new) | Store: `getConsent`, `setConsent`, `subscribe`, `openConsentPreferences`, key + event constants. No React. |
| `apps/crm/src/lib/useConsent.ts` (new) | `useConsent()` via `useSyncExternalStore`. |
| `apps/crm/src/lib/legacyStorage.ts` (new) | `purgeAnalyticsStorage()`, `purgeSupportStorage()`: delete tool storage without initialising the SDK. |
| `apps/crm/src/lib/analytics.ts` (modify) | Split `enabled` into `initialized` + `capturing`; `disableAnalytics()`; replay last identity on (re)start. |
| `apps/crm/src/lib/sentry.ts` (modify) | Drop inert replay option; scrub `/conectar/:token`. |
| `apps/crm/src/lib/crispLoader.ts` (new) | `loadCrisp()`, `loadCrispWhenIdle()`. |
| `apps/crm/src/lib/supportChat.ts` (new) | `openSupportChat()`, `resumePendingSupportChat()`, `clearPendingSupportChat()`. |
| `apps/crm/src/lib/consentEffects.ts` (new) | `installConsentEffects()`: boot + change handling for PostHog / Crisp / purges. |
| `apps/crm/index.html`, `apps/crm/src/main.tsx` (modify) | Remove inline Crisp loader; call `installConsentEffects()`. |
| `apps/crm/src/context/AuthContext.tsx` (modify) | Gate Crisp identify on support consent; revoke teardown. |
| `apps/crm/src/components/consent/CookieConsent.tsx`, `CookiePreferencesDialog.tsx`, `CookiePreferencesLink.tsx` (new) | Banner, dialog, link. |
| `apps/crm/src/test/consent.ts` (new) | `seedConsent()` test helper. |

---

### Task 1: Consent store, hook, legacy-storage purge

**Files:**
- Create: `apps/crm/src/lib/consent.ts`
- Create: `apps/crm/src/lib/useConsent.ts`
- Create: `apps/crm/src/lib/legacyStorage.ts`
- Create: `apps/crm/src/test/consent.ts`
- Test: `apps/crm/src/lib/__tests__/consent.test.ts`
- Test: `apps/crm/src/lib/__tests__/legacyStorage.test.ts`

**Interfaces:**
- Produces (used by every later task):
  - `CONSENT_STORAGE_KEY = 'consent_v1'`, `OPEN_PREFERENCES_EVENT = 'mesaas:open-cookie-preferences'`
  - `type ConsentCategory = 'analytics' | 'support'`
  - `interface ConsentChoice { analytics: boolean; support: boolean }`, `interface Consent extends ConsentChoice { decidedAt: string }`
  - `getConsent(): Consent | null` (referentially stable while stored value is unchanged)
  - `setConsent(choice: ConsentChoice): void`
  - `subscribe(listener: () => void): () => void`
  - `openConsentPreferences(focus?: ConsentCategory): void` (dispatches `CustomEvent(OPEN_PREFERENCES_EVENT, { detail: { focus } })` on `window`)
  - `useConsent(): Consent | null`
  - `purgeAnalyticsStorage(): void`, `purgeSupportStorage(): void`
  - test helper `seedConsent(choice?: Partial<ConsentChoice>): void`

- [ ] **Step 1: Write the failing store tests**

Create `apps/crm/src/lib/__tests__/consent.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('consent store', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('is undecided (null) until a choice is stored', async () => {
    const { getConsent } = await import('../consent');
    expect(getConsent()).toBeNull();
  });

  it('round-trips a choice under the versioned key', async () => {
    const { getConsent, setConsent, CONSENT_STORAGE_KEY } = await import('../consent');
    setConsent({ analytics: true, support: false });
    expect(getConsent()).toMatchObject({ analytics: true, support: false });
    expect(typeof getConsent()?.decidedAt).toBe('string');
    expect(JSON.parse(localStorage.getItem(CONSENT_STORAGE_KEY) ?? 'null')).toMatchObject({
      analytics: true,
      support: false,
    });
    expect(CONSENT_STORAGE_KEY).toBe('consent_v1');
  });

  it('returns a referentially stable object while the stored value is unchanged', async () => {
    const { getConsent, setConsent } = await import('../consent');
    setConsent({ analytics: true, support: true });
    expect(getConsent()).toBe(getConsent());
  });

  it('treats malformed or wrong-shaped stored values as undecided', async () => {
    const { getConsent, CONSENT_STORAGE_KEY } = await import('../consent');
    localStorage.setItem(CONSENT_STORAGE_KEY, '{not json');
    expect(getConsent()).toBeNull();
    localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify({ analytics: 'yes', support: true }));
    expect(getConsent()).toBeNull();
  });

  it('ignores a previous-version key so a category change re-prompts', async () => {
    const { getConsent } = await import('../consent');
    localStorage.setItem(
      'consent_v0',
      JSON.stringify({ analytics: true, support: true, decidedAt: 'x' }),
    );
    expect(getConsent()).toBeNull();
  });

  it('notifies subscribers on set and stops after unsubscribe', async () => {
    const { setConsent, subscribe } = await import('../consent');
    const listener = vi.fn();
    const unsubscribe = subscribe(listener);
    setConsent({ analytics: true, support: true });
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    setConsent({ analytics: false, support: false });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('notifies subscribers when another tab changes the key (storage event)', async () => {
    const { subscribe, CONSENT_STORAGE_KEY } = await import('../consent');
    const listener = vi.fn();
    subscribe(listener);
    window.dispatchEvent(new StorageEvent('storage', { key: CONSENT_STORAGE_KEY }));
    expect(listener).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated' }));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('keeps the decision in memory when storage writes throw', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const { getConsent, setConsent } = await import('../consent');
    setConsent({ analytics: true, support: false });
    expect(getConsent()).toMatchObject({ analytics: true, support: false });
  });

  it('openConsentPreferences dispatches the window event with the requested focus', async () => {
    const { openConsentPreferences, OPEN_PREFERENCES_EVENT } = await import('../consent');
    const handler = vi.fn();
    window.addEventListener(OPEN_PREFERENCES_EVENT, handler);
    openConsentPreferences('support');
    window.removeEventListener(OPEN_PREFERENCES_EVENT, handler);
    expect(handler).toHaveBeenCalledTimes(1);
    expect((handler.mock.calls[0][0] as CustomEvent).detail).toEqual({ focus: 'support' });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run apps/crm/src/lib/__tests__/consent.test.ts`
Expected: FAIL (cannot resolve `../consent`).

- [ ] **Step 3: Implement the store**

Create `apps/crm/src/lib/consent.ts`:

```ts
/**
 * Cookie / storage consent (docs/superpowers/specs/2026-09-19-cookie-consent-design.md).
 *
 * Plain module: no React, and no `window` / `localStorage` access at import time. LgpdPage
 * imports this and scripts/seo/prerender.tsx renders it in Node, so everything touches the
 * browser only inside functions. React consumers use `useConsent()` (lib/useConsent.ts).
 */
export const CONSENT_STORAGE_KEY = 'consent_v1';
export const OPEN_PREFERENCES_EVENT = 'mesaas:open-cookie-preferences';

export type ConsentCategory = 'analytics' | 'support';

export interface ConsentChoice {
  analytics: boolean;
  support: boolean;
}

export interface Consent extends ConsentChoice {
  decidedAt: string;
}

type Listener = () => void;

const listeners = new Set<Listener>();
let storageListenerInstalled = false;
// Flips once a write to localStorage throws. From then on the decision lives here, for the
// session only: nothing non-essential ever loads without an explicit choice.
let memoryOnly = false;
let memoryRaw: string | null = null;
let cachedRaw: string | null | undefined;
let cachedValue: Consent | null = null;

function readRaw(): string | null {
  if (memoryOnly) return memoryRaw;
  try {
    return localStorage.getItem(CONSENT_STORAGE_KEY);
  } catch {
    return memoryRaw;
  }
}

function parse(raw: string | null): Consent | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<Consent> | null;
    if (
      !value ||
      typeof value.analytics !== 'boolean' ||
      typeof value.support !== 'boolean' ||
      typeof value.decidedAt !== 'string'
    ) {
      return null;
    }
    return { analytics: value.analytics, support: value.support, decidedAt: value.decidedAt };
  } catch {
    return null;
  }
}

/** Stable reference while the stored value is unchanged (useSyncExternalStore requires it). */
export function getConsent(): Consent | null {
  const raw = readRaw();
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedValue = parse(raw);
  }
  return cachedValue;
}

function notify(): void {
  for (const listener of [...listeners]) listener();
}

export function setConsent(choice: ConsentChoice): void {
  const raw = JSON.stringify({
    analytics: choice.analytics,
    support: choice.support,
    decidedAt: new Date().toISOString(),
  });
  memoryRaw = raw;
  try {
    localStorage.setItem(CONSENT_STORAGE_KEY, raw);
  } catch {
    memoryOnly = true;
  }
  notify();
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  if (!storageListenerInstalled && typeof window !== 'undefined') {
    storageListenerInstalled = true;
    // Another tab decided or revoked: reach this tab's subscribers too.
    window.addEventListener('storage', (event) => {
      if (event.key === CONSENT_STORAGE_KEY || event.key === null) notify();
    });
  }
  return () => {
    listeners.delete(listener);
  };
}

/** Opens the preferences dialog mounted by <CookieConsent />. `focus` pre-enables a category. */
export function openConsentPreferences(focus?: ConsentCategory): void {
  window.dispatchEvent(new CustomEvent(OPEN_PREFERENCES_EVENT, { detail: { focus } }));
}
```

Create `apps/crm/src/lib/useConsent.ts`:

```ts
import { useSyncExternalStore } from 'react';
import { getConsent, subscribe, type Consent } from './consent';

/** Reactive view of the consent store. `null` = undecided. */
export function useConsent(): Consent | null {
  return useSyncExternalStore(subscribe, getConsent, () => null);
}
```

Create `apps/crm/src/test/consent.ts`:

```ts
import { CONSENT_STORAGE_KEY, type ConsentChoice } from '../lib/consent';

/** Test helper: stores a decided consent. Call AFTER any `localStorage.clear()`. */
export function seedConsent(choice: Partial<ConsentChoice> = {}): void {
  localStorage.setItem(
    CONSENT_STORAGE_KEY,
    JSON.stringify({
      analytics: false,
      support: false,
      decidedAt: '2026-09-19T00:00:00.000Z',
      ...choice,
    }),
  );
}
```

- [ ] **Step 4: Run store tests to verify they pass**

Run: `npx vitest run apps/crm/src/lib/__tests__/consent.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Write the failing hook + legacy-storage tests**

Create `apps/crm/src/lib/__tests__/useConsent.test.tsx`:

```tsx
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { setConsent } from '../consent';
import { useConsent } from '../useConsent';

describe('useConsent', () => {
  afterEach(() => localStorage.clear());

  it('is null when undecided and re-renders on a same-tab change', () => {
    localStorage.clear();
    const { result } = renderHook(() => useConsent());
    expect(result.current).toBeNull();
    act(() => setConsent({ analytics: true, support: false }));
    expect(result.current).toMatchObject({ analytics: true, support: false });
    act(() => setConsent({ analytics: false, support: false }));
    expect(result.current).toMatchObject({ analytics: false });
  });
});
```

Create `apps/crm/src/lib/__tests__/legacyStorage.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { CRISP_SESSION_STORAGE_KEY } from '../crispSession';
import { purgeAnalyticsStorage, purgeSupportStorage } from '../legacyStorage';

function cookieNames(): string[] {
  return document.cookie
    .split(';')
    .map((c) => c.split('=')[0].trim())
    .filter(Boolean);
}

describe('legacy storage purge', () => {
  afterEach(() => {
    localStorage.clear();
    for (const name of cookieNames()) document.cookie = `${name}=; Max-Age=0; path=/`;
  });

  it('removes PostHog ph_ keys and cookies but leaves the opt-out flag and unrelated keys', () => {
    localStorage.setItem('ph_phc_test_posthog', '{"distinct_id":"x"}');
    localStorage.setItem('__ph_opt_in_out_phc_test', '0');
    localStorage.setItem('theme', 'dark');
    document.cookie = 'ph_phc_test_posthog=abc; path=/';
    document.cookie = 'session_hint=keep; path=/';

    purgeAnalyticsStorage();

    expect(localStorage.getItem('ph_phc_test_posthog')).toBeNull();
    expect(localStorage.getItem('__ph_opt_in_out_phc_test')).toBe('0');
    expect(localStorage.getItem('theme')).toBe('dark');
    expect(cookieNames()).not.toContain('ph_phc_test_posthog');
    expect(cookieNames()).toContain('session_hint');
  });

  it('removes Crisp cookies/keys and the Mesaas-owned crisp session cache', () => {
    localStorage.setItem('crisp-client/session/abc', 'x');
    localStorage.setItem(CRISP_SESSION_STORAGE_KEY, '{"userId":"u","token":"t"}');
    localStorage.setItem('theme', 'dark');
    document.cookie = 'crisp-client%2Fsession%2Fabc=1; path=/';

    purgeSupportStorage();

    expect(localStorage.getItem('crisp-client/session/abc')).toBeNull();
    expect(localStorage.getItem(CRISP_SESSION_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem('theme')).toBe('dark');
    expect(cookieNames()).not.toContain('crisp-client%2Fsession%2Fabc');
  });

  it('does not throw when storage is unavailable', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('denied');
      },
    });
    try {
      expect(() => purgeAnalyticsStorage()).not.toThrow();
      expect(() => purgeSupportStorage()).not.toThrow();
    } finally {
      if (original) Object.defineProperty(window, 'localStorage', original);
    }
  });
});
```

- [ ] **Step 6: Run to verify they fail**

Run: `npx vitest run apps/crm/src/lib/__tests__/useConsent.test.tsx apps/crm/src/lib/__tests__/legacyStorage.test.ts`
Expected: useConsent passes (already implemented in Step 3); legacyStorage FAILS (cannot resolve `../legacyStorage`).

- [ ] **Step 7: Implement legacy storage purge**

Create `apps/crm/src/lib/legacyStorage.ts`:

```ts
import { CRISP_SESSION_STORAGE_KEY } from './crispSession';

/**
 * Deletes a tool's browser storage directly, WITHOUT initialising its SDK. Existing users
 * already carry a PostHog `ph_*` identifier and a Crisp session from before the consent gate;
 * SDK-level opt-out calls are no-ops against an SDK that never started this session, so a
 * "Rejeitar todos" on launch day has to clear the legacy keys itself.
 *
 * No browser access at module scope (prerender imports this transitively via LgpdPage).
 */

function expireCookie(name: string): void {
  const host = location.hostname;
  const parts = host.split('.');
  // Cookies are only removed by an expiry that matches the domain they were set with, so try
  // the host-only form, the host, and every parent domain.
  const domains: Array<string | null> = [null, host, `.${host}`];
  for (let i = 1; i < parts.length - 1; i++) domains.push(`.${parts.slice(i).join('.')}`);
  for (const domain of domains) {
    document.cookie = `${name}=; Max-Age=0; path=/${domain ? `; domain=${domain}` : ''}`;
  }
}

function purge(prefixes: string[], exactKeys: string[] = []): void {
  try {
    const names = document.cookie
      .split(';')
      .map((cookie) => cookie.split('=')[0].trim())
      .filter(Boolean);
    for (const name of names) {
      if (prefixes.some((prefix) => name.startsWith(prefix))) expireCookie(name);
    }
  } catch {
    // Cookie access can be blocked; never let cleanup break the app.
  }
  try {
    // Collect first, remove after: removing while iterating skips entries.
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) keys.push(key);
    }
    for (const key of keys) {
      if (prefixes.some((prefix) => key.startsWith(prefix)) || exactKeys.includes(key)) {
        localStorage.removeItem(key);
      }
    }
  } catch {
    // Storage can be blocked; never let cleanup break the app.
  }
}

/** PostHog identifier storage. Leaves `__ph_opt_in_out_*` (the SDK's own opt-out flag) alone. */
export function purgeAnalyticsStorage(): void {
  purge(['ph_']);
}

/**
 * Crisp storage plus Mesaas's own reconciliation cache. Crisp's docs describe a cookie family
 * under `crisp-client`; the prefix scan also covers localStorage in case that is wrong. Task 10
 * confirms the real keys in a browser.
 */
export function purgeSupportStorage(): void {
  purge(['crisp-client'], [CRISP_SESSION_STORAGE_KEY]);
}
```

- [ ] **Step 8: Run all Task 1 tests**

Run: `npx vitest run apps/crm/src/lib/__tests__/consent.test.ts apps/crm/src/lib/__tests__/useConsent.test.tsx apps/crm/src/lib/__tests__/legacyStorage.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/crm/src/lib/consent.ts apps/crm/src/lib/useConsent.ts apps/crm/src/lib/legacyStorage.ts apps/crm/src/test/consent.ts apps/crm/src/lib/__tests__/consent.test.ts apps/crm/src/lib/__tests__/useConsent.test.tsx apps/crm/src/lib/__tests__/legacyStorage.test.ts
git commit -m "feat(consent): add consent store, hook and legacy storage purge

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Gate PostHog behind consent

**Files:**
- Modify: `apps/crm/src/lib/analytics.ts` (state flags at `:79-101`, helpers below)
- Modify: `apps/crm/src/lib/__tests__/analytics.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1 (analytics stays consent-agnostic; `consentEffects` in Task 4 drives it).
- Produces: `initAnalytics(): void` (start-or-resume, idempotent, never a second `posthog.init`), `disableAnalytics(): void`, existing `captureEvent`, `identifySignup`, `identifyWorkspaceUser`, `resetAnalytics` (all no-op while not capturing).

Background (verified against posthog-js 1.402.3, load-bearing): `reset()` deletes the SDK's opt-in/out flag, so **`reset()` must run before `opt_out_capturing()`**; the opt-out flag persists across page loads so a fresh `init` after a past revoke needs `opt_in_capturing()`; `opt_out_persistence_by_default: true` makes opt-out also clear the `ph_*` identifier; `opt_in_capturing()` emits a `$opt_in` event unless `captureEventName: false`.

- [ ] **Step 1: Extend the mock and write the failing tests**

In `apps/crm/src/lib/__tests__/analytics.test.ts`, replace the `posthogMock` block and the `beforeEach`:

```ts
const { posthogMock } = vi.hoisted(() => ({
  posthogMock: {
    init: vi.fn(),
    identify: vi.fn(),
    capture: vi.fn(),
    reset: vi.fn(),
    group: vi.fn(),
    has_opted_out_capturing: vi.fn(() => false),
    opt_in_capturing: vi.fn(),
    opt_out_capturing: vi.fn(),
  },
}));

vi.mock('posthog-js', () => ({ default: posthogMock }));

describe('analytics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.unstubAllEnvs();
    posthogMock.has_opted_out_capturing.mockReset();
    posthogMock.has_opted_out_capturing.mockReturnValue(false);
  });
```

Append these tests inside the same `describe('analytics', ...)` (before its closing `});`):

```ts
  it('clears the ph_ identifier on opt-out by initialising with opt_out_persistence_by_default', async () => {
    vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test');
    const { initAnalytics } = await import('../analytics');
    initAnalytics();
    expect(posthogMock.init).toHaveBeenCalledWith(
      'phc_test',
      expect.objectContaining({ opt_out_persistence_by_default: true }),
    );
  });

  it('disableAnalytics resets BEFORE opting out (reset() deletes the opt-out flag)', async () => {
    vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test');
    const { initAnalytics, disableAnalytics } = await import('../analytics');
    initAnalytics();
    disableAnalytics();
    expect(posthogMock.reset).toHaveBeenCalledTimes(1);
    expect(posthogMock.opt_out_capturing).toHaveBeenCalledTimes(1);
    expect(posthogMock.reset.mock.invocationCallOrder[0]).toBeLessThan(
      posthogMock.opt_out_capturing.mock.invocationCallOrder[0],
    );
  });

  it('every helper no-ops after disableAnalytics', async () => {
    vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test');
    const { initAnalytics, disableAnalytics, captureEvent, identifySignup, identifyWorkspaceUser } =
      await import('../analytics');
    initAnalytics();
    disableAnalytics();
    posthogMock.reset.mockClear();
    captureEvent('client_created');
    identifySignup('user-1');
    identifyWorkspaceUser('user-1', { workspace_id: 'ws-1', plan_id: null, role: 'owner' });
    expect(posthogMock.capture).not.toHaveBeenCalled();
    expect(posthogMock.identify).not.toHaveBeenCalled();
    expect(posthogMock.group).not.toHaveBeenCalled();
  });

  it('accept, reject, accept initialises once and resumes with opt_in_capturing', async () => {
    vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test');
    const { initAnalytics, disableAnalytics } = await import('../analytics');
    initAnalytics();
    disableAnalytics();
    posthogMock.has_opted_out_capturing.mockReturnValue(true);
    initAnalytics();
    expect(posthogMock.init).toHaveBeenCalledTimes(1);
    expect(posthogMock.opt_in_capturing).toHaveBeenCalledWith({ captureEventName: false });
  });

  it('clears an opt-out flag left by a previous session on a fresh grant', async () => {
    vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test');
    posthogMock.has_opted_out_capturing.mockReturnValue(true);
    const { initAnalytics } = await import('../analytics');
    initAnalytics();
    expect(posthogMock.init).toHaveBeenCalledTimes(1);
    expect(posthogMock.opt_in_capturing).toHaveBeenCalledWith({ captureEventName: false });
  });

  it('does not opt in when the SDK is not opted out', async () => {
    vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test');
    const { initAnalytics } = await import('../analytics');
    initAnalytics();
    expect(posthogMock.opt_in_capturing).not.toHaveBeenCalled();
  });

  it('replays the last workspace identity when capturing starts after the user was known', async () => {
    // AuthContext identifies once, during profile hydration. A mid-session grant (or the idle
    // boot init finishing after hydration) would otherwise leave the person permanently
    // anonymous under person_profiles: 'identified_only'.
    vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test');
    const { initAnalytics, identifyWorkspaceUser } = await import('../analytics');
    identifyWorkspaceUser('user-1', { workspace_id: 'ws-1', plan_id: null, role: 'owner' });
    expect(posthogMock.identify).not.toHaveBeenCalled();
    initAnalytics();
    expect(posthogMock.identify).toHaveBeenCalledWith('user-1', {
      workspace_id: 'ws-1',
      plan_id: null,
      role: 'owner',
    });
    expect(posthogMock.group).toHaveBeenCalledWith('workspace', 'ws-1');
  });

  it('forgets the remembered identity on resetAnalytics so it is never replayed for the next user', async () => {
    vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test');
    const { initAnalytics, identifyWorkspaceUser, resetAnalytics } = await import('../analytics');
    identifyWorkspaceUser('user-1', { workspace_id: 'ws-1', plan_id: null, role: 'owner' });
    resetAnalytics();
    initAnalytics();
    expect(posthogMock.identify).not.toHaveBeenCalled();
  });

  it('disableAnalytics no-ops when analytics was never started', async () => {
    vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test');
    const { disableAnalytics } = await import('../analytics');
    disableAnalytics();
    expect(posthogMock.reset).not.toHaveBeenCalled();
    expect(posthogMock.opt_out_capturing).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `npx vitest run apps/crm/src/lib/__tests__/analytics.test.ts`
Expected: the new tests FAIL (`disableAnalytics` is not exported, no `opt_out_persistence_by_default`); the seven original tests still pass.

- [ ] **Step 3: Implement**

In `apps/crm/src/lib/analytics.ts`, replace everything from `let enabled = false;` through the end of `identifyWorkspaceUser` (the block ending `posthog.group('workspace', props.workspace_id);\n}`) with:

```ts
// Two flags, not one: `initialized` = a posthog.init has run (never resets, so a re-grant can
// never double-init); `capturing` = our helpers may send. Consent revoke flips only `capturing`.
let initialized = false;
let capturing = false;
// Last workspace identity AuthContext reported, kept in memory only (never sent while not
// capturing) so a later start can identify the person. Cleared by resetAnalytics.
let lastIdentity: { userId: string; props: WorkspaceUserProps } | null = null;

function applyIdentity(userId: string, props: WorkspaceUserProps): void {
  posthog.identify(userId, { ...props });
  // Retention is a property of the workspace, not the individual — an agency churns, not a seat.
  posthog.group('workspace', props.workspace_id);
}

/**
 * Start or resume product analytics. Called by consent handling only after the visitor opted in
 * (lib/consentEffects.ts). Safe to call when unconfigured (local dev, CI, self-hosters): no-ops.
 * Idempotent: the first call runs posthog.init, later calls (after a revoke) only opt back in.
 */
export function initAnalytics(): void {
  if (!KEY) return;
  if (!initialized) {
    posthog.init(KEY, {
      api_host: HOST,
      // Do not build a person profile for anonymous landing-page traffic — it is noise here, and
      // fewer profiles is the easier LGPD posture to defend.
      person_profiles: 'identified_only',
      capture_pageview: true,
      // Unhandled errors and rejections land in PostHog error tracking. Without this a production
      // JS error is invisible unless a user reports it, and a click that dies on an exception is
      // indistinguishable from a dead button in the rageclick data.
      capture_exceptions: true,
      // Opting out must also drop the ph_* identifier from storage. Without this, opt-out stops
      // capture but leaves distinct_id/device_id behind.
      opt_out_persistence_by_default: true,
    });
    initialized = true;
  }
  // The SDK's opt-out flag survives page loads: a user who revoked yesterday and accepts today
  // gets an initialised but still opted-out SDK unless we opt back in. `captureEventName: false`
  // suppresses the default `$opt_in` event.
  if (posthog.has_opted_out_capturing()) posthog.opt_in_capturing({ captureEventName: false });
  capturing = true;
  if (lastIdentity) applyIdentity(lastIdentity.userId, lastIdentity.props);
}

/**
 * Stop capturing (consent revoked). ORDER MATTERS: reset() deletes the SDK's opt-out flag, so it
 * must run before opt_out_capturing(); the reverse order silently un-revokes and the SDK's own
 * emitters ($pageview, exception capture, autocapture, session replay) resume.
 */
export function disableAnalytics(): void {
  if (!initialized || !capturing) return;
  posthog.reset();
  posthog.opt_out_capturing();
  capturing = false;
}

/**
 * Stitch signup to a real person. Under `person_profiles: 'identified_only'`, events captured
 * while anonymous are personless and are NEVER retroactively attached to the person created by a
 * later identify — so `signup_completed` fired before this call leaves every signup as an orphan
 * whose history ends at the form, and the signup→activation funnel cannot be measured. Must run
 * before the `signup_completed` capture. Only the Supabase uuid goes out (no email/name), which
 * keeps the fewer-profiles LGPD posture that motivated `identified_only`. Without analytics
 * consent nothing is sent and the signup is simply not attributed.
 */
export function identifySignup(userId: string): void {
  if (!capturing) return;
  posthog.identify(userId);
}

export function identifyWorkspaceUser(userId: string, props: WorkspaceUserProps): void {
  lastIdentity = { userId, props };
  if (!capturing) return;
  applyIdentity(userId, props);
}
```

Then change the two remaining `if (!enabled) return;` guards. In `captureEvent` replace `if (!enabled) return;` with `if (!capturing) return;`. Replace `resetAnalytics` with:

```ts
export function resetAnalytics(): void {
  lastIdentity = null;
  if (!capturing) return;
  posthog.reset();
}
```

Also delete the now-unused original `let enabled = false;` line and the old `initAnalytics`/`identifySignup`/`identifyWorkspaceUser` bodies (they were inside the replaced range). Confirm `grep -n "enabled" apps/crm/src/lib/analytics.ts` returns nothing.

- [ ] **Step 4: Run tests**

Run: `npx vitest run apps/crm/src/lib/__tests__/analytics.test.ts`
Expected: PASS (all original + 9 new).

- [ ] **Step 5: Confirm the `opt_in_capturing` option name against the installed types**

Run: `sed -n 4890,4925p node_modules/posthog-js/dist/module.d.ts`
Expected: `opt_in_capturing(options?: { captureEventName?: ... | false ... })`. If the option is named differently, fix both `analytics.ts` and the two test assertions.

- [ ] **Step 6: Commit**

```bash
git add apps/crm/src/lib/analytics.ts apps/crm/src/lib/__tests__/analytics.test.ts
git commit -m "feat(consent): gate PostHog behind consent with safe revoke and resume

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Sentry cleanup and invite-token scrub

**Files:**
- Modify: `apps/crm/src/lib/sentry.ts`
- Test: `apps/crm/src/lib/__tests__/sentry.test.ts` (new)

**Interfaces:**
- Produces: `scrubInviteToken(value: string): string`, `scrubEvent<T extends Scrubbable>(event: T): T`, `initSentry(): void` (unchanged signature).

Background: Sentry replay is not installed (default integrations contain none), so `replaysOnErrorSampleRate` is inert; delete it rather than gate it. Sentry stays on under legitimate interest, so it must not ship invite tokens: the route is `/conectar/:token` (`App.tsx:149`).

- [ ] **Step 1: Write the failing tests**

Create `apps/crm/src/lib/__tests__/sentry.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sentryMock } = vi.hoisted(() => ({
  sentryMock: { init: vi.fn(), browserTracingIntegration: vi.fn(() => ({ name: 'tracing' })) },
}));
vi.mock('@sentry/react', () => sentryMock);

describe('sentry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it('no-ops without a DSN', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', '');
    const { initSentry } = await import('../sentry');
    initSentry();
    expect(sentryMock.init).not.toHaveBeenCalled();
  });

  it('initialises without any replay option (replay is not installed)', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', 'https://key@example.ingest.sentry.io/1');
    const { initSentry } = await import('../sentry');
    initSentry();
    const options = sentryMock.init.mock.calls[0][0] as Record<string, unknown>;
    expect(options).not.toHaveProperty('replaysOnErrorSampleRate');
    expect(options).not.toHaveProperty('replaysSessionSampleRate');
    expect(options.beforeSend).toBeTypeOf('function');
    expect(options.beforeSendTransaction).toBeTypeOf('function');
  });

  it('replaces the invite token in /conectar/:token URLs', async () => {
    const { scrubInviteToken } = await import('../sentry');
    expect(scrubInviteToken('https://app.mesaas.com.br/conectar/abc123?x=1')).toBe(
      'https://app.mesaas.com.br/conectar/:token?x=1',
    );
    expect(scrubInviteToken('/clientes/5')).toBe('/clientes/5');
  });

  it('scrubs the request url, transaction name and navigation breadcrumbs', async () => {
    const { scrubEvent } = await import('../sentry');
    const event = scrubEvent({
      request: { url: 'https://x.test/conectar/secret-token' },
      transaction: '/conectar/secret-token',
      breadcrumbs: [
        { category: 'navigation', data: { from: '/conectar/secret-token', to: '/login' } },
        { category: 'console', data: undefined },
      ],
      spans: [
        {
          description: 'GET https://x.test/conectar/secret-token',
          data: { 'http.url': 'https://x.test/conectar/secret-token', status: 200 },
        },
      ],
      contexts: { trace: { data: { url: '/conectar/secret-token' } } },
    });
    expect(event.request?.url).toBe('https://x.test/conectar/:token');
    expect(event.transaction).toBe('/conectar/:token');
    expect(event.breadcrumbs?.[0].data).toEqual({ from: '/conectar/:token', to: '/login' });
    expect(event.spans?.[0].description).toBe('GET https://x.test/conectar/:token');
    expect(event.spans?.[0].data).toEqual({ 'http.url': 'https://x.test/conectar/:token', status: 200 });
    expect(event.contexts?.trace?.data).toEqual({ url: '/conectar/:token' });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run apps/crm/src/lib/__tests__/sentry.test.ts`
Expected: FAIL (`scrubInviteToken` / `scrubEvent` not exported; replay option still present).

- [ ] **Step 3: Implement**

Replace `apps/crm/src/lib/sentry.ts` with:

```ts
import * as Sentry from '@sentry/react';

const DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined;

/**
 * Sentry stays on under legitimate interest (error reporting, tracing), so it must not carry
 * secrets in URLs: `/conectar/:token` puts an invite token in the path. Replay is deliberately
 * NOT installed; adding it later is a new consent decision (see the cookie-consent spec).
 */
const INVITE_TOKEN_PATH = /\/conectar\/[^/?#]+/g;

export function scrubInviteToken(value: string): string {
  return value.replace(INVITE_TOKEN_PATH, '/conectar/:token');
}

type Data = Record<string, unknown>;

// Sentry runs `beforeSend` for error events only; transactions (browserTracingIntegration names
// them from location.pathname and attaches the URL as request.url / span data) go through
// `beforeSendTransaction`. Both hooks share this scrubber, and it walks every string in the
// free-form data bags rather than guessing key names.
interface Scrubbable {
  request?: { url?: string };
  transaction?: string;
  breadcrumbs?: Array<{ message?: string; data?: Data }>;
  spans?: Array<{ description?: string; data?: Data }>;
  contexts?: { trace?: { data?: Data } };
}

function scrubData(data: Data | undefined): void {
  if (!data) return;
  for (const key of Object.keys(data)) {
    const value = data[key];
    if (typeof value === 'string') data[key] = scrubInviteToken(value);
  }
}

export function scrubEvent<T extends Scrubbable>(event: T): T {
  if (event.request?.url) event.request.url = scrubInviteToken(event.request.url);
  if (event.transaction) event.transaction = scrubInviteToken(event.transaction);
  for (const crumb of event.breadcrumbs ?? []) {
    if (crumb.message) crumb.message = scrubInviteToken(crumb.message);
    scrubData(crumb.data);
  }
  for (const span of event.spans ?? []) {
    if (span.description) span.description = scrubInviteToken(span.description);
    scrubData(span.data);
  }
  scrubData(event.contexts?.trace?.data);
  return event;
}

export function initSentry() {
  if (!DSN) return;

  Sentry.init({
    dsn: DSN,
    environment: import.meta.env.MODE,
    integrations: [Sentry.browserTracingIntegration()],
    tracesSampleRate: 0.2,
    beforeSend: scrubEvent,
    beforeSendTransaction: scrubEvent,
  });
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run apps/crm/src/lib/__tests__/sentry.test.ts && npx tsc -p apps/crm/tsconfig.json --noEmit`
Expected: PASS, no type errors. If `beforeSend: scrubEvent` fails to infer, wrap it: `beforeSend: (event) => scrubEvent(event)`.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/lib/sentry.ts apps/crm/src/lib/__tests__/sentry.test.ts
git commit -m "fix(sentry): drop inert replay option and scrub invite tokens from URLs

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Crisp loader, support chat, consent effects, boot wiring

**Files:**
- Create: `apps/crm/src/lib/crispLoader.ts`
- Create: `apps/crm/src/lib/supportChat.ts`
- Create: `apps/crm/src/lib/consentEffects.ts`
- Modify: `apps/crm/index.html:30-32`
- Modify: `apps/crm/src/main.tsx:5-6,30-40`
- Test: `apps/crm/src/lib/__tests__/crispLoader.test.ts`, `supportChat.test.ts`, `consentEffects.test.ts` (new)

**Interfaces:**
- Consumes (Task 1): `getConsent`, `subscribe`, `openConsentPreferences`. (Task 2): `initAnalytics`, `disableAnalytics`.
- Produces: `loadCrisp(): void` (once), `loadCrispWhenIdle(): void`, `openSupportChat(): void`, `resumePendingSupportChat(): void`, `clearPendingSupportChat(): void`, `installConsentEffects(): void`.

Behaviour contract of `installConsentEffects` (first call = "boot", later changes = "user action"):
- boot + analytics granted → `initAnalytics` deferred to idle (requestIdleCallback timeout 3000, fallback setTimeout 1500), as today; user grants later → `initAnalytics` immediately.
- analytics not granted at boot → `purgeAnalyticsStorage()`; revoke after boot → `disableAnalytics()` then `purgeAnalyticsStorage()`.
- support granted at boot → `loadCrispWhenIdle()`; granted later → `loadCrisp()` + `resumePendingSupportChat()`.
- support not granted at boot → `purgeSupportStorage()`. Support **revoke is NOT handled here**: `AuthContext` owns the Crisp teardown ordering (Task 5).

- [ ] **Step 1: Write the failing tests**

Create `apps/crm/src/lib/__tests__/crispLoader.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('crispLoader', () => {
  beforeEach(() => {
    vi.resetModules();
    document.head.querySelectorAll('script').forEach((s) => s.remove());
    delete (window as { $crisp?: unknown }).$crisp;
  });
  afterEach(() => vi.useRealTimers());

  it('injects the Crisp script exactly once', async () => {
    const { loadCrisp, CRISP_SCRIPT_SRC } = await import('../crispLoader');
    loadCrisp();
    loadCrisp();
    expect(document.head.querySelectorAll(`script[src="${CRISP_SCRIPT_SRC}"]`)).toHaveLength(1);
  });

  it('keeps an existing $crisp queue so earlier pushes are consumed by the widget', async () => {
    const queue: unknown[][] = [['set', 'user:nickname', ['Ana']]];
    window.$crisp = queue;
    const { loadCrisp } = await import('../crispLoader');
    loadCrisp();
    expect(window.$crisp).toBe(queue);
  });

  it('creates the queue when it is missing', async () => {
    const { loadCrisp } = await import('../crispLoader');
    loadCrisp();
    expect(Array.isArray(window.$crisp)).toBe(true);
  });

  it('loadCrispWhenIdle defers the load (setTimeout fallback in jsdom)', async () => {
    vi.useFakeTimers();
    const { loadCrispWhenIdle, CRISP_SCRIPT_SRC } = await import('../crispLoader');
    loadCrispWhenIdle();
    expect(document.head.querySelector(`script[src="${CRISP_SCRIPT_SRC}"]`)).toBeNull();
    vi.advanceTimersByTime(2500);
    expect(document.head.querySelector(`script[src="${CRISP_SCRIPT_SRC}"]`)).not.toBeNull();
  });
});
```

Create `apps/crm/src/lib/__tests__/supportChat.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { seedConsent } from '../../test/consent';

describe('supportChat', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    document.head.querySelectorAll('script').forEach((s) => s.remove());
    window.$crisp = [];
  });

  it('opens the consent dialog focused on support when consent is missing (no dead click)', async () => {
    const { OPEN_PREFERENCES_EVENT } = await import('../consent');
    const handler = vi.fn();
    window.addEventListener(OPEN_PREFERENCES_EVENT, handler);
    const { openSupportChat } = await import('../supportChat');
    openSupportChat();
    window.removeEventListener(OPEN_PREFERENCES_EVENT, handler);
    expect((handler.mock.calls[0][0] as CustomEvent).detail).toEqual({ focus: 'support' });
    expect(window.$crisp).toEqual([]);
  });

  it('shows and opens the chat when support consent is granted', async () => {
    seedConsent({ support: true });
    const { openSupportChat } = await import('../supportChat');
    openSupportChat();
    expect(window.$crisp).toEqual([
      ['do', 'chat:show'],
      ['do', 'chat:open'],
    ]);
  });

  it('opens the chat once consent arrives after a blocked click, but not after the dialog was dismissed', async () => {
    const { openSupportChat, resumePendingSupportChat, clearPendingSupportChat } = await import(
      '../supportChat'
    );
    openSupportChat();
    seedConsent({ support: true });
    resumePendingSupportChat();
    expect(window.$crisp).toContainEqual(['do', 'chat:open']);

    window.$crisp = [];
    localStorage.clear();
    openSupportChat();
    clearPendingSupportChat();
    seedConsent({ support: true });
    resumePendingSupportChat();
    expect(window.$crisp).toEqual([]);
  });
});
```

Create `apps/crm/src/lib/__tests__/consentEffects.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { seedConsent } from '../../test/consent';

const m = vi.hoisted(() => ({
  initAnalytics: vi.fn(),
  disableAnalytics: vi.fn(),
  loadCrisp: vi.fn(),
  loadCrispWhenIdle: vi.fn(),
  purgeAnalyticsStorage: vi.fn(),
  purgeSupportStorage: vi.fn(),
  resumePendingSupportChat: vi.fn(),
}));
vi.mock('../analytics', () => ({
  initAnalytics: m.initAnalytics,
  disableAnalytics: m.disableAnalytics,
}));
vi.mock('../crispLoader', () => ({
  loadCrisp: m.loadCrisp,
  loadCrispWhenIdle: m.loadCrispWhenIdle,
}));
vi.mock('../legacyStorage', () => ({
  purgeAnalyticsStorage: m.purgeAnalyticsStorage,
  purgeSupportStorage: m.purgeSupportStorage,
}));
vi.mock('../supportChat', () => ({ resumePendingSupportChat: m.resumePendingSupportChat }));

async function boot() {
  const consent = await import('../consent');
  const { installConsentEffects } = await import('../consentEffects');
  installConsentEffects();
  return consent;
}

describe('installConsentEffects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.useFakeTimers();
    localStorage.clear();
  });
  afterEach(() => vi.useRealTimers());

  it('loads nothing and purges legacy storage when the visitor is undecided', async () => {
    await boot();
    vi.advanceTimersByTime(5000);
    expect(m.initAnalytics).not.toHaveBeenCalled();
    expect(m.loadCrisp).not.toHaveBeenCalled();
    expect(m.loadCrispWhenIdle).not.toHaveBeenCalled();
    expect(m.purgeAnalyticsStorage).toHaveBeenCalledTimes(1);
    expect(m.purgeSupportStorage).toHaveBeenCalledTimes(1);
  });

  it('defers both tools to idle at boot when consent is already stored', async () => {
    seedConsent({ analytics: true, support: true });
    await boot();
    expect(m.initAnalytics).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1500);
    expect(m.initAnalytics).toHaveBeenCalledTimes(1);
    expect(m.loadCrispWhenIdle).toHaveBeenCalledTimes(1);
    expect(m.purgeAnalyticsStorage).not.toHaveBeenCalled();
    expect(m.purgeSupportStorage).not.toHaveBeenCalled();
  });

  it('starts analytics immediately when the visitor accepts after boot', async () => {
    const { setConsent } = await boot();
    setConsent({ analytics: true, support: false });
    expect(m.initAnalytics).toHaveBeenCalledTimes(1);
    expect(m.loadCrisp).not.toHaveBeenCalled();
  });

  it('loads Crisp immediately on a later support grant and resumes a blocked chat click', async () => {
    const { setConsent } = await boot();
    setConsent({ analytics: false, support: true });
    expect(m.loadCrisp).toHaveBeenCalledTimes(1);
    expect(m.resumePendingSupportChat).toHaveBeenCalledTimes(1);
  });

  it('on analytics revoke: disables PostHog, then purges its storage', async () => {
    const { setConsent } = await boot();
    setConsent({ analytics: true, support: false });
    m.purgeAnalyticsStorage.mockClear();
    setConsent({ analytics: false, support: false });
    expect(m.disableAnalytics).toHaveBeenCalledTimes(1);
    expect(m.purgeAnalyticsStorage).toHaveBeenCalledTimes(1);
    expect(m.disableAnalytics.mock.invocationCallOrder[0]).toBeLessThan(
      m.purgeAnalyticsStorage.mock.invocationCallOrder[0],
    );
  });

  it('does NOT tear Crisp down on support revoke (AuthContext owns that ordering)', async () => {
    const { setConsent } = await boot();
    setConsent({ analytics: false, support: true });
    m.purgeSupportStorage.mockClear();
    setConsent({ analytics: false, support: false });
    expect(m.purgeSupportStorage).not.toHaveBeenCalled();
  });

  it('does not purge repeatedly for an unrelated change', async () => {
    const { setConsent } = await boot();
    m.purgeAnalyticsStorage.mockClear();
    setConsent({ analytics: false, support: true });
    expect(m.purgeAnalyticsStorage).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run apps/crm/src/lib/__tests__/crispLoader.test.ts apps/crm/src/lib/__tests__/supportChat.test.ts apps/crm/src/lib/__tests__/consentEffects.test.ts`
Expected: FAIL (modules do not exist).

- [ ] **Step 3: Implement the three modules**

Create `apps/crm/src/lib/crispLoader.ts`:

```ts
export const CRISP_SCRIPT_SRC = 'https://client.crisp.chat/l.js';

let requested = false;

/**
 * Injects the Crisp widget script. Runs only after the visitor consented to the `support`
 * category. `index.html` keeps `window.$crisp = []` and `CRISP_WEBSITE_ID` (the queue), so every
 * push made before this loads is consumed by the widget once it does.
 */
export function loadCrisp(): void {
  if (requested || typeof document === 'undefined') return;
  requested = true;
  window.$crisp = window.$crisp ?? [];
  const script = document.createElement('script');
  script.src = CRISP_SCRIPT_SRC;
  script.async = true;
  document.head.appendChild(script);
}

/** Same as loadCrisp but off the critical path (PageSpeed: third-party payload). */
export function loadCrispWhenIdle(): void {
  if ('requestIdleCallback' in window) {
    requestIdleCallback(() => loadCrisp(), { timeout: 4000 });
  } else {
    setTimeout(loadCrisp, 2500);
  }
}
```

Create `apps/crm/src/lib/supportChat.ts`:

```ts
import { getConsent, openConsentPreferences } from './consent';
import { loadCrisp } from './crispLoader';

let pendingOpen = false;

function showChat(): void {
  loadCrisp();
  window.$crisp?.push(['do', 'chat:show']);
  window.$crisp?.push(['do', 'chat:open']);
}

/**
 * The single entry point for "open the support chat". Without support consent the widget is not
 * loaded, so a bare `$crisp.push(['do','chat:open'])` would be a silent dead click; instead we
 * open the consent dialog focused on the support toggle and open the chat once it is granted.
 */
export function openSupportChat(): void {
  if (getConsent()?.support !== true) {
    pendingOpen = true;
    openConsentPreferences('support');
    return;
  }
  showChat();
}

/** Called by consent handling when support consent is granted. */
export function resumePendingSupportChat(): void {
  if (!pendingOpen) return;
  pendingOpen = false;
  showChat();
}

/** Called when the dialog closes, so a later unrelated grant does not pop the chat open. */
export function clearPendingSupportChat(): void {
  pendingOpen = false;
}
```

Create `apps/crm/src/lib/consentEffects.ts`:

```ts
import { disableAnalytics, initAnalytics } from './analytics';
import { getConsent, subscribe } from './consent';
import { loadCrisp, loadCrispWhenIdle } from './crispLoader';
import { purgeAnalyticsStorage, purgeSupportStorage } from './legacyStorage';
import { resumePendingSupportChat } from './supportChat';

// PostHog pulls in ~108 KiB of lazy extensions (recorder, surveys, web-vitals) as soon as it
// boots. At page load, with consent already stored, keep that off the critical path (PageSpeed:
// third-party payload). A user clicking "Aceitar" is different: start right away.
function initAnalyticsWhenIdle(): void {
  if ('requestIdleCallback' in window) {
    requestIdleCallback(() => initAnalytics(), { timeout: 3000 });
  } else {
    setTimeout(() => initAnalytics(), 1500);
  }
}

/**
 * Applies the stored consent at boot and every later change. The first `apply()` is "boot";
 * anything after is a user action.
 *
 * Crisp REVOKE is deliberately absent: tearing the widget down has to happen in AuthContext, in
 * the same order as its sign-out (bump crispResetGeneration, clear the session cache, then
 * session:reset), or an in-flight crisp-identity response can re-identify a reset session.
 */
export function installConsentEffects(): void {
  let analyticsOn = false;
  let supportOn = false;
  let booted = false;

  const apply = (): void => {
    const consent = getConsent();
    const analytics = consent?.analytics === true;
    const support = consent?.support === true;

    if (analytics && !analyticsOn) {
      if (booted) initAnalytics();
      else initAnalyticsWhenIdle();
    }
    if (!analytics) {
      if (analyticsOn) disableAnalytics();
      // Boot: clear identifiers left by pre-gate tracking. Revoke: clear what the SDK left.
      if (analyticsOn || !booted) purgeAnalyticsStorage();
    }

    if (support && !supportOn) {
      if (booted) loadCrisp();
      else loadCrispWhenIdle();
      resumePendingSupportChat();
    }
    if (!support && !booted) purgeSupportStorage();

    analyticsOn = analytics;
    supportOn = support;
    booted = true;
  };

  apply();
  subscribe(apply);
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run apps/crm/src/lib/__tests__/crispLoader.test.ts apps/crm/src/lib/__tests__/supportChat.test.ts apps/crm/src/lib/__tests__/consentEffects.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire `index.html` and `main.tsx`**

In `apps/crm/index.html` replace the Crisp comment + script (lines 30-32) with exactly:

```html
    <!-- Crisp: only the $crisp queue and the website id live here. The widget script is injected
         by lib/crispLoader.ts after the visitor consents to the support category. $crisp queues
         calls immediately, so every window.$crisp.push in the app is harmless until then. -->
    <script type="text/javascript">window.$crisp=[];window.CRISP_WEBSITE_ID="bc54b5a7-dc07-46a9-8b6a-1c3ba9923314";</script>
```

In `apps/crm/src/main.tsx`: replace `import { initAnalytics } from './lib/analytics';` with `import { installConsentEffects } from './lib/consentEffects';`, and replace the block from the `// PostHog pulls in ~108 KiB...` comment through the closing `}` of the `if/else` (lines ~32-40) with:

```ts
// PostHog and the Crisp widget start only after the visitor's consent (lib/consentEffects.ts);
// with consent already stored they still load on idle, off the landing page's critical path.
installConsentEffects();
```

Keep `initSentry();` where it is.

- [ ] **Step 6: Typecheck**

Run: `npx tsc -p apps/crm/tsconfig.json --noEmit`
Expected: no errors (`window.$crisp` is declared globally in `TopBarActions.tsx`).

- [ ] **Step 7: Commit**

```bash
git add apps/crm/src/lib/crispLoader.ts apps/crm/src/lib/supportChat.ts apps/crm/src/lib/consentEffects.ts apps/crm/src/lib/__tests__/crispLoader.test.ts apps/crm/src/lib/__tests__/supportChat.test.ts apps/crm/src/lib/__tests__/consentEffects.test.ts apps/crm/index.html apps/crm/src/main.tsx
git commit -m "feat(consent): load Crisp and PostHog only after consent

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: AuthContext: gate Crisp identify, revoke teardown

**Files:**
- Modify: `apps/crm/src/context/AuthContext.tsx` (imports `:26-35`; declarations near `:218-221`; nickname/identify effects `:462-575`)
- Modify: `apps/crm/src/context/__tests__/AuthContext.test.tsx` (`describe('AuthProvider Crisp identification')` at `:485`)

**Interfaces:**
- Consumes (Task 1): `useConsent`, `getConsent`, `purgeSupportStorage`.
- Produces: no new exports. Behaviour: no `crisp-identity` invoke and no `$crisp` identity push without support consent; identify runs once when consent is granted mid-session; revoke performs the same teardown as `signOut` (generation bump, then `CRISP_TOKEN_ID = null` + cache clear, then `session:reset` + `chat:hide`), then purges Crisp storage.

- [ ] **Step 1: Seed consent in the existing Crisp tests and write the new failing tests**

In `AuthContext.test.tsx`, add imports next to the other test imports:

```ts
import { seedConsent } from '../../test/consent';
import { CONSENT_STORAGE_KEY, setConsent } from '../../lib/consent';
```

In `describe('AuthProvider Crisp identification')`'s `beforeEach`, after the existing `localStorage.clear();` line add: `seedConsent({ support: true });`.

Inside the same describe add (before its closing `});`; reuse the `OWNER_PROFILE` const and `renderWithAuth`, and read `lib/__mocks__/supabase.ts` first to see how `supabase.functions.invoke` is exposed, adapting the `invokeSpy` line if it is not a `vi.fn`):

```ts
  const invokeSpy = () => vi.mocked(supabaseModule.supabase.functions.invoke);

  function signedInOwner() {
    mockedSupabase.__resetSupabaseMock();
    mockedSupabase.__setCurrentUser({ id: 'user-1', email: 'eduardo@example.com' });
    mockedSupabase.__setCurrentProfile(OWNER_PROFILE);
  }

  it('does not call crisp-identity or push identity without support consent', async () => {
    localStorage.removeItem(CONSENT_STORAGE_KEY);
    signedInOwner();

    renderWithAuth();
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));

    expect(invokeSpy()).not.toHaveBeenCalledWith('crisp-identity', expect.anything());
    expect(crispPush).not.toHaveBeenCalledWith(['set', 'user:email', expect.anything()]);
    expect(crispPush).not.toHaveBeenCalledWith(['set', 'user:nickname', expect.anything()]);
  });

  it('identifies once when support consent is granted mid-session', async () => {
    localStorage.removeItem(CONSENT_STORAGE_KEY);
    signedInOwner();

    renderWithAuth();
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));
    expect(crispPush).not.toHaveBeenCalledWith(['set', 'user:email', expect.anything()]);

    await act(async () => {
      setConsent({ analytics: false, support: true });
    });

    await waitFor(() => {
      expect(crispPush).toHaveBeenCalledWith(['set', 'user:email', ['eduardo@example.com']]);
    });
    await waitFor(() => {
      expect(crispPush).toHaveBeenCalledWith(['set', 'user:nickname', ['Eduardo Souza']]);
    });
  });

  it('revoking support consent tears the Crisp session down like sign-out does', async () => {
    signedInOwner();
    window.CRISP_TOKEN_ID = 'tok-1';
    localStorage.setItem(
      CRISP_SESSION_STORAGE_KEY,
      JSON.stringify({ userId: 'user-1', token: 'tok-1' }),
    );

    renderWithAuth();
    await waitFor(() => {
      expect(crispPush).toHaveBeenCalledWith(['set', 'user:email', ['eduardo@example.com']]);
    });
    crispPush.mockClear();

    await act(async () => {
      setConsent({ analytics: false, support: false });
    });

    expect(crispPush).toHaveBeenCalledWith(['do', 'session:reset']);
    expect(crispPush).toHaveBeenCalledWith(['do', 'chat:hide']);
    expect(window.CRISP_TOKEN_ID).toBeNull();
    expect(localStorage.getItem(CRISP_SESSION_STORAGE_KEY)).toBeNull();
  });

  it('discards an in-flight crisp-identity response that lands after the consent was revoked', async () => {
    signedInOwner();
    let resolveInvoke!: (value: { data: unknown; error?: unknown }) => void;
    mockedSupabase.__queueFunctionsInvokeResponse(
      new Promise((resolve) => {
        resolveInvoke = resolve;
      }),
    );

    renderWithAuth();
    await waitFor(() => {
      expect(invokeSpy()).toHaveBeenCalledWith('crisp-identity', expect.anything());
    });

    await act(async () => {
      setConsent({ analytics: false, support: false });
    });
    crispPush.mockClear();
    await act(async () => {
      resolveInvoke({ data: { signature: 'abc' }, error: null });
    });

    expect(crispPush).not.toHaveBeenCalledWith(['set', 'user:email', expect.anything()]);
  });
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `npx vitest run apps/crm/src/context/__tests__/AuthContext.test.tsx -t "Crisp identification"`
Expected: the four new tests FAIL (identify runs regardless of consent; no revoke teardown); the pre-existing Crisp tests pass because consent is seeded.

- [ ] **Step 3: Implement**

In `AuthContext.tsx` add imports after the `crispSession` import block:

```ts
import { getConsent } from '../lib/consent';
import { useConsent } from '../lib/useConsent';
import { purgeSupportStorage } from '../lib/legacyStorage';
```

Directly after the line `const userId = user?.id;` (near `:221`) add:

```ts
  // Crisp only runs with the visitor's support consent (cookie-consent spec). Read reactively so
  // a grant through the dialog re-runs the identify effects below without a reload.
  const supportConsent = useConsent()?.support === true;
  const prevSupportConsent = useRef(supportConsent);

  // Revoke: mirror signOut's Crisp teardown, in the same order and for the same reason. The
  // generation bump comes first so a crisp-identity response already in flight can never
  // re-identify the reset session; the token/cache go next (crisp_session_v1 is Mesaas-owned,
  // so a leftover would make the `matches` check in the identify effect skip the rebind on a
  // later re-grant); only then the widget reset and hide. The widget script cannot be unloaded,
  // so this is best effort until the next reload, where consentEffects purges what is left.
  useEffect(() => {
    const revoked = prevSupportConsent.current && !supportConsent;
    prevSupportConsent.current = supportConsent;
    if (!revoked) return;
    crispResetGeneration.current += 1;
    window.CRISP_TOKEN_ID = null;
    clearCrispSessionCache();
    try {
      window.$crisp?.push(['do', 'session:reset']);
      window.$crisp?.push(['do', 'chat:hide']);
    } catch {
      // Never let a support-tooling nicety break auth.
    }
    purgeSupportStorage();
  }, [supportConsent]);
```

In the Crisp identify effect (`useEffect(() => { if (!userId) return; let active = true; const initialCrispResetGeneration ...`) change the first guard to:

```ts
    if (!userId || !supportConsent) return;
```

Change the post-await guard to also check consent:

```ts
      if (
        !active ||
        crispResetGeneration.current !== initialCrispResetGeneration ||
        getConsent()?.support !== true
      ) {
        return;
      }
```

and its dependency array from `[userId, user?.email]` to `[userId, user?.email, supportConsent]`.

In the nickname effect (`useEffect(() => { if (!userId) return; if (profile?.nome) {`) change the first line to `if (!userId || !supportConsent) return;` and its deps to `[userId, profile?.nome, supportConsent]`.

- [ ] **Step 3b: Extend the comment above the identify effect**

Append to the long comment block above the identify effect one paragraph: `Consent: this effect is inert without support consent (no crisp-identity invoke, no pushes, no cache writes) and re-runs on a grant. The post-await getConsent() check covers a revoke that lands mid-flight in addition to the generation guard.`

- [ ] **Step 4: Run the AuthContext suite**

Run: `npx vitest run apps/crm/src/context/__tests__/AuthContext.test.tsx`
Expected: PASS (whole file). If a test outside the Crisp describe now fails because it relied on a queued `crisp-identity` response being consumed, seed consent in that test or queue nothing; do not weaken the new gating.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/context/AuthContext.tsx apps/crm/src/context/__tests__/AuthContext.test.tsx
git commit -m "feat(consent): gate Crisp identification and add revoke teardown

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Consent UI (banner, dialog, link, i18n, CSS, App mount)

**Files:**
- Create: `apps/crm/src/components/consent/CookieConsent.tsx`
- Create: `apps/crm/src/components/consent/CookiePreferencesDialog.tsx`
- Create: `apps/crm/src/components/consent/CookiePreferencesLink.tsx`
- Modify: `packages/i18n/locales/pt/common.json`, `packages/i18n/locales/en/common.json` (new top-level `cookies` block, after the last existing key)
- Modify: `apps/crm/style.css` (append `.cookie-banner` rules)
- Modify: `apps/crm/src/App.tsx:260` (mount next to `<Analytics />`)
- Test: `apps/crm/src/components/consent/__tests__/CookieConsent.test.tsx`

**Interfaces:**
- Consumes (Task 1): `useConsent`, `setConsent`, `OPEN_PREFERENCES_EVENT`, `openConsentPreferences`, `ConsentCategory`. (Task 4): `clearPendingSupportChat`.
- Produces: `default CookieConsent` (banner + dialog owner), `CookiePreferencesDialog`, `CookiePreferencesLink({ children?, className?, style? })` (Node-safe: no hooks, no i18n).

- [ ] **Step 1: Add i18n strings**

Confirm there is no existing `cookies` key: `grep -n '"cookies"' packages/i18n/locales/*/common.json` (expect nothing). In `packages/i18n/locales/pt/common.json` add a comma after the last top-level block's closing `}` and append:

```json
  "cookies": {
    "banner": {
      "title": "Cookies e privacidade",
      "body": "Usamos armazenamento essencial para o Mesaas funcionar. Com a sua permissão, também usamos análise de uso (incluindo gravação de sessão e mapas de calor) e o chat de suporte.",
      "learnMore": "Ver detalhes na página de LGPD",
      "acceptAll": "Aceitar todos",
      "rejectAll": "Rejeitar todos",
      "customize": "Personalizar"
    },
    "dialog": {
      "title": "Preferências de cookies",
      "description": "Escolha quais ferramentas opcionais podem usar o armazenamento do seu navegador. Você pode mudar isso quando quiser.",
      "essentialTitle": "Essenciais",
      "essentialDescription": "Sessão de login, idioma, tema e esta escolha. Sempre ativos: o Mesaas não funciona sem eles.",
      "analyticsTitle": "Análise e diagnóstico",
      "analyticsDescription": "PostHog: métricas de uso, gravação de sessão e mapas de calor para melhorarmos o produto.",
      "supportTitle": "Chat de suporte",
      "supportDescription": "Crisp: chat com a nossa equipe. Sem isto o chat não carrega.",
      "supportNeeded": "Para abrir o chat de suporte, mantenha o Chat de suporte ativado e salve.",
      "revokeNote": "Ao desativar uma ferramenta, o efeito é aplicado por completo ao recarregar a página.",
      "save": "Salvar preferências",
      "cancel": "Cancelar"
    },
    "link": "Preferências de cookies"
  }
```

In `en/common.json` append the English equivalent (same keys):

```json
  "cookies": {
    "banner": {
      "title": "Cookies and privacy",
      "body": "We use essential storage so Mesaas works. With your permission we also use usage analytics (including session recording and heatmaps) and the support chat.",
      "learnMore": "See details on the data protection page",
      "acceptAll": "Accept all",
      "rejectAll": "Reject all",
      "customize": "Customize"
    },
    "dialog": {
      "title": "Cookie preferences",
      "description": "Choose which optional tools may use your browser's storage. You can change this at any time.",
      "essentialTitle": "Essential",
      "essentialDescription": "Login session, language, theme and this choice. Always on: Mesaas does not work without them.",
      "analyticsTitle": "Analytics and diagnostics",
      "analyticsDescription": "PostHog: usage metrics, session recording and heatmaps so we can improve the product.",
      "supportTitle": "Support chat",
      "supportDescription": "Crisp: chat with our team. Without this the chat does not load.",
      "supportNeeded": "To open the support chat, keep Support chat enabled and save.",
      "revokeNote": "Turning a tool off takes full effect after you reload the page.",
      "save": "Save preferences",
      "cancel": "Cancel"
    },
    "link": "Cookie preferences"
  }
```

- [ ] **Step 2: Write the failing component tests**

Create `apps/crm/src/components/consent/__tests__/CookieConsent.test.tsx`:

```tsx
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from 'i18next';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getConsent, openConsentPreferences } from '@/lib/consent';
import { seedConsent } from '../../../test/consent';
import CookieConsent from '../CookieConsent';

const t = (key: string) => i18n.t(key);

function renderBanner() {
  return render(
    <MemoryRouter>
      <CookieConsent />
    </MemoryRouter>,
  );
}

describe('CookieConsent', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('shows the banner only while the visitor is undecided', () => {
    const { unmount } = renderBanner();
    expect(screen.getByRole('region', { name: t('cookies.banner.title') })).toBeInTheDocument();
    unmount();

    seedConsent({ analytics: true, support: true });
    renderBanner();
    expect(screen.queryByRole('region', { name: t('cookies.banner.title') })).toBeNull();
  });

  it('gives Accept all and Reject all the same visual weight', () => {
    renderBanner();
    const accept = screen.getByRole('button', { name: t('cookies.banner.acceptAll') });
    const reject = screen.getByRole('button', { name: t('cookies.banner.rejectAll') });
    expect(accept.className).toBe(reject.className);
  });

  it('Accept all stores both categories as granted', async () => {
    renderBanner();
    await userEvent.click(screen.getByRole('button', { name: t('cookies.banner.acceptAll') }));
    expect(getConsent()).toMatchObject({ analytics: true, support: true });
    expect(screen.queryByRole('region', { name: t('cookies.banner.title') })).toBeNull();
  });

  it('Reject all stores both categories as denied', async () => {
    renderBanner();
    await userEvent.click(screen.getByRole('button', { name: t('cookies.banner.rejectAll') }));
    expect(getConsent()).toMatchObject({ analytics: false, support: false });
  });

  it('Customize lets the visitor grant one category and saves that choice', async () => {
    renderBanner();
    await userEvent.click(screen.getByRole('button', { name: t('cookies.banner.customize') }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(
      within(dialog).getByRole('switch', { name: t('cookies.dialog.analyticsTitle') }),
    );
    await userEvent.click(
      within(dialog).getByRole('button', { name: t('cookies.dialog.save') }),
    );
    expect(getConsent()).toMatchObject({ analytics: true, support: false });
  });

  it('re-opens the preferences dialog after a decision (withdrawal must stay easy)', async () => {
    seedConsent({ analytics: true, support: true });
    renderBanner();
    act(() => openConsentPreferences());
    const dialog = await screen.findByRole('dialog');
    const analytics = within(dialog).getByRole('switch', {
      name: t('cookies.dialog.analyticsTitle'),
    });
    expect(analytics).toBeChecked();
    await userEvent.click(analytics);
    await userEvent.click(within(dialog).getByRole('button', { name: t('cookies.dialog.save') }));
    expect(getConsent()).toMatchObject({ analytics: false, support: true });
  });

  it('pre-enables the support switch when opened from a blocked chat click', async () => {
    seedConsent({ analytics: false, support: false });
    renderBanner();
    act(() => openConsentPreferences('support'));
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByRole('switch', { name: t('cookies.dialog.supportTitle') }),
    ).toBeChecked();
    expect(within(dialog).getByText(t('cookies.dialog.supportNeeded'))).toBeInTheDocument();
  });
});
```

Confirm `@testing-library/user-event` is installed (`grep user-event package.json`); if it is not, use `fireEvent` from `@testing-library/react` instead and keep the same assertions.

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run apps/crm/src/components/consent/__tests__/CookieConsent.test.tsx`
Expected: FAIL (components do not exist).

- [ ] **Step 4: Implement the components**

Create `apps/crm/src/components/consent/CookiePreferencesLink.tsx`:

```tsx
import type { CSSProperties, ReactNode } from 'react';
import { openConsentPreferences } from '@/lib/consent';

interface Props {
  children?: ReactNode;
  /** When given, the default link look is NOT applied (the caller styles it). */
  className?: string;
  style?: CSSProperties;
}

const DEFAULT_STYLE: CSSProperties = {
  color: 'var(--primary-color)',
  textDecoration: 'underline',
  background: 'none',
  border: 0,
  padding: 0,
  font: 'inherit',
  cursor: 'pointer',
};

/**
 * Withdrawal entry point. Deliberately no hooks and no i18n: LgpdPage renders this in Node during
 * prerender (scripts/seo/prerender.tsx), where neither is initialised. Copy is pt by default.
 */
export function CookiePreferencesLink({
  children = 'Preferências de cookies',
  className,
  style,
}: Props) {
  return (
    <button
      type="button"
      className={className}
      style={className ? style : { ...DEFAULT_STYLE, ...style }}
      onClick={() => openConsentPreferences()}
    >
      {children}
    </button>
  );
}
```

Create `apps/crm/src/components/consent/CookiePreferencesDialog.tsx`:

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { setConsent, type ConsentCategory } from '@/lib/consent';
import { useConsent } from '@/lib/useConsent';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Category to pre-enable (a blocked chat click asks for `support`). */
  focus?: ConsentCategory;
}

// Mounted only while the dialog is open (inside DialogContent), so the switches always start from
// the stored choice instead of leaking state from a previous open.
function PreferencesForm({ focus, onClose }: { focus?: ConsentCategory; onClose: () => void }) {
  const { t } = useTranslation();
  const consent = useConsent();
  const [analytics, setAnalytics] = useState(consent?.analytics === true);
  const [support, setSupport] = useState(focus === 'support' ? true : consent?.support === true);

  const save = () => {
    setConsent({ analytics, support });
    onClose();
  };

  return (
    <>
      <div className="space-y-4">
        <div className="rounded-lg border p-3">
          <p className="text-sm font-medium">{t('cookies.dialog.essentialTitle')}</p>
          <p className="text-sm text-muted-foreground">
            {t('cookies.dialog.essentialDescription')}
          </p>
        </div>

        <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
          <div>
            <Label htmlFor="cookie-analytics" className="text-sm font-medium">
              {t('cookies.dialog.analyticsTitle')}
            </Label>
            <p className="text-sm text-muted-foreground">
              {t('cookies.dialog.analyticsDescription')}
            </p>
          </div>
          <Switch id="cookie-analytics" checked={analytics} onCheckedChange={setAnalytics} />
        </div>

        <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
          <div>
            <Label htmlFor="cookie-support" className="text-sm font-medium">
              {t('cookies.dialog.supportTitle')}
            </Label>
            <p className="text-sm text-muted-foreground">
              {t('cookies.dialog.supportDescription')}
            </p>
            {focus === 'support' && (
              <p className="mt-1 text-sm font-medium">{t('cookies.dialog.supportNeeded')}</p>
            )}
          </div>
          <Switch id="cookie-support" checked={support} onCheckedChange={setSupport} />
        </div>

        <p className="text-xs text-muted-foreground">{t('cookies.dialog.revokeNote')}</p>
      </div>
      <DialogFooter className="mt-4">
        <Button variant="outline" onClick={onClose}>
          {t('cookies.dialog.cancel')}
        </Button>
        <Button onClick={save}>{t('cookies.dialog.save')}</Button>
      </DialogFooter>
    </>
  );
}

export function CookiePreferencesDialog({ open, onOpenChange, focus }: Props) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('cookies.dialog.title')}</DialogTitle>
          <DialogDescription>{t('cookies.dialog.description')}</DialogDescription>
        </DialogHeader>
        <PreferencesForm focus={focus} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
```

Create `apps/crm/src/components/consent/CookieConsent.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { OPEN_PREFERENCES_EVENT, setConsent, type ConsentCategory } from '@/lib/consent';
import { clearPendingSupportChat } from '@/lib/supportChat';
import { useConsent } from '@/lib/useConsent';
import { CookiePreferencesDialog } from './CookiePreferencesDialog';

/**
 * Mounted once in App.tsx. Owns both the first-visit banner (visible only while the visitor is
 * undecided) and the preferences dialog, which any "Preferências de cookies" link reopens via
 * openConsentPreferences() at any time.
 */
export default function CookieConsent() {
  const { t } = useTranslation();
  const consent = useConsent();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [focus, setFocus] = useState<ConsentCategory | undefined>();

  useEffect(() => {
    const onOpen = (event: Event) => {
      setFocus((event as CustomEvent<{ focus?: ConsentCategory }>).detail?.focus);
      setDialogOpen(true);
    };
    window.addEventListener(OPEN_PREFERENCES_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_PREFERENCES_EVENT, onOpen);
  }, []);

  const handleOpenChange = (open: boolean) => {
    setDialogOpen(open);
    // A dismissed dialog must not leave a chat-open request waiting for some later grant.
    if (!open) clearPendingSupportChat();
  };

  return (
    <>
      {consent === null && (
        <section
          role="region"
          aria-label={t('cookies.banner.title')}
          className="cookie-banner fixed inset-x-4 bottom-4 z-[9000] mx-auto max-w-3xl rounded-xl border bg-card p-4 text-card-foreground shadow-lg sm:flex sm:items-center sm:gap-4"
        >
          <div className="flex-1 text-sm">
            <p className="font-medium">{t('cookies.banner.title')}</p>
            <p className="text-muted-foreground">
              {t('cookies.banner.body')}{' '}
              <Link to="/lgpd" className="underline">
                {t('cookies.banner.learnMore')}
              </Link>
            </p>
          </div>
          <div className="mt-3 flex flex-wrap gap-2 sm:mt-0 sm:shrink-0">
            <Button variant="ghost" size="sm" onClick={() => setDialogOpen(true)}>
              {t('cookies.banner.customize')}
            </Button>
            {/* Same variant on purpose: rejecting must not look less clickable than accepting. */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConsent({ analytics: false, support: false })}
            >
              {t('cookies.banner.rejectAll')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConsent({ analytics: true, support: true })}
            >
              {t('cookies.banner.acceptAll')}
            </Button>
          </div>
        </section>
      )}
      <CookiePreferencesDialog open={dialogOpen} onOpenChange={handleOpenChange} focus={focus} />
    </>
  );
}
```

- [ ] **Step 5: Mount in App and add CSS**

In `apps/crm/src/App.tsx` add `import CookieConsent from './components/consent/CookieConsent';` with the other component imports, and render `<CookieConsent />` immediately before `<Analytics />` (inside `<AuthProvider>`, `:260`).

Append to `apps/crm/style.css` (end of file):

```css
/* Cookie consent banner (components/consent/CookieConsent.tsx). Fixed to the bottom only, so the
   sidebar breakpoint rules do not apply. On phones the floating nav pill (.mobile-nav-glass, 72px
   tall, z-index 40) sits at the bottom, so lift the banner above it when that nav is rendered. */
@media (max-width: 900px) {
  body:has(.mobile-nav-glass) .cookie-banner {
    bottom: calc(96px + env(safe-area-inset-bottom, 0px) + var(--mobile-nav-chrome-offset, 0px));
  }
}
```

- [ ] **Step 6: Run tests and typecheck**

Run: `npx vitest run apps/crm/src/components/consent apps/crm/src/__tests__/App.test.tsx && npx tsc -p apps/crm/tsconfig.json --noEmit`
Expected: PASS. `App.test.tsx` now renders the banner; if a text query collides with banner copy, scope the query, do not change banner copy. If the tests fail on i18n language, check `test/vitest.setup.ts` and make `t` in the new test read `i18n.t`, which already follows the active language.

- [ ] **Step 7: Commit**

```bash
git add apps/crm/src/components/consent packages/i18n/locales/pt/common.json packages/i18n/locales/en/common.json apps/crm/style.css apps/crm/src/App.tsx
git commit -m "feat(consent): add cookie banner and preferences dialog

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: Withdrawal entry points and chat entry points

**Files:**
- Modify: `apps/crm/src/pages/landing/LandingChrome.tsx:163-176` (Legal column)
- Modify: `apps/crm/src/pages/landing/landing.css` and/or `landing-v2.css` (footer link style)
- Modify: `apps/crm/src/pages/politica-privacidade/PoliticaPage.tsx`, `termos-de-uso/TermosPage.tsx`, `lgpd/LgpdPage.tsx`, `novidades/NovidadesPage.tsx`, `login/LoginPage.tsx:403`
- Modify: `apps/crm/src/pages/configuracao/tabs/PerfilTab.tsx` (new "Privacidade" card before "Sessão")
- Modify: `apps/crm/src/components/layout/TopBarActions.tsx:23-27`, `MobileNav.tsx:240-245`
- Test: `apps/crm/src/pages/landing/__tests__/LandingChrome.links.test.tsx` (extend), `apps/crm/src/components/layout/__tests__/TopBarActions.test.tsx` (new)

**Interfaces:**
- Consumes (Task 4): `openSupportChat`. (Task 6): `CookiePreferencesLink`. (Task 1): `openConsentPreferences`.

- [ ] **Step 1: Write the failing tests**

Read `LandingChrome.links.test.tsx` first and add a case in its existing style asserting the footer contains a button named `Preferências de cookies` that dispatches `OPEN_PREFERENCES_EVENT` when clicked.

Create `apps/crm/src/components/layout/__tests__/TopBarActions.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OPEN_PREFERENCES_EVENT } from '@/lib/consent';
import { seedConsent } from '../../../test/consent';

vi.mock('../NotificationBell', () => ({ default: () => null }));

import TopBarActions from '../TopBarActions';

describe('TopBarActions chat button', () => {
  beforeEach(() => {
    localStorage.clear();
    window.$crisp = [];
  });

  it('opens the consent dialog instead of a dead click when support consent is missing', () => {
    const handler = vi.fn();
    window.addEventListener(OPEN_PREFERENCES_EVENT, handler);
    render(<TopBarActions />);
    fireEvent.click(screen.getByRole('button', { name: 'Chat' }));
    window.removeEventListener(OPEN_PREFERENCES_EVENT, handler);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(window.$crisp).not.toContainEqual(['do', 'chat:open']);
  });

  it('opens the Crisp chat when support consent is granted', () => {
    seedConsent({ support: true });
    render(<TopBarActions />);
    fireEvent.click(screen.getByRole('button', { name: 'Chat' }));
    expect(window.$crisp).toContainEqual(['do', 'chat:open']);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run apps/crm/src/components/layout/__tests__/TopBarActions.test.tsx apps/crm/src/pages/landing/__tests__/LandingChrome.links.test.tsx`
Expected: FAIL (no consent gating; no footer button).

- [ ] **Step 3: Route the chat entry points through `openSupportChat`**

In `TopBarActions.tsx` add `import { openSupportChat } from '@/lib/supportChat';` and replace `openCrisp` with:

```ts
  const openCrisp = useCallback(() => {
    // Gated: without support consent this opens the consent dialog instead of a dead click.
    openSupportChat();
    setCrispUnread(false);
  }, []);
```

In `MobileNav.tsx` add `import { openSupportChat } from '@/lib/supportChat';` and replace `window.$crisp?.push(['do', 'chat:open']);` (inside the Chat button's `onClick`, `:242`) with `openSupportChat();`. Leave the `declare global` blocks as they are.

- [ ] **Step 4: Add the withdrawal links**

`LandingChrome.tsx`: import `CookiePreferencesLink` from `@/components/consent/CookiePreferencesLink` and add after the LGPD `<li>`:

```tsx
              <li>
                <CookiePreferencesLink className="cookie-prefs-link" />
              </li>
```

Find the footer link rule (`grep -n "footer-col a" apps/crm/src/pages/landing/*.css`) and add `.footer-col button.cookie-prefs-link` to the same selector list, plus:

```css
.footer-col button.cookie-prefs-link {
  background: none;
  border: 0;
  padding: 0;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
```

Legal/other pages: import `CookiePreferencesLink` and append, just before each page's outer closing `</div>` (after the "Última atualização" `<p>` in Politica/Termos/Lgpd; after "Voltar para o início" in Novidades):

```tsx
      <p style={{ textAlign: 'center', marginTop: '1rem' }}>
        <CookiePreferencesLink />
      </p>
```

`LoginPage.tsx`: after `<p className="auth-footer">{t('footer')}</p>` (`:403`) add `<p className="auth-footer"><CookiePreferencesLink /></p>` (import it). Check the result in the browser in Task 10; adjust only spacing.

`PerfilTab.tsx`: import `Button` (already imported) and `openConsentPreferences` from `@/lib/consent`, and insert before the `{/* Logout */}` card:

```tsx
      {/* Privacy */}
      <div className="card animate-up" style={{ marginBottom: '1.5rem' }}>
        <h3 className="config-title">Privacidade</h3>
        <p style={{ color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
          Escolha quais ferramentas opcionais (análise de uso e chat de suporte) podem usar o
          armazenamento do seu navegador.
        </p>
        <Button variant="outline" onClick={() => openConsentPreferences()}>
          Preferências de cookies
        </Button>
      </div>
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run apps/crm/src/components/layout apps/crm/src/pages/landing apps/crm/src/pages/configuracao && npx tsc -p apps/crm/tsconfig.json --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/crm/src/pages apps/crm/src/components/layout
git commit -m "feat(consent): add withdrawal links and gate the chat entry points

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: Legal copy (`/lgpd`, `/politica-de-privacidade`)

**Files:**
- Modify: `apps/crm/src/pages/lgpd/LgpdPage.tsx` (new section before `'11. Atualizações'`, renumber that one to 12)
- Modify: `apps/crm/src/pages/politica-privacidade/PoliticaPage.tsx` (short pointer section at the end of its section list)

**Interfaces:**
- Consumes (Task 6): `CookiePreferencesLink`.

The retention column states only what the code proves. Vendor-side retention periods are NOT invented: the cell links the vendor's own policy. After merging, ask the user whether to add concrete PostHog/Crisp retention numbers (PostHog project retention settings can be read with the `posthog` MCP).

- [ ] **Step 1: Confirm the YouTube embed facts before writing the row**

Run: `grep -n "Youtube\|nocookie" apps/crm/src/pages/ajuda/ArtigoPage.tsx apps/crm/src/components/**/*.tsx | head`
If the TipTap `Youtube` extension is configured with `nocookie: true`, write the embed row as "sem cookies de acompanhamento até a reprodução"; otherwise use the wording below.

- [ ] **Step 2: Add the LGPD section**

In `LgpdPage.tsx` import `CookiePreferencesLink` (`@/components/consent/CookiePreferencesLink`) and insert this object into the sections array immediately before the `'11. Atualizações'` entry, then rename that entry's title to `'12. Atualizações'`:

```tsx
          {
            title: '11. Cookies e armazenamento',
            content: (
              <>
                <p>
                  Usamos armazenamento do navegador (cookies e localStorage) para duas finalidades:
                  o que é essencial para o Mesaas funcionar e o que é opcional e depende do seu
                  consentimento (art. 7º, I, da LGPD). Você escolhe no banner exibido na primeira
                  visita e pode mudar de ideia a qualquer momento.
                </p>
                <p style={{ marginTop: '0.5rem' }}>
                  <strong>Essenciais (sempre ativos):</strong> sessão de login, idioma, tema, a
                  proteção contra versões desatualizadas do app e o registro desta escolha.
                  Preferências de interface (por exemplo, guias e tours já concluídos) ficam apenas
                  no seu navegador e não são usadas para rastreamento.
                </p>
                <div style={{ overflowX: 'auto', marginTop: '1rem' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                    <thead>
                      <tr>
                        {['Ferramenta', 'Para que serve', 'O que coleta', 'Base legal'].map((h) => (
                          <th
                            key={h}
                            style={{
                              textAlign: 'left',
                              padding: '0.5rem',
                              borderBottom: '1px solid var(--border-color)',
                            }}
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        [
                          <>
                            <strong>PostHog</strong> (União Europeia). Categoria: análise e
                            diagnóstico. Depende do seu consentimento.
                          </>,
                          'Entender como o produto é usado e corrigir problemas, incluindo gravação de sessão e mapas de calor.',
                          'Páginas e ações no app, identificador do usuário e do workspace, gravação da tela durante o uso, e um identificador guardado no navegador (cookie e localStorage). Retenção no fornecedor conforme a política do PostHog: posthog.com/privacy.',
                          'Consentimento (art. 7º, I).',
                        ],
                        [
                          <>
                            <strong>Crisp</strong>. Categoria: chat de suporte. Depende do seu
                            consentimento.
                          </>,
                          'Conversar com a nossa equipe de suporte.',
                          'Mensagens, e-mail e nome de quem está logado, e um cookie de sessão do chat. Retenção conforme a política do Crisp: crisp.chat/en/privacy.',
                          'Consentimento (art. 7º, I).',
                        ],
                        [
                          <>
                            <strong>Sentry</strong>. Categoria: essencial.
                          </>,
                          'Detectar e corrigir erros do aplicativo.',
                          'Detalhes técnicos de erros e de desempenho. Não gravamos a tela e removemos códigos de convite dos endereços enviados.',
                          'Legítimo interesse (art. 7º, IX).',
                        ],
                        [
                          <>
                            <strong>Vercel Analytics</strong>. Categoria: essencial.
                          </>,
                          'Medir acessos de forma agregada.',
                          'Página, país e tipo de dispositivo, sem cookies.',
                          'Legítimo interesse (art. 7º, IX).',
                        ],
                        [
                          <>
                            <strong>Vídeos incorporados (YouTube)</strong>. Somente em artigos da
                            central de ajuda, para usuários logados.
                          </>,
                          'Exibir vídeos de ajuda dentro dos artigos.',
                          'O YouTube pode definir cookies próprios ao reproduzir o vídeo.',
                          'Sua ação de reproduzir o vídeo.',
                        ],
                      ].map((row, i) => (
                        <tr key={i}>
                          {row.map((cell, j) => (
                            <td
                              key={j}
                              style={{
                                verticalAlign: 'top',
                                padding: '0.5rem',
                                borderBottom: '1px solid var(--border-color)',
                              }}
                            >
                              {cell}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p style={{ marginTop: '1rem' }}>
                  <strong>Como retirar o consentimento:</strong> use o botão{' '}
                  <CookiePreferencesLink /> e desative a ferramenta. Ao retirar, paramos de enviar
                  dados na hora e apagamos o identificador guardado no seu navegador; o efeito é
                  aplicado por completo ao recarregar a página. Retirar o consentimento não afeta o
                  uso do Mesaas, apenas desliga a análise de uso e o chat de suporte.
                </p>
              </>
            ),
          },
```

If Step 1 showed the YouTube extension already uses `nocookie: true`, replace the last row's second cell text with `O player usa o modo sem cookies do YouTube até a reprodução.`

- [ ] **Step 3: Add the Política pointer**

The sections run `1. Coleta de Dados` to `6. Alterações nesta Política` (`PoliticaPage.tsx:26-119`). Insert the entry below immediately before `6. Alterações nesta Política` and rename that one to `7. Alterações nesta Política`. Use a plain `<a>` (this page is prerendered, so no router hooks):

```tsx
          {
            title: '6. Cookies e armazenamento',
            content: (
              <p>
                Usamos cookies essenciais e, somente com o seu consentimento, ferramentas de
                análise e de chat de suporte. Veja a lista completa e como retirar o consentimento
                na nossa <a href="/lgpd">página de LGPD</a>.
              </p>
            ),
          },
```

- [ ] **Step 4: Verify the prerender typecheck and Node safety**

Run: `npx tsc -p tsconfig.scripts.json`
Expected: clean.

Then prove `LgpdPage` renders in Node without browser globals:

```bash
npx tsx --tsconfig tsconfig.scripts.json -e "import React from 'react'; import { renderToStaticMarkup } from 'react-dom/server'; import LgpdPage from './apps/crm/src/pages/lgpd/LgpdPage'; const html = renderToStaticMarkup(React.createElement(LgpdPage)); console.log(html.includes('Cookies e armazenamento') ? 'OK' : 'MISSING')"
```
Expected: prints `OK`. If it throws `window is not defined` / `localStorage`, an import in the chain touches the browser at module scope: fix that module (see Global Constraints).

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/lgpd/LgpdPage.tsx apps/crm/src/pages/politica-privacidade/PoliticaPage.tsx
git commit -m "docs(lgpd): disclose cookies, tools and how to withdraw consent

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 9: Fix the rest of the existing suite and seed consent in e2e screenshots

**Files:**
- Modify: `apps/crm/src/__tests__/App.test.tsx`
- Modify: `e2e/screenshots/landing-hero.spec.ts`, `landing-features.spec.ts`, `kb-agosto.spec.ts`
- Run: full Vitest suite

- [ ] **Step 1: Run the whole frontend suite and list failures**

Run: `npm run test 2>&1 | tail -60`
Expected: any remaining failures are consent-related (a test asserting a Crisp push / `crisp-identity` call without seeded consent, or a query colliding with banner copy). Fix each by seeding consent with `seedConsent(...)` after `localStorage.clear()`, or scoping the query. Do not weaken the gating.

- [ ] **Step 2: Add an App-level test that the banner is mounted**

In `apps/crm/src/__tests__/App.test.tsx`, add `import { beforeEach } from 'vitest';` (extend the existing vitest import) and inside `describe('App', ...)`:

```tsx
  it('mounts the cookie consent banner for an undecided visitor', async () => {
    localStorage.clear();
    renderApp('/');
    expect(await screen.findByRole('region', { name: /cookies e privacidade/i })).toBeInTheDocument();
  });
```

If the test environment language is not pt, read the label via `i18n.t('cookies.banner.title')` as in Task 6.

- [ ] **Step 3: Seed consent in the e2e screenshot specs**

Marketing screenshots must not contain the banner. In each of the three specs, before the first `page.goto(...)` add:

```ts
  await page.addInitScript(() => {
    localStorage.setItem(
      'consent_v1',
      JSON.stringify({ analytics: false, support: false, decidedAt: '2026-09-19T00:00:00.000Z' }),
    );
  });
```

(Use the spec's own `page` fixture / helper. Denied on purpose: screenshots must not load PostHog or Crisp either.) Where a spec already calls `addInitScript`, merge into it.

- [ ] **Step 4: Run tests and typecheck the e2e-adjacent code**

Run: `npm run test && npx tsc -p tsconfig.scripts.json`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/__tests__/App.test.tsx e2e/screenshots
git commit -m "test(consent): update existing suites and seed consent in e2e screenshots

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 10: Full gates and real-browser verification

**Files:** none (verification; fix-forward commits allowed).

- [ ] **Step 1: Run every CI gate**

```bash
npm run lint
npm run format:check
npx tsc -p apps/crm/tsconfig.json --noEmit
npx tsc -p apps/hub/tsconfig.json --noEmit
npx tsc -p apps/admin/tsconfig.json --noEmit
npx tsc -p tsconfig.scripts.json
npm run test
```

Expected: all pass. If `format:check` fails run `npm run format` and commit the result.

- [ ] **Step 2: Confirm prerender still works**

Run: `npm run build && npm run prerender`
Expected: `Prerendered N routes ...` with no `window is not defined`. Then confirm the Crisp script tag is gone from the shell and the queue is kept: `grep -c "client.crisp.chat" dist/index.html dist/lgpd/index.html` prints `0` for both, and `grep -c 'window.\$crisp=\[\]' dist/index.html` prints `1`. (`dist/` is a build output; do not commit it.)

- [ ] **Step 3: Start the app in the Browser pane**

Worktrees have no `.env`; use `npm run dev:env` (loads `VITE_*` from the main checkout's `.env`; per project memory this hits PROD Supabase, so do not sign in with real data; the landing page and `/login` are enough for consent checks). Start it with `preview_start`, open the landing page in a **clean profile state** (`localStorage.clear()` and clear cookies via `javascript_tool` first).

- [ ] **Step 4: Verify the before-consent state**

With the network panel (`read_network_requests`) after a reload, and idle 5s:
- Expected: **zero** requests to any host containing `posthog` and to `client.crisp.chat`.
- `localStorage` has no `ph_*` and no `crisp-client*` keys; `document.cookie` has no `ph_*` / `crisp-client*`.
- The banner is visible; Accept and Reject look equally prominent (screenshot).

- [ ] **Step 5: Verify Accept, Reject, revoke**

- Click **Aceitar todos**: within a few seconds requests to `eu.i.posthog.com` (and the PostHog assets host) and `client.crisp.chat` appear; `localStorage.consent_v1` is `{analytics:true,support:true,...}`; PostHog storage key `ph_*_posthog` exists.
- **Enumerate what Crisp actually stores** (this settles the `crisp-client` prefix assumption from Task 1): run `Object.keys(localStorage)` and `document.cookie` with the widget loaded. If Crisp uses a name that does not start with `crisp-client`, add that prefix to `purgeSupportStorage()` in `legacyStorage.ts` with a test, and commit.
- Reload: both tools load again without the banner.
- Open **Preferências de cookies** (landing footer), switch off Análise, Save: no further PostHog requests after the click; `ph_*` keys are gone from storage. Switch it back on, Save: capture resumes and the `ph_*_posthog` key returns (confirms `opt_in_capturing` restores persistence; if it does not, the SDK needs the `ph_*` write path re-enabled: investigate before shipping).
- Clear consent, reload, click **Rejeitar todos**: reload; still zero PostHog/Crisp requests.
- Turn Crisp off in the dialog and Save: chat launcher hidden; after reload the Crisp script is not requested and Crisp cookies/keys are gone.

- [ ] **Step 6: Verify the chat entry point and the withdrawal links**

Sign-in is not required for the dialog test: on `/login` and legal pages confirm the **Preferências de cookies** link exists and opens the dialog. If a signed-in session is available on a non-production stack, click the top-bar Chat with support consent off: the dialog opens with Chat de suporte pre-enabled; Save opens the chat. If no such session is available, state that this leg was covered only by the unit tests.

- [ ] **Step 7: Verify layout**

`resize_window` to mobile (375x812), then dark scheme, then desktop: banner does not shift layout or overlap the CTA text, sits above the bottom nav when it is rendered, the dialog scrolls, focus is trapped in the dialog and returns after close. Screenshot each.

- [ ] **Step 8: Report and commit fixes**

Commit any fix-forward changes with `fix(consent): ...`. Then summarise to the user: gates result, the before/after network evidence, what was and was not verifiable (signed-in chat flow), and the open follow-ups: (a) vendor retention numbers for `/lgpd`, (b) Google Fonts / unpkg Phosphor third-party requests (out of scope, flagged in the spec), (c) consent is per browser, not per account.

---

## Self-review (spec coverage)

- Consent store, versioning, storage fallback, cross-tab, React-free, `useConsent`: Task 1.
- PostHog: two flags, reset-then-opt-out order, `opt_out_persistence_by_default`, opt-in after stored opt-out, replay of identity, replay/heatmaps inside analytics category: Task 2 (+ disclosure in Tasks 6, 8).
- Sentry: replay inert → removed, token scrub, `ErrorBoundary` untouched: Task 3.
- Crisp: loader, `index.html` queue kept, chat entry points never dead, AuthContext gating + revoke teardown mirroring sign-out, in-flight discard, legacy purge, cookie/localStorage enumeration: Tasks 1, 4, 5, 10.
- Legacy identifiers purge on boot/reject: Tasks 1, 4.
- UI: equal-weight banner, dialog, essentials list, re-entry points (landing, legal pages, novidades, login, settings `perfil`, chat), prerender/hydration safety, i18n, mobile nav offset: Tasks 6, 7, 8.
- Legal copy incl. replay disclosure, live revoke button, YouTube embeds: Task 8.
- Tests to update (AuthContext, App, e2e screenshots), browser verification wording (no replay envelope; Sentry envelopes expected), risks: Tasks 5, 9, 10.
- Deliberately not built (per spec §5): Hub/Admin, server-side capture, Google Fonts/unpkg, geo-targeting, account-synced consent.
