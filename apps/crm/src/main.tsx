import React from 'react';
import * as Sentry from '@sentry/react';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { installDeployRecovery, installSilentUpdate } from '@mesaas/app-lifecycle';
import { initSentry } from '@/lib/sentry';
import { installConsentEffects } from './lib/consentEffects';
import { captureReferral } from './lib/referral';
import { initI18n } from '@mesaas/i18n';
import { I18N_LAZY, I18N_RESOURCES } from './boot/i18nResources';
import { mountApp } from './boot/mountApp';
import { markSsrMount } from './lib/ssrMount';
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

const container = document.getElementById('root')!;
// The prerendered landing (scripts/seo writes the marker) is hydrated, not re-rendered. Its HTML
// is in `pt`, so i18n starts in `pt` there; App's SavedLanguageSync applies the saved language
// right after hydration.
const isSsr = container.dataset.ssr === 'landing' && window.location.pathname === '/';
if (isSsr) markSsrMount();

initI18n(I18N_RESOURCES, { lazy: I18N_LAZY, ...(isSsr ? { initialLanguage: 'pt' as const } : {}) });

// Minimal DATA router (single splat route; App keeps its own descendant <Routes>). It was
// introduced because `useBlocker` needs data-router context, for the Estúdio autosave's
// dirty-navigation blocker. Estúdio is retired; today the data router is what lets
// `installSilentUpdate` register its navigation blocker. Route matching/links are unchanged:
// every internal link navigates by absolute path.
const router = createBrowserRouter([{ path: '*', element: <App /> }]);

// A deploy while this tab is open: move to the new build at the next route change, or once
// the tab has been hidden or idle for a while, never starting over unsaved work or an in-flight mutation.
installSilentUpdate({ router, holdWhile: () => queryClient.isMutating() > 0 });

// Client-rendered documents: on the landing, render once its chunk is in (a short wait); a failed
// or slow import renders anyway after 2s and falls back to the route's lazy() loading, so a stalled
// chunk never leaves the page blank until index.html's 8s #lp-ssr fallback.
// Prerendered landing: hydrate once the chunk is in; a failed chunk is reported once, retried once,
// and otherwise the server HTML stays as is (mountApp).
void mountApp({
  container,
  element: <RouterProvider router={router} />,
  isSsr,
  preload: window.location.pathname === '/' ? preloadLanding : () => Promise.resolve(),
  report: (err) => Sentry.captureException(err, { tags: { boot: 'ssr-hydration' } }),
});
