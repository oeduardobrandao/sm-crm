import { buildPlanIntentQuery } from '@/pages/comecar/plan-intent';
import type { BillingInterval } from '@/services/billing';
import { LANDING, type LandingContent } from './landing.content';
import { LANDING_EN } from './landing.content.en';
import { PRECOS, type PrecosContent } from './precos.content';
import { PRECOS_EN } from './precos.content.en';

/** Market of a public page: Portuguese (Brazil, root paths) or English (US, under `/en`). */
export type SiteLocale = 'pt' | 'en';

export type SitePageKey = 'home' | 'pricing' | 'privacy' | 'terms';

/** `/en` and `/en/...` are English; everything else (`/english`, `/enx`, `/`) is Portuguese. */
export function siteLocaleForPath(pathname: string): SiteLocale {
  return pathname === '/en' || pathname.startsWith('/en/') ? 'en' : 'pt';
}

const PATHS: Record<SiteLocale, Record<SitePageKey, string>> = {
  pt: {
    home: '/',
    pricing: '/precos',
    privacy: '/politica-de-privacidade',
    terms: '/termos-de-uso',
  },
  en: {
    home: '/en',
    pricing: '/en/pricing',
    privacy: '/en/privacy',
    terms: '/en/terms',
  },
};

export function localizedPath(locale: SiteLocale, key: SitePageKey): string {
  return PATHS[locale][key];
}

/** Signup link. Pt matches what the landing builds today (`/login?tab=register`, plus the plan
 * intent for paid plans); en adds `market=us` so signup knows which market the visitor came from. */
export function signupHref(
  locale: SiteLocale,
  planIntent?: string,
  interval: BillingInterval = 'month',
): string {
  let href = '/login?tab=register';
  if (locale === 'en') href += '&market=us';
  if (planIntent) href += `&${buildPlanIntentQuery(planIntent, interval)}`;
  return href;
}

export function landingContent(locale: SiteLocale): LandingContent {
  return locale === 'en' ? LANDING_EN : LANDING;
}

export function precosContent(locale: SiteLocale): PrecosContent {
  return locale === 'en' ? PRECOS_EN : PRECOS;
}
