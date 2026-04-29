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

export function initI18n(resources: Record<string, Record<string, Record<string, unknown>>>) {
  const namespaces = Object.keys(Object.values(resources)[0] ?? {});

  i18n.use(initReactI18next).init({
    lng: getSavedLanguage(),
    fallbackLng: 'pt',
    defaultNS: 'common',
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
