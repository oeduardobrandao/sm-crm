import { disableAnalytics, initAnalytics } from './analytics';
import { getConsent, subscribe } from './consent';
import { loadCrisp, loadCrispWhenIdle } from './crispLoader';
import { purgeAnalyticsStorage, purgeSupportStorage } from './legacyStorage';
import { resumePendingSupportChat } from './supportChat';

// PostHog pulls in ~108 KiB of lazy extensions (recorder, surveys, web-vitals) as soon as it
// boots. At page load, with consent already stored, keep that off the critical path (PageSpeed:
// third-party payload). A user clicking "Aceitar" is different: start right away.
//
// The window is up to 3s, so the callback re-reads consent when it fires: a returning visitor who
// revokes right after load must not get PostHog initialised afterwards (disableAnalytics() is a
// no-op against an SDK that has not started yet, so it cannot undo a late init).
function initAnalyticsWhenIdle(): void {
  const initIfStillConsented = () => {
    if (getConsent()?.analytics === true) initAnalytics();
  };
  if ('requestIdleCallback' in window) {
    requestIdleCallback(initIfStillConsented, { timeout: 3000 });
  } else {
    setTimeout(initIfStillConsented, 1500);
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
