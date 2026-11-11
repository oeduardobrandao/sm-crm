import { isNativeApp } from '../native/platform';
import { getConsent } from './consent';
import { purgeMarketingStorage } from './legacyStorage';

type Fbq = ((...args: unknown[]) => void) & {
  callMethod?: (...args: unknown[]) => void;
  queue: unknown[];
  push: Fbq;
  loaded: boolean;
  version: string;
  disablePushState?: boolean;
};

declare global {
  interface Window {
    fbq?: Fbq;
    _fbq?: Fbq;
  }
}

const META_PIXEL_ID = import.meta.env.VITE_META_PIXEL_ID as string | undefined;

export const META_PIXEL_SRC = 'https://connect.facebook.net/en_US/fbevents.js';

let requested = false;

function fbq(...args: unknown[]): void {
  window.fbq?.(...args);
}

/**
 * Injects the Meta Pixel (fbevents.js). Same gate as the Google Ads tag: only after the visitor
 * consented to the `marketing` ("Publicidade") category, and only where `VITE_META_PIXEL_ID` is
 * set (production).
 *
 * Meta only gets the landing PageView and the explicit events (trackMetaEvent): `autoConfig` off
 * stops the pixel scraping button text and page metadata, and `disablePushState` stops it sending
 * a PageView per SPA route change, which would leak signed-in CRM URLs (`/clientes/123`).
 */
export function loadMetaPixel(): void {
  // Never inside the iOS app (App Store tracking / ATT), same as loadGoogleAds.
  if (isNativeApp()) return;
  if (requested || !META_PIXEL_ID || typeof document === 'undefined') return;
  requested = true;
  if (!window.fbq) {
    // Meta's base-code stub: calls queue until fbevents.js loads and replays them.
    const stub = function (...args: unknown[]) {
      if (stub.callMethod) stub.callMethod(...args);
      else stub.queue.push(args);
    } as Fbq;
    stub.push = stub;
    stub.loaded = true;
    stub.version = '2.0';
    stub.queue = [];
    window.fbq = stub;
    if (!window._fbq) window._fbq = stub;
  }
  window.fbq!.disablePushState = true;
  fbq('consent', 'grant');
  fbq('set', 'autoConfig', false, META_PIXEL_ID);
  fbq('init', META_PIXEL_ID);
  fbq('track', 'PageView');

  const script = document.createElement('script');
  script.src = META_PIXEL_SRC;
  script.async = true;
  // A failed fetch (offline, ad blocker) must not leave `requested` stuck: a later consent
  // change retries.
  script.onerror = () => {
    requested = false;
    script.remove();
  };
  // Consent can be revoked while fbevents.js is downloading.
  script.onload = () => {
    if (getConsent()?.marketing === true) return;
    disableMetaPixel();
  };
  document.head.appendChild(script);
}

/** Same as loadMetaPixel but off the critical path; re-reads consent when it fires. */
export function loadMetaPixelWhenIdle(): void {
  const loadIfStillConsented = () => {
    if (getConsent()?.marketing === true) loadMetaPixel();
  };
  if ('requestIdleCallback' in window) {
    requestIdleCallback(loadIfStillConsented, { timeout: 4000 });
  } else {
    setTimeout(loadIfStillConsented, 2500);
  }
}

/**
 * Revoke. The script cannot be unloaded: `consent revoke` makes the pixel stop sending, and the
 * `_fbp` / `_fbc` cookies it left are expired.
 */
export function disableMetaPixel(): void {
  fbq('consent', 'revoke');
  purgeMarketingStorage();
}

/**
 * Sends a standard Meta event (`Purchase`, `CompleteRegistration`...). A no-op without marketing
 * consent; loads the pixel first when the idle load has not fired yet.
 */
export function trackMetaEvent(event: string, params?: Record<string, unknown>): void {
  if (!META_PIXEL_ID || getConsent()?.marketing !== true) return;
  loadMetaPixel();
  if (params) fbq('track', event, params);
  else fbq('track', event);
}

/**
 * Sends a custom Meta event (`fbq('trackCustom', ...)`), e.g. `IniciouCadastro`. Same consent gate
 * as trackMetaEvent. Returns whether the event was handed to the pixel, so a caller that fires
 * once can retry after the visitor accepts the cookie banner.
 */
export function trackMetaCustomEvent(event: string, params?: Record<string, unknown>): boolean {
  if (!META_PIXEL_ID || getConsent()?.marketing !== true) return false;
  loadMetaPixel();
  if (params) fbq('trackCustom', event, params);
  else fbq('trackCustom', event);
  return true;
}
