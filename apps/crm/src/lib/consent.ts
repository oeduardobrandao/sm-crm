/**
 * Cookie / storage consent (docs/superpowers/specs/2026-09-19-cookie-consent-design.md).
 *
 * Plain module: no React, and no `window` / `localStorage` access at import time. LgpdPage
 * imports this and scripts/seo/prerender.tsx renders it in Node, so everything touches the
 * browser only inside functions. React consumers use `useConsent()` (lib/useConsent.ts).
 */
import { siteLocaleForPath } from '../content/siteLocale';

export const CONSENT_STORAGE_KEY = 'consent_v1';
export const OPEN_PREFERENCES_EVENT = 'mesaas:open-cookie-preferences';

export type ConsentCategory = 'analytics' | 'support' | 'marketing';

export interface ConsentChoice {
  analytics: boolean;
  support: boolean;
  /** Google Ads. Optional because it came after the first two: omitted means declined. */
  marketing?: boolean;
}

/**
 * Why the record exists: `choice` is the visitor's own decision (banner, dialog, "Do Not Sell");
 * `us_default` is the opt-out default written on a first visit to an `/en` page
 * (lib/usConsentDefault.ts). Records from before this field are choices.
 */
export type ConsentBasis = 'choice' | 'us_default';

export interface Consent extends Required<ConsentChoice> {
  decidedAt: string;
  basis: ConsentBasis;
}

type Listener = () => void;

const listeners = new Set<Listener>();
let storageListenerInstalled = false;
// Flips once a write to localStorage throws. From then on the decision lives here, for the
// session only: nothing non-essential ever loads without an explicit choice.
let memoryOnly = false;
let memoryRaw: string | null = null;
let cachedRaw: string | null | undefined;
let cachedGpc: boolean | undefined;
let cachedOnUsPage: boolean | undefined;
// The value subscribers last heard about (set on subscribe and on every notify). Kept apart from
// the read cache on purpose: a render (useConsent -> getConsent) refreshes the cache for a new path
// before any effect runs, so comparing against the cache would never see the change.
let lastNotified: Consent | null | undefined;
let cachedValue: Consent | null = null;

/**
 * Global Privacy Control: the browser asks sites not to sell or share the visitor's data. Honoured
 * on every page (Brazilian pages and the signed-in app included) as advertising off, whatever the
 * stored record says.
 */
export function gpcEnabled(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true
  );
}

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
    // `marketing` arrived after consent_v1 shipped. A record without it is a valid earlier
    // decision, kept as is with marketing declined: bumping the key would re-prompt everyone.
    return {
      analytics: value.analytics,
      support: value.support,
      marketing: value.marketing === true,
      decidedAt: value.decidedAt,
      basis: value.basis === 'us_default' ? 'us_default' : 'choice',
    };
  } catch {
    return null;
  }
}

/** Whether the current page is on the English US site (`/en`). False outside a browser. */
function onUsPage(): boolean {
  return typeof window !== 'undefined' && siteLocaleForPath(window.location.pathname) === 'en';
}

/**
 * Stable reference while the stored value, the GPC signal and the site (US or Brazil) are
 * unchanged (useSyncExternalStore
 * requires it). With GPC on, `marketing` is always false: every ad loader reads consent through
 * here, so no ad tag can load under GPC. The stored record itself is left as it was.
 *
 * LGPD: a `us_default` record is the US opt-out default, valid only on `/en` pages. Anywhere
 * else (Brazilian pages, the app) it reads as undecided, so the opt-in banner shows and nothing
 * non-essential loads until the visitor chooses. A `choice` record applies on every page.
 */
export function getConsent(): Consent | null {
  const raw = readRaw();
  const gpc = gpcEnabled();
  const usPage = onUsPage();
  if (raw !== cachedRaw || gpc !== cachedGpc || usPage !== cachedOnUsPage) {
    cachedRaw = raw;
    cachedGpc = gpc;
    cachedOnUsPage = usPage;
    let parsed = parse(raw);
    if (parsed && parsed.basis === 'us_default' && !usPage) parsed = null;
    cachedValue = parsed && gpc && parsed.marketing ? { ...parsed, marketing: false } : parsed;
  }
  return cachedValue;
}

/**
 * Call after a client-side navigation: moving between `/en` and a Brazilian page can change what
 * a `us_default` record means, and subscribers (installConsentEffects, useConsent) only hear about
 * it through here. Notifies when the value differs from the one subscribers last heard about,
 * however many times getConsent() ran in between.
 */
export function consentPathChanged(): void {
  if (getConsent() !== lastNotified) notify();
}

function notify(): void {
  lastNotified = getConsent();
  for (const listener of [...listeners]) listener();
}

export function setConsent(choice: ConsentChoice, basis: ConsentBasis = 'choice'): void {
  const raw = JSON.stringify({
    analytics: choice.analytics,
    support: choice.support,
    marketing: choice.marketing === true,
    decidedAt: new Date().toISOString(),
    basis,
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
  if (lastNotified === undefined) lastNotified = getConsent();
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
