# Mobile final review fixes report

## Implementation summary

- **IMPORTANT 1 — container-relative phone carousel sizing:** Replaced the phone override's `min(84vw, 340px)` basis with `flex: 0 0 84%`, `min-width: min(260px, 84%)`, and `max-width: 340px`. Added a focused CSS contract tied to the phone media block that verifies all three declarations and rejects viewport units.
- **IMPORTANT 2 — calendar navigation touch targets:** Added `min-width: 44px` and `min-height: 44px` to `.month-grid-nav-btn`. Extended the MonthGrid test to verify that both Previous and Next buttons use the class and that its CSS contract is 44x44px.
- **MINOR 1 — finance empty-state touch target:** Raised `.cliente-finance-empty__action` from 40px to 44px and added a responsive CSS contract assertion.
- **MINOR 2 — scroll mocks and centering geometry:** Replaced direct prototype assignments in both suites with descriptor-preserving setup and restoration in `afterEach`. ClienteDetalheNav now exercises `offsetLeft=320`, `offsetWidth=80`, `clientWidth=200`, and `scrollWidth=500`, asserting centered/clamped `left: 260`. HubTab exercises `offsetLeft=420`, `offsetWidth=100`, `clientWidth=240`, and `scrollWidth=600`, asserting computed `left: 350`. Existing production scroll behavior was already correct and was not changed.
- **MINOR 3 — range diff whitespace:** Removed the two trailing spaces from the design document date line.

## TDD evidence

### RED

Command:

```bash
npm run test -- apps/crm/src/components/instagram/__tests__/InstagramPostCarousel.test.tsx apps/crm/src/components/ui/__tests__/month-grid.test.tsx apps/crm/src/pages/cliente-detalhe/__tests__/ClienteFinanceResponsive.test.tsx apps/crm/src/pages/cliente-detalhe/__tests__/ClienteDetalheNav.test.tsx apps/crm/src/pages/cliente-detalhe/__tests__/HubTab.test.tsx
```

Evidence before production CSS changes: exit 1; **3 failed, 27 passed (30 tests)** across **3 failed, 2 passed (5 files)**. The failures were exactly the new carousel sizing, MonthGrid 44x44, and finance action 44px contracts. The strengthened ClienteDetalheNav and HubTab geometry/restoration tests passed against existing production scroll code, establishing that no production scroll change was necessary.

The first attempted GREEN run then exposed an overly broad carousel CSS test selector: it selected the desktop item rule even after the phone CSS was corrected. The test was narrowed to the carousel-specific 767px media block and rerun; this was a test harness correction, not a production change.

### GREEN

Same five-file command after the fixes: exit 0; **5 passed (5 files), 30 passed (30 tests)**. A fresh post-commit run produced the same result.

Additional required project verification:

```bash
npm run build
```

Exit 0: TypeScript compilation and Vite production build completed successfully (3917 modules transformed). Vite emitted only its existing CJS API, external `outDir`, and chunk-size warnings.

## Exact focused test result

- Command: `npm run test -- apps/crm/src/components/instagram/__tests__/InstagramPostCarousel.test.tsx apps/crm/src/components/ui/__tests__/month-grid.test.tsx apps/crm/src/pages/cliente-detalhe/__tests__/ClienteFinanceResponsive.test.tsx apps/crm/src/pages/cliente-detalhe/__tests__/ClienteDetalheNav.test.tsx apps/crm/src/pages/cliente-detalhe/__tests__/HubTab.test.tsx`
- Result: **5/5 test files passed; 30/30 tests passed; 0 failures**.

## Range diff check

Command: `git diff --check 23019a6e..HEAD`

Result: exit 0 with no output; the full requested range is whitespace-clean.

## Files changed

- `apps/crm/style.css`
- `apps/crm/src/components/instagram/__tests__/InstagramPostCarousel.test.tsx`
- `apps/crm/src/components/ui/__tests__/month-grid.test.tsx`
- `apps/crm/src/pages/cliente-detalhe/__tests__/ClienteFinanceResponsive.test.tsx`
- `apps/crm/src/pages/cliente-detalhe/__tests__/ClienteDetalheNav.test.tsx`
- `apps/crm/src/pages/cliente-detalhe/__tests__/HubTab.test.tsx`
- `docs/superpowers/specs/2026-07-17-crm-mobile-responsive-polish-design.md`
- `.superpowers/sdd/mobile-final-review-fixes-report.md`

## Self-review and concerns

- Confirmed the carousel contract is scoped to the carousel's phone media block rather than merely matching any item rule.
- Confirmed both month navigation controls retain their existing behavior and share the now-compliant class.
- Confirmed prototype descriptors are restored even when an assertion fails because restoration occurs in `afterEach`.
- Confirmed non-zero geometry exercises arithmetic rather than jsdom's all-zero default path.
- No production scroll behavior was changed because the stronger tests passed it as written.
- No functional concerns remain. The full suite was intentionally not run per controller instruction; only the requested focused tests and the required CRM build were run.
