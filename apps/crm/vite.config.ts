import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve(__dirname, '../..'), 'VITE_');
  return {
    root: path.resolve(__dirname, '.'),
    envDir: path.resolve(__dirname, '../..'),
    publicDir: path.resolve(__dirname, '../../public'),
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        '@mesaas/i18n': path.resolve(__dirname, '../../packages/i18n/index.ts'),
      },
    },
    server: {
      allowedHosts: ['.trycloudflare.com'],
      // Estúdio dev only: the OpenPencil editor iframe (localhost:1420) fetches/saves the
      // .fig blob itself, but its dev origin is not in the edge functions' ALLOWED_ORIGINS.
      // Route the doc endpoint through the CRM origin and rewrite the CORS allow-origin to
      // echo localhost origins (Authorization is still enforced by the function). Prod
      // builds never use this path — buildDocUrl points straight at Supabase there.
      proxy: env.VITE_SUPABASE_URL
        ? {
            '/estudio-fn': {
              target: `${env.VITE_SUPABASE_URL}/functions/v1`,
              changeOrigin: true,
              rewrite: (p) => p.replace(/^\/estudio-fn/, ''),
              configure: (proxy) => {
                proxy.on('proxyRes', (proxyRes, req) => {
                  const origin = req.headers.origin;
                  if (typeof origin === 'string' && /^http:\/\/localhost:\d+$/.test(origin)) {
                    proxyRes.headers['access-control-allow-origin'] = origin;
                  }
                });
              },
            },
          }
        : undefined,
    },
    build: {
      outDir: '../../dist',
    },
  };
});
