import { useEffect, type ReactNode } from 'react';
import { setLanguageHint } from '@mesaas/i18n';

/** Wraps every `/en` page. On mount it switches i18n to English and records a hint
 * (`mesaas-site-language`, never the explicit choice), so the cookie banner and sign-up that
 * follow stay in English; an explicit choice or the workspace language still wins in the app.
 * An effect, never render work: the server render and the hydrating first render are already
 * English (entry-server.tsx and main.tsx start `/en` in `en`). */
export function EnglishPage({ children }: { children: ReactNode }) {
  useEffect(() => {
    setLanguageHint('en');
  }, []);
  return children;
}
