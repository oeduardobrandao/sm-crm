import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig(({ command }) => ({
  root: path.resolve(__dirname, '.'),
  envDir: path.resolve(__dirname, '../..'),
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@mesaas/i18n': path.resolve(__dirname, '../../packages/i18n/index.ts'),
      '@mesaas/ui': path.resolve(__dirname, '../../packages/ui'),
      '@mesaas/app-lifecycle': path.resolve(__dirname, '../../packages/app-lifecycle/index.ts'),
    },
  },
  base: command === 'serve' ? '/' : '/hub/',
  build: {
    outDir: '../../dist/hub',
  },
}));
