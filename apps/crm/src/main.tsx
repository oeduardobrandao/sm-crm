import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { installDeployRecovery, installSilentUpdate } from '@mesaas/app-lifecycle';
import { initSentry } from '@/lib/sentry';
import { installConsentEffects } from './lib/consentEffects';
import { captureReferral } from './lib/referral';
import { initI18n, type NamespaceLoader } from '@mesaas/i18n';
// Only `common` is bundled: it is all the public pages (landing, pricing, consent banner) need.
// The rest is fetched per language+namespace on demand; ProtectedRoute's lazy chunk preloads
// them all (App.tsx) before any authenticated route renders.
import ptCommon from '../../../packages/i18n/locales/pt/common.json';
import enCommon from '../../../packages/i18n/locales/en/common.json';
import App, { preloadLanding, queryClient } from './App';
import '../style.css';

// Before anything else: a tab open across a deploy loads chunks that no longer exist.
installDeployRecovery();

initSentry();

// PostHog and the Crisp widget start only after the visitor's consent (lib/consentEffects.ts);
// with consent already stored they still load on idle, off the landing page's critical path.
installConsentEffects();

// Programa de afiliados: grava o ?ref= de qualquer página do site para o cadastro (lib/referral.ts).
captureReferral(window.location.search);

type LocaleModule = Promise<{ default: Record<string, unknown> }>;

// Explicit per-file imports (not a template-string import) so Vite emits one small chunk per
// bundle, and only for the CRM's namespaces, never the Hub's.
const LAZY_LOCALES: Record<string, Record<string, () => LocaleModule>> = {
  pt: {
    dashboard: () => import('../../../packages/i18n/locales/pt/dashboard.json'),
    clients: () => import('../../../packages/i18n/locales/pt/clients.json'),
    leads: () => import('../../../packages/i18n/locales/pt/leads.json'),
    posts: () => import('../../../packages/i18n/locales/pt/posts.json'),
    auth: () => import('../../../packages/i18n/locales/pt/auth.json'),
    brand: () => import('../../../packages/i18n/locales/pt/brand.json'),
    automations: () => import('../../../packages/i18n/locales/pt/automations.json'),
  },
  en: {
    dashboard: () => import('../../../packages/i18n/locales/en/dashboard.json'),
    clients: () => import('../../../packages/i18n/locales/en/clients.json'),
    leads: () => import('../../../packages/i18n/locales/en/leads.json'),
    posts: () => import('../../../packages/i18n/locales/en/posts.json'),
    auth: () => import('../../../packages/i18n/locales/en/auth.json'),
    brand: () => import('../../../packages/i18n/locales/en/brand.json'),
    automations: () => import('../../../packages/i18n/locales/en/automations.json'),
  },
};

const loadLocale: NamespaceLoader = async (lng, ns) => {
  const load = LAZY_LOCALES[lng]?.[ns];
  if (!load) throw new Error(`No locale bundle for ${lng}/${ns}`);
  return (await load()).default;
};

initI18n(
  { pt: { common: ptCommon }, en: { common: enCommon } },
  { lazy: { namespaces: Object.keys(LAZY_LOCALES.pt), load: loadLocale } },
);

// Minimal DATA router (single splat route; App keeps its own descendant <Routes>). It was
// introduced because `useBlocker` needs data-router context, for the Estúdio autosave's
// dirty-navigation blocker. Estúdio is retired; today the data router is what lets
// `installSilentUpdate` register its navigation blocker. Route matching/links are unchanged:
// every internal link navigates by absolute path.
const router = createBrowserRouter([{ path: '*', element: <App /> }]);

// A deploy while this tab is open: move to the new build at the next route change, or once
// the tab has been hidden or idle for a while, never starting over unsaved work or an in-flight mutation.
installSilentUpdate({ router, holdWhile: () => queryClient.isMutating() > 0 });

// On the landing page, render once its chunk is in (the prerendered HTML modulepreloads it, so
// this is a short wait): the hero then paints together with the cookie banner. A failed or slow
// import renders anyway after 2s and falls back to the route's lazy() loading, so a stalled chunk
// never leaves the page blank until index.html's 8s #lp-ssr fallback.
const firstRender =
  window.location.pathname === '/'
    ? Promise.race([
        preloadLanding().catch(() => {}),
        new Promise<void>((resolve) => setTimeout(resolve, 2000)),
      ])
    : Promise.resolve();
void firstRender.then(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(<RouterProvider router={router} />);
});
