# Admin iOS Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the platform Admin (`apps/admin`) in the CRM's iOS idiom on phones (<768px) and desktop (≥768px), sharing the CRM's phone kit through a new `@mesaas/ios-kit` package.

**Architecture:** Part A moves the CRM's generic phone primitives into `packages/ios-kit` (TSX moved with re-export shims; CSS copied with a parity test). Part B builds the Admin shell once (tokens, `useIsPhone`, sidebar, tab bar, Mais sheet, `PageHeader`, `AdminNavBar`, `AdminFormSheet`, restyled primitives). Part C restyles each page in parallel: each page keeps its data hooks and branches `isPhone ? <XPhone/> : <XDesktop/>`.

**Tech Stack:** React 19, React Router v7 (`createBrowserRouter`), TanStack Query, Tailwind 3.4, shadcn/Radix copies in `apps/admin/src/components/ui`, lucide-react, vitest + Testing Library (jsdom), Vite 6.

**Spec:** `docs/superpowers/specs/2026-10-12-admin-ios-redesign-design.md` (read it first). Mockup boards: `docs/superpowers/specs/2026-10-12-admin-ios-redesign-boards/*.dc.html` (iPhone boards have plain names, desktop boards start with `Dk`). Canvas: https://claude.ai/artifact/Vi2PaQpTmpMVit41HetJwh

**Worktree:** `/Users/eduardosouza/projects/sm-crm/.claude/worktrees/admin-app-ios-redesign-1585fd` (lowercase `projects`; the file tools refuse the `Projects` spelling). Branch `claude/admin-app-ios-redesign-1585fd`. Every command below runs from that directory.

## Global Constraints

- Phone = `(max-width: 767px)`; desktop = `≥ 768px`. Tests render desktop by default (the vitest `matchMedia` stub returns `matches: false`).
- No backend, migration, edge-function, route or `vercel.json` change. Routes stay exactly as in `apps/admin/src/router.tsx`.
- The CRM's look and behaviour do not change. `apps/crm/style.css` is not edited.
- No `@/` imports inside `packages/ios-kit` (root vitest maps `@` to `apps/crm/src`). Admin code imports relatively or via `@/` (Admin vite alias) as it does today, but **Admin test files and anything a test imports must not rely on `@/`** (vitest maps `@` to the CRM): use relative imports in Admin files, as the existing Admin code does.
- No hex colour literals in Admin TSX matched by `apps/admin/src/__tests__/no-hex-literals.test.ts`; colours go in CSS files or `lib/` data files.
- Portuguese UI copy. No em-dashes (`—`) in user-facing copy: use a period, colon or `·`.
- Never `useBlocker`. Keep every existing `window.confirm` call as is.
- Never delete or weaken a test to go green. Update its queries to the new markup while asserting the same behaviour.
- Icons: `lucide-react` only. Toasts: `sonner`.
- Admin glass/theme rules: `html[data-theme]` (default dark, `admin-theme` in localStorage); `html[data-liquid-glass]` on by default; glass ON forces dark and hides the theme toggle.
- Parallel agents never commit. They report; the orchestrator reviews and commits with explicit paths (`git add <paths>`), never `git add -A`.
- Before reporting: `npx tsc -p apps/admin/tsconfig.json --noEmit` (plus `apps/crm/tsconfig.json` for Part A), `npx vitest run <owned test files>`, `npx prettier --write <touched files>`, `npx eslint <touched files>`.

## Review Focus

1. **Crossing 768px while state is live** (rotating an iPhone to landscape is 844pt wide): the shell keeps `<main><div><Outlet/>` at the same tree position in both modes so the route element is not remounted by the shell; a page's open sheet may close, but no data is lost or mutated. Test in Task B4 (`keeps the outlet mounted when the breakpoint flips`).
2. **Back while a sheet is open** (iOS edge swipe, Android back): closes the sheet, not the page; a refused close (dirty confirm answered "cancel", or a save in flight) leaves the sheet open and the next Back still closes only the sheet. Tests in Task A3 and Task B3.
3. **Navigating from the Mais sheet** leaves no dead history entry (one Back returns to the previous page, not to a closed sheet). Test in Task B4 using `closeThen`.
4. **Glass ON with light theme saved**: glass forces dark without overwriting the saved `admin-theme`; turning glass off restores light. Test in Task B4.
5. **Phone filter taps** in the Workspaces filters sheet do not stack history entries (`set(patch, { replace: true })`). Test in Task C4.

---

## File map

Part A (package):
- Create `packages/ios-kit/package.json`, `packages/ios-kit/index.ts`, `packages/ios-kit/src/cn.ts`, `packages/ios-kit/src/<moved files>`, `packages/ios-kit/ios-kit.css`, `packages/ios-kit/__tests__/<moved tests>`, `packages/ios-kit/__tests__/pointer.ts`, `packages/ios-kit/__tests__/css-parity.test.ts`.
- Modify (become shims): `apps/crm/src/components/mobile/<moved files>`, `apps/crm/src/hooks/useOverlayHistoryEntry.ts`, `apps/crm/src/lib/normalizeText.ts`.
- Modify wiring: `apps/crm/tsconfig.json`, `apps/admin/tsconfig.json`, `apps/crm/vite.config.ts`, `apps/admin/vite.config.ts`, `vitest.config.ts`.

Part B (Admin shell, all under `apps/admin/`):
- `index.html` (viewport meta), `src/main.tsx` (CSS imports), `src/globals.css` (select rule scope).
- Create `src/ios/admin-kit.css`, `src/hooks/useIsPhone.ts`, `src/__tests__/phone.ts`, `src/lib/nav-items.ts`, `src/layouts/useAdminTheme.ts`, `src/components/shell/AdminNavBar.tsx`, `src/components/shell/AdminFormSheet.tsx`, `src/components/shell/AdminTabBar.tsx`, `src/components/shell/MaisSheet.tsx`, `src/components/shell/DesktopSidebar.tsx`, `src/components/shell/KpiTile.tsx`, `src/components/shell/GlassPanel.tsx`, `src/components/shell/SelectionBar.tsx`.
- Modify `src/layouts/AdminLayout.tsx`, `src/components/PageHeader.tsx`, `src/components/ui/{card,table,badge,button,tabs,dialog}.tsx`, `src/__tests__/no-hex-literals.test.ts`.

Part C (pages): each task owns the files listed in it. New view files follow `pages/<area>/<Name>Phone.tsx` / `<Name>Desktop.tsx` (covered by the hex-test globs).

---

## Part A: `@mesaas/ios-kit`

### Task A1: Package scaffold, TSX move, shims, wiring

**Files:**
- Create: `packages/ios-kit/package.json`, `packages/ios-kit/index.ts`, `packages/ios-kit/src/cn.ts`
- Move (`git mv`) from `apps/crm/src/components/mobile/` to `packages/ios-kit/src/`: `LargeTitleHeader.tsx`, `GroupedList.tsx`, `SegmentedControl.tsx`, `BottomSheet.tsx`, `ActionSheet.tsx`, `ContextMenu.tsx`, `SwipeRow.tsx`, `BottomActionBar.tsx`, `ChipRow.tsx`, `CheckList.tsx`, `PickerSheet.tsx`, `FormRow.tsx`, `InfoButton.tsx`, `BarList.tsx`, `PhoneConfirmSheet.tsx`, `PhoneFiltersSheet.tsx`, `BrandMark.tsx`, `sheetActions.ts`, `useSheetHistory.ts`, `useLongPress.ts`, `useReturnFocus.ts`, `roving.ts`
- Move: `apps/crm/src/hooks/useOverlayHistoryEntry.ts` → `packages/ios-kit/src/useOverlayHistoryEntry.ts`; `apps/crm/src/lib/normalizeText.ts` → `packages/ios-kit/src/normalizeText.ts`
- Create shims at every old path (same filenames)
- Move tests: `apps/crm/src/components/mobile/__tests__/{ActionSheet,BottomSheet,ChipRowAndBar,ContextMenu,FormRow,GroupedList,InfoButtonAndBarList,LargeTitleHeader,PickerSheet,SegmentedControl,SwipeRow}.test.tsx` → `packages/ios-kit/__tests__/`; copy `pointer.ts` there (keep the CRM copy). `PhoneConfirmAndFilters.test.tsx`, `PhoneNavBar.test.tsx`, `PhonePageHeader.test.tsx` stay. `apps/crm/src/hooks/__tests__/useOverlayHistoryEntry.test.tsx` stays (it imports through the shim).
- Modify: `apps/crm/tsconfig.json`, `apps/admin/tsconfig.json`, `apps/crm/vite.config.ts`, `apps/admin/vite.config.ts`, `vitest.config.ts`

