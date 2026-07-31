import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Analytics } from '@vercel/analytics/react';
import { Toaster } from 'sonner';
import { installDeployRecovery, watchForNewVersion } from '@mesaas/app-lifecycle';
import { showNewVersionToast } from './lib/new-version-toast';
import { AdminAuthProvider } from './context/AdminAuthContext';
import { LiquidGlassProvider } from './liquidglass/LiquidGlassProvider';
import { TooltipProvider } from './components/ui/tooltip';
import { router } from './router';
import './globals.css';
import './liquidglass/glass.css';

// Before anything else: a tab open across a deploy loads chunks that no longer exist.
installDeployRecovery();
watchForNewVersion({ onNewVersion: showNewVersionToast });

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <AdminAuthProvider>
        <LiquidGlassProvider>
          <TooltipProvider delayDuration={200}>
            <Toaster />
            <RouterProvider router={router} />
            <Analytics />
          </TooltipProvider>
        </LiquidGlassProvider>
      </AdminAuthProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
