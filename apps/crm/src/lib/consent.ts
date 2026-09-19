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
