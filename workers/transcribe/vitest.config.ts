import { defineConfig } from 'vitest/config';

// Isolado, como workers/media-proxy: a suíte da raiz não globa workers/**.
export default defineConfig({
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
});
