import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
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
import App from './App';
import '../style.css';

initSentry();
initAnalytics();

initI18n({
  pt: {
    common: ptCommon,
    dashboard: ptDashboard,
    clients: ptClients,
    leads: ptLeads,
    posts: ptPosts,
    auth: ptAuth,
    brand: ptBrand,
  },
  en: {
    common: enCommon,
    dashboard: enDashboard,
    clients: enClients,
    leads: enLeads,
    posts: enPosts,
    auth: enAuth,
    brand: enBrand,
  },
});

// Minimal DATA router (single splat route; App keeps its own descendant <Routes>). It was
// introduced because `useBlocker` needs data-router context, for the Estúdio autosave's
// dirty-navigation blocker; Estúdio is retired and nothing uses `useBlocker` today, but the
// data router is kept because swapping back to <BrowserRouter> is a behaviour change for no
// benefit. Route matching/links are unchanged: every internal link navigates by absolute path.
const router = createBrowserRouter([{ path: '*', element: <App /> }]);

ReactDOM.createRoot(document.getElementById('root')!).render(<RouterProvider router={router} />);
