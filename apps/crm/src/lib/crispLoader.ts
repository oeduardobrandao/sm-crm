import { getConsent } from './consent';
import { purgeSupportStorage } from './legacyStorage';

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
  // A failed l.js fetch (offline, ad blocker) must not leave `requested` stuck: a later
  // consenting click on Chat retries instead of being a silent dead click.
  script.onerror = () => {
    requested = false;
    script.remove();
  };
  // Consent can be revoked while l.js is downloading. AuthContext's revoke effect already ran by
  // then and found no widget to reset, so the widget would boot with a live session the visitor
  // said no to. Do the minimal teardown here (the identity-generation fencing stays in
  // AuthContext; this only needs to reset and hide what the script just booted).
  script.onload = () => {
    if (getConsent()?.support === true) return;
    try {
      window.$crisp?.push(['do', 'session:reset']);
      window.$crisp?.push(['do', 'chat:hide']);
    } catch {
      // Never let a support-tooling nicety throw out of a script handler.
    }
    purgeSupportStorage();
  };
  document.head.appendChild(script);
}

/**
 * Same as loadCrisp but off the critical path (PageSpeed: third-party payload). The deferral
 * window is up to 4s, so the callback re-reads consent when it fires: a visitor who revokes
 * inside that window must not get the widget injected after saying no.
 */
export function loadCrispWhenIdle(): void {
  const loadIfStillConsented = () => {
    if (getConsent()?.support === true) loadCrisp();
  };
  if ('requestIdleCallback' in window) {
    requestIdleCallback(loadIfStillConsented, { timeout: 4000 });
  } else {
    setTimeout(loadIfStillConsented, 2500);
  }
}
