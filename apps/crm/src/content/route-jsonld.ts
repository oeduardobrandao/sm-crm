/** Per-route JSON-LD registry — single source for the prerender script and
 * the client-side usePageMeta swap. */
import {
  faqPageJsonLd,
  organizationJsonLd,
  softwareApplicationJsonLd,
  webSiteJsonLd,
} from './jsonld';
import { LANDING } from './landing.content';
import { PRECOS } from './precos.content';
import { marketingPageBySlug } from './paginas';

export function jsonLdForPath(path: string): object[] {
  const base = [organizationJsonLd(), webSiteJsonLd()];
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
