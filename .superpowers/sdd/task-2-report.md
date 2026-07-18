# Task 2 Report — Finance empty states and mobile KPIs

## Implementation summary

- Integrated `ClienteFinanceEmptyState` into the contracts and transactions cards. Empty datasets now render the dedicated state; populated datasets keep their existing table headers, rows, labels, values, and status badges.
- Added the exact Portuguese and English empty-state translations requested.
- Added the scoped `cliente-finance-kpis` hook and phone-only three-column override. The selectors use `minmax(0, 1fr)`, reset the generic odd-child span rule, and make KPI text non-wrapping with shrinkable cards to avoid horizontal overflow.
- Added the responsive/integration contract test.

## Commands and results

1. `npx vitest run apps/crm/src/pages/cliente-detalhe/__tests__/ClienteFinanceResponsive.test.tsx`
   - RED: exited 1; all 3 contract assertions failed for the missing KPI hook/CSS, empty-state integration, and translation keys.
2. `npx vitest run apps/crm/src/pages/cliente-detalhe/__tests__/ClienteFinanceEmptyState.test.tsx apps/crm/src/pages/cliente-detalhe/__tests__/ClienteFinanceResponsive.test.tsx`
   - GREEN: exited 0; 2 test files and 4 tests passed with no test warnings.
3. `npm run build`
   - exited 0; TypeScript and Vite production build completed. Vite reported pre-existing informational warnings about its deprecated CJS API, external `outDir`, and chunk size.
4. `git diff --check`
   - exited 0; no whitespace errors.

## Files changed

- `apps/crm/src/pages/cliente-detalhe/ClienteDetalhePage.tsx`
- `apps/crm/style.css`
- `packages/i18n/locales/pt/clients.json`
- `packages/i18n/locales/en/clients.json`
- `apps/crm/src/pages/cliente-detalhe/__tests__/ClienteFinanceResponsive.test.tsx`

## Self-review

- Scope is limited to the client-detail finance section and its explicit locale/test hooks.
- The phone KPI rule is scoped by `.cliente-finance-kpis`; generic KPI grids remain unaffected.
- Both populated table render paths preserve their original markup and row content.
- Empty paths avoid constructing table markup entirely.
- `min-width: 0`, equal `minmax(0, 1fr)` columns, and non-wrapping type guard against phone-width overflow.
- Tests verify the integration, responsive CSS contract, no legacy empty rows, and exact bilingual copy.

## Concerns

- None for this task. Build warnings are unrelated Vite/project configuration warnings and do not affect the focused tests or TypeScript build result.

## Follow-up review fix — finance KPI currency containment

### Fix summary

- Scoped the long-currency containment strategy to `.cliente-finance-kpis .kpi-value` in the phone breakpoint. The value remains a single, full line inside its one-third KPI column and scrolls horizontally within itself when necessary, rather than painting outside the card.
- Added `display: block`, `width: 100%`, `max-width: 100%`, `overflow-x: auto`, `scrollbar-width: none`, and a matching WebKit scrollbar-hiding selector. No generic `.kpi-grid` styles changed.

### TDD evidence

#### RED

Command:

```bash
npx vitest run apps/crm/src/pages/cliente-detalhe/__tests__/ClienteFinanceResponsive.test.tsx
```

Output: exited 1 as expected; 1 of 3 tests failed because the KPI value rule lacked the required block sizing and internal horizontal-overflow containment declarations. The other 2 tests passed.

#### GREEN

Command:

```bash
npx vitest run apps/crm/src/pages/cliente-detalhe/__tests__/ClienteFinanceEmptyState.test.tsx apps/crm/src/pages/cliente-detalhe/__tests__/ClienteFinanceResponsive.test.tsx
```

Output: exited 0; 2 test files and 4 tests passed.

### Files changed

- `apps/crm/style.css`
- `apps/crm/src/pages/cliente-detalhe/__tests__/ClienteFinanceResponsive.test.tsx`
- `.superpowers/sdd/task-2-report.md`

### Follow-up self-review

- The containment selector is limited to `.cliente-finance-kpis`, so it cannot alter other KPI grids.
- `width` and `max-width` constrain the non-wrapping value to its shrinkable card; `overflow-x: auto` makes excess currency text scroll inside the value instead of contributing page-level horizontal overflow.
- All three mobile finance cards remain equal `minmax(0, 1fr)` columns, and no truncation rule was added.
