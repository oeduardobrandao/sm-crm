import React from 'react';
import * as Sentry from '@sentry/react';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import {
  installDeployRecovery,
  installSilentUpdate,
  installTranslateGuard,
} from '@mesaas/app-lifecycle';
import { initSentry } from '@/lib/sentry';
import { installConsentEffects } from './lib/consentEffects';
import { captureReferral } from './lib/referral';
import { initI18n } from '@mesaas/i18n';
import { I18N_LAZY, I18N_RESOURCES } from './boot/i18nResources';
import { mountApp } from './boot/mountApp';
import { markSsrMount } from './lib/ssrMount';
import { siteLocaleForPath } from './content/siteLocale';
import App, { preloadLanding, queryClient } from './App';
import '../style.css';

// Before anything else: a tab open across a deploy loads chunks that no longer exist.
installDeployRecovery();
// Browser page translation rewrites text nodes React still owns; keep it from crashing the app.
installTranslateGuard();

initSentry();

// PostHog and the Crisp widget start only after the visitor's consent (lib/consentEffects.ts);
// with consent already stored they still load on idle, off the landing page's critical path.
installConsentEffects();

// Programa de afiliados: grava o ?ref= de qualquer página do site para o cadastro (lib/referral.ts).
captureReferral(window.location.search);

const container = document.getElementById('root')!;
const { pathname } = window.location;
// `/` and `/en` are the two server-rendered landings.
const isLandingPath = pathname === '/' || pathname === '/en';
// The prerendered landing (scripts/seo writes the marker) is hydrated, not re-rendered. `/`'s
// HTML is in `pt`, so i18n starts in `pt` there and App's SavedLanguageSync applies the saved
// language right after hydration. Every `/en` page is English whatever was saved: it starts in
// `en` (matching `/en`'s server HTML) and EnglishPage saves `en` on mount.
const isSsr = container.dataset.ssr === 'landing' && isLandingPath;
if (isSsr) markSsrMount();

const initialLanguage =
  siteLocaleForPath(pathname) === 'en' ? ('en' as const) : isSsr ? ('pt' as const) : undefined;
initI18n(I18N_RESOURCES, { lazy: I18N_LAZY, ...(initialLanguage ? { initialLanguage } : {}) });

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
// chunk never leaves the page blank.
// Prerendered landing: hydrate once the chunk is in; a failed chunk is reported once, retried once,
// and otherwise the server HTML stays as is (mountApp).
void mountApp({
  container,
  element: <RouterProvider router={router} />,
  isSsr,
  preload: isLandingPath ? preloadLanding : () => Promise.resolve(),
  report: (err) => Sentry.captureException(err, { tags: { boot: 'ssr-hydration' } }),
});
