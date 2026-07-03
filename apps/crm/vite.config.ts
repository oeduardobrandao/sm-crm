import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  root: path.resolve(__dirname, '.'),
  envDir: path.resolve(__dirname, '../..'),
  publicDir: path.resolve(__dirname, '../../public'),
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@mesaas/i18n': path.resolve(__dirname, '../../packages/i18n/index.ts'),
      '@mesaas/design-doc': path.resolve(
        __dirname,
        '../../supabase/functions/_shared/design-doc.ts',
      ),
      '@mesaas/design-render-tree': path.resolve(
        __dirname,
        '../../supabase/functions/_shared/design-render-tree.ts',
      ),
      '@mesaas/fonts': path.resolve(__dirname, '../../supabase/functions/_shared/fonts'),
    },
  },
  server: {
    allowedHosts: ['.trycloudflare.com'],
  },
  build: {
    outDir: '../../dist',
  },
});
