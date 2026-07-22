import path from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'apps/crm/src'),
      '@mesaas/i18n': path.resolve(__dirname, 'packages/i18n/index.ts'),
      '@mesaas/ui': path.resolve(__dirname, 'packages/ui'),
    },
  },
  define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('https://mesaas.supabase.co'),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('anon-key-for-tests'),
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/vitest.setup.ts'],
    include: [
      'apps/**/__tests__/**/*.test.{ts,tsx}',
      'apps/**/*.{test,spec}.{ts,tsx}',
      'test/**/*.{test,spec}.{ts,tsx}',
      'scripts/**/*.test.mjs',
      // Scoped to e2e/screenshots/__tests__ today (safety.ts unit tests).
      // Correct as-is, but this glob is repo-wide under e2e/** -- if a future
      // __tests__ dir appears elsewhere under e2e/ (e.g. alongside actual
      // Playwright specs), vitest would also try to collect those .test.ts
      // files, which are meant for the Playwright runner, not vitest.
      'e2e/**/__tests__/**/*.test.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: [
        'apps/crm/src/**/*.{ts,tsx}',
        'apps/hub/src/**/*.{ts,tsx}',
      ],
      exclude: [
        '**/*.d.ts',
        '**/__tests__/**',
      ],
    },
  },
});
