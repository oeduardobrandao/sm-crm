import type { Locale as DateFnsLocale } from 'date-fns';
import { enUS } from 'date-fns/locale/en-US';
import { ptBR } from 'date-fns/locale/pt-BR';
import i18n from 'i18next';
import type { BackendModule, i18n as I18nInstance } from 'i18next';
import { initReactI18next, useTranslation } from 'react-i18next';

/** Written only by a deliberate choice (the pt/EN toggle). Wins over everything else. */
const LANGUAGE_EXPLICIT_KEY = 'mesaas-language';
/** Written by visiting the US site (`/en`): a hint for pre-auth pages, never a choice. */
const LANGUAGE_HINT_KEY = 'mesaas-site-language';
const LANGUAGE_MIGRATED_KEY = 'mesaas-language-migrated';
const STORAGE_KEY = LANGUAGE_EXPLICIT_KEY;
const SUPPORTED_LANGUAGES = ['pt', 'en'] as const;
type Language = (typeof SUPPORTED_LANGUAGES)[number];

type Resources = Record<string, Record<string, Record<string, unknown>>>;

/** Fetches one namespace bundle for one language, e.g. via `import('./locales/en/posts.json')`. */
type NamespaceLoader = (lng: string, ns: string) => Promise<Record<string, unknown>>;

interface LazyNamespaces {
  /** Namespaces that are NOT in `resources` and are fetched on demand through `load`. */
  namespaces: readonly string[];
  load: NamespaceLoader;
}

function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && SUPPORTED_LANGUAGES.includes(value as Language);
}

function readLanguageKey(key: string): Language | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const value = localStorage.getItem(key);
    return isLanguage(value) ? value : null;
  } catch {
    return null;
  }
}

/** The language the visitor picked with the toggle, or null. */
export function getExplicitLanguage(): Language | null {
  return readLanguageKey(LANGUAGE_EXPLICIT_KEY);
}

/** The language hinted by visiting `/en`, or null. */
export function getLanguageHint(): Language | null {
  return readLanguageKey(LANGUAGE_HINT_KEY);
}

let activeWorkspaceLanguage: Language | null = null;

/** The signed-in workspace's language (memory only, never stored); null clears it. */
export function setActiveWorkspaceLanguage(lang: Language | null): void {
  activeWorkspaceLanguage = lang;
}

/** explicit choice, then workspace language, then the `/en` hint, then pt. Never throws. */
export function effectiveLanguage(): Language {
  return getExplicitLanguage() ?? activeWorkspaceLanguage ?? getLanguageHint() ?? 'pt';
}

/** Pre-auth language: explicit choice, then the `/en` hint, then pt. Never throws. */
export function getSavedLanguage(): Language {
  return getExplicitLanguage() ?? getLanguageHint() ?? 'pt';
}

/** Records the `/en` hint and switches the UI without saving an explicit choice. */
export function setLanguageHint(lang: Language): void {
  try {
    localStorage.setItem(LANGUAGE_HINT_KEY, lang);
  } catch {
    // Storage blocked: the language still changes for this session.
  }
  i18n.changeLanguage(lang);
}

/**
 * Once per browser: before the split, visiting `/en` wrote the explicit key. Move whatever is
 * there to the hint so an old visit is not mistaken for a choice.
 */
export function migrateLegacyLanguageKey(): void {
  try {
    if (localStorage.getItem(LANGUAGE_MIGRATED_KEY)) return;
    const legacy = localStorage.getItem(LANGUAGE_EXPLICIT_KEY);
    if (isLanguage(legacy)) {
      localStorage.setItem(LANGUAGE_HINT_KEY, legacy);
      localStorage.removeItem(LANGUAGE_EXPLICIT_KEY);
    }
    localStorage.setItem(LANGUAGE_MIGRATED_KEY, '1');
  } catch {
    // Storage unavailable: nothing to migrate.
  }
}

/** BCP 47 tag for `<html lang>`, so assistive tech and browser translation see the UI language. */
export function htmlLangFor(lang: string): string {
  return lang.startsWith('en') ? 'en' : 'pt-BR';
}

function syncDocumentLang(lang: string) {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = htmlLangFor(lang);
}

function createBackend(load: NamespaceLoader): BackendModule {
  return {
    type: 'backend',
    init() {},
    read(lng, ns, callback) {
      load(lng, ns).then(
        (data) => callback(null, data),
        (err: unknown) => callback(err instanceof Error ? err : new Error(String(err)), null),
      );
    },
  };
}

const lazyNamespacesByInstance = new WeakMap<I18nInstance, readonly string[]>();

