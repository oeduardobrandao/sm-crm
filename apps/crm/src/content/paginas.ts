import { SOBRE } from './paginas/sobre';

export interface MarketingPageContent {
  slug: string;
  eyebrow: string;
  h1: string;
  sub: string;
  sections: Array<{ h2: string; paragraphs: string[]; bullets?: string[] }>;
  faq: Array<{ q: string; a: string }>;
  cta: { title: string; sub: string };
}

/** Populated by the per-page content modules. Tasks 10–13 each create a file
 * under content/paginas/ exporting its const and add it to this array. */
export const MARKETING_PAGES: MarketingPageContent[] = [SOBRE];

export function marketingPageBySlug(slug: string): MarketingPageContent | undefined {
  return MARKETING_PAGES.find((p) => p.slug === slug);
}
