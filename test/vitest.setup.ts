import { afterEach, expect, vi } from 'vitest';
import * as matchers from '@testing-library/jest-dom/matchers';
import { cleanup, configure } from '@testing-library/react';
import { initI18n } from '@mesaas/i18n';

expect.extend(matchers);

// CI's coverage-instrumented run is slow enough that testing-library's 1s
// default for findBy*/waitFor flakes on unrelated tests (ImportarPage,
// revocation, LoginPage all tripped it on 2026-07-30). More headroom in CI
// only; local runs keep the tight default so slow waits still surface.
if (process.env.CI) {
  configure({ asyncUtilTimeout: 10_000 });
}
import ptCommon from '../packages/i18n/locales/pt/common.json';
import enCommon from '../packages/i18n/locales/en/common.json';
import ptDashboard from '../packages/i18n/locales/pt/dashboard.json';
import enDashboard from '../packages/i18n/locales/en/dashboard.json';
import ptClients from '../packages/i18n/locales/pt/clients.json';
import enClients from '../packages/i18n/locales/en/clients.json';
import ptLeads from '../packages/i18n/locales/pt/leads.json';
import enLeads from '../packages/i18n/locales/en/leads.json';
import ptPosts from '../packages/i18n/locales/pt/posts.json';
import enPosts from '../packages/i18n/locales/en/posts.json';
import ptAuth from '../packages/i18n/locales/pt/auth.json';
import enAuth from '../packages/i18n/locales/en/auth.json';
import ptBrand from '../packages/i18n/locales/pt/brand.json';
import enBrand from '../packages/i18n/locales/en/brand.json';
import ptHubHome from '../packages/i18n/locales/pt/hubHome.json';
import enHubHome from '../packages/i18n/locales/en/hubHome.json';
import ptHubPostCard from '../packages/i18n/locales/pt/hubPostCard.json';
import enHubPostCard from '../packages/i18n/locales/en/hubPostCard.json';
import ptHubPosts from '../packages/i18n/locales/pt/hubPosts.json';
import enHubPosts from '../packages/i18n/locales/en/hubPosts.json';
import ptHubPages from '../packages/i18n/locales/pt/hubPages.json';
import enHubPages from '../packages/i18n/locales/en/hubPages.json';
import ptHubBriefing from '../packages/i18n/locales/pt/hubBriefing.json';
import enHubBriefing from '../packages/i18n/locales/en/hubBriefing.json';
import ptHubBrand from '../packages/i18n/locales/pt/hubBrand.json';
import enHubBrand from '../packages/i18n/locales/en/hubBrand.json';
import ptHubIdeas from '../packages/i18n/locales/pt/hubIdeas.json';
import enHubIdeas from '../packages/i18n/locales/en/hubIdeas.json';
import ptHubReports from '../packages/i18n/locales/pt/hubReports.json';
import enHubReports from '../packages/i18n/locales/en/hubReports.json';
import ptHubMessages from '../packages/i18n/locales/pt/hubMessages.json';
import enHubMessages from '../packages/i18n/locales/en/hubMessages.json';
import ptHubAgenda from '../packages/i18n/locales/pt/hubAgenda.json';
import enHubAgenda from '../packages/i18n/locales/en/hubAgenda.json';
import ptHubConvite from '../packages/i18n/locales/pt/hubConvite.json';
import enHubConvite from '../packages/i18n/locales/en/hubConvite.json';
import ptEntregas from '../packages/i18n/locales/pt/entregas.json';
import enEntregas from '../packages/i18n/locales/en/entregas.json';
import ptWorkflows from '../packages/i18n/locales/pt/workflows.json';
import enWorkflows from '../packages/i18n/locales/en/workflows.json';
import ptPostEditor from '../packages/i18n/locales/pt/postEditor.json';
import enPostEditor from '../packages/i18n/locales/en/postEditor.json';
import ptLinha from '../packages/i18n/locales/pt/linha.json';
import enLinha from '../packages/i18n/locales/en/linha.json';
import ptEntregasViews from '../packages/i18n/locales/pt/entregasViews.json';
import enEntregasViews from '../packages/i18n/locales/en/entregasViews.json';
import ptEntregasPhone from '../packages/i18n/locales/pt/entregasPhone.json';
import enEntregasPhone from '../packages/i18n/locales/en/entregasPhone.json';
import ptPostPanels from '../packages/i18n/locales/pt/postPanels.json';
import enPostPanels from '../packages/i18n/locales/en/postPanels.json';
import ptCalendario from '../packages/i18n/locales/pt/calendario.json';
import enCalendario from '../packages/i18n/locales/en/calendario.json';
import ptAgenda from '../packages/i18n/locales/pt/agenda.json';
import enAgenda from '../packages/i18n/locales/en/agenda.json';
import ptAgendaEvento from '../packages/i18n/locales/pt/agendaEvento.json';
import enAgendaEvento from '../packages/i18n/locales/en/agendaEvento.json';
import ptSettings from '../packages/i18n/locales/pt/settings.json';
import enSettings from '../packages/i18n/locales/en/settings.json';
import ptSettingsHub from '../packages/i18n/locales/pt/settingsHub.json';
import enSettingsHub from '../packages/i18n/locales/en/settingsHub.json';
import ptBilling from '../packages/i18n/locales/pt/billing.json';
import enBilling from '../packages/i18n/locales/en/billing.json';
import ptMcp from '../packages/i18n/locales/pt/mcp.json';
import enMcp from '../packages/i18n/locales/en/mcp.json';
import ptTasks from '../packages/i18n/locales/pt/tasks.json';
import enTasks from '../packages/i18n/locales/en/tasks.json';
import ptTasksForm from '../packages/i18n/locales/pt/tasksForm.json';
import enTasksForm from '../packages/i18n/locales/en/tasksForm.json';
import ptTasksPhone from '../packages/i18n/locales/pt/tasksPhone.json';
import enTasksPhone from '../packages/i18n/locales/en/tasksPhone.json';
import ptClientHub from '../packages/i18n/locales/pt/clientHub.json';
import enClientHub from '../packages/i18n/locales/en/clientHub.json';
import ptClientBriefing from '../packages/i18n/locales/pt/clientBriefing.json';
import enClientBriefing from '../packages/i18n/locales/en/clientBriefing.json';
import ptMessages from '../packages/i18n/locales/pt/messages.json';
import enMessages from '../packages/i18n/locales/en/messages.json';
import ptMessagesPhone from '../packages/i18n/locales/pt/messagesPhone.json';
import enMessagesPhone from '../packages/i18n/locales/en/messagesPhone.json';