/**
 * Initialises i18next + react-i18next.
 *
 * `resources` are bundled (synchronous). With `lazy`, the namespaces it lists are fetched on
 * demand: `useTranslation('posts')` suspends until its bundle lands, and `loadLazyNamespaces()`
 * fetches all of them at once (the CRM does that before any authenticated route renders).
 * Init stays synchronous either way, because only bundled namespaces are requested at init, so
 * a component outside any Suspense boundary that uses a bundled namespace never suspends.
 *
 * `instance` exists for tests; apps use the shared singleton.
 */
export function initI18n(
  resources: Resources,
  options: {
    lazy?: LazyNamespaces;
    instance?: I18nInstance;
    /** Overrides the saved language for init only (hydration renders `pt`); never written to storage. */
    initialLanguage?: Language;
  } = {},
) {
  const instance = options.instance ?? i18n;
  const namespaces = Object.keys(Object.values(resources)[0] ?? {});
  const { lazy } = options;

  if (lazy) {
    instance.use(createBackend(lazy.load));
    lazyNamespacesByInstance.set(instance, lazy.namespaces);
  }

  // Registered before init so the initial language also lands on <html lang>; `off` first
  // keeps a repeated init (tests) from stacking listeners.
  instance.off('languageChanged', syncDocumentLang);
  instance.on('languageChanged', syncDocumentLang);

  instance.use(initReactI18next).init({
    lng: options.initialLanguage ?? getSavedLanguage(),
    fallbackLng: 'pt',
    defaultNS: 'common',
    // Lets `useTranslation('someOtherNamespace')` still resolve bare `t('actions.save')`-style
    // keys against `common` without an explicit `common:` prefix, instead of rendering the
    // raw key when it isn't found in the caller's own namespace.
    fallbackNS: 'common',
    ns: namespaces,
    interpolation: { escapeValue: false },
    resources,
    ...(lazy
      ? {
          // Bundled resources plus a backend for the rest. Init must stay synchronous
          // (nothing to fetch for the bundled `ns` above) so `isInitialized` is already true
          // on the first render.
          partialBundledLanguages: true,
          initAsync: false,
        }
      : {}),
  });

  return instance;
}

/**
 * Fetches every lazy namespace for the current language (and its fallback). Once loaded they
 * are part of i18next's `ns` list, so `changeLanguage()` fetches the new language's bundles
 * for them before switching. Never rejects: a failed bundle degrades to the fallback/raw keys.
 * Resolves immediately when `initI18n` was called without `lazy`.
 */
export function loadLazyNamespaces(instance: I18nInstance = i18n): Promise<void> {
  const namespaces = lazyNamespacesByInstance.get(instance);
  if (!namespaces?.length) return Promise.resolve();
  return Promise.resolve(instance.loadNamespaces([...namespaces])).catch(() => undefined);
}

export function changeLanguage(lang: Language) {
  try {
    localStorage.setItem(LANGUAGE_EXPLICIT_KEY, lang);
  } catch {
    // Storage blocked (private mode, disabled cookies): the language still changes for this session.
  }
  i18n.changeLanguage(lang);
}

type IntlLocale = 'pt-BR' | 'en-US';

/** `Intl` / `toLocale*` tag for a UI language. Anything not English stays Brazilian. */
export function intlLocaleFor(lang: string | undefined): IntlLocale {
  return lang?.toLowerCase().startsWith('en') ? 'en-US' : 'pt-BR';
}

function currentLanguage(instance: typeof i18n | undefined = i18n): string | undefined {
  return instance?.resolvedLanguage ?? instance?.language;
}

/**
 * Current display locale, read at call time. For plain functions (formatters, imperative
 * renderers); a component should use `useIntlLocale()` so it re-renders on a switch.
 * Defaults to pt-BR before i18n is initialized.
 */
export function getIntlLocale(): IntlLocale {
  return intlLocaleFor(currentLanguage());
}

/** date-fns locale matching `getIntlLocale()`. */
export function getDateFnsLocale(): DateFnsLocale {
  return getIntlLocale() === 'en-US' ? enUS : ptBR;
}

export function useIntlLocale(): IntlLocale {
  const { i18n: instance } = useTranslation();
  return intlLocaleFor(currentLanguage(instance));
}

export function useDateFnsLocale(): DateFnsLocale {
  return useIntlLocale() === 'en-US' ? enUS : ptBR;
}

export { i18n, SUPPORTED_LANGUAGES, STORAGE_KEY, LANGUAGE_EXPLICIT_KEY, LANGUAGE_HINT_KEY };
export type { Language, IntlLocale, NamespaceLoader };
