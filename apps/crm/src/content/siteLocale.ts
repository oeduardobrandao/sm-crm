// No imports on purpose: App.tsx and main.tsx (the entry chunk every page downloads) read the
// locale of a path, and locale.ts would bring both languages' landing and pricing copy with it.

/** Market of a public page: Portuguese (Brazil, root paths) or English (US, under `/en`). */
export type SiteLocale = 'pt' | 'en';

/** `/en` and `/en/...` are English; everything else (`/english`, `/enx`, `/`) is Portuguese. */
export function siteLocaleForPath(pathname: string): SiteLocale {
  return pathname === '/en' || pathname.startsWith('/en/') ? 'en' : 'pt';
}

/** Public pages whose copy exists only in Portuguese (the Brazilian site). They render in `pt`
 * whatever language the visitor saved: a visit to `/en` saves `en` so the app that follows is
 * English, but that must not turn the Portuguese site's cookie banner and `<html lang>` English.
 * Kept in sync with the `pt` entries of `PUBLIC_ROUTES` by siteLocale.test.ts. */
const PORTUGUESE_SITE_PATHS = new Set([
  '/',
  '/precos',
  '/sobre',
  '/aprovacao-de-post',
  '/portal-do-cliente',
  '/agente-de-conteudo-ia',
  '/politica-de-privacidade',
  '/termos-de-uso',
  '/lgpd',
  '/novidades',
  '/blog',
]);

/** True on a Portuguese-only page of the public site (`/blog/<slug>` included). */
export function isPortugueseSitePage(pathname: string): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return PORTUGUESE_SITE_PATHS.has(path) || /^\/blog\/[^/]+$/.test(path);
}
