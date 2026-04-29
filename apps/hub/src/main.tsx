import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { initI18n } from '@mesaas/i18n';
import ptCommon from '../../../packages/i18n/locales/pt/common.json';
import enCommon from '../../../packages/i18n/locales/en/common.json';
import { router } from './router';
import '../../crm/style.css';

initI18n({
  pt: { common: ptCommon },
  en: { common: enCommon },
});

const queryClient = new QueryClient();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>
);
