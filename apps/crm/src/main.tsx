import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { installDeployRecovery, installSilentUpdate } from '@mesaas/app-lifecycle';
import { initSentry } from '@/lib/sentry';
import { initAnalytics } from './lib/analytics';
import { initI18n } from '@mesaas/i18n';
import ptCommon from '../../../packages/i18n/locales/pt/common.json';
import enCommon from '../../../packages/i18n/locales/en/common.json';
import ptDashboard from '../../../packages/i18n/locales/pt/dashboard.json';
import enDashboard from '../../../packages/i18n/locales/en/dashboard.json';
import ptClients from '../../../packages/i18n/locales/pt/clients.json';
import enClients from '../../../packages/i18n/locales/en/clients.json';
import ptLeads from '../../../packages/i18n/locales/pt/leads.json';
import enLeads from '../../../packages/i18n/locales/en/leads.json';
import ptPosts from '../../../packages/i18n/locales/pt/posts.json';
import enPosts from '../../../packages/i18n/locales/en/posts.json';
import ptAuth from '../../../packages/i18n/locales/pt/auth.json';
import enAuth from '../../../packages/i18n/locales/en/auth.json';
import ptBrand from '../../../packages/i18n/locales/pt/brand.json';
import enBrand from '../../../packages/i18n/locales/en/brand.json';
import ptAutomations from '../../../packages/i18n/locales/pt/automations.json';
import enAutomations from '../../../packages/i18n/locales/en/automations.json';
import App, { queryClient } from './App';
import '../style.css';

// Before anything else: a tab open across a deploy loads chunks that no longer exist.
installDeployRecovery();

initSentry();

// PostHog pulls in ~108 KiB of lazy extensions (recorder, surveys, web-vitals) as soon as it
// boots. Initializing on idle keeps all of that off the landing page's critical path without
// losing any feature: `capture_pageview` still fires on init with the current URL, and every
// capture/identify helper no-ops safely until then (PageSpeed: third-party payload).
if ('requestIdleCallback' in window) {
  requestIdleCallback(() => initAnalytics(), { timeout: 3000 });
} else {
  setTimeout(() => initAnalytics(), 1500);
}

initI18n({
  pt: {
    common: ptCommon,
    dashboard: ptDashboard,
    clients: ptClients,
    leads: ptLeads,
    posts: ptPosts,
    auth: ptAuth,
    brand: ptBrand,
    automations: ptAutomations,
  },
  en: {
    common: enCommon,
    dashboard: enDashboard,
    clients: enClients,
    leads: enLeads,
    posts: enPosts,
    auth: enAuth,
    brand: enBrand,
    automations: enAutomations,
  },
});

// Minimal DATA router (single splat route; App keeps its own descendant <Routes>). It was
// introduced because `useBlocker` needs data-router context, for the Estúdio autosave's
// dirty-navigation blocker. Estúdio is retired; today the data router is what lets
// `installSilentUpdate` register its navigation blocker. Route matching/links are unchanged:
// every internal link navigates by absolute path.
const router = createBrowserRouter([{ path: '*', element: <App /> }]);

// A deploy while this tab is open: move to the new build at the next route change, or once
// the tab has been hidden or idle for a while, never starting over unsaved work or an in-flight mutation.
installSilentUpdate({ router, holdWhile: () => queryClient.isMutating() > 0 });

ReactDOM.createRoot(document.getElementById('root')!).render(<RouterProvider router={router} />);
