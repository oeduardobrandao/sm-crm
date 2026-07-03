import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { initSentry } from '@/lib/sentry';
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
import ptEstudio from '../../../packages/i18n/locales/pt/estudio.json';
import enEstudio from '../../../packages/i18n/locales/en/estudio.json';
import App from './App';
import '../style.css';

initSentry();

initI18n({
  pt: {
    common: ptCommon,
    dashboard: ptDashboard,
    clients: ptClients,
    leads: ptLeads,
    posts: ptPosts,
    auth: ptAuth,
    estudio: ptEstudio,
  },
  en: {
    common: enCommon,
    dashboard: enDashboard,
    clients: enClients,
    leads: enLeads,
    posts: enPosts,
    auth: enAuth,
    estudio: enEstudio,
  },
});

// Minimal DATA router (single splat route; App keeps its own descendant <Routes>) — a plain
// <BrowserRouter> gives `useBlocker` no data-router context, and the Estúdio autosave's
// dirty-navigation blocker (design §6.2) needs it. Route matching/links are unchanged: every
// internal link in this app navigates by absolute path.
const router = createBrowserRouter([{ path: '*', element: <App /> }]);

ReactDOM.createRoot(document.getElementById('root')!).render(<RouterProvider router={router} />);