initI18n({
  pt: {
    common: ptCommon,
    dashboard: ptDashboard,
    clients: ptClients,
    leads: ptLeads,
    posts: ptPosts,
    auth: ptAuth,
    brand: ptBrand,
    entregas: ptEntregas,
    workflows: ptWorkflows,
    postEditor: ptPostEditor,
    linha: ptLinha,
    entregasViews: ptEntregasViews,
    entregasPhone: ptEntregasPhone,
    postPanels: ptPostPanels,
    calendario: ptCalendario,
    agenda: ptAgenda,
    agendaEvento: ptAgendaEvento,
    settings: ptSettings,
    settingsHub: ptSettingsHub,
    billing: ptBilling,
    mcp: ptMcp,
    tasks: ptTasks,
    tasksForm: ptTasksForm,
    tasksPhone: ptTasksPhone,
    clientHub: ptClientHub,
    clientBriefing: ptClientBriefing,
    messages: ptMessages,
    messagesPhone: ptMessagesPhone,
    hubHome: ptHubHome,
    hubPostCard: ptHubPostCard,
    hubPosts: ptHubPosts,
    hubPages: ptHubPages,
    hubBriefing: ptHubBriefing,
    hubBrand: ptHubBrand,
    hubIdeas: ptHubIdeas,
    hubReports: ptHubReports,
    hubMessages: ptHubMessages,
    hubAgenda: ptHubAgenda,
    hubConvite: ptHubConvite,
  },
  en: {
    common: enCommon,
    dashboard: enDashboard,
    clients: enClients,
    leads: enLeads,
    posts: enPosts,
    auth: enAuth,
    brand: enBrand,
    entregas: enEntregas,
    workflows: enWorkflows,
    postEditor: enPostEditor,
    linha: enLinha,
    entregasViews: enEntregasViews,
    entregasPhone: enEntregasPhone,
    postPanels: enPostPanels,
    calendario: enCalendario,
    agenda: enAgenda,
    agendaEvento: enAgendaEvento,
    settings: enSettings,
    settingsHub: enSettingsHub,
    billing: enBilling,
    mcp: enMcp,
    tasks: enTasks,
    tasksForm: enTasksForm,
    tasksPhone: enTasksPhone,
    clientHub: enClientHub,
    clientBriefing: enClientBriefing,
    messages: enMessages,
    messagesPhone: enMessagesPhone,
    hubHome: enHubHome,
    hubPostCard: enHubPostCard,
    hubPosts: enHubPosts,
    hubPages: enHubPages,
    hubBriefing: enHubBriefing,
    hubBrand: enHubBrand,
    hubIdeas: enHubIdeas,
    hubReports: enHubReports,
    hubMessages: enHubMessages,
    hubAgenda: enHubAgenda,
    hubConvite: enHubConvite,
  },
});

// jsdom has no ResizeObserver — cmdk (FontPicker) and other floating-ui consumers observe
// their anchors with it. A no-op implementation is enough for tests.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// jsdom is also missing the DOM geometry APIs ProseMirror's EditorView calls on every
// real click/keystroke inside a contenteditable it manages (posAtCoords -> elementFromPoint,
// scrollToSelection -> coordsAtPos -> Range.getClientRects/getBoundingClientRect). Without
// these, `userEvent.click`/`.type` against a mounted TipTap editor throws uncaught exceptions
// mid-transaction and the resulting document silently never receives the typed text (proven
// empirically while writing PaginaRichTextEditor.test.tsx, Task 9 of the portal-cliente-layout
// plan). Zero-sized stubs are enough: tests don't assert real screen coordinates, they only
// need ProseMirror to finish applying the transaction instead of throwing.
// The rest of this file stubs DOM APIs; `@vitest-environment node` files (server-render tests)
// have no DOM to stub.
const hasDom = typeof document !== 'undefined';
if (hasDom && !document.elementFromPoint) {
  document.elementFromPoint = () => null;
}
if (hasDom && !Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = () => ({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    toJSON() {
      return {};
    },
  });
}
if (hasDom && !Range.prototype.getClientRects) {
  Range.prototype.getClientRects = () =>
    ({
      length: 0,
      item: () => null,
      [Symbol.iterator]: function* () {},
    }) as unknown as DOMRectList;
}

if (hasDom)
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });

afterEach(() => {
  if (hasDom) cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
