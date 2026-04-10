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
    },
  },
  base: '/crm/',
  build: {
    outDir: '../../dist/crm',
  },
});
