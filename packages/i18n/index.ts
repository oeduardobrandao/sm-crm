import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

const STORAGE_KEY = 'mesaas-language';
const SUPPORTED_LANGUAGES = ['pt', 'en'] as const;
type Language = (typeof SUPPORTED_LANGUAGES)[number];

function getSavedLanguage(): Language {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved && SUPPORTED_LANGUAGES.includes(saved as Language)) return saved as Language;
  return 'pt';
}

/** BCP 47 tag for `<html lang>`, so assistive tech and browser translation see the UI language. */
export function htmlLangFor(lang: string): string {
  return lang.startsWith('en') ? 'en' : 'pt-BR';
}

function syncDocumentLang(lang: string) {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = htmlLangFor(lang);
}

export function initI18n(resources: Record<string, Record<string, Record<string, unknown>>>) {
  const namespaces = Object.keys(Object.values(resources)[0] ?? {});

  // Registered before init so the initial language also lands on <html lang>; `off` first
  // keeps a repeated init (tests) from stacking listeners.
  i18n.off('languageChanged', syncDocumentLang);
  i18n.on('languageChanged', syncDocumentLang);

  i18n.use(initReactI18next).init({
    lng: getSavedLanguage(),
    fallbackLng: 'pt',
    defaultNS: 'common',
    // Lets `useTranslation('someOtherNamespace')` still resolve bare `t('actions.save')`-style
    // keys against `common` without an explicit `common:` prefix, instead of rendering the
    // raw key when it isn't found in the caller's own namespace.
    fallbackNS: 'common',
    ns: namespaces,
    interpolation: { escapeValue: false },
    resources,
  });

  return i18n;
}

export function changeLanguage(lang: Language) {
  localStorage.setItem(STORAGE_KEY, lang);
  i18n.changeLanguage(lang);
}

export { i18n, SUPPORTED_LANGUAGES, STORAGE_KEY };
export type { Language };
