import { defineConfig } from 'vitest/config';

// Isolated config for the media-proxy worker. The repo-root vitest suite only
// globs apps/** + test/** + scripts/**, so this worker's tests are run on their
// own via `npm test` inside workers/media-proxy.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
