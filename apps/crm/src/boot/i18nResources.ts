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
    entregas: () => import('../../../../packages/i18n/locales/pt/entregas.json'),
    workflows: () => import('../../../../packages/i18n/locales/pt/workflows.json'),
    postEditor: () => import('../../../../packages/i18n/locales/pt/postEditor.json'),
    linha: () => import('../../../../packages/i18n/locales/pt/linha.json'),
    entregasViews: () => import('../../../../packages/i18n/locales/pt/entregasViews.json'),
    entregasPhone: () => import('../../../../packages/i18n/locales/pt/entregasPhone.json'),
    postPanels: () => import('../../../../packages/i18n/locales/pt/postPanels.json'),
    calendario: () => import('../../../../packages/i18n/locales/pt/calendario.json'),
    agenda: () => import('../../../../packages/i18n/locales/pt/agenda.json'),
    agendaEvento: () => import('../../../../packages/i18n/locales/pt/agendaEvento.json'),
    settings: () => import('../../../../packages/i18n/locales/pt/settings.json'),
    settingsHub: () => import('../../../../packages/i18n/locales/pt/settingsHub.json'),
    billing: () => import('../../../../packages/i18n/locales/pt/billing.json'),
    mcp: () => import('../../../../packages/i18n/locales/pt/mcp.json'),
    tasks: () => import('../../../../packages/i18n/locales/pt/tasks.json'),
    tasksForm: () => import('../../../../packages/i18n/locales/pt/tasksForm.json'),
    tasksPhone: () => import('../../../../packages/i18n/locales/pt/tasksPhone.json'),
    clientHub: () => import('../../../../packages/i18n/locales/pt/clientHub.json'),
    clientBriefing: () => import('../../../../packages/i18n/locales/pt/clientBriefing.json'),
    messages: () => import('../../../../packages/i18n/locales/pt/messages.json'),
    messagesPhone: () => import('../../../../packages/i18n/locales/pt/messagesPhone.json'),
    files: () => import('../../../../packages/i18n/locales/pt/files.json'),
    filesPhone: () => import('../../../../packages/i18n/locales/pt/filesPhone.json'),
    finance: () => import('../../../../packages/i18n/locales/pt/finance.json'),
    financeV2: () => import('../../../../packages/i18n/locales/pt/financeV2.json'),
  },
  en: {
    dashboard: () => import('../../../../packages/i18n/locales/en/dashboard.json'),
    clients: () => import('../../../../packages/i18n/locales/en/clients.json'),
    leads: () => import('../../../../packages/i18n/locales/en/leads.json'),
    posts: () => import('../../../../packages/i18n/locales/en/posts.json'),
    auth: () => import('../../../../packages/i18n/locales/en/auth.json'),
    brand: () => import('../../../../packages/i18n/locales/en/brand.json'),
    automations: () => import('../../../../packages/i18n/locales/en/automations.json'),
    entregas: () => import('../../../../packages/i18n/locales/en/entregas.json'),
    workflows: () => import('../../../../packages/i18n/locales/en/workflows.json'),
    postEditor: () => import('../../../../packages/i18n/locales/en/postEditor.json'),
    linha: () => import('../../../../packages/i18n/locales/en/linha.json'),
    entregasViews: () => import('../../../../packages/i18n/locales/en/entregasViews.json'),
    entregasPhone: () => import('../../../../packages/i18n/locales/en/entregasPhone.json'),
    postPanels: () => import('../../../../packages/i18n/locales/en/postPanels.json'),
    calendario: () => import('../../../../packages/i18n/locales/en/calendario.json'),
    agenda: () => import('../../../../packages/i18n/locales/en/agenda.json'),
    agendaEvento: () => import('../../../../packages/i18n/locales/en/agendaEvento.json'),
    settings: () => import('../../../../packages/i18n/locales/en/settings.json'),
    settingsHub: () => import('../../../../packages/i18n/locales/en/settingsHub.json'),
    billing: () => import('../../../../packages/i18n/locales/en/billing.json'),
    mcp: () => import('../../../../packages/i18n/locales/en/mcp.json'),
    tasks: () => import('../../../../packages/i18n/locales/en/tasks.json'),
    tasksForm: () => import('../../../../packages/i18n/locales/en/tasksForm.json'),
    tasksPhone: () => import('../../../../packages/i18n/locales/en/tasksPhone.json'),
    clientHub: () => import('../../../../packages/i18n/locales/en/clientHub.json'),
    clientBriefing: () => import('../../../../packages/i18n/locales/en/clientBriefing.json'),
    messages: () => import('../../../../packages/i18n/locales/en/messages.json'),
    messagesPhone: () => import('../../../../packages/i18n/locales/en/messagesPhone.json'),
    files: () => import('../../../../packages/i18n/locales/en/files.json'),
    filesPhone: () => import('../../../../packages/i18n/locales/en/filesPhone.json'),
    finance: () => import('../../../../packages/i18n/locales/en/finance.json'),
    financeV2: () => import('../../../../packages/i18n/locales/en/financeV2.json'),
  },
};

const loadLocale: NamespaceLoader = async (lng, ns) => {
  const load = LAZY_LOCALES[lng]?.[ns];
  if (!load) throw new Error(`No locale bundle for ${lng}/${ns}`);
  return (await load()).default;
};

export const I18N_RESOURCES = { pt: { common: ptCommon }, en: { common: enCommon } };

export const I18N_LAZY = { namespaces: Object.keys(LAZY_LOCALES.pt), load: loadLocale };
