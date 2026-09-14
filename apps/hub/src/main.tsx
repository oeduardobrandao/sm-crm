import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Analytics } from '@vercel/analytics/react';
import { installDeployRecovery, installSilentUpdate } from '@mesaas/app-lifecycle';
import { initI18n } from '@mesaas/i18n';
import ptCommon from '../../../packages/i18n/locales/pt/common.json';
import enCommon from '../../../packages/i18n/locales/en/common.json';
import ptHubHome from '../../../packages/i18n/locales/pt/hubHome.json';
import enHubHome from '../../../packages/i18n/locales/en/hubHome.json';
import ptHubPostCard from '../../../packages/i18n/locales/pt/hubPostCard.json';
import enHubPostCard from '../../../packages/i18n/locales/en/hubPostCard.json';
import ptHubPosts from '../../../packages/i18n/locales/pt/hubPosts.json';
import enHubPosts from '../../../packages/i18n/locales/en/hubPosts.json';
import ptHubPages from '../../../packages/i18n/locales/pt/hubPages.json';
import enHubPages from '../../../packages/i18n/locales/en/hubPages.json';
import ptHubBriefing from '../../../packages/i18n/locales/pt/hubBriefing.json';
import enHubBriefing from '../../../packages/i18n/locales/en/hubBriefing.json';
import ptHubBrand from '../../../packages/i18n/locales/pt/hubBrand.json';
import enHubBrand from '../../../packages/i18n/locales/en/hubBrand.json';
import ptHubIdeas from '../../../packages/i18n/locales/pt/hubIdeas.json';
import enHubIdeas from '../../../packages/i18n/locales/en/hubIdeas.json';
import ptHubReports from '../../../packages/i18n/locales/pt/hubReports.json';
import enHubReports from '../../../packages/i18n/locales/en/hubReports.json';
import ptHubMessages from '../../../packages/i18n/locales/pt/hubMessages.json';
import enHubMessages from '../../../packages/i18n/locales/en/hubMessages.json';
import { router } from './router';
import '../../crm/style.css';

// Before anything else: a tab open across a deploy loads chunks that no longer exist.
installDeployRecovery();

initI18n({
  pt: {
    common: ptCommon,
    hubHome: ptHubHome,
    hubPostCard: ptHubPostCard,
    hubPosts: ptHubPosts,
    hubPages: ptHubPages,
    hubBriefing: ptHubBriefing,
    hubBrand: ptHubBrand,
    hubIdeas: ptHubIdeas,
    hubReports: ptHubReports,
    hubMessages: ptHubMessages,
  },
  en: {
    common: enCommon,
    hubHome: enHubHome,
    hubPostCard: enHubPostCard,
    hubPosts: enHubPosts,
    hubPages: enHubPages,
    hubBriefing: enHubBriefing,
    hubBrand: enHubBrand,
    hubIdeas: enHubIdeas,
    hubReports: enHubReports,
    hubMessages: enHubMessages,
  },
});

const queryClient = new QueryClient();

// A deploy while this tab is open: move to the new build at the next route change, or once
// the tab has been hidden or idle for a while, never starting over unsaved work or an in-flight mutation.
installSilentUpdate({ router, holdWhile: () => queryClient.isMutating() > 0 });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Analytics />
    </QueryClientProvider>
  </React.StrictMode>,
);
