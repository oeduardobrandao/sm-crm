import { useEffect, type ReactNode } from 'react';
import { changeLanguage } from '@mesaas/i18n';

/** Wraps every `/en` page. On mount it switches i18n to English and saves that choice
 * (`mesaas-language`), so the cookie banner, sign-up and the app that follow stay in English.
 * An effect, never render work: the server render and the hydrating first render are already
 * English (entry-server.tsx and main.tsx start `/en` in `en`). */
export function EnglishPage({ children }: { children: ReactNode }) {
  useEffect(() => {
    void changeLanguage('en');
  }, []);
  return children;
}
