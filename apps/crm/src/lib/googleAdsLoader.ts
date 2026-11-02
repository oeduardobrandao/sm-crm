import { getConsent } from './consent';
import { purgeMarketingStorage } from './legacyStorage';

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

const GOOGLE_ADS_ID = import.meta.env.VITE_GOOGLE_ADS_ID as string | undefined;

export const GOOGLE_TAG_SRC = 'https://www.googletagmanager.com/gtag/js';

const GRANTED = {
  ad_storage: 'granted',
  ad_user_data: 'granted',
  ad_personalization: 'granted',
} as const;
const DENIED = {
  ad_storage: 'denied',
  ad_user_data: 'denied',
  ad_personalization: 'denied',
} as const;

let requested = false;

function gtag(...args: unknown[]): void {
  window.gtag?.(...args);
}

/**
 * Injects the Google Ads tag (gtag.js). Runs only after the visitor consented to the `marketing`
 * category, and only where `VITE_GOOGLE_ADS_ID` is set (production): dev and staging traffic
 * never reaches the Ads account.
 *
 * Consent Mode starts denied and is granted in the same tick, so the tag never writes `_gcl_*`
 * on a stale default. The `gclid` is read from the URL when the script loads: a visitor who
 * lands from an ad and consents only after navigating inside the SPA loses that attribution.
 */
export function loadGoogleAds(): void {
  if (requested || !GOOGLE_ADS_ID || typeof document === 'undefined') return;
  requested = true;
  const dataLayer = (window.dataLayer = window.dataLayer ?? []);
  if (!window.gtag) {
    // gtag.js reads the `arguments` object off the queue, not an array: keep the stub's shape.
    window.gtag = function () {
      // eslint-disable-next-line prefer-rest-params
      dataLayer.push(arguments);
    };
  }
  gtag('consent', 'default', { ...DENIED, analytics_storage: 'denied' });
  gtag('consent', 'update', GRANTED);
  gtag('js', new Date());
  gtag('config', GOOGLE_ADS_ID);

  const script = document.createElement('script');
  script.src = `${GOOGLE_TAG_SRC}?id=${encodeURIComponent(GOOGLE_ADS_ID)}`;
  script.async = true;
  // A failed fetch (offline, ad blocker) must not leave `requested` stuck: a later consent
  // change retries.
  script.onerror = () => {
    requested = false;
    script.remove();
  };
  // Consent can be revoked while gtag.js is downloading: the queued `update granted` would then
  // run, so deny again and clear whatever the tag wrote.
  script.onload = () => {
    if (getConsent()?.marketing === true) return;
    disableGoogleAds();
  };
  document.head.appendChild(script);
}

/**
 * Same as loadGoogleAds but off the critical path (PageSpeed: third-party payload). The callback
 * re-reads consent when it fires: a visitor who revokes inside the window must not get the tag.
 */
export function loadGoogleAdsWhenIdle(): void {
  const loadIfStillConsented = () => {
    if (getConsent()?.marketing === true) loadGoogleAds();
  };
  if ('requestIdleCallback' in window) {
    requestIdleCallback(loadIfStillConsented, { timeout: 4000 });
  } else {
    setTimeout(loadIfStillConsented, 2500);
  }
}

/**
 * Revoke. The script cannot be unloaded, so Consent Mode goes back to denied (the tag stops
 * writing and sending ad identifiers) and the cookies it left are expired.
 */
export function disableGoogleAds(): void {
  gtag('consent', 'update', DENIED);
  purgeMarketingStorage();
}

/**
 * Reports a Google Ads conversion (`label` from the conversion action's tag setup). A no-op until
 * the tag is loaded with consent, so call sites need no guard of their own.
 */
export function trackGoogleAdsConversion(
  label: string,
  value?: { amount: number; currency?: string; transactionId?: string },
): void {
  if (!requested || !GOOGLE_ADS_ID || getConsent()?.marketing !== true) return;
  gtag('event', 'conversion', {
    send_to: `${GOOGLE_ADS_ID}/${label}`,
    ...(value && {
      value: value.amount,
      currency: value.currency ?? 'BRL',
      ...(value.transactionId && { transaction_id: value.transactionId }),
    }),
  });
}
