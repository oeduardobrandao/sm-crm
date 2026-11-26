/** Per-route JSON-LD registry — single source for the prerender script and
 * the client-side usePageMeta swap. */
import {
  faqPageJsonLd,
  organizationJsonLd,
  softwareApplicationJsonLd,
  webSiteJsonLd,
} from './jsonld';
import { LANDING } from './landing.content';
import { LANDING_EN } from './landing.content.en';
import { PRECOS } from './precos.content';
import { PRECOS_EN } from './precos.content.en';
import { siteLocaleForPath } from './locale';
import { marketingPageBySlug } from './paginas';

export function jsonLdForPath(path: string): object[] {
  const locale = siteLocaleForPath(path);
  const base = [organizationJsonLd(), webSiteJsonLd(locale)];
  if (path === '/en') {
    return [...base, softwareApplicationJsonLd('en'), faqPageJsonLd([...LANDING_EN.faq])];
  }
  if (path === '/en/pricing') {
    return [...base, softwareApplicationJsonLd('en'), faqPageJsonLd([...PRECOS_EN.faq])];
  }
  if (path === '/') {
    return [...base, softwareApplicationJsonLd(), faqPageJsonLd([...LANDING.faq])];
  }
  if (path === '/precos') {
    return [...base, softwareApplicationJsonLd(), faqPageJsonLd([...PRECOS.faq])];
  }
  const page = marketingPageBySlug(path.slice(1));
  if (page && page.faq.length) return [...base, faqPageJsonLd([...page.faq])];
  return base;
}
