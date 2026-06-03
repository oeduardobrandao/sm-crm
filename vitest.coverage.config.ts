import { mergeConfig } from 'vitest/config';
import baseConfig from './vitest.config';

// Coverage ratchet (added 2026-06-03 as backpressure).
//
// This config extends the base vitest config and adds enforced coverage
// thresholds. It is intentionally SEPARATE from `vitest.config.ts` so the
// existing `npm run test:coverage` (report-only) keeps working unchanged.
// Run via `npm run coverage:check`.
//
// Thresholds are pinned just below the current baseline so the build fails if
// coverage *drops* below today's level — they are a floor, not a target.
// Baseline at creation: Stmts 46.45 / Branch 73.14 / Funcs 55.67 / Lines 46.45.
// Raise these numbers as coverage improves; never lower them.
export default mergeConfig(baseConfig, {
  test: {
    coverage: {
      thresholds: {
        lines: 45,
        statements: 45,
        functions: 54,
        branches: 72,
      },
    },
  },
});
