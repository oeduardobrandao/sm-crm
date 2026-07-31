import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig(({ command }) => ({
  root: path.resolve(__dirname, '.'),
  envDir: path.resolve(__dirname, '../..'),
  publicDir: path.resolve(__dirname, '../../public'),
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@mesaas/app-lifecycle': path.resolve(__dirname, '../../packages/app-lifecycle/index.ts'),
    },
  },
  base: command === 'serve' ? '/' : '/admin/',
  build: {
    outDir: '../../dist/admin',
  },
}));
