import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { effectiveLanguage, i18n } from '@mesaas/i18n';
import { isPortugueseSitePage, siteLocaleForPath } from '@/content/siteLocale';

/** Keeps i18n in the right language as the visitor moves between pages:
 *
 * - `/en` pages are English whatever was saved: main.tsx starts them in `en` and EnglishPage
 *   saves `en`, so this stays out of the way there.
 * - Portuguese-only site pages (the landing, pricing, the blog...) render in `pt` without
 *   touching the saved language, so a visitor who went through `/en` still gets the Portuguese
 *   cookie banner and `<html lang="pt-BR">` on the Brazilian site.
 * - Everything else (login, the app) uses the effective language (explicit choice, then the
 *   signed-in workspace's language, then the `/en` hint), including after a client-side
 *   navigation away from a Portuguese site page.
 *
 * The path is read inside the effect, never during render (the landing is server-rendered). */
export function SavedLanguageSync() {
  const { pathname } = useLocation();
  useEffect(() => {
    if (siteLocaleForPath(pathname) === 'en') return;
    const target = isPortugueseSitePage(pathname) ? 'pt' : effectiveLanguage();
    if (i18n.language !== target) void i18n.changeLanguage(target);
  }, [pathname]);
  return null;
}
