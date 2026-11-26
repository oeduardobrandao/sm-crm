import i18n from 'i18next';
import { toast } from 'sonner';
import { siteLocaleForPath } from '../content/siteLocale';
import { isNativeApp } from '../native/platform';
import { getConsent, gpcEnabled, setConsent } from './consent';

/**
 * US consent model for the English site (spec 2026-11-25-us-english-site-design.md §9).
 * Nothing here runs at import time: main.tsx calls it at boot, the SSR bundle only imports it.
 */

/**
 * First visit to an `/en` page with no stored decision: write the US opt-out default (analytics,
 * support and advertising on, advertising off when the browser sends GPC). Runs in main.tsx before
 * installConsentEffects(), so the effects boot with the record in place and the Brazilian banner
 * never sees `null` there. Never in the iOS app, which loads no ad tags.
 */
export function applyUsConsentDefault(pathname: string): void {
  if (siteLocaleForPath(pathname) !== 'en') return;
  if (isNativeApp()) return;
  if (getConsent() !== null) return;
  setConsent({ analytics: true, support: true, marketing: !gpcEnabled() }, 'us_default');
}

/**
 * "Do Not Sell or Share My Personal Information" (US notice and `/en` footer): advertising off,
 * the other two kept, and the record's basis kept too. A `us_default` record stays `us_default`
 * (valid only on `/en`, so the click never leaks a Brazilian "choice"); a `choice` stays a
 * `choice`. With no record at all (storage gone or the default skipped), the other two follow
 * the US default.
 */
export function doNotSellOrShare(): void {
  const current = getConsent();
  setConsent(
    {
      analytics: current ? current.analytics : true,
      support: current ? current.support : true,
      marketing: false,
    },
    current?.basis ?? 'us_default',
  );
  toast.success(i18n.t('common:cookies.us.doNotSellDone'));
}
