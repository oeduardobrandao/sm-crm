import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PUBLIC_ROUTES } from '@/content/site-meta';

const titleFor = (path: string) => PUBLIC_ROUTES.find((r) => r.path === path)?.title ?? 'Mesaas';
/** The default title of the Brazilian and US sites. */
export const DEFAULT_TITLES = { pt: titleFor('/'), en: titleFor('/en') } as const;

/** Signed-in pages that set no title of their own inherit the page's static `<title>`, which is
 * the Portuguese landing title. Swap it for the default of the active language. Pages that set
 * their own title are left alone: their effects run before this parent's effect. */
export function AppDocumentTitle() {
  const { pathname } = useLocation();
  const { i18n } = useTranslation();
  useEffect(() => {
    const target = i18n.language === 'en' ? DEFAULT_TITLES.en : DEFAULT_TITLES.pt;
    const current = document.title;
    if (current !== target && Object.values(DEFAULT_TITLES).includes(current)) {
      document.title = target;
    }
  }, [pathname, i18n.language]);
  return null;
}
