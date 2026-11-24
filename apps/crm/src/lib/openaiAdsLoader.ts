import { isNativeApp } from '../native/platform';
import { getConsent } from './consent';
import { purgeMarketingStorage } from './legacyStorage';

const OPENAI_PIXEL_ID = import.meta.env.VITE_OPENAI_PIXEL_ID as string | undefined;

/** Same-origin page that hosts the pixel (public/oaiq-frame.html + oaiq-frame.js). */
export const OPENAI_FRAME_SRC = '/oaiq-frame.html';
const CHANNEL = 'mesaas-oaiq';

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

let frame: HTMLIFrameElement | null = null;
let frameReady = false;
let pending: unknown[][] = [];
let revoked = false;
let clickId: string | undefined;
let listening = false;

/**
 * Reads the ChatGPT ad click id (`?oppref=`) from the landing URL, into memory only. Called at
 * boot, before consent, because the SPA can navigate away from the landing URL before the
 * visitor accepts the banner; nothing is stored or sent until the pixel loads with consent.
 */
export function captureOpenAiClickId(): void {
  if (typeof window === 'undefined') return;
  try {
    const value = new URLSearchParams(window.location.search).get('oppref');
    if (value) clickId = value;
  } catch {
    // Malformed URL: no click id.
  }
}

function onFrameMessage(event: MessageEvent): void {
  if (!frame || event.source !== frame.contentWindow) return;
  if (event.origin !== window.location.origin) return;
  const data = event.data as { channel?: unknown; ready?: unknown } | null;
  if (data?.channel !== CHANNEL || data.ready !== true) return;
  frameReady = true;
  const calls = pending;
  pending = [];
  for (const call of calls) post(call);
}

function post(call: unknown[]): void {
  frame?.contentWindow?.postMessage({ channel: CHANNEL, call }, window.location.origin);
}

function oaiq(...call: unknown[]): void {
  if (!frame) return;
  if (frameReady) post(call);
  else pending.push(call);
}

/**
 * Loads the ChatGPT ads pixel (OpenAI `oaiq`). Same gate as the Google Ads tag and the Meta
 * Pixel: only after the visitor consented to the `marketing` ("Publicidade") category, and only
 * where `VITE_OPENAI_PIXEL_ID` is set (production).
 *
 * The SDK never runs on the app's own page. Its "automatic advanced matching" is a server-side
 * setting (on outside Japan, no toggle in Ads Manager) that makes it listen to change/keydown/
 * click/submit and hash emails, phones and names found in the document it runs in. In the
 * signed-in CRM those are the agency's clients' data, which the privacy policy says we never
 * send. So it runs in a hidden, empty, same-origin iframe (public/oaiq-frame.html): there is
 * nothing there to match, and its cookies are still first-party. The ad click id, which the SDK
 * would read from its own URL, is captured on the landing (captureOpenAiClickId) and passed to
 * `init` as `oppref`.
 *
 * The frame gets the parent's origin as referrer, never the path: a signed-in boot must not send
 * `/clientes/123` to OpenAI.
 *
 * Residual risk: the frame is same-origin, so this rests on the SDK (unversioned, served by
 * OpenAI) never reading `window.parent`. 0.1.105 does not. Re-check if OpenAI changes it.
 */
export function loadOpenAiAds(): void {
  // Never inside the iOS app (App Store tracking / ATT), same as loadGoogleAds.
  if (isNativeApp()) return;
  if (!OPENAI_PIXEL_ID || typeof document === 'undefined') return;
  if (frame) {
    // Granted again after a revoke in the same page load: the SDK is still there, re-enable it.
    if (revoked) {
      revoked = false;
      oaiq('consent', true);
    }
    return;
  }
  revoked = false;
  if (!listening) {
    window.addEventListener('message', onFrameMessage);
    listening = true;
  }
  const el = document.createElement('iframe');
  el.src = OPENAI_FRAME_SRC;
  el.title = 'Medição de anúncios';
  el.tabIndex = -1;
  el.setAttribute('aria-hidden', 'true');
  el.referrerPolicy = 'origin';
  el.style.cssText =
    'position:absolute;width:0;height:0;border:0;visibility:hidden;pointer-events:none';
  frame = el;
  frameReady = false;
  pending = [];

  oaiq('init', {
    pixelId: OPENAI_PIXEL_ID,
    debug: import.meta.env.DEV,
    ...(clickId ? { oppref: clickId } : {}),
  });
  oaiq('consent', true);
  oaiq('measure', 'page_viewed', { type: 'contents' });

  document.body.appendChild(el);
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
 * Revoke. The frame stays (removing it would drop calls still in flight): `consent false` makes
 * the SDK stop sending and clear its click id, and the cookies it left on our origin are expired
 * too. Verified with the real SDK: the click id (`__oppref`) and browser id (`__obref`) are gone
 * afterwards, and the SDK then writes back only its own opt-out flag (`__oaiq_consent=false`,
 * localStorage `oaiq_consent=false`), which is a refusal record, not an identifier. Left on
 * purpose: it keeps the SDK off on the next load.
 */
export function disableOpenAiAds(): void {
  if (frame) {
    revoked = true;
    oaiq('consent', false);
  }
  clickId = undefined;
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
