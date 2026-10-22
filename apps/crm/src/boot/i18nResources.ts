import type { NamespaceLoader } from '@mesaas/i18n';
// Only `common` is bundled: it is all the public pages (landing, pricing, consent banner) need.
// The rest is fetched per language+namespace on demand; ProtectedRoute's lazy chunk preloads
// them all (App.tsx) before any authenticated route renders. Shared by main.tsx and the
// landing's server render (entry-server.tsx), which must init i18n with the same resources.
import ptCommon from '../../../../packages/i18n/locales/pt/common.json';
import enCommon from '../../../../packages/i18n/locales/en/common.json';

type LocaleModule = Promise<{ default: Record<string, unknown> }>;

// Explicit per-file imports (not a template-string import) so Vite emits one small chunk per
// bundle, and only for the CRM's namespaces, never the Hub's.
const LAZY_LOCALES: Record<string, Record<string, () => LocaleModule>> = {
  pt: {
    dashboard: () => import('../../../../packages/i18n/locales/pt/dashboard.json'),
    clients: () => import('../../../../packages/i18n/locales/pt/clients.json'),
    leads: () => import('../../../../packages/i18n/locales/pt/leads.json'),
    posts: () => import('../../../../packages/i18n/locales/pt/posts.json'),
    auth: () => import('../../../../packages/i18n/locales/pt/auth.json'),
    brand: () => import('../../../../packages/i18n/locales/pt/brand.json'),
    automations: () => import('../../../../packages/i18n/locales/pt/automations.json'),
  },
  en: {
    dashboard: () => import('../../../../packages/i18n/locales/en/dashboard.json'),
    clients: () => import('../../../../packages/i18n/locales/en/clients.json'),
    leads: () => import('../../../../packages/i18n/locales/en/leads.json'),
    posts: () => import('../../../../packages/i18n/locales/en/posts.json'),
    auth: () => import('../../../../packages/i18n/locales/en/auth.json'),
    brand: () => import('../../../../packages/i18n/locales/en/brand.json'),
    automations: () => import('../../../../packages/i18n/locales/en/automations.json'),
  },
};

const loadLocale: NamespaceLoader = async (lng, ns) => {
  const load = LAZY_LOCALES[lng]?.[ns];
  if (!load) throw new Error(`No locale bundle for ${lng}/${ns}`);
  return (await load()).default;
};

export const I18N_RESOURCES = { pt: { common: ptCommon }, en: { common: enCommon } };

export const I18N_LAZY = { namespaces: Object.keys(LAZY_LOCALES.pt), load: loadLocale };