**Interfaces:**
- Produces: `@mesaas/ios-kit` (bare, the package index, same export list as today's `apps/crm/src/components/mobile/index.ts` plus `useOverlayHistoryEntry`, `OverlayHistoryOptions`, `normalize`) and deep paths `@mesaas/ios-kit/src/<File>`. CSS arrives in A2.

- [ ] **Step 1: Record the baseline**

Run: `npm run coverage:check 2>&1 | tail -15` and `npx vitest run apps/crm/src/components/mobile apps/crm/src/hooks 2>&1 | tail -5`
Write down the coverage numbers and the passing test count.

- [ ] **Step 2: Scaffold the package**

`packages/ios-kit/package.json`:
```json
{
  "name": "@mesaas/ios-kit",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "main": "index.ts"
}
```

`packages/ios-kit/src/cn.ts`:
```ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

Then register the workspace in the lockfile (CI runs `npm ci`, which fails on a package.json missing from `package-lock.json`):
```bash
npm install --package-lock-only
git diff --stat package-lock.json   # expect a node_modules/@mesaas/ios-kit link entry + packages/ios-kit entry
```

- [ ] **Step 3: Move the files with history**

```bash
cd packages/ios-kit && mkdir -p src __tests__ && cd ../..
for f in LargeTitleHeader.tsx GroupedList.tsx SegmentedControl.tsx BottomSheet.tsx ActionSheet.tsx ContextMenu.tsx SwipeRow.tsx BottomActionBar.tsx ChipRow.tsx CheckList.tsx PickerSheet.tsx FormRow.tsx InfoButton.tsx BarList.tsx PhoneConfirmSheet.tsx PhoneFiltersSheet.tsx BrandMark.tsx sheetActions.ts useSheetHistory.ts useLongPress.ts useReturnFocus.ts roving.ts; do git mv apps/crm/src/components/mobile/$f packages/ios-kit/src/$f; done
git mv apps/crm/src/hooks/useOverlayHistoryEntry.ts packages/ios-kit/src/useOverlayHistoryEntry.ts
git mv apps/crm/src/lib/normalizeText.ts packages/ios-kit/src/normalizeText.ts
for t in ActionSheet BottomSheet ChipRowAndBar ContextMenu FormRow GroupedList InfoButtonAndBarList LargeTitleHeader PickerSheet SegmentedControl SwipeRow; do git mv apps/crm/src/components/mobile/__tests__/$t.test.tsx packages/ios-kit/__tests__/$t.test.tsx; done
cp apps/crm/src/components/mobile/__tests__/pointer.ts packages/ios-kit/__tests__/pointer.ts
```

- [ ] **Step 4: Rewrite imports inside the package**

In every `packages/ios-kit/src/*`: `'@/lib/utils'` → `'./cn'`; `'@/lib/normalizeText'` → `'./normalizeText'`; `'@/hooks/useOverlayHistoryEntry'` → `'./useOverlayHistoryEntry'`.
In every moved test: `'../<File>'` → `'../src/<File>'`; `'@/components/mobile/<File>'` → `'../src/<File>'`; `'@/components/mobile'` → `'../index'`; keep `'./pointer'`.
Check: `grep -rn "from '@/" packages/ios-kit` prints nothing.

- [ ] **Step 5: Write the package index**

`packages/ios-kit/index.ts` = the export list of `apps/crm/src/components/mobile/index.ts` minus `PhonePageHeader`/`PhoneNavBar`, with paths `./src/<File>`, plus:
```ts
export { BrandMark } from './src/BrandMark';
export { useReturnFocus } from './src/useReturnFocus';
export { rovingIndex } from './src/roving';
export { useOverlayHistoryEntry } from './src/useOverlayHistoryEntry';
export type { OverlayHistoryOptions } from './src/useOverlayHistoryEntry';
export { normalize } from './src/normalizeText';
export { cn } from './src/cn';
```
(Check each moved file's actual export names with `grep -n "^export" packages/ios-kit/src/*.ts*` and export every public one.)

- [ ] **Step 6: Write the shims**

For each moved kit file `F` (with its extension), `apps/crm/src/components/mobile/F` contains exactly:
```ts
export * from '@mesaas/ios-kit/src/<F without extension>';
```
`apps/crm/src/hooks/useOverlayHistoryEntry.ts`:
```ts
export * from '@mesaas/ios-kit/src/useOverlayHistoryEntry';
```
`apps/crm/src/lib/normalizeText.ts`:
```ts
export * from '@mesaas/ios-kit/src/normalizeText';
```
`apps/crm/src/components/mobile/index.ts` is left unchanged (it re-exports `./X`, which are now shims). `PhonePageHeader.tsx` and `PhoneNavBar.tsx` keep importing `./BrandMark`, `./LargeTitleHeader` (shims).

- [ ] **Step 7: Wire the alias (directory style, like `@mesaas/ui`)**

`apps/crm/tsconfig.json` and `apps/admin/tsconfig.json`, inside `compilerOptions.paths`:
```json
"@mesaas/ios-kit": ["../../packages/ios-kit/index.ts"],
"@mesaas/ios-kit/*": ["../../packages/ios-kit/*"]
```
`apps/crm/vite.config.ts` and `apps/admin/vite.config.ts`, next to the `@mesaas/ui` alias:
```ts
'@mesaas/ios-kit': path.resolve(__dirname, '../../packages/ios-kit'),
```
`vitest.config.ts` `resolve.alias`:
```ts
'@mesaas/ios-kit': path.resolve(__dirname, 'packages/ios-kit'),
```
and in `coverage.include` add `'packages/ios-kit/src/**/*.{ts,tsx}'`.
Note: Vite string aliases match the prefix, so `@mesaas/ios-kit/src/BottomSheet` → `packages/ios-kit/src/BottomSheet` and bare `@mesaas/ios-kit` → the directory, resolved via `package.json` `main`. If the bare import fails to resolve in Vite or vitest, switch to two array-form aliases: `{ find: /^@mesaas\/ios-kit$/, replacement: <abs>/packages/ios-kit/index.ts }` then `{ find: '@mesaas/ios-kit', replacement: <abs>/packages/ios-kit }`.

- [ ] **Step 8: Verify**

```bash
npx tsc -p apps/crm/tsconfig.json --noEmit
npx tsc -p apps/hub/tsconfig.json --noEmit
npx tsc -p apps/admin/tsconfig.json --noEmit
npx tsc -p tsconfig.scripts.json
npx vitest run packages/ios-kit apps/crm/src/components/mobile apps/crm/src/hooks apps/crm/src/components/layout
npm run build 2>&1 | tail -5
npm run lint 2>&1 | tail -5
npm run coverage:check 2>&1 | tail -15
```
Expected: all pass; the test count across these dirs equals the baseline; coverage not lower than baseline (if the CRM aggregate drops below a threshold, that's the moved files: confirm `packages/ios-kit/src` is in `coverage.include` and read `scripts/` coverage check for how thresholds are computed).

- [ ] **Step 9: Run the whole frontend suite**

Run: `npm run test 2>&1 | tail -8`. Expected: same pass count as on `main` (run `git stash`-free: compare against the number printed in Step 1's full run if you took one, otherwise just zero failures).

- [ ] **Step 10: Commit (orchestrator)**

```bash
git add package-lock.json packages/ios-kit apps/crm/src/components/mobile apps/crm/src/hooks/useOverlayHistoryEntry.ts apps/crm/src/lib/normalizeText.ts apps/crm/tsconfig.json apps/admin/tsconfig.json apps/crm/vite.config.ts apps/admin/vite.config.ts vitest.config.ts
git commit -m "refactor(ios-kit): move the CRM phone kit to @mesaas/ios-kit (pure move, shims at old paths)"
```

### Task A2: Kit CSS copy + parity test

**Files:**
- Create: `packages/ios-kit/ios-kit.css`, `packages/ios-kit/__tests__/css-parity.test.ts`

**Interfaces:**
- Produces: `@mesaas/ios-kit/ios-kit.css` (imported by the Admin in B1).

- [ ] **Step 1: Write the failing parity test**

`packages/ios-kit/__tests__/css-parity.test.ts`:
```ts
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../../..');
const kit = readFileSync(path.join(ROOT, 'packages/ios-kit/ios-kit.css'), 'utf8');
const crm = readFileSync(path.join(ROOT, 'apps/crm/style.css'), 'utf8');

/** Splits at section header comments: a line starting with `/* ====` or `/* ----`. */
function sections(css: string): string[] {
  const lines = css.split('\n');
  const out: string[] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (/^\/\* (====|----)/.test(line) && current.length) {
      out.push(current.join('\n').trimEnd());
      current = [];
    }
    current.push(line);
  }
  if (current.length) out.push(current.join('\n').trimEnd());
  return out
    // The file's own banner is not a copy.
    .filter((s) => !s.startsWith('/* ==== @ios-kit banner'))
    // An excerpt (rules lifted from inside a larger CRM section) carries its own header
    // line, which is not in the CRM file: compare only the rules under it.
    .map((s) => (s.startsWith('/* ---- @ios-kit excerpt') ? s.split('\n').slice(1).join('\n') : s));
}

describe('ios-kit.css is a verbatim copy of the CRM kit sections', () => {
  const list = sections(kit);
  it('has sections', () => {
    expect(list.length).toBeGreaterThan(10);
  });
  it.each(list.map((s) => [s.split('\n')[0], s]))('%s', (_header, section) => {
    expect(crm.includes(section as string)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/ios-kit/__tests__/css-parity.test.ts`. Expected: FAIL (file missing).

- [ ] **Step 3: Build the copy**

Find exact line ranges first:
```bash
grep -n "^/\* \(====\|----\)" apps/crm/style.css | awk -F: '$1>=15700 && $1<=17320'
grep -n "^\.phone-field" apps/crm/style.css
```
`packages/ios-kit/ios-kit.css` = a banner comment whose first line is `/* ==== @ios-kit banner ==== */` (then: verbatim copy of the generic kit sections of `apps/crm/style.css`, kept in sync by `css-parity.test.ts`, edit both sides), then, copied with `sed -n 'A,Bp' apps/crm/style.css >> packages/ios-kit/ios-kit.css` (never retyped), in this order:
1. From the `/* ===== PHONE KIT` header line through the closing `}` of the `[data-theme='dark'] .phone-kit { … }` block. If the `@media (max-width: 767px) { .app-container … }` block sits inside that range, stop before it, and start the next copy at the next `/* ----` header (the media block is CRM-only).
2. Every `/* ---- … ---- */` section from `Large title + round header buttons` through `Bar list (small charts on phones)`, each from its header line to the line before the next header, **skipping** `Dialog primitives as sheets (F0c)`.
3. An excerpt: the line `/* ---- @ios-kit excerpt: .phone-field base rules (from the CRM post-editor section) ---- */`, then lines from `.phone-field {` (today L17889) up to **the line before** the `/* ---- Bottom bar ---- */` header (today L17939; including the header would break parity). These are the rules `FormRow` builds on.
Each copied section must stay byte-identical to `style.css`.

- [ ] **Step 4: Run the parity test**

Run: `npx vitest run packages/ios-kit/__tests__/css-parity.test.ts`. Expected: PASS, >10 sections.

- [ ] **Step 5: Mutation check**

Temporarily change one value inside `ios-kit.css` (e.g. `--phone-gutter: 16px` → `17px`), run the test, expect FAIL, revert, expect PASS.

- [ ] **Step 6: Commit (orchestrator)**

```bash
git add packages/ios-kit/ios-kit.css packages/ios-kit/__tests__/css-parity.test.ts
git commit -m "feat(ios-kit): kit CSS copy for non-CRM apps, guarded by a parity test"
```

### Task A3: `BottomSheet` `repushIfStillOpen`

**Files:**
- Modify: `packages/ios-kit/src/BottomSheet.tsx`, `packages/ios-kit/src/useSheetHistory.ts`
- Test: `packages/ios-kit/__tests__/BottomSheet.test.tsx`

**Interfaces:**
- Produces: `BottomSheetProps.repushIfStillOpen?: boolean` (default false); `useSheetHistory(open, onClose, options?: OverlayHistoryOptions)`.

- [ ] **Step 1: Write the failing test** (append to `BottomSheet.test.tsx`; reuse its existing render helper and router setup; if it renders under a `MemoryRouter`, wrap this test in `createMemoryRouter` + `RouterProvider` so `history.state.idx` exists, mirroring `apps/crm/src/hooks/__tests__/useOverlayHistoryEntry.test.tsx`'s setup for the `repushIfStillOpen` case)

```tsx
it('repushIfStillOpen: a refused Back keeps a history entry, so the next Back still targets the sheet', async () => {
  // Arrange: a sheet whose onOpenChange(false) is refused the first time.
  let refuse = true;
  function Harness() {
    const [open, setOpen] = useState(true);
    return (
      <BottomSheet
        open={open}
        onOpenChange={(next) => {
          if (!next && refuse) return; // parent refuses
          setOpen(next);
        }}
        title="Editar"
        repushIfStillOpen
      >
        <p>corpo</p>
      </BottomSheet>
    );
  }
  // createMemoryRouter never writes window.history, so history.state.idx would stay null and
  // no entry would be pushed. Use the browser router, like useOverlayHistoryEntry.test.tsx:
  window.history.replaceState(null, '', '/admin/plans');
  const router = createBrowserRouter([{ path: '*', element: <Harness /> }]);
  render(<RouterProvider router={router} />);
  // Act: Back once (refused), then allow, then Back again.
  // Assert: after the refused Back the dialog is still open; after the second Back it closes
  // and the router location is still /admin/plans (the page was not left).
});
```
Write the Act/Assert body with the same pattern `apps/crm/src/hooks/__tests__/useOverlayHistoryEntry.test.tsx` uses for its `repushIfStillOpen` test (~L117–160: `window.history.back()` inside `act`, then `await waitFor`), reading the slot with `window.history.state.idx` and the path with `router.state.location.pathname`.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/ios-kit/__tests__/BottomSheet.test.tsx -t repushIfStillOpen`. Expected: FAIL (prop unknown / page left on second Back).

- [ ] **Step 3: Implement**

`useSheetHistory.ts`:
```ts
import type { OverlayHistoryOptions } from './useOverlayHistoryEntry';
export function useSheetHistory(open: boolean, onClose: () => void, options?: OverlayHistoryOptions) {
  useOverlayHistoryEntry(open, onClose, options);
  // …rest unchanged
```
`BottomSheet.tsx`: add to `BottomSheetProps`:
```ts
  /** Re-push the sheet's history entry when a Back-triggered close is refused by the parent. */
  repushIfStillOpen?: boolean;
```
destructure it and call `useSheetHistory(open, close, repushIfStillOpen ? { repushIfStillOpen: true } : undefined)`.

- [ ] **Step 4: Run kit + CRM tests**

Run: `npx vitest run packages/ios-kit apps/crm/src/components/mobile apps/crm/src/components/layout`. Expected: PASS.

- [ ] **Step 5: Commit (orchestrator)**

```bash
git add packages/ios-kit/src/BottomSheet.tsx packages/ios-kit/src/useSheetHistory.ts packages/ios-kit/__tests__/BottomSheet.test.tsx
git commit -m "feat(ios-kit): opt-in repushIfStillOpen on BottomSheet"
```

---

## Part B: Admin shell

### Task B1: Foundations (meta, CSS, `useIsPhone`, nav data, hex test, dialog `hideClose`)

**Files:**
- Modify: `apps/admin/index.html:5`, `apps/admin/src/main.tsx`, `apps/admin/src/globals.css:72-83`, `apps/admin/src/__tests__/no-hex-literals.test.ts`, `apps/admin/src/components/ui/dialog.tsx`
- Create: `apps/admin/src/ios/admin-kit.css`, `apps/admin/src/hooks/useIsPhone.ts`, `apps/admin/src/hooks/__tests__/useIsPhone.test.tsx`, `apps/admin/src/__tests__/phone.ts`, `apps/admin/src/lib/nav-items.ts`, `apps/admin/src/lib/__tests__/nav-items.test.ts`

**Interfaces:**
- Produces:
  - `useIsPhone(): boolean`, `PHONE_QUERY = '(max-width: 767px)'` from `apps/admin/src/hooks/useIsPhone.ts`.
  - `mockPhone(isPhone?: boolean): () => void` from `apps/admin/src/__tests__/phone.ts` (returns a restore function).
  - From `apps/admin/src/lib/nav-items.ts`: `AdminNavItem { id: NavId; to: string; label: string; icon: LucideIcon; tile: string }`, `AdminNavGroup { label: string | null; items: AdminNavItem[] }`, `NAV_GROUPS: AdminNavGroup[]`, `PHONE_TABS: AdminNavItem[]` (Dashboard, Métricas, Workspaces, Afiliados), `MAIS_GROUPS: AdminNavGroup[]` (the labelled groups), `isRouteActive(pathname: string, to: string): boolean`, `hidesTabBar(pathname: string): boolean`.
  - `DialogContent` prop `hideClose?: boolean`.
  - CSS classes in `admin-kit.css` used by B2–B4 and Part C (listed in Step 6).

- [ ] **Step 1: Write failing tests**

`apps/admin/src/hooks/__tests__/useIsPhone.test.tsx`:
```tsx
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useIsPhone } from '../useIsPhone';
import { mockPhone } from '../../__tests__/phone';

describe('useIsPhone', () => {
  let restore: (() => void) | null = null;
  afterEach(() => restore?.());

  it('is false under the default jsdom stub (desktop)', () => {
    expect(renderHook(() => useIsPhone()).result.current).toBe(false);
  });

  it('is true when the phone query matches', () => {
    restore = mockPhone();
    expect(renderHook(() => useIsPhone()).result.current).toBe(true);
  });

  it('follows change events', () => {
    const listeners: Array<() => void> = [];
    let matches = false;
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      get matches() { return matches; },
      media: query, onchange: null,
      addListener: vi.fn(), removeListener: vi.fn(),
      addEventListener: (_: string, cb: () => void) => listeners.push(cb),
      removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia;
    restore = () => { window.matchMedia = original; };
    const { result } = renderHook(() => useIsPhone());
    expect(result.current).toBe(false);
    act(() => { matches = true; listeners.forEach((l) => l()); });
    expect(result.current).toBe(true);
  });
});
```

`apps/admin/src/lib/__tests__/nav-items.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { NAV_GROUPS, PHONE_TABS, MAIS_GROUPS, hidesTabBar, isRouteActive } from '../nav-items';

describe('nav-items', () => {
  it('lists the 11 admin routes once, in four groups', () => {
    const all = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.to));
    expect(all).toEqual([
      '/admin', '/admin/metricas', '/admin/workspaces', '/admin/afiliados',
      '/admin/plans', '/admin/admins', '/admin/integrations',
      '/admin/banners', '/admin/popups', '/admin/kb-articles', '/admin/kb-videos',
    ]);
    expect(NAV_GROUPS.map((g) => g.label)).toEqual([null, 'Plataforma', 'Comunicação', 'Central de Ajuda']);
  });
  it('phone tabs are the unlabelled group; Mais holds the rest', () => {
    expect(PHONE_TABS.map((t) => t.label)).toEqual(['Dashboard', 'Métricas', 'Workspaces', 'Afiliados']);
    expect(MAIS_GROUPS.flatMap((g) => g.items).length).toBe(7);
  });
  it('isRouteActive: Dashboard only on /admin; others on their subtree', () => {
    expect(isRouteActive('/admin', '/admin')).toBe(true);
    expect(isRouteActive('/admin/workspaces', '/admin')).toBe(false);
    expect(isRouteActive('/admin/workspaces/abc', '/admin/workspaces')).toBe(true);
    expect(isRouteActive('/admin/workspaces-x', '/admin/workspaces')).toBe(false);
  });
  it('hidesTabBar only on the pushed KB editors', () => {
    expect(hidesTabBar('/admin/kb-articles/new')).toBe(true);
    expect(hidesTabBar('/admin/kb-articles/123/edit')).toBe(true);
    expect(hidesTabBar('/admin/kb-videos/new')).toBe(true);
    expect(hidesTabBar('/admin/kb-videos/9/edit')).toBe(true);
    expect(hidesTabBar('/admin/kb-articles')).toBe(false);
    expect(hidesTabBar('/admin/workspaces/1')).toBe(false);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run apps/admin/src/hooks/__tests__/useIsPhone.test.tsx apps/admin/src/lib/__tests__/nav-items.test.ts`. Expected: FAIL (modules missing).

- [ ] **Step 3: Implement `useIsPhone` and `mockPhone`**

`apps/admin/src/hooks/useIsPhone.ts`:
```ts
import { useEffect, useState } from 'react';

/** The kit's phone threshold, and the Admin's old `md` breakpoint. */
export const PHONE_QUERY = '(max-width: 767px)';

function matchesPhone(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(PHONE_QUERY).matches
    : false;
}

/** True below 768px. jsdom's matchMedia stub reports false, so tests render desktop. */
export function useIsPhone(): boolean {
  const [isPhone, setIsPhone] = useState(matchesPhone);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(PHONE_QUERY);
    const sync = () => setIsPhone(mq.matches);
    sync();
    mq.addEventListener?.('change', sync);
    return () => mq.removeEventListener?.('change', sync);
  }, []);
  return isPhone;
}
```

`apps/admin/src/__tests__/phone.ts`:
```ts
import { vi } from 'vitest';
import { PHONE_QUERY } from '../hooks/useIsPhone';

/** Makes `useIsPhone()` true (or false) for the current test. Returns a restore function. */
export function mockPhone(isPhone = true): () => void {
  const original = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    matches: isPhone && query === PHONE_QUERY,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
  return () => {
    window.matchMedia = original;
  };
}
```

- [ ] **Step 4: Implement `nav-items.ts`**

```ts
import {
  AppWindow, BookOpen, Building2, Film, HandCoins, LayoutDashboard, Megaphone, Package, Plug,
  TrendingUp, Users, type LucideIcon,
} from 'lucide-react';

export type NavId =
  | 'dashboard' | 'metricas' | 'workspaces' | 'afiliados' | 'planos' | 'admins'
  | 'integracoes' | 'banners' | 'popups' | 'artigos' | 'videos';

export interface AdminNavItem {
  id: NavId;
  to: string;
  label: string;
  icon: LucideIcon;
  /** iOS Settings-style tile colour (data, like plan-colors.ts). */
  tile: string;
}

export interface AdminNavGroup {
  label: string | null;
  items: AdminNavItem[];
}

const item = (id: NavId, to: string, label: string, icon: LucideIcon, tile: string): AdminNavItem => ({ id, to, label, icon, tile });

export const NAV_GROUPS: AdminNavGroup[] = [
  {
    label: null,
    items: [
      item('dashboard', '/admin', 'Dashboard', LayoutDashboard, '#facc15'),
      item('metricas', '/admin/metricas', 'Métricas', TrendingUp, '#34c759'),
      item('workspaces', '/admin/workspaces', 'Workspaces', Building2, '#007aff'),
      item('afiliados', '/admin/afiliados', 'Afiliados', HandCoins, '#ff9500'),
    ],
  },
  {
    label: 'Plataforma',
    items: [
      item('planos', '/admin/plans', 'Planos', Package, '#af52de'),
      item('admins', '/admin/admins', 'Admins', Users, '#30b0c7'),
      item('integracoes', '/admin/integrations', 'Integrações', Plug, '#636366'),
    ],
  },
  {
    label: 'Comunicação',
    items: [
      item('banners', '/admin/banners', 'Banners', Megaphone, '#ff6b35'),
      item('popups', '/admin/popups', 'Popups', AppWindow, '#5856d6'),
    ],
  },
  {
    label: 'Central de Ajuda',
    items: [
      item('artigos', '/admin/kb-articles', 'Artigos', BookOpen, '#0a84ff'),
      item('videos', '/admin/kb-videos', 'Vídeos', Film, '#ff3b30'),
    ],
  },
];

export const PHONE_TABS: AdminNavItem[] = NAV_GROUPS[0].items;
export const MAIS_GROUPS: AdminNavGroup[] = NAV_GROUPS.filter((g) => g.label !== null);

export function isRouteActive(pathname: string, to: string): boolean {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (to === '/admin') return path === '/admin';
  return path === to || path.startsWith(`${to}/`);
}

const PUSHED_EDITORS = [
  /^\/admin\/kb-articles\/(new|[^/]+\/edit)\/?$/,
  /^\/admin\/kb-videos\/(new|[^/]+\/edit)\/?$/,
];

/** The phone tab bar is hidden on the pushed full-screen editors. */
export function hidesTabBar(pathname: string): boolean {
  return PUSHED_EDITORS.some((re) => re.test(pathname));
}
```
Group labels render uppercase via CSS (`text-transform: uppercase`), the stored label is title case.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run apps/admin/src/hooks/__tests__/useIsPhone.test.tsx apps/admin/src/lib/__tests__/nav-items.test.ts`. Expected: PASS.

- [ ] **Step 6: Meta, CSS imports, admin-kit.css, select scope, hideClose, hex globs**

`apps/admin/index.html` line 5:
```html
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, interactive-widget=resizes-content" />
```

`apps/admin/src/main.tsx` imports, in this order:
```ts
import './globals.css';
import './liquidglass/glass.css';
import '@mesaas/ios-kit/ios-kit.css';
import './ios/admin-kit.css';
```

`apps/admin/src/globals.css`: change the global `select` rule's selector (L72–83) from `select` to `select:not(.phone-field__select)` (keep its declarations).

`apps/admin/src/components/ui/dialog.tsx`: `DialogContent` accepts `hideClose?: boolean`; when true the trailing `DialogPrimitive.Close` X is not rendered. Type: `React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { hideClose?: boolean }`.

`apps/admin/src/ios/admin-kit.css` (full content):
```css
/* Admin chrome on top of @mesaas/ios-kit (imported after ios-kit.css). Phone shell, tab bar,
   desktop sidebar, shared panels. Colours live here so TSX stays hex-free. */

:root {
  --font-main: 'SF Pro Text', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif;
  --font-heading: 'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif;
  --banner-height: 0px;
  --mobile-nav-chrome-offset: 0px;
  --admin-tab-bar-space: calc(64px + max(10px, env(safe-area-inset-bottom)) + 16px);
}

.phone-kit {
  --phone-accent: #facc15;
  --phone-on-accent: #12151a;
}

/* Liquid Glass ON: translucent cells over the mesh. Blur only on chrome (below). */
[data-liquid-glass='on'] .phone-kit {
  --phone-bg: transparent;
  --phone-cell: rgba(17, 21, 28, 0.55);
  --phone-cell-pressed: rgba(37, 43, 56, 0.7);
  --phone-sheet-bg: rgba(22, 26, 34, 0.86);
  --phone-menu-bg: rgba(30, 34, 43, 0.9);
  --phone-glass: rgba(17, 21, 28, 0.6);
  --phone-glass-border: rgba(255, 255, 255, 0.08);
}
[data-liquid-glass='on'] .phone-kit.phone-sheet,
[data-liquid-glass='on'] .phone-kit .phone-sheet,
[data-liquid-glass='on'] .phone-kit.phone-action-sheet,
[data-liquid-glass='on'] .phone-kit.phone-context-menu {
  -webkit-backdrop-filter: blur(30px) saturate(1.8);
  backdrop-filter: blur(30px) saturate(1.8);
}

/* ── Phone shell ───────────────────────────────────────────────────────── */
.admin-phone-shell {
  min-height: 100dvh;
  background: var(--phone-bg);
  color: var(--phone-label);
  font-family: var(--font-main);
}
.admin-phone-main {
  padding: env(safe-area-inset-top) max(16px, env(safe-area-inset-right))
    var(--admin-tab-bar-space) max(16px, env(safe-area-inset-left));
}
.admin-phone-shell[data-tab-bar='hidden'] .admin-phone-main {
  padding-bottom: max(16px, env(safe-area-inset-bottom));
}

.admin-tab-bar {
  position: fixed;
  z-index: 40;
  left: max(16px, env(safe-area-inset-left));
  right: max(16px, env(safe-area-inset-right));
  bottom: calc(max(10px, env(safe-area-inset-bottom)) + var(--mobile-nav-chrome-offset, 0px));
  min-height: 64px;
  padding: 4px;
  box-sizing: border-box;
  border: 1px solid var(--phone-glass-border);
  border-radius: 32px;
  background: var(--phone-cell);
  background: var(--phone-glass);
  box-shadow: var(--phone-shadow-float);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  backdrop-filter: blur(20px) saturate(180%);
}
.admin-tab-bar__items {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  min-height: 54px;
}
.admin-tab-bar__item {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  min-width: 0;
  min-height: 54px;
  padding: 4px 2px;
  border: 0;
  border-radius: 28px;
  background: none;
  color: var(--phone-label-secondary);
  font-family: var(--font-main);
  text-decoration: none;
  -webkit-tap-highlight-color: transparent;
  transition: background-color 160ms ease;
  cursor: pointer;
}
.admin-tab-bar__item[aria-current='page'],
.admin-tab-bar__item[aria-expanded='true'] {
  background: var(--phone-tab-active);
  color: var(--phone-label);
}
.admin-tab-bar__item:focus-visible {
  outline: 2px solid var(--phone-accent);
  outline-offset: -2px;
}
.admin-tab-bar__item svg {
  width: 22px;
  height: 22px;
}
.admin-tab-bar__label {
  max-width: 100%;
  overflow: hidden;
  font-size: 10px;
  font-weight: 500;
  line-height: 1.1;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.admin-tab-bar__item[aria-current='page'] .admin-tab-bar__label {
  font-weight: 600;
}

/* Tile behind a nav icon (sidebar, Mais rows). Colour comes from an inline custom property. */
.admin-nav-tile {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 7px;
  background: var(--tile);
  color: #ffffff;
}
.admin-nav-tile svg {
  width: 15px;
  height: 15px;
}

/* ── Desktop shell ─────────────────────────────────────────────────────── */
.admin-desktop-shell {
  min-height: 100dvh;
}
.admin-sidebar {
  position: fixed;
  z-index: 30;
  top: 12px;
  bottom: 12px;
  left: 12px;
  display: flex;
  flex-direction: column;
  width: 248px;
  height: calc(100dvh - 24px);
  box-sizing: border-box;
  padding: 18px 12px 14px;
  overflow-y: auto;
  border: 1px solid hsl(var(--border));
  border-radius: 22px;
}
.admin-sidebar__group-label {
  margin: 0 0 4px 10px;
  color: hsl(var(--muted-foreground));
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.admin-sidebar__link {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 34px;
  padding: 0 10px;
  border-radius: 10px;
  color: hsl(var(--foreground));
  font-size: 14px;
  text-decoration: none;
}
.admin-sidebar__link:hover {
  background: hsl(var(--foreground) / 0.06);
}
.admin-sidebar__link[aria-current='page'] {
  background: hsl(var(--foreground) / 0.12);
  font-weight: 600;
}
.admin-sidebar__link:focus-visible {
  outline: 2px solid hsl(var(--ring));
  outline-offset: 1px;
}
.admin-desktop-main {
  margin-left: 272px;
  min-width: 0;
}
.admin-desktop-content {
  max-width: 1100px;
  margin: 0 auto;
  padding: 18px 28px 28px;
}
.admin-desktop-content:has([data-admin-wide]) {
  max-width: 1180px;
}

/* ── Shared content pieces ─────────────────────────────────────────────── */
.admin-kpi-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(var(--admin-kpi-min, 210px), 1fr));
  gap: 12px;
}
.admin-phone-shell .admin-kpi-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

/* Liquid glass on desktop panels (Card, KPI tiles, sidebar, selection bar). */
[data-liquid-glass='on'] .admin-glass {
  background-color: rgba(17, 21, 28, 0.55);
  -webkit-backdrop-filter: blur(22px) saturate(1.7);
  backdrop-filter: blur(22px) saturate(1.7);
  border-color: rgba(255, 255, 255, 0.08);
}
[data-liquid-glass='on'] .admin-sidebar.admin-glass {
  background-color: rgba(13, 16, 22, 0.55);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06), 0 12px 40px rgba(0, 0, 0, 0.35);
}

/* Sheet header submit (AdminFormSheet). */
.admin-sheet-submit {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 14px;
  border: 0;
  border-radius: 999px;
  background: var(--phone-accent, #facc15);
  color: var(--phone-on-accent, #12151a);
  font-family: var(--font-main);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}
.admin-sheet-submit:disabled {
  opacity: 0.5;
  cursor: default;
}
.admin-sheet-submit svg {
  width: 14px;
  height: 14px;
}

/* dnd-kit handles inside sheets must own the gesture. */
.phone-kit [data-dnd-handle] {
  touch-action: none;
}
```
(Check variable names against `packages/ios-kit/ios-kit.css`: `--phone-tab-active`, `--phone-shadow-float`, `--phone-glass`, `--phone-glass-border`, `--phone-sheet-bg`, `--phone-menu-bg` exist there; if a class such as `.phone-context-menu`/`.phone-action-sheet` has a different root name, use the real one from the CSS.)

`apps/admin/src/__tests__/no-hex-literals.test.ts`: keep `FILES` and `ALLOW`, add glob-collected files. Replace the `FILES` constant usage with:
```ts
import { existsSync, readdirSync, statSync } from 'node:fs';

/** New-design files are hex-free by convention; collected by path so page work never edits this test. */
function collect(dir: string, match: (rel: string) => boolean): string[] {
  const out: string[] = [];
  const walk = (abs: string) => {
    for (const name of readdirSync(abs)) {
      const p = path.join(abs, name);
      if (statSync(p).isDirectory()) {
        if (name !== '__tests__') walk(p);
      } else {
        const rel = path.relative(SRC, p).split(path.sep).join('/');
        if (match(rel)) out.push(rel);
      }
    }
  };
  const root = path.join(SRC, dir);
  if (!existsSync(root)) return out; // components/shell appears in B2–B4
  walk(root);
  return out;
}

const NEW_DESIGN = [
  ...collect('components/shell', (r) => r.endsWith('.tsx')),
  ...collect('pages', (r) => /(Phone|Desktop)\.tsx$/.test(r) || /\/phone\/.+\.tsx$/.test(r)),
  'components/PageHeader.tsx',
];

const ALL = Array.from(new Set([...FILES, ...NEW_DESIGN]));
```
and run `it.each(ALL)` instead of `it.each(FILES)`. Also add `'lib/nav-items.ts'` to nothing (it is a data file and must keep its hexes).

- [ ] **Step 7: Verify**

```bash
npx tsc -p apps/admin/tsconfig.json --noEmit
npx vitest run apps/admin
npm run build:admin 2>&1 | tail -5
```
Expected: PASS; build succeeds and `dist/admin/assets/*.css` contains `.phone-group` and `.admin-tab-bar` (`grep -l "admin-tab-bar" dist/admin/assets/*.css`). If `build:admin` writes elsewhere, check `apps/admin/vite.config.ts` `build.outDir`.

- [ ] **Step 8: Commit (orchestrator)**

```bash
git add apps/admin/index.html apps/admin/src/main.tsx apps/admin/src/globals.css apps/admin/src/ios apps/admin/src/hooks apps/admin/src/__tests__ apps/admin/src/lib/nav-items.ts apps/admin/src/lib/__tests__/nav-items.test.ts apps/admin/src/components/ui/dialog.tsx
git commit -m "feat(admin): iOS shell foundations (viewport, kit CSS, useIsPhone, nav data)"
```

Tasks B2, B3 and B4 depend only on B1 and touch disjoint files: run them in parallel.

### Task B2: Primitives restyle, `PageHeader`, `AdminNavBar`, `KpiTile`, `GlassPanel`, `SelectionBar`

**Files:**
- Modify: `apps/admin/src/components/ui/{card,table,badge,button,tabs,dialog}.tsx`, `apps/admin/src/components/PageHeader.tsx`
- Create: `apps/admin/src/components/shell/AdminNavBar.tsx`, `apps/admin/src/components/shell/KpiTile.tsx`, `apps/admin/src/components/shell/GlassPanel.tsx`, `apps/admin/src/components/shell/SelectionBar.tsx`, `apps/admin/src/components/__tests__/PageHeader.test.tsx`, `apps/admin/src/components/shell/__tests__/KpiTile.test.tsx`
- Test (update if needed): `apps/admin/src/components/ui/__tests__/primitives.test.tsx`

**Interfaces:**
- Consumes: `useIsPhone` (B1), `LargeTitleHeader`, `PhoneIconButton`, `BrandMark` from `@mesaas/ios-kit`.
- Produces:
  - `PageHeader({ title: string; description?: ReactNode; actions?: ReactNode; phoneActions?: ReactNode; back?: { to: string; label: string }; children?: ReactNode })`.
  - `AdminNavBar({ title?: ReactNode; back: { to: string; label: string }; trailing?: ReactNode })`.
  - `KpiTile({ label: string; value: ReactNode; sub?: ReactNode; tone?: 'default' | 'warning' | 'danger' | 'success'; to?: string })` and `KpiGrid({ children, min?: number })`.
  - `GlassPanel({ title?: ReactNode; titleId?: string; actions?: ReactNode; children; className?: string; flush?: boolean })` (flush = no body padding, for tables/lists).
  - `SelectionBar({ count: number; children: ReactNode; label?: string })`: floating glass action bar (desktop) / kit `BottomActionBar` (phone).

- [ ] **Step 1: Write failing tests**

`apps/admin/src/components/__tests__/PageHeader.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { PageHeader } from '../PageHeader';
import { mockPhone } from '../../__tests__/phone';

const wrap = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe('PageHeader', () => {
  let restore: (() => void) | null = null;
  afterEach(() => restore?.());

  it('desktop: h1, description and actions', () => {
    wrap(<PageHeader title="Planos" description="5 planos" actions={<button>Novo plano</button>} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Planos' })).toBeInTheDocument();
    expect(screen.getByText('5 planos')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Novo plano' })).toBeInTheDocument();
  });

  it('desktop with back: a link to the parent above the title', () => {
    wrap(<PageHeader title="Social Bee" back={{ to: '/admin/workspaces', label: 'Workspaces' }} />);
    expect(screen.getByRole('link', { name: /Workspaces/ })).toHaveAttribute('href', '/admin/workspaces');
  });

  it('phone root: large title with the Mesaas mark and phone actions, not desktop actions', () => {
    restore = mockPhone();
    wrap(
      <PageHeader
        title="Planos"
        description="5 planos"
        actions={<button>Novo plano</button>}
        phoneActions={<button aria-label="Novo">+</button>}
      />,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Planos' })).toBeInTheDocument();
    expect(screen.getByAltText('Mesaas')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Novo' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Novo plano' })).not.toBeInTheDocument();
  });

  it('phone with back: a back button named after the parent', () => {
    restore = mockPhone();
    wrap(<PageHeader title="Workspace" back={{ to: '/admin/workspaces', label: 'Workspaces' }} />);
    expect(screen.getByRole('button', { name: 'Voltar para Workspaces' })).toBeInTheDocument();
  });
});
```

`apps/admin/src/components/shell/__tests__/KpiTile.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { KpiGrid, KpiTile } from '../KpiTile';

describe('KpiTile', () => {
  it('renders label, value and sub-line; a `to` tile is a link', () => {
    render(
      <MemoryRouter>
        <KpiGrid>
          <KpiTile label="MRR" value="R$ 9.870" sub="61 pagantes" to="/admin/metricas" />
          <KpiTile label="Em risco" value="6" tone="warning" />
        </KpiGrid>
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: /MRR.*R\$ 9\.870/ })).toHaveAttribute('href', '/admin/metricas');
    expect(screen.getByText('6')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run apps/admin/src/components/__tests__/PageHeader.test.tsx apps/admin/src/components/shell/__tests__/KpiTile.test.tsx`. Expected: FAIL.

- [ ] **Step 3: `AdminNavBar`**

```tsx
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { PhoneIconButton } from '@mesaas/ios-kit';
import { cn } from '../../lib/utils';

export interface AdminNavBarProps {
  title?: ReactNode;
  back: { to: string; label: string };
  trailing?: ReactNode;
}

function hasInAppHistory(): boolean {
  const idx = (window.history.state as { idx?: unknown } | null)?.idx;
  return typeof idx === 'number' && idx > 0;
}

/** Pushed-screen nav bar on phones: back, centred title, trailing actions. Never a dialog. */
export function AdminNavBar({ title, back, trailing }: AdminNavBarProps) {
  const navigate = useNavigate();
  const goBack = () => {
    if (hasInAppHistory()) navigate(-1);
    else navigate(back.to, { replace: true });
  };
  return (
    <header className={cn('phone-kit phone-nav-bar', title != null && 'phone-nav-bar--title-center')}>
      <div className="phone-nav-bar__leading">
        <PhoneIconButton label={`Voltar para ${back.label}`} onClick={goBack}>
          <ChevronLeft aria-hidden="true" />
        </PhoneIconButton>
        {title != null && <h1 className="phone-nav-bar__title">{title}</h1>}
      </div>
      <div className="phone-nav-bar__trailing">{trailing}</div>
    </header>
  );
}
```

- [ ] **Step 4: `PageHeader`**

```tsx
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { BrandMark, LargeTitleHeader } from '@mesaas/ios-kit';
import { useIsPhone } from '../hooks/useIsPhone';
import { AdminNavBar } from './shell/AdminNavBar';

interface PageHeaderProps {
  title: string;
  description?: ReactNode;
  /** Desktop actions (pill buttons). */
  actions?: ReactNode;
  /** Phone actions (round PhoneIconButtons) in the header row. */
  phoneActions?: ReactNode;
  /** Pushed screen: desktop back link, phone nav bar. */
  back?: { to: string; label: string };
  /** Under the title: segmented control, chips. */
  children?: ReactNode;
}

export function PageHeader({ title, description, actions, phoneActions, back, children }: PageHeaderProps) {
  const isPhone = useIsPhone();

  if (isPhone && back) {
    return (
      <>
        <AdminNavBar title={title} back={back} trailing={phoneActions} />
        {(description || children) && (
          <div className="phone-kit mb-4">
            {description && <p className="phone-large-title__subtitle">{description}</p>}
            {children}
          </div>
        )}
      </>
    );
  }

  if (isPhone) {
    return (
      <LargeTitleHeader title={title} subtitle={description} leading={<BrandMark />} trailing={phoneActions}>
        {children}
      </LargeTitleHeader>
    );
  }

  return (
    <div className="mb-5">
      {back && (
        <Link
          to={back.to}
          className="mb-1.5 inline-flex items-center gap-0.5 text-[15px] text-primary hover:underline"
        >
          <ChevronLeft size={18} aria-hidden="true" />
          {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-sf text-[34px] font-bold leading-[1.1] tracking-[-0.01em]">{title}</h1>
          {description ? <p className="mt-1 text-[15px] text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children ? <div className="mt-4">{children}</div> : null}
    </div>
  );
}
```

- [ ] **Step 5: `KpiTile`, `GlassPanel`, `SelectionBar`**

`KpiTile.tsx`:
```tsx
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '../../lib/utils';

const TONE = {
  default: { label: 'text-muted-foreground', value: '', border: '' },
  warning: { label: 'text-warning', value: 'text-warning', border: 'border-warning/40' },
  danger: { label: 'text-destructive', value: 'text-destructive', border: 'border-destructive/40' },
  success: { label: 'text-muted-foreground', value: 'text-success', border: '' },
} as const;

export interface KpiTileProps {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: keyof typeof TONE;
  to?: string;
}

export function KpiTile({ label, value, sub, tone = 'default', to }: KpiTileProps) {
  const t = TONE[tone];
  const body = (
    <>
      <span className={cn('block text-xs font-semibold uppercase tracking-[0.04em]', t.label)}>{label}</span>
      <span className={cn('mt-1.5 block text-[28px] font-bold leading-tight', t.value)}>{value}</span>
      {sub ? <span className="block text-[13px] text-muted-foreground">{sub}</span> : null}
    </>
  );
  const cls = cn('admin-glass block rounded-[18px] border border-border bg-card px-[18px] py-4 text-card-foreground', t.border);
  return to ? (
    <Link to={to} className={cn(cls, 'no-underline hover:bg-card/80')}>{body}</Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function KpiGrid({ children, min = 210 }: { children: ReactNode; min?: number }) {
  return (
    <div className="admin-kpi-grid mb-5" style={{ ['--admin-kpi-min' as string]: `${min}px` }}>
      {children}
    </div>
  );
}
```
(On phones the grid becomes two columns via `.admin-phone-shell .admin-kpi-grid`; the tile padding stays.)

`GlassPanel.tsx`:
```tsx
import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

export interface GlassPanelProps {
  title?: ReactNode;
  titleId?: string;
  actions?: ReactNode;
  /** No body padding (tables, lists that run edge to edge). */
  flush?: boolean;
  className?: string;
  children: ReactNode;
}

export function GlassPanel({ title, titleId, actions, flush, className, children }: GlassPanelProps) {
  return (
    <section
      aria-labelledby={title && titleId ? titleId : undefined}
      className={cn('admin-glass min-w-0 overflow-hidden rounded-[18px] border border-border bg-card text-card-foreground', className)}
    >
      {(title || actions) && (
        <div className="flex items-center justify-between gap-3 px-[18px] py-3.5">
          {title ? <h2 id={titleId} className="text-[17px] font-semibold">{title}</h2> : <span />}
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </div>
      )}
      <div className={flush ? undefined : 'px-[18px] pb-4'}>{children}</div>
    </section>
  );
}
```

`SelectionBar.tsx`:
```tsx
import type { ReactNode } from 'react';
import { BottomActionBar } from '@mesaas/ios-kit';
import { useIsPhone } from '../../hooks/useIsPhone';

export interface SelectionBarProps {
  count: number;
  /** Action buttons. */
  children: ReactNode;
  /** Defaults to "{count} selecionado(s)". */
  label?: string;
}

/** Floating action bar for a list in selection mode. Renders nothing at count 0. */
export function SelectionBar({ count, children, label }: SelectionBarProps) {
  const isPhone = useIsPhone();
  if (count === 0) return null;
  const text = label ?? `${count} ${count === 1 ? 'selecionado' : 'selecionados'}`;
  if (isPhone) {
    return <BottomActionBar aria-label="Ações da seleção">{children}</BottomActionBar>;
  }
  return (
    <div
      role="toolbar"
      aria-label="Ações da seleção"
      className="admin-glass fixed bottom-7 left-[calc(50%+136px)] z-30 flex -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-card py-2 pl-[18px] pr-2 shadow-lg"
    >
      <span className="mr-1.5 text-sm font-semibold">{text}</span>
      {children}
    </div>
  );
}
```
(Read `packages/ios-kit/src/BottomActionBar.tsx` for its real props and adapt the phone branch call to them; keep the `aria-label`.)

- [ ] **Step 6: Restyle primitives (classes only, APIs unchanged)**

- `card.tsx` `Card`: `'admin-glass rounded-[18px] border border-border bg-card text-card-foreground'`. `CardHeader`: `'flex items-center justify-between gap-3 px-[18px] py-3.5'` (drop `border-b`). `CardTitle`: `'text-[17px] font-semibold'`. `CardContent`: `'px-[18px] pb-4 pt-0 first:pt-4'`.
- `table.tsx`: `TableHead` → `h-9 px-2.5 text-left align-middle text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground first:pl-[18px] last:pr-[18px] [&:has([role=checkbox])]:pr-0`; `TableCell` → `px-2.5 py-3 align-middle first:pl-[18px] last:pr-[18px] [&:has([role=checkbox])]:pr-0`; `TableRow` → `border-b border-border/60 transition-colors hover:bg-foreground/[0.03] data-[state=selected]:bg-muted`; `TableHeader` → `[&_tr]:border-b [&_tr]:border-border`. Keep every existing className hook a test or page relies on (read the current file and change only the class strings).
- `badge.tsx`: base `rounded-[6px]` instead of `rounded-md`, `font-bold tracking-[0.02em]`; size `md` → `h-[18px] px-[7px] text-[11px]`. Keep every variant's colour classes exactly and in the same order (tests assert `text-warning`, `bg-warning/10`, and `'bg-destructive '` with a trailing space, i.e. `bg-destructive text-destructive-foreground` stays one string).
- `button.tsx`: base `rounded-full font-semibold` (replace `rounded-md`, `font-medium`); sizes `default: 'h-[34px] px-3.5'`, `sm: 'h-7 px-3 text-xs'`, `lg: 'h-10 px-6'`, `icon: 'h-[34px] w-[34px]'` (remove the per-size `rounded-md`); variant `secondary` → `bg-foreground/[0.12] text-foreground hover:bg-foreground/[0.18]`; `destructive` → `bg-destructive/15 text-destructive hover:bg-destructive/25`; `outline` → `border border-border bg-transparent hover:bg-foreground/[0.06]`. `default`, `ink`, `ghost`, `link` keep their colours.
- `tabs.tsx`: `TabsList` → `inline-flex h-8 items-center rounded-[9px] bg-foreground/[0.12] p-0.5 text-foreground`; `TabsTrigger` → `inline-flex h-7 items-center justify-center whitespace-nowrap rounded-[7px] px-3.5 text-[13px] font-normal transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-card data-[state=active]:font-semibold data-[state=active]:shadow-sm`.
- `dialog.tsx`: overlay `bg-black/50`; content `rounded-[22px] admin-glass border-border bg-card shadow-[0_30px_80px_rgba(0,0,0,0.5)]` (keep layout classes), `DialogHeader` `px-[18px] pt-[18px]`, `DialogFooter` `px-[18px]`. Wait: the `shadow-[…]` arbitrary value contains no hex, fine.

- [ ] **Step 7: Run tests**

Run: `npx vitest run apps/admin`. Expected: the two new tests PASS; if `primitives.test.tsx` fails, it must be only on removed shape classes (e.g. `rounded-md`): update that assertion to the new class and keep the variant assertions. Any page test failure here means a page queried a class: report it instead of fixing page tests (Part C owns them), unless the fix is a one-line query update.

- [ ] **Step 8: Commit (orchestrator)**

```bash
git add apps/admin/src/components/ui apps/admin/src/components/PageHeader.tsx apps/admin/src/components/shell/AdminNavBar.tsx apps/admin/src/components/shell/KpiTile.tsx apps/admin/src/components/shell/GlassPanel.tsx apps/admin/src/components/shell/SelectionBar.tsx apps/admin/src/components/__tests__/PageHeader.test.tsx apps/admin/src/components/shell/__tests__
git commit -m "feat(admin): iOS-style primitives, responsive PageHeader and shared content pieces"
```

### Task B3: `AdminFormSheet`

**Files:**
- Create: `apps/admin/src/components/shell/AdminFormSheet.tsx`, `apps/admin/src/components/shell/__tests__/AdminFormSheet.test.tsx`

**Interfaces:**
- Consumes: `useIsPhone` (B1), `BottomSheet` with `repushIfStillOpen` (A3), Admin `Dialog`/`DialogContent` (`hideClose`, B1), `DialogTitle`, `DialogDescription`, `DialogBody`.
- Produces:
```ts
export interface AdminFormSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  /** id of the page's own <form>; the header submit targets it with form={formId}. */
  formId: string;
  submitLabel?: string;            // default 'Salvar'
  submitting?: boolean;            // disables submit and blocks every dismiss path
  submitDisabled?: boolean;
  /** Refusable close: return false to keep the sheet open (e.g. a dirty confirm). */
  canClose?: () => boolean;
  width?: 'md' | 'lg' | 'xl';      // desktop 680 / 820 / 1000px
  children: ReactNode;             // must contain <form id={formId}>
}
export function AdminFormSheet(props: AdminFormSheetProps): JSX.Element;
```

- [ ] **Step 1: Write failing tests**

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { AdminFormSheet } from '../AdminFormSheet';
import { mockPhone } from '../../../__tests__/phone';

function Harness(props: { submitting?: boolean; canClose?: () => boolean; onSubmit?: () => void }) {
  const [open, setOpen] = useState(true);
  return (
    <MemoryRouter>
      <p>{open ? 'aberto' : 'fechado'}</p>
      <AdminFormSheet
        open={open}
        onOpenChange={setOpen}
        title="Editar: Pro"
        formId="plan-form"
        submitting={props.submitting}
        canClose={props.canClose}
      >
        <form
          id="plan-form"
          onSubmit={(e) => {
            e.preventDefault();
            props.onSubmit?.();
          }}
        >
          <label>
            Nome <input defaultValue="Pro" />
          </label>
        </form>
      </AdminFormSheet>
    </MemoryRouter>
  );
}

describe.each([
  ['desktop', false],
  ['phone', true],
])('AdminFormSheet (%s)', (_name, phone) => {
  let restore: (() => void) | null = null;
  afterEach(() => restore?.());
  const setup = () => {
    if (phone) restore = mockPhone();
  };

  it('the header submit submits the page form (one form, no nesting)', () => {
    setup();
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    const dialog = screen.getByRole('dialog', { name: 'Editar: Pro' });
    expect(dialog.querySelectorAll('form')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('Cancelar closes', () => {
    setup();
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.getByText('fechado')).toBeInTheDocument();
  });

  it('while submitting, Cancelar and Escape do not close', () => {
    setup();
    render(<Harness submitting />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.getByText('aberto')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Salvar/ })).toBeDisabled();
  });

  it('canClose returning false keeps it open', () => {
    setup();
    render(<Harness canClose={() => false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.getByText('aberto')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run apps/admin/src/components/shell/__tests__/AdminFormSheet.test.tsx`. Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

```tsx
import type { ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { BottomSheet } from '@mesaas/ios-kit';
import { useIsPhone } from '../../hooks/useIsPhone';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog';
import { cn } from '../../lib/utils';

export interface AdminFormSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  formId: string;
  submitLabel?: string;
  submitting?: boolean;
  submitDisabled?: boolean;
  canClose?: () => boolean;
  width?: 'md' | 'lg' | 'xl';
  children: ReactNode;
}

const WIDTH = { md: 'max-w-[680px]', lg: 'max-w-[820px]', xl: 'max-w-[1000px]' } as const;

/**
 * Create/edit form as an iOS sheet: a centred glass sheet on desktop, a large bottom sheet on
 * phones. The page owns the single <form id={formId}>; the header submit targets it.
 */
export function AdminFormSheet({
  open, onOpenChange, title, description, formId, submitLabel = 'Salvar',
  submitting = false, submitDisabled = false, canClose, width = 'md', children,
}: AdminFormSheetProps) {
  const isPhone = useIsPhone();

  const requestClose = () => {
    if (submitting) return;
    if (canClose && !canClose()) return;
    onOpenChange(false);
  };
  const handleOpenChange = (next: boolean) => {
    if (next) onOpenChange(true);
    else requestClose();
  };

  const cancel = (
    <button type="button" className="phone-text-button" onClick={requestClose} disabled={submitting}>
      Cancelar
    </button>
  );
  const submit = (
    <button type="submit" form={formId} className="admin-sheet-submit" disabled={submitting || submitDisabled}>
      {submitting ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
      {submitLabel}
    </button>
  );

  if (isPhone) {
    return (
      <BottomSheet
        open={open}
        onOpenChange={handleOpenChange}
        title={title}
        description={description}
        headerLeading={cancel}
        headerTrailing={submit}
        repushIfStillOpen
      >
        {children}
      </BottomSheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent hideClose className={cn('phone-kit top-10 translate-y-0 max-h-[calc(100dvh-80px)]', WIDTH[width])}>
        <div className="flex h-[54px] shrink-0 items-center justify-between gap-3 border-b border-border px-4">
          {cancel}
          <DialogTitle className="text-base font-semibold">{title}</DialogTitle>
          {submit}
        </div>
        {description ? <DialogDescription className="px-[18px] pt-3">{description}</DialogDescription> : null}
        <DialogBody className="px-[18px] py-[18px]">{children}</DialogBody>
      </DialogContent>
    </Dialog>
  );
}
```
Notes: the desktop dialog carries `phone-kit` so `.phone-text-button` and `.admin-sheet-submit` read the kit tokens; it sits top-aligned 40px from the top (DkPlanoForm), not vertically centred, overriding `top-1/2 -translate-y-1/2` from `DialogContent` (`top-10 translate-y-0` wins through `cn`/tailwind-merge). Without `description`, Radix warns about a missing `Description`: pass `aria-describedby={undefined}` on `DialogContent` in that case.

- [ ] **Step 4: Run tests**

Run: `npx vitest run apps/admin/src/components/shell/__tests__/AdminFormSheet.test.tsx`. Expected: PASS (8 tests). If the phone branch's sheet title is visually hidden and not exposed as the dialog name, assert via `getByRole('dialog')` and check the kit test for how `BottomSheet` names its dialog.

- [ ] **Step 5: Commit (orchestrator)**

```bash
git add apps/admin/src/components/shell/AdminFormSheet.tsx apps/admin/src/components/shell/__tests__/AdminFormSheet.test.tsx
git commit -m "feat(admin): AdminFormSheet (centred sheet on desktop, bottom sheet on phones)"
```

### Task B4: `AdminLayout` (desktop sidebar, phone tab bar, Mais sheet)

**Files:**
- Modify: `apps/admin/src/layouts/AdminLayout.tsx`, `apps/admin/src/layouts/__tests__/AdminLayout.test.tsx`
- Create: `apps/admin/src/layouts/useAdminTheme.ts`, `apps/admin/src/components/shell/DesktopSidebar.tsx`, `apps/admin/src/components/shell/AdminTabBar.tsx`, `apps/admin/src/components/shell/MaisSheet.tsx`, `apps/admin/src/components/shell/useChromeOffset.ts`, `apps/admin/src/layouts/__tests__/AdminLayoutPhone.test.tsx`

**Interfaces:**
- Consumes: `NAV_GROUPS`, `PHONE_TABS`, `MAIS_GROUPS`, `isRouteActive`, `hidesTabBar` (B1); `useIsPhone` (B1); `BottomSheet`, `GroupedList`, `Cell`, `useSheetActions`, `BrandMark` (kit); `useAdminAuth`, `useLiquidGlassContext`.
- Produces: `useAdminTheme(): { theme: 'light' | 'dark'; setTheme(t): void; toggleTheme(): void; glassEnabled: boolean; toggleGlass(): void }` (moves the current effect from AdminLayout verbatim). The layout keeps `<main><div><Outlet/></div></main>` at the same position in both modes.

- [ ] **Step 1: Write failing phone tests** (`AdminLayoutPhone.test.tsx`; same mocks as `AdminLayout.test.tsx`, but the glass mock exposes a mutable `enabled` and a `toggle` spy)

```tsx
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { mockPhone } from '../../__tests__/phone';

const signOut = vi.fn();
vi.mock('../../context/AdminAuthContext', () => ({
  useAdminAuth: () => ({ adminEmail: 'admin@mesaas.com.br', signOut }),
}));
const glass = { enabled: false, toggle: vi.fn() };
vi.mock('../../liquidglass/LiquidGlassProvider', () => ({ useLiquidGlassContext: () => glass }));
vi.mock('../../liquidglass/LiquidBackdrop', () => ({ LiquidBackdrop: () => null }));

import AdminLayout from '../AdminLayout';

function renderAt(path: string) {
  const router = createMemoryRouter(
    [{
      path: '/admin',
      element: <AdminLayout />,
      children: [
        { index: true, element: <p>dash</p> },
        { path: 'workspaces', element: <p>lista</p> },
        { path: 'workspaces/:id', element: <p>detalhe</p> },
        { path: 'plans', element: <p>planos</p> },
        { path: 'kb-articles/new', element: <p>editor</p> },
      ],
    }],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

describe('AdminLayout on phones', () => {
  let restore: () => void;
  beforeEach(() => {
    restore = mockPhone();
    localStorage.clear();
    glass.enabled = false;
  });
  afterEach(() => restore());

  it('shows the tab bar, no sidebar', () => {
    renderAt('/admin');
    const nav = screen.getByRole('navigation', { name: 'Navegação principal' });
    expect(within(nav).getAllByRole('link').map((l) => l.textContent)).toEqual([
      'Dashboard', 'Métricas', 'Workspaces', 'Afiliados',
    ]);
    expect(within(nav).getByRole('button', { name: 'Mais' })).toBeInTheDocument();
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  });

  it('marks the parent tab on a child route, and Mais on other routes', () => {
    renderAt('/admin/workspaces/42');
    expect(screen.getByRole('link', { name: 'Workspaces' })).toHaveAttribute('aria-current', 'page');
  });

  it('Mais is current on a Mais route', () => {
    renderAt('/admin/plans');
    expect(screen.getByRole('button', { name: 'Mais' })).toHaveAttribute('aria-current', 'page');
  });

  it('hides the tab bar on pushed editors', () => {
    renderAt('/admin/kb-articles/new');
    expect(screen.queryByRole('navigation', { name: 'Navegação principal' })).not.toBeInTheDocument();
  });

  it('Mais lists the other pages, account and Sair; a row navigates and closes', async () => {
    const router = renderAt('/admin');
    fireEvent.click(screen.getByRole('button', { name: 'Mais' }));
    const sheet = screen.getByRole('dialog');
    for (const label of ['Planos', 'Admins', 'Integrações', 'Banners', 'Popups', 'Artigos', 'Vídeos', 'Sair']) {
      expect(within(sheet).getByText(label)).toBeInTheDocument();
    }
    expect(within(sheet).getByText('admin@mesaas.com.br')).toBeInTheDocument();
    fireEvent.click(within(sheet).getByText('Planos'));
    expect(await screen.findByText('planos')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/admin/plans');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('theme switch only shows with glass off; glass switch calls toggle', () => {
    renderAt('/admin');
    fireEvent.click(screen.getByRole('button', { name: 'Mais' }));
    expect(screen.getByRole('switch', { name: /Tema escuro/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('switch', { name: /Liquid Glass/ }));
    expect(glass.toggle).toHaveBeenCalled();
  });

  it('keeps the outlet mounted when the breakpoint flips', () => {
    // Render on phone, then flip matchMedia to desktop and fire the change listener; the
    // outlet element must be the same DOM node (not remounted by the shell).
    // Implement with a matchMedia mock that captures 'change' listeners (see useIsPhone.test).
  });
});
```
Write the last test fully with a listener-capturing `matchMedia` mock (copy the one in `useIsPhone.test.tsx`): capture `screen.getByText('dash')` before the flip, fire listeners inside `act`, assert `screen.getByText('dash')` is the same node (`toBe`).

Also add to `AdminLayout.test.tsx` (desktop):
```tsx
it('groups the sidebar and marks the current page', () => {
  renderLayout();
  expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
  expect(screen.getByText('Plataforma')).toBeInTheDocument();
  expect(screen.getByText('Comunicação')).toBeInTheDocument();
  expect(screen.getByText('Central de Ajuda')).toBeInTheDocument();
  expect(screen.getByRole('switch', { name: 'Liquid Glass' })).toBeInTheDocument();
});
it('glass ON with light saved: forces dark without overwriting admin-theme', () => {
  // Use a mutable glass mock (as in the phone test), set localStorage admin-theme=light,
  // enabled=true: data-theme is dark and localStorage still says light.
});
```
(Convert this file's glass mock to the same mutable object so the second test can set `enabled = true`; the existing three tests keep passing unchanged, including `bg-card` on the aside and the "Modo claro"/"Modo escuro" buttons.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run apps/admin/src/layouts`. Expected: new tests FAIL.

- [ ] **Step 3: `useAdminTheme`** (logic moved verbatim from AdminLayout)

```ts
import { useEffect, useState } from 'react';
import { useLiquidGlassContext } from '../liquidglass/LiquidGlassProvider';

export function useAdminTheme() {
  const [theme, setTheme] = useState<'light' | 'dark'>(
    () => (localStorage.getItem('admin-theme') as 'light' | 'dark') || 'dark',
  );
  const { enabled: glassEnabled, toggle: toggleGlass } = useLiquidGlassContext();

  // Glass ON forces dark for presentation but never persists it: the saved theme comes
  // back when glass is turned off.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', glassEnabled ? 'dark' : theme);
    if (!glassEnabled) localStorage.setItem('admin-theme', theme);
  }, [theme, glassEnabled]);

  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
  return { theme, setTheme, toggleTheme, glassEnabled, toggleGlass };
}
```

- [ ] **Step 4: `DesktopSidebar`**

```tsx
import { NavLink } from 'react-router-dom';
import { Moon, Sun } from 'lucide-react';
import { BrandMark } from '@mesaas/ios-kit';
import { NAV_GROUPS } from '../../lib/nav-items';

export interface DesktopSidebarProps {
  email: string | null;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  glassEnabled: boolean;
  onToggleGlass: () => void;
  onSignOut: () => void;
}

export function DesktopSidebar({ email, theme, onToggleTheme, glassEnabled, onToggleGlass, onSignOut }: DesktopSidebarProps) {
  return (
    <aside className="admin-sidebar admin-glass glass-surface--sidebar bg-card text-card-foreground">
      <div className="flex items-center gap-2.5 px-2 pb-[18px]">
        <BrandMark />
        <span className="font-sf text-[17px] font-bold">Mesaas</span>
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">admin</span>
      </div>
      <nav aria-label="Navegação principal" className="flex flex-1 flex-col gap-3.5">
        {NAV_GROUPS.map((group) => (
          <div key={group.label ?? 'main'}>
            {group.label && <h2 className="admin-sidebar__group-label">{group.label}</h2>}
            <ul className="flex flex-col gap-0.5">
              {group.items.map(({ id, to, label, icon: Icon, tile }) => (
                <li key={id}>
                  <NavLink to={to} end={to === '/admin'} className="admin-sidebar__link">
                    <span className="admin-nav-tile" aria-hidden="true" style={{ ['--tile' as string]: tile }}>
                      <Icon />
                    </span>
                    {label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <div className="mt-3 flex flex-col gap-2.5 border-t border-border px-1.5 pt-3">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold">{email}</p>
          <p className="text-[11px] text-muted-foreground">Admin da plataforma</p>
        </div>
        <div className="flex items-center gap-2">
          <span id="admin-glass-label" className="flex-1 text-[13px] text-muted-foreground">Liquid Glass</span>
          <button
            type="button"
            role="switch"
            aria-checked={glassEnabled}
            aria-labelledby="admin-glass-label"
            onClick={onToggleGlass}
            className="phone-switch"
          >
            <span className="phone-switch__thumb" aria-hidden="true" />
          </button>
          {!glassEnabled && (
            <button
              type="button"
              onClick={onToggleTheme}
              aria-label={theme === 'dark' ? 'Modo claro' : 'Modo escuro'}
              title={theme === 'dark' ? 'Modo claro' : 'Modo escuro'}
              className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-foreground/[0.08] text-muted-foreground hover:text-foreground"
            >
              {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
            </button>
          )}
          <button
            type="button"
            onClick={onSignOut}
            className="h-7 rounded-full bg-foreground/[0.08] px-2.5 text-xs text-foreground hover:bg-foreground/[0.14]"
          >
            Sair
          </button>
        </div>
      </div>
    </aside>
  );
}
```
Note: `.phone-switch` reads kit tokens; the sidebar is outside `.phone-kit`, so give the `<aside>` the `phone-kit` class too **only if** its tokens don't clash with the sidebar's own colours; otherwise wrap just the switch in `<span className="phone-kit">`. Verify the switch looks right in the Browser pane (Phase D). The NavLink's `aria-current="page"` is automatic.

- [ ] **Step 5: `useChromeOffset`, `AdminTabBar`, `MaisSheet`**

`useChromeOffset.ts`: copy the `visualViewport` effect from `apps/crm/src/components/layout/MobileNav.tsx` (the `updateChromeOffset` block, including its comment) into `export function useChromeOffset(): void { useEffect(() => { … }, []); }`.

`AdminTabBar.tsx`:
```tsx
import { useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Ellipsis } from 'lucide-react';
import { PHONE_TABS, MAIS_GROUPS, isRouteActive } from '../../lib/nav-items';
import { MaisSheet, type MaisSheetProps } from './MaisSheet';
import { useChromeOffset } from './useChromeOffset';

export type AdminTabBarProps = Omit<MaisSheetProps, 'open' | 'onOpenChange' | 'returnFocusRef'>;

export function AdminTabBar(props: AdminTabBarProps) {
  useChromeOffset();
  const { pathname } = useLocation();
  const [maisOpen, setMaisOpen] = useState(false);
  const maisRef = useRef<HTMLButtonElement>(null);
  const onMaisRoute = MAIS_GROUPS.some((g) => g.items.some((i) => isRouteActive(pathname, i.to)));

  return (
    <>
      <nav className="admin-tab-bar" aria-label="Navegação principal">
        <div className="admin-tab-bar__items">
          {PHONE_TABS.map(({ id, to, label, icon: Icon }) => {
            const active = isRouteActive(pathname, to);
            return (
              <NavLink
                key={id}
                to={to}
                end={to === '/admin'}
                className="admin-tab-bar__item"
                aria-current={active ? 'page' : undefined}
              >
                <Icon strokeWidth={active ? 2.3 : 2} aria-hidden="true" />
                <span className="admin-tab-bar__label">{label}</span>
              </NavLink>
            );
          })}
          <button
            ref={maisRef}
            type="button"
            className="admin-tab-bar__item"
            aria-current={onMaisRoute ? 'page' : undefined}
            aria-expanded={maisOpen}
            aria-haspopup="dialog"
            onClick={() => setMaisOpen(true)}
          >
            <Ellipsis aria-hidden="true" />
            <span className="admin-tab-bar__label">Mais</span>
          </button>
        </div>
      </nav>
      <MaisSheet {...props} open={maisOpen} onOpenChange={setMaisOpen} returnFocusRef={maisRef} />
    </>
  );
}
```
(NavLink sets its own `aria-current` when active; passing it explicitly keeps child routes such as `/admin/workspaces/42` marked, since `end` is off for those. Ensure the label is the link's accessible name: icon is `aria-hidden`.)

`MaisSheet.tsx`:
```tsx
import type { RefObject } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { BottomSheet, Cell, GroupedList, useSheetActions } from '@mesaas/ios-kit';
import { MAIS_GROUPS } from '../../lib/nav-items';

export interface MaisSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
  email: string | null;
  theme: 'light' | 'dark';
  onSetTheme: (t: 'light' | 'dark') => void;
  glassEnabled: boolean;
  onToggleGlass: () => void;
  onSignOut: () => void;
}

function MaisContent({ email, theme, onSetTheme, glassEnabled, onToggleGlass, onSignOut }: Omit<MaisSheetProps, 'open' | 'onOpenChange' | 'returnFocusRef'>) {
  const navigate = useNavigate();
  const { closeThen } = useSheetActions();
  return (
    <>
      {MAIS_GROUPS.map((group) => (
        <GroupedList key={group.label} header={group.label}>
          {group.items.map(({ id, to, label, icon: Icon, tile }) => (
            <Cell key={id} label={label} icon={<Icon />} iconColor={tile} chevron onClick={() => closeThen(() => navigate(to))} />
          ))}
        </GroupedList>
      ))}
      <GroupedList header="Conta">
        <Cell label={email ?? ''} subtitle="Admin da plataforma" />
        <Cell label="Liquid Glass" switch={{ checked: glassEnabled, onCheckedChange: onToggleGlass }} />
        {!glassEnabled && (
          <Cell
            label="Tema escuro"
            switch={{ checked: theme === 'dark', onCheckedChange: (on) => onSetTheme(on ? 'dark' : 'light') }}
          />
        )}
      </GroupedList>
      <GroupedList aria-label="Sessão">
        <Cell label="Sair" icon={<LogOut />} destructive onClick={() => closeThen(onSignOut)} />
      </GroupedList>
    </>
  );
}

export function MaisSheet({ open, onOpenChange, returnFocusRef, ...rest }: MaisSheetProps) {
  return (
    <BottomSheet open={open} onOpenChange={onOpenChange} title="Mais" hideTitle returnFocusRef={returnFocusRef} detents={['large']}>
      <MaisContent {...rest} />
    </BottomSheet>
  );
}
```
(Check `Cell`'s `iconColor` contract in `packages/ios-kit/src/GroupedList.tsx`: it takes a CSS colour string for the tile, which here is data from `nav-items.ts`, not a hex literal in this file. Check how `Cell` renders `switch` rows: the switch must be a `role="switch"` named by the label; adjust the test's query if the kit names it differently, keeping the assertion.)

- [ ] **Step 6: `AdminLayout`**

```tsx
import { Outlet, useLocation } from 'react-router-dom';
import { useAdminAuth } from '../context/AdminAuthContext';
import { BuildPrefetch } from '../components/BuildPrefetch';
import { LiquidBackdrop } from '../liquidglass/LiquidBackdrop';
import { useIsPhone } from '../hooks/useIsPhone';
import { hidesTabBar } from '../lib/nav-items';
import { DesktopSidebar } from '../components/shell/DesktopSidebar';
import { AdminTabBar } from '../components/shell/AdminTabBar';
import { useAdminTheme } from './useAdminTheme';

export default function AdminLayout() {
  const { adminEmail, signOut } = useAdminAuth();
  const { theme, setTheme, toggleTheme, glassEnabled, toggleGlass } = useAdminTheme();
  const isPhone = useIsPhone();
  const { pathname } = useLocation();
  const hideTabs = isPhone && hidesTabBar(pathname);

  // Same element types at the same positions in both modes, so crossing 768px never
  // remounts the route element through the shell.
  return (
    <div
      className={isPhone ? 'phone-kit admin-phone-shell' : 'admin-desktop-shell'}
      data-tab-bar={hideTabs ? 'hidden' : undefined}
    >
      <BuildPrefetch />
      <LiquidBackdrop />
      {!isPhone && (
        <DesktopSidebar
          email={adminEmail}
          theme={theme}
          onToggleTheme={toggleTheme}
          glassEnabled={glassEnabled}
          onToggleGlass={toggleGlass}
          onSignOut={signOut}
        />
      )}
      <main className={isPhone ? 'admin-phone-main' : 'admin-desktop-main'}>
        <div className={isPhone ? undefined : 'admin-desktop-content'}>
          <Outlet />
        </div>
      </main>
      {isPhone && !hideTabs && (
        <AdminTabBar
          email={adminEmail}
          theme={theme}
          onSetTheme={setTheme}
          glassEnabled={glassEnabled}
          onToggleGlass={toggleGlass}
          onSignOut={signOut}
        />
      )}
    </div>
  );
}
```
Note: `{!isPhone && <DesktopSidebar/>}` before `<main>` shifts `main`'s child index when it toggles; React reconciles by position within the parent's children array, and a `false` hole keeps the slot, so `<main>` stays at the same index. Verify with the "keeps the outlet mounted" test.

- [ ] **Step 7: Run tests**

Run: `npx vitest run apps/admin/src/layouts apps/admin/src/__tests__ apps/admin/src/lib` (B2 and B3 run in parallel; their `components/**` tests are theirs). Expected: PASS, including the three original `AdminLayout.test.tsx` tests and the hex test (new shell files contain no hex; `nav-items.ts` is a lib data file and is not scanned).

- [ ] **Step 8: Commit (orchestrator)**

```bash
git add apps/admin/src/layouts apps/admin/src/components/shell/DesktopSidebar.tsx apps/admin/src/components/shell/AdminTabBar.tsx apps/admin/src/components/shell/MaisSheet.tsx apps/admin/src/components/shell/useChromeOffset.ts
git commit -m "feat(admin): glass sidebar on desktop, tab bar + Mais sheet on phones"
```

### Task B5: Shell checkpoint (orchestrator)

- [ ] Run `npx tsc -p apps/admin/tsconfig.json --noEmit && npx vitest run apps/admin packages/ios-kit && npm run lint`.
- [ ] Browser pane: start the Admin (`.claude/launch.json` entry for `npm run dev:admin:env` on :5177), sign in with the seed-login approach (memory `reference_seed_login_browser_verification`), stub edge functions where a page spins. Check `/admin` at 390×844 and 1440×900, glass on and off, dark and light: sidebar groups/tiles, tab bar, Mais sheet, safe areas. Screenshot each.
- [ ] Fix shell issues before fanning out Part C.

---

## Part C: pages (parallel)

All Part C tasks depend on Part B and are independent of each other. Dispatch them in parallel. Each task's agent receives: the spec, this plan's Global Constraints, the **Page task procedure** below, its own task block, and the shell API (Interfaces of B1–B4).

### Page task procedure (every Part C task follows it)

1. `pwd` must print the worktree path and `git branch --show-current` must print `claude/admin-app-ios-redesign-1585fd`; stop otherwise.
2. Read: the spec; your boards in `docs/superpowers/specs/2026-10-12-admin-ios-redesign-boards/` (phone + desktop); your page files; your owned tests; `packages/ios-kit/index.ts` and the source of each kit component you use (props!); `apps/admin/src/components/shell/*`, `PageHeader.tsx`, `src/ios/admin-kit.css`.
3. Write the phone-branch test first (file `pages/__tests__/<Page>.phone.test.tsx`), modelled on the page's existing test (same mocks/fixtures), calling `mockPhone()` in `beforeEach` and restoring in `afterEach`. It asserts: the large title (or nav bar title) is present, the main list renders the fixture rows as links/buttons with their primary text, and the primary action works (opens its sheet, navigates, or calls the mutation spy). Run it; it must FAIL.
4. Restructure the page: keep the default export, the data hooks and every handler in the page file; render `isPhone ? <XPhone {...} /> : <XDesktop {...} />` with views in `pages/<area>/XPhone.tsx` and `pages/<area>/XDesktop.tsx` (file names must end in `Phone.tsx`/`Desktop.tsx` or live under `pages/<area>/phone/` so the hex test scans them). Pass data and handlers down as props; do not duplicate queries.
5. Desktop: match the `Dk*` board using `PageHeader`, `KpiGrid`/`KpiTile`, `GlassPanel`/`Card`, restyled `Table`, `Badge`, `Button`, Tabs or kit `SegmentedControl` (`semantics="tablist"` for sections). Phone: match the iPhone board using `PageHeader` (with `phoneActions` and `back` as the board shows), kit `GroupedList`/`Cell`, `SegmentedControl`, `ChipRow`, `SwipeRow`, `ActionSheet`, `BarList`, `AdminFormSheet`. Leave out any board element whose data the page does not have.
6. Forms that were inline panels or `Dialog`s move into `AdminFormSheet` per the spec: the page keeps its single `<form id=…>` as the sheet's child; remove the form's own Cancel/Save buttons (the sheet header has them); pass `submitting` from the mutation's pending state.
7. Eleven other agents are editing the same worktree right now, so only your own files are your signal. Run the phone test (PASS) and **only your owned test files** plus `apps/admin/src/__tests__/no-hex-literals.test.ts`: `npx vitest run <owned tests> apps/admin/src/__tests__/no-hex-literals.test.ts`. Update owned tests whose queries broke because markup changed, keeping each assertion's behaviour (never delete one). Run `npx tsc -p apps/admin/tsconfig.json --noEmit` and fix every error in your files; list errors in other files as noise in your report, do not touch them. Then `npx prettier --write <your files>` and `npx eslint <your files>`. The orchestrator runs the full gate in D1.
8. Do not edit shared files: `router.tsx`, `main.tsx`, `globals.css`, `ios/admin-kit.css`, `layouts/*`, `components/PageHeader.tsx`, `components/ui/*`, `components/shell/*`, `components/TargetPicker.tsx` (Banners and Popups both use it), `components/KbBulkBar.tsx` and `components/KbViewStats.tsx` (owned by C11 only; C12 consumes them unchanged), `lib/*`, the hex test, `packages/ios-kit`, other tasks' pages and tests. If you need a change there, describe it in your report with the exact diff. Do not commit.
9. Report: files changed, tests added/updated (and why each update preserves behaviour), gate output, anything on the boards you left out and why, requested shared-file changes.

### Task C1: Login

**Files:** `apps/admin/src/pages/LoginPage.tsx` (+ `pages/login/LoginPhone.tsx`/`LoginDesktop.tsx` only if the split helps; a single responsive page is fine here). Tests: `pages/__tests__/LoginPage.test.tsx`, `pages/__tests__/login-error.test.ts`, `src/__tests__/admin-login-flow.test.tsx`; new `pages/__tests__/LoginPage.phone.test.tsx`.
**Boards:** Login, DkLogin. Gold gradient background (already allow-listed hexes `#eaf0dc`, `#eab308` in LoginPage), white glass card (desktop 400px centred; phone full-width with 16px gutters), Mesaas mark, title "Mesaas Admin", subtitle "Acesso restrito à equipe da plataforma", inset grouped E-mail/Senha fields, black "Entrar" button. Keep the existing auth flow and errors. `LoginPage.test.tsx:31-35` queries `getByAltText('Mesaas')` (exactly one image with that alt) and one decorative `alt=""` logo: do **not** add the kit `BrandMark` (also `alt="Mesaas"`) next to the existing logo; keep exactly one `alt="Mesaas"` image. Keep the gold gradient hexes in `pages/LoginPage.tsx` (its ALLOW entry is keyed to that path) or move them to CSS; never into a `*Phone.tsx`/`*Desktop.tsx` file.

### Task C2: Dashboard

**Files:** `pages/DashboardPage.tsx`, `pages/dashboard/RiskCard.tsx`, new `pages/dashboard/DashboardPhone.tsx`, `pages/dashboard/DashboardDesktop.tsx`. Tests: `pages/__tests__/DashboardPage.test.tsx`, `dashboard-risk.test.ts`, `dashboard-export.test.ts`; new `DashboardPage.phone.test.tsx`.
**Boards:** Main, DashboardListas, DashboardClaro, DkMain, DkDashboardClaro.
Desktop: header "Dashboard" / "Visão geral da plataforma" + "Ver métricas" pill; 8 KPI tiles (`KpiGrid` min 220; the existing KPIs, warning tone for "Em risco"); row of two panels: "Atenção" (RiskCard restyled: segmented Todos/Testes/Pendentes if RiskCard already has those filters, grouped sections with counts, rows link to the workspace) and "Workspaces pagantes" table with "Exportar CSV" (existing export). Phone: large title with mark; KPI tiles 2-up; "Atenção" as `GroupedList`s; lists as `Cell` rows linking to `/admin/workspaces/:id`; CSV export desktop-only.

### Task C3: Métricas

**Files:** `pages/MetricasPage.tsx`, `pages/metricas/{RevenueSection,MovementSection,DepositsSection}.tsx`, new `pages/metricas/*Phone.tsx` as needed. Tests: `MetricasPage.test.tsx`, `MetricsSections.test.tsx`, `DepositsSection.test.tsx`, `metrics-view.test.ts`, `deposits-view.test.ts`; new `MetricasPage.phone.test.tsx`.
**Boards:** Metricas, MetricasMovimento, MetricasDepositos, DkMetricas.
Sections switch with a kit `SegmentedControl` (`semantics="tablist"`, Receita · Movimento e churn · Depósitos) in the header (desktop: right of the title; phone: under the large title). Keep the existing section-state mechanism (URL param or state, whichever the page uses). Desktop: KPI row + chart panel ("MRR por mês" with segmented Por provedor/Por plano if the section has it) + side panel; charts keep `lib/chartTheme.ts`. Phone: KPI 2-up, chart full width or `BarList` when the board shows bars, lists as grouped rows. Keep the `window.confirm` in MetricasPage.

### Task C4: Workspaces list

**Files:** `pages/WorkspacesPage.tsx`, `pages/workspaces/{WorkspacesTable,WorkspacesToolbar,WorkspacesFilterChips,WorkspacesPagination}.tsx`, new `pages/workspaces/WorkspacesPhone.tsx` (+ `WorkspacesFiltersSheetPhone.tsx` if needed). Tests: `WorkspacesPage.test.tsx`, `WorkspacesTable.test.tsx`, `WorkspacesToolbar.test.tsx`, `WorkspacesPagination.test.tsx`, `workspaces-*.test.ts`, `hooks/__tests__/useWorkspacesParams.test.tsx`; new `WorkspacesPage.phone.test.tsx`.
**Boards:** Workspaces, WorkspacesFiltros, DkWorkspaces.
Desktop: header with search field, "Filtros" pill, "Exportar CSV"; removable gold filter chips + "Limpar" + count; restyled table in a flush `GlassPanel`; pagination footer. Phone: large title with filter `PhoneIconButton` (badge = active filter count) and search; `ChipRow` of active filters; list header button showing the current sort ("Última atividade ↓") that opens an `ActionSheet` of the existing sort options; rows as `Cell` (avatar letter, name + OVERRIDES badge, e-mail subtitle, plan badge, status line) linking to the detail; filters in `PhoneFiltersSheet`. **Every `set()` call made from inside the open filters sheet passes `{ replace: true }`.** Add this test to the phone test file:
```tsx
it('filter taps inside the sheet replace history instead of pushing', async () => {
  // Render with createMemoryRouter at /admin/workspaces; open the filters sheet; record
  // router.state.historyAction / window.history.length; tap two filter chips; assert the
  // router's last navigation was REPLACE (router.state.historyAction === 'REPLACE') after each tap.
});
```
(write it concretely with the page's fixtures). CSV export stays desktop-only.

### Task C5: Workspace detail

**Files:** `pages/WorkspaceDetailPage.tsx`, `pages/WorkspaceEventsCard.tsx`, `pages/WorkspaceInvitesCard.tsx`, new `pages/workspace-detail/WorkspaceDetailPhone.tsx`, `pages/workspace-detail/WorkspaceDetailDesktop.tsx` (+ sub-views). Tests: `WorkspaceInvitesCard.test.tsx`, `workspace-*.test.ts`; new `WorkspaceDetailPage.phone.test.tsx` (and a desktop render test if none exists, covering the hero and the limits sheet).
**Boards:** WorkspaceDetalhe, WorkspaceDetalhe2, WorkspaceFuncionalidades, WorkspaceLimites, DkWorkspaceDetalhe.
`PageHeader` with `back={{ to: '/admin/workspaces', label: 'Workspaces' }}`; hero (64px avatar letter, name, owner/phone/created line, plan/status/OVERRIDES badges, actions such as "Abrir no Stripe" when the page has that link); usage tiles with progress bars (existing limits data); sections via segmented control on desktop (Visão geral · Funcionalidades · Limites · Membros · Atividade, only the sections the page has) and grouped drill-down rows on phone. The limits and features `Dialog`s (WorkspaceDetailPage ~L521 and ~L558) become `AdminFormSheet`s. They have no `<form>` today (save is an `onClick` on the footer button), so:
- Split today's `closePanel` (~L283) into
  ```ts
  /** True when the panel may close: nothing to lose, or the user confirmed discarding. */
  const confirmDiscard = () => !editsDirty || window.confirm(DISCARD_EDITS_WARNING);
  /** Resets both panels' edits (they share one save payload) and closes. */
  const discardAndClose = () => {
    setResourceEdits(initialEdits.resources);
    setFeatureEdits(initialEdits.features);
    setOpenPanel(null);
  };
  ```
  and pass `canClose={confirmDiscard}` and `onOpenChange={(open) => !open && discardAndClose()}` (the sheet calls `canClose` first on every dismiss path, so the confirm runs once). Every other caller of `closePanel` uses `() => confirmDiscard() && discardAndClose()`.
- Wrap each panel body in `<form id="ws-limits-form">` / `<form id="ws-features-form">` with `onSubmit={(e) => { e.preventDefault(); saveMutation.mutate(); }}` (use the real mutation name), so the sheet header "Salvar" submits it; `submitting={saveMutation.isPending}`. The other footer actions (e.g. clear overrides) stay as buttons (`type="button"`) at the end of the body. The save's `onSuccess` keeps closing with `setOpenPanel(null)` directly (no confirm after a save).
- Test (desktop and phone): with an edited limit, Cancelar triggers `window.confirm` once (spy returns false → sheet stays open, edits kept; returns true → sheet closes, edits reset); "Salvar" calls the save mutation.
Keep both `window.confirm` calls in WorkspaceInvitesCard.

### Task C6: Plans

**Files:** `pages/PlansPage.tsx`, new `pages/plans/PlansPhone.tsx`, `pages/plans/PlansDesktop.tsx`, `pages/plans/PlanFormFields.tsx` (shared form body). Tests: `plan-form.test.ts`; new `PlansPage.test.tsx` (desktop: cards render, "Novo plano" opens the sheet, submitting calls the mutation) and `PlansPage.phone.test.tsx`.
**Boards:** Planos, PlanoForm, DkPlanos, DkPlanoForm.
Desktop: header + "Novo plano" gold pill; auto-fit grid of plan cards (colour dot from `lib/plan-colors.ts`, name, badges PADRÃO/12X/INATIVO from existing fields, price line, limits checklist, "N de 25 funcionalidades" with progress bar, workspace count when available); clicking a card opens the edit sheet. The inline `showForm` panel (~L116) moves into `AdminFormSheet` (`width="md"`, title "Editar: {nome}" or "Novo plano", `submitLabel` "Atualizar"/"Criar"); the form body (`<form id="plan-form">`) is shared by both branches; on desktop it uses a segmented control for its sections only if the form already groups fields that way, otherwise it is a single scroll. Phone: grouped list of plans (Cell with colour tile, subtitle limits line) + "+" `PhoneIconButton`; same sheet.

### Task C7: Affiliates

**Files:** `pages/AffiliatesPage.tsx`, `pages/AffiliateDetailPage.tsx`, `pages/affiliates/CommissionRulesCard.tsx`, new `pages/affiliates/*Phone.tsx`/`*Desktop.tsx`. Tests: `AffiliatesPage.test.tsx`; new `AffiliatesPage.phone.test.tsx`, `AffiliateDetailPage.phone.test.tsx`.
**Boards:** Afiliados, Comissoes, AfiliadoDetalhe, DkAfiliados, DkAfiliadoDetalhe.
List desktop: KPI row from existing totals, table "Por saldo disponível" (avatar initials, code, indications, subscribers, payout status badge, available) + "Tabela de comissões" side panel (CommissionRulesCard restyled, its edit flow unchanged). List phone: rules summary cell, grouped affiliate rows. Detail: `back` to Afiliados; hero (initials avatar, name + status badge, e-mail · código · desde, actions incl. "Suspender" as destructive if it exists); KPI tiles; desktop: segmented Indicações · Comissões · Repasses with the existing tables + "Repasse (Stripe Connect)" side panel; phone: the same as grouped lists with a segmented control.

### Task C8: Admins + Integrations

**Files:** `pages/AdminsPage.tsx`, `pages/IntegrationsPage.tsx`, new views as needed. Tests: `AdminsPage.test.tsx`, `IntegrationsPage.test.tsx`; new `AdminsPage.phone.test.tsx`, `IntegrationsPage.phone.test.tsx`.
**Boards:** Admins, Integracoes, DkAdmins, DkIntegracoes.
Admins desktop (`max-w` ~860 via a wrapper): "Convidar" panel (e-mail input + gold "Convidar" + help line), table of admins (avatar letter, e-mail, "por …", date, "Remover" tinted button or "VOCÊ" badge). Admins phone: invite group (FormRow-style input + button), list where each removable row is a `SwipeRow` with a "Remover" action calling the same handler (which keeps any existing confirm); footer hint "Deslize um admin para a esquerda para remover."; also keep a visible way to remove for accessibility (a trailing button or the `SwipeRow`'s accessible action, check the kit). Integrations: connector URL panel with "Copiar", "Como conectar" segmented (claude.ai · Claude Code · Codex) with numbered steps from the existing copy, permissions chips, "Conexões autorizadas" table/list with "Revogar" (existing `window.confirm` kept).

### Task C9: Banners

**Files:** `pages/BannersPage.tsx`, new `pages/banners/BannersPhone.tsx`, `pages/banners/BannersDesktop.tsx`, `pages/banners/BannerFormFields.tsx`. Tests: new `BannersPage.test.tsx` (desktop list + open form + submit) and `BannersPage.phone.test.tsx`; `components/__tests__/TargetPicker.test.tsx` must keep passing.
**Boards:** Banners, BannerForm, DkBanners.
Header + segmented filter (Todos · Ativos · Rascunhos · Arquivo, only states the data has) + "Novo banner". Desktop: list panel, each row = type + status badges, the banner preview strip (existing `BannerPreview`), Público/Período/Alcance meta (only fields that exist), "Editar" pill + more menu (existing actions). Phone: cards in a grouped list, "+" action. The inline form (~L338) moves into `AdminFormSheet` (`width="md"`) with `TargetPicker` inside; keep its behaviour.

### Task C10: Popups

**Files:** `pages/PopupsPage.tsx`, new `pages/popups/PopupsPhone.tsx`, `pages/popups/PopupsDesktop.tsx`, `pages/popups/PopupEditorBody.tsx` (the existing PopupEditor moved/restyled). Tests: `PopupsPage.test.tsx`, `popup-form.test.ts`; new `PopupsPage.phone.test.tsx`.
**Boards:** Popups, PopupEditor, DkPopupEditor.
List: header + segmented filter + "Novo popup"; desktop table (popup, pages, audience, status) / phone grouped list. Editor (inline at ~L443 today) moves into `AdminFormSheet` `width="xl"`: desktop three columns (page list with dnd-kit ordering + "+ Página", form, live `PopupCard` preview from `@mesaas/ui/PopupCard`), segmented Páginas · Configurações; phone: segmented Páginas · Configurações · Prévia. dnd-kit drag handles get `data-dnd-handle` (admin-kit.css sets `touch-action: none`). Keep upload, ordering, validation (`popup-form.ts`) and the `window.confirm`.

### Task C11: KB Articles

**Files:** `pages/KbArticlesPage.tsx`, `pages/KbArticleEditorPage.tsx`, `components/KbBulkBar.tsx` (the list's selection bar: replace its body with `SelectionBar` from shell, keep its props/behaviour), `components/KbViewStats.tsx` (restyle only), new `pages/kb-articles/*Phone.tsx`/`*Desktop.tsx`. Do not change `components/editor/*` behaviour (styling of its toolbar wrapper is fine). Tests: `KbArticlesPage.test.tsx`, `components/__tests__/KbViewStats.test.tsx`, `kb-bulk.test.ts`; new `KbArticlesPage.phone.test.tsx`, `KbArticleEditorPage.phone.test.tsx`.
**Boards:** Artigos, ArtigoEditor, DkArtigos, DkArtigoEditor.
List: header (count subtitle), segmented Todos · Publicados · Rascunhos (only if the page filters that way; keep its current filter controls otherwise), grouped by category with "Selecionar todos", row = selection circle + title + status badge + views; selection mode with `SelectionBar` (Publicar N · Despublicar · other existing bulk actions). Editor desktop: `PageHeader` `back` Artigos, subtitle with save state, actions (Visualizar if it exists, Publicar, Salvar gold); two columns: editor surface with formatting toolbar (existing TipTap `ArticleEditor`) and side panels Detalhes (slug, categoria, status, resumo) and Contexto (routes chips), using existing fields only. The desktop editor root carries `data-admin-wide` (widens the content to 1180px via admin-kit.css). Editor phone: `AdminNavBar` with Salvar, segmented Conteúdo · Detalhes · Contexto, the editor full width; the tab bar is hidden by the shell. Keep the `window.confirm` and `trackUnsavedWork` uploads.

### Task C12: KB Videos

**Files:** `pages/KbVideosPage.tsx`, `pages/KbVideoEditorPage.tsx`, `pages/kb-videos/SeriesDialog.tsx` (→ `AdminFormSheet`), new `pages/kb-videos/*Phone.tsx`/`*Desktop.tsx`. Tests: `KbVideosPage.test.tsx`, `KbVideoEditorPage.test.tsx`, `kb-videos/__tests__/SeriesDialog.test.tsx`, `kb-video-status.test.ts`, `stream-upload.test.ts`; new `KbVideosPage.phone.test.tsx`.
**Boards:** Videos, VideoEditor, DkVideos.
List desktop: header + "Selecionar" + "Nova série"; per series a section (name + status badge + "Editar série" + "Enviar vídeo"), grid of video cards (16:9 thumbnail with duration, title, status + processing badges, stats). Phone: per series a grouped list of video rows (thumbnail, title, badges, stats). `SeriesDialog` becomes an `AdminFormSheet` keeping its form and its `window.confirm`. Editor: desktop `PageHeader` `back` Vídeos with Salvar, root carries `data-admin-wide`; phone `AdminNavBar` (tab bar hidden by shell); keep upload (`trackUnsavedWork`), status polling, delete confirm.

---

## Part D: Integration (orchestrator)

### Task D1: Gates, review, browser sweep, PR

- [ ] After each Part C agent reports: review its diff against its boards and the procedure (spec compliance first, then code quality), apply requested shared-file changes, commit its files with explicit paths: `git commit -m "feat(admin): <page> in the iOS idiom (phone + desktop)"`.
- [ ] Full gates:
```bash
npm run lint
npm run format:check
npx tsc -p apps/crm/tsconfig.json --noEmit
npx tsc -p apps/hub/tsconfig.json --noEmit
npx tsc -p apps/admin/tsconfig.json --noEmit
npx tsc -p tsconfig.scripts.json
npm run test
npm run coverage:check
npm run check:functions
npm run test:functions
ls node_modules/.deno 2>/dev/null && npm ci
```
- [ ] `grep -rn "—" apps/admin/src --include='*.tsx' | grep -v "^\s*//"` → no em-dash in user-facing strings added by this branch (`git diff main -- apps/admin | grep '^+' | grep '—'`).
- [ ] Browser pane sweep: every route at 390×844 and 1440×900, glass on (dark), glass off dark, glass off light; open every sheet once; screenshot each route at both widths; fix regressions.
- [ ] Playwright WebKit smoke at 390px for the tab bar, Mais sheet and one form sheet (memory `reference_webkit_playwright_ios_repro`).
- [ ] Final whole-branch review (one fresh reviewer on the most capable model) before the PR.
- [ ] Push and open the PR (`gh pr create`), body: summary, Part A called out as a separately reviewable pure-move commit, screenshots, test plan; end with the attribution line. Then `ccd_pr` `get_status`/`bind_pr`.
