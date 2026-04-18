import path from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'apps/crm/src'),
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
