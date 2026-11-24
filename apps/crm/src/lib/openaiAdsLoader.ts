import { isNativeApp } from '../native/platform';
import { getConsent } from './consent';
import { purgeMarketingStorage } from './legacyStorage';

type Oaiq = ((...args: unknown[]) => void) & { q: unknown[] };

declare global {
  interface Window {
    oaiq?: Oaiq;
  }
}

const OPENAI_PIXEL_ID = import.meta.env.VITE_OPENAI_PIXEL_ID as string | undefined;

export const OPENAI_PIXEL_SRC = 'https://bzrcdn.openai.com/sdk/oaiq.min.js';

/**
 * The SDK's documented measurement events (`oaiq('measure', name, data)`). `data.type` must be
 * the event's data type, or the SDK drops the event. `amount` is an integer in minor units.
 */
export type OpenAiAdsEvent =
  | { name: 'registration_completed'; data: { type: 'customer_action' } }
  | {
      name: 'subscription_created';
      data: { type: 'plan_enrollment'; amount?: number; currency?: string };
    };

let requested = false;

function oaiq(...args: unknown[]): void {
  window.oaiq?.(...args);
}

/**
 * Injects the ChatGPT ads pixel (OpenAI `oaiq`). Same gate as the Google Ads tag and the Meta
 * Pixel: only after the visitor consented to the `marketing` ("Publicidade") category, and only
 * where `VITE_OPENAI_PIXEL_ID` is set (production).
 *
 * The SDK sends no page views on its own (only an `openai::sdk_init` lifecycle ping), so OpenAI
 * gets the first `page_viewed` and the explicit events (trackOpenAiAdsEvent), never one per SPA
 * route.
 *
 * "Automatic advanced matching" is NOT a client option: the SDK reads it from
 * `bzrcdn.openai.com/pixel-config/v1/<pixel>.json` and, when on, listens to change/keydown/
 * click/submit on the whole document and hashes emails, phones and names it finds on the page.
 * In the signed-in CRM those are the agency's clients' data, which the privacy policy says we
 * never send. It must stay OFF in the ChatGPT Ads pixel settings.
 */
export function loadOpenAiAds(): void {
  // Never inside the iOS app (App Store tracking / ATT), same as loadGoogleAds.
  if (isNativeApp()) return;
  if (requested || !OPENAI_PIXEL_ID || typeof document === 'undefined') return;
  requested = true;
  if (!window.oaiq) {
    // OpenAI's base-code stub: calls queue on `.q` until oaiq.min.js loads and replays them.
    const stub = function (...args: unknown[]) {
      stub.q.push(args);
    } as Oaiq;
    stub.q = [];
    window.oaiq = stub;
  }
  oaiq('init', { pixelId: OPENAI_PIXEL_ID, debug: import.meta.env.DEV });
  oaiq('consent', true);
  oaiq('measure', 'page_viewed', { type: 'contents' });

  const script = document.createElement('script');
  script.src = OPENAI_PIXEL_SRC;
  script.async = true;
  // A failed fetch (offline, ad blocker) must not leave `requested` stuck: a later consent
  // change retries.
  script.onerror = () => {
    requested = false;
    script.remove();
  };
  // Consent can be revoked while oaiq.min.js is downloading.
  script.onload = () => {
    if (getConsent()?.marketing === true) return;
    disableOpenAiAds();
  };
  document.head.appendChild(script);
}

/** Same as loadOpenAiAds but off the critical path; re-reads consent when it fires. */
export function loadOpenAiAdsWhenIdle(): void {
  const loadIfStillConsented = () => {
    if (getConsent()?.marketing === true) loadOpenAiAds();
  };
  if ('requestIdleCallback' in window) {
    requestIdleCallback(loadIfStillConsented, { timeout: 4000 });
  } else {
    setTimeout(loadIfStillConsented, 2500);
  }
}

/**
 * Revoke. The script cannot be unloaded: `consent false` makes the SDK stop sending, detach its
 * document listeners and clear its click id; the cookies it left are expired too.
 */
export function disableOpenAiAds(): void {
  oaiq('consent', false);
  purgeMarketingStorage();
}

/**
 * Sends a ChatGPT ads conversion event. A no-op without marketing consent; loads the pixel first
 * when the idle load has not fired yet.
 */
export function trackOpenAiAdsEvent(event: OpenAiAdsEvent): void {
  if (!OPENAI_PIXEL_ID || getConsent()?.marketing !== true) return;
  loadOpenAiAds();
  oaiq('measure', event.name, event.data);
}
