import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig(() => {
  return {
    root: path.resolve(__dirname, '.'),
    envDir: path.resolve(__dirname, '../..'),
    publicDir: path.resolve(__dirname, '../../public'),
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        '@mesaas/i18n': path.resolve(__dirname, '../../packages/i18n/index.ts'),
        '@mesaas/ui': path.resolve(__dirname, '../../packages/ui'),
        '@mesaas/report-blocks': path.resolve(__dirname, '../../packages/report-blocks'),
        '@mesaas/import-parsers': path.resolve(__dirname, '../../packages/import-parsers/index.ts'),
        '@mesaas/app-lifecycle': path.resolve(__dirname, '../../packages/app-lifecycle/index.ts'),
        '@mesaas/link-policy': path.resolve(__dirname, '../../packages/link-policy/index.ts'),
      },
    },
    // The FFmpeg wrapper resolves its worker relative to its module URL.
    // Prebundling relocates that URL without copying worker.js.
    optimizeDeps: { exclude: ['@ffmpeg/ffmpeg'] },
    server: {
      allowedHosts: ['.trycloudflare.com'],
    },
    build: {
      outDir: '../../dist',
      // Read at runtime by prefetchBuildAssets. Outside /assets/ on purpose: it must not be
      // cached as immutable.
      manifest: 'build-manifest.json',
    },
  };
});
