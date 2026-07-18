# Task 2 report: related articles menu

## Scope

Replaced the permanent contextual-help link row with a single `Artigos relacionados`
trigger. Desktop uses the existing Radix Popover primitive; phone viewports use the
existing bottom Sheet primitive. Both surfaces render the same filtered article list.

## TDD evidence

### RED

Command:

```bash
npm run test -- apps/crm/src/components/help/__tests__/ContextHelpLinks.test.tsx
```

Output: failed as expected before implementation: 1 failed, 1 passed. The failing
test could not find `role="button"` named `Artigos relacionados`; the rendered DOM
showed the previous two permanent article links instead.

### GREEN

Command:

```bash
npm run test -- apps/crm/src/components/help/__tests__/ContextHelpLinks.test.tsx
```

Output after implementation (and again after final CSS cleanup): 1 test file passed,
2 tests passed, 0 failures.

## Verification

```bash
npm run test
```

Output: 166 test files passed, 1311 tests passed, 0 failures. The suite emitted
pre-existing stderr warnings from media-gallery `act(...)` usage, jsdom canvas
support, mocked analytics/client-health errors, and safety-net fixtures; none caused
a test failure.

```bash
npm run build
```

Output: passed. TypeScript completed and Vite built 3913 modules successfully. Vite
reported its existing CJS API deprecation, an outDir warning, and chunk-size guidance.

## Files

- `apps/crm/src/components/help/ContextHelpLinks.tsx`
- `apps/crm/src/components/help/__tests__/ContextHelpLinks.test.tsx`
- `apps/crm/style.css`

## Self-review

- Preserved the existing `getContextLinksForRoute(baseRoute)` query key, query
  function, stale time, and `/ajuda/:slug` routes.
- Filters missing/empty article slugs before rendering, and hides the entire control
  when no valid article remains.
- Uses exactly one trigger and shares `ArticleMenu` across desktop Popover and phone
  Sheet branches.
- Uses the specified `(max-width: 767px)` media query and subscribes/unsubscribes to
  viewport changes.
- Applied the requested compact styles, including 44px article targets and safe-area
  Sheet padding.
- `git diff --check` passed before commit preparation.

## Concerns

No task-specific concerns. The warning-only output noted above is outside this task's
files and did not affect test or build status.

## Follow-up review fix

The sole review finding was resolved by adding `min-height: 44px` to the scoped
`.context-help__trigger` rule in `apps/crm/style.css`. This preserves the existing
compact `Button size="sm"` layout while making the single related-articles trigger
meet the 44px touch-target requirement.

The existing component test already exercises the single trigger behavior. It does
not load the global stylesheet, so a CSS-height assertion would not verify the rule
in this test environment; the scoped selector and declaration were verified directly
in the final diff.

Follow-up verification:

```bash
npm run test -- apps/crm/src/components/help/__tests__/ContextHelpLinks.test.tsx
```

Output: 1 test file passed, 2 tests passed, 0 failures.

```bash
git diff --check
```

Output: passed with no whitespace errors.
