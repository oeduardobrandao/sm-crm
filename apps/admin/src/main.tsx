import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Analytics } from '@vercel/analytics/react';
import { Toaster } from 'sonner';
import { AdminAuthProvider } from './context/AdminAuthContext';
import { LiquidGlassProvider } from './liquidglass/LiquidGlassProvider';
import { router } from './router';
import './globals.css';
import './liquidglass/glass.css';

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
          <Toaster />
          <RouterProvider router={router} />
          <Analytics />
        </LiquidGlassProvider>
      </AdminAuthProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
