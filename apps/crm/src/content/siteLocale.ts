// No imports on purpose: App.tsx and main.tsx (the entry chunk every page downloads) read the
// locale of a path, and locale.ts would bring both languages' landing and pricing copy with it.

/** Market of a public page: Portuguese (Brazil, root paths) or English (US, under `/en`). */
export type SiteLocale = 'pt' | 'en';

/** `/en` and `/en/...` are English; everything else (`/english`, `/enx`, `/`) is Portuguese. */
export function siteLocaleForPath(pathname: string): SiteLocale {
  return pathname === '/en' || pathname.startsWith('/en/') ? 'en' : 'pt';
}
