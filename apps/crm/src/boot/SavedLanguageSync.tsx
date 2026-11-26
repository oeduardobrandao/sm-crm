import { useEffect } from 'react';
import { getSavedLanguage, i18n } from '@mesaas/i18n';
import { siteLocaleForPath } from '@/content/siteLocale';

/** The prerendered landing hydrates in `pt` (main.tsx passes `initialLanguage: 'pt'` on `/`,
 * matching the server HTML); the visitor's saved language is applied right after hydration. On
 * every other boot i18n already starts in the saved language, so this is a no-op there.
 *
 * `/en` pages are English whatever was saved: main.tsx starts them in `en` and EnglishPage
 * saves `en`, so this stays out of the way there. The path is read inside the effect, never
 * during render (the landing is server-rendered). */
export function SavedLanguageSync() {
  useEffect(() => {
    if (siteLocaleForPath(window.location.pathname) === 'en') return;
    const saved = getSavedLanguage();
    if (i18n.language !== saved) void i18n.changeLanguage(saved);
  }, []);
  return null;
}
