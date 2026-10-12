# Desktop "Visual novo" Level 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An opt-in, per-browser "Visual novo (beta)" toggle that gives desktop CRM pages (≥1101px) the iOS look of the phone redesign (grey canvas, borderless white groups, large titles, segmented controls, pill buttons) while toggle-off stays pixel-identical to today.

**Architecture:** A tiny module (`lib/visualLook.ts`) mirrors `localStorage['look']` to `<html data-look="ios">`, applied before first paint by the inline script in `apps/crm/index.html`, toggled from the sidebar user menu. One ordinary stylesheet (`src/styles/visual-novo.css`, no `@layer`) imported after `style.css` restyles shared selectors; every rule sits in `@media (min-width: 1101px)` and every selector starts with `html[data-look='ios']`, enforced by a postcss contract test.

**Tech Stack:** React 19, Vite, plain CSS, Vitest + Testing Library (jsdom), postcss (already a dependency), react-i18next (`packages/i18n`), PostHog via `lib/analytics.ts`.

**Spec:** `docs/superpowers/specs/2026-10-12-desktop-visual-novo-l1-design.md` (approved 2026-10-12). Mockups: https://claude.ai/artifact/Bt1KGGC2PLjqyH2QmVKGUo (board "Início · Nível 1").

## Global Constraints

- Stored values: `localStorage['look']` is `'ios'` (on) or `'classic'` (explicit off); absent = never chose; default for never chose is off (`VISUAL_NOVO_DEFAULT = false`). Turning off writes `'classic'`, never removes the key.
- Attribute: `<html data-look="ios">` when on; attribute absent when off.
- Width: every override rule inside `@media (min-width: 1101px)`. Nothing changes below 1101px, on phones, in the Hub or the Admin.
- Selectors: every selector's first compound is `html` carrying `[data-look='ios']` (light: `html[data-look='ios'] .app-container …`; dark: `html[data-theme='dark'][data-look='ios'] .app-container …`). No `!important`, no `@layer`.
- Toggle-off must be pixel-identical: new attributes (`data-slot`) and the new class (`header--section`) must not be read by any base CSS.
- Copy: pt-BR "Visual novo (beta)", en "New look (beta)". No em dashes in user-facing copy.
- Tokens: `--vn-canvas #f2f2f7 / #0a0c0f`, `--vn-group #ffffff / #12151a`, `--vn-fill rgba(118,118,128,.12) / rgba(118,118,128,.24)`, `--vn-thumb #ffffff / #3a404d`, `--vn-radius-group 16px`, `--vn-title 34px` (light / dark).
- Pill buttons apply to exactly: `[data-slot='button']`, `.btn-primary`, `.btn-secondary`, `.btn-danger`, `.btn-danger-outline`, `.btn-icon`, `.btn-icon--danger`, `.btn-upgrade`. Not to `.btn-confirmar`, `.btn-complete-etapa`, `.btn-revert-etapa`, `.btn-edit-workflow`, `.btn-remove-member`, `.btn-instagram-action*`, `.btn-integration`.
- Analytics: one event, `visual_novo_toggled` with `{ on: boolean }`.
- Gates before pushing (CLAUDE.md): `npm run lint`, `npm run format:check`, `npx tsc -p apps/crm/tsconfig.json --noEmit`, `npx tsc -p apps/hub/tsconfig.json --noEmit`, `npx tsc -p apps/admin/tsconfig.json --noEmit`, `npx tsc -p tsconfig.scripts.json`, `npm run test`.
- All commands run from the worktree root: `/Users/eduardosouza/projects/sm-crm/.claude/worktrees/desktop-ios-macos-previews-ce1e35`. Vitest resolves file paths in tests relative to that root (`readFileSync('apps/crm/...')`).

## Review Focus

1. `localStorage` throws (Safari private mode, blocked storage) → toggling still applies the look for the session, no crash. Pinned in Task 1.
2. A junk stored value (`'true'`, `'1'`, `'IOS'`) → treated as off, both in the module and the pre-paint script. Pinned in Tasks 1 and 2.
3. Toggle on, window between 768 and 1100px (drawer sidebar) → today's look, and the drawer menu shows no toggle. Pinned in Tasks 3 (no item in drawer) and 5 (contract: every rule in the 1101px block).
4. Toggle off → no override rule can match. Pinned in Task 5 (contract: every selector requires `[data-look='ios']` on `html`).
5. `asChild` Buttons (links styled as buttons) → still become pills. Pinned in Task 4.

---

## File map

| File | Change | Responsibility |
|---|---|---|
| `apps/crm/src/lib/visualLook.ts` | create | Read/apply/store the look; the "never chose" rule |
| `apps/crm/src/lib/__tests__/visualLook.test.ts` | create | Module tests |
| `apps/crm/index.html` | modify (pre-paint script) | Apply `data-look` before first paint |
| `apps/crm/src/__tests__/visualNovoPrePaint.test.ts` | create | Runs the inline script in jsdom |
| `apps/crm/src/components/layout/Sidebar.tsx` | modify | Menu item, state, analytics |
| `apps/crm/src/lib/analytics.ts` | modify | Add `'visual_novo_toggled'` to `AnalyticsEvent` |
| `packages/i18n/locales/pt/common.json`, `.../en/common.json` | modify | `sidebar.visualNovo` |
| `apps/crm/src/components/layout/__tests__/Sidebar.test.tsx` | modify | Toggle tests |
| `apps/crm/src/components/ui/button.tsx`, `tabs.tsx` | modify | `data-slot` hooks |
| `apps/crm/src/components/ui/__tests__/dataSlots.test.tsx` | create | data-slot tests |
| `apps/crm/src/pages/dashboard/components/ClientHealthMonitor.tsx` | modify | `header--section` marker |
| `apps/crm/src/styles/visual-novo.css` | create | The override sheet |
| `apps/crm/src/main.tsx` | modify | Import the sheet after `style.css` |
| `apps/crm/src/__tests__/visualNovoContracts.test.ts` | create | CSS contract test |

---

### Task 1: `visualLook` module

**Files:**
- Create: `apps/crm/src/lib/visualLook.ts`
- Test: `apps/crm/src/lib/__tests__/visualLook.test.ts`

**Interfaces:**
- Produces: `LOOK_STORAGE_KEY = 'look'`, `VISUAL_NOVO_DEFAULT = false`, `shouldApplyVisualNovo(stored: string | null): boolean`, `isVisualNovoOn(): boolean`, `setVisualNovo(on: boolean): void`.

- [ ] **Step 1: Write the failing test**

Create `apps/crm/src/lib/__tests__/visualLook.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LOOK_STORAGE_KEY,
  VISUAL_NOVO_DEFAULT,
  isVisualNovoOn,
  setVisualNovo,
  shouldApplyVisualNovo,
} from '../visualLook';

describe('visualLook', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-look');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('applies only for the exact stored value "ios"; a missing key falls back to the default', () => {
    expect(shouldApplyVisualNovo('ios')).toBe(true);
    expect(shouldApplyVisualNovo('classic')).toBe(false);
    expect(shouldApplyVisualNovo(null)).toBe(VISUAL_NOVO_DEFAULT);
    expect(VISUAL_NOVO_DEFAULT).toBe(false);
    for (const junk of ['true', '1', 'IOS', '', ' ios']) {
      expect(shouldApplyVisualNovo(junk)).toBe(false);
    }
  });

  it('reads the state from the attribute on <html>', () => {
    expect(isVisualNovoOn()).toBe(false);
    document.documentElement.setAttribute('data-look', 'ios');
    expect(isVisualNovoOn()).toBe(true);
  });

  it('turning on sets the attribute and stores "ios"', () => {
    setVisualNovo(true);
    expect(document.documentElement.getAttribute('data-look')).toBe('ios');
    expect(localStorage.getItem(LOOK_STORAGE_KEY)).toBe('ios');
    expect(isVisualNovoOn()).toBe(true);
  });

  it('turning off removes the attribute and stores "classic" (an explicit opt-out, never a removed key)', () => {
    setVisualNovo(true);
    setVisualNovo(false);
    expect(document.documentElement.hasAttribute('data-look')).toBe(false);
    expect(localStorage.getItem(LOOK_STORAGE_KEY)).toBe('classic');
    expect(isVisualNovoOn()).toBe(false);
  });

  it('still applies the attribute when localStorage throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => setVisualNovo(true)).not.toThrow();
    expect(document.documentElement.getAttribute('data-look')).toBe('ios');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/crm/src/lib/__tests__/visualLook.test.ts`
Expected: FAIL, cannot resolve `../visualLook`.

- [ ] **Step 3: Write the implementation**

Create `apps/crm/src/lib/visualLook.ts`:

```ts
/**
 * "Visual novo" (desktop level 1): a per-browser opt-in mirrored to <html data-look="ios">,
 * the same pattern as the theme toggle (localStorage 'theme' + data-theme). The look itself is
 * src/styles/visual-novo.css. Spec: docs/superpowers/specs/2026-10-12-desktop-visual-novo-l1-design.md
 *
 * Stored as 'ios' (on) or 'classic' (explicit off). A missing key means the user never chose and
 * falls back to VISUAL_NOVO_DEFAULT, so flipping the default at launch keeps every explicit opt-out.
 * apps/crm/index.html applies the same rule before first paint; keep the two in step
 * (src/__tests__/visualNovoPrePaint.test.ts checks they agree).
 */
export const LOOK_STORAGE_KEY = 'look';
export const VISUAL_NOVO_DEFAULT = false;

export function shouldApplyVisualNovo(stored: string | null): boolean {
  if (stored === null) return VISUAL_NOVO_DEFAULT;
  return stored === 'ios';
}

/** Reads the applied state from the DOM, so a caller can never disagree with what is on screen. */
export function isVisualNovoOn(): boolean {
  return document.documentElement.getAttribute('data-look') === 'ios';
}

export function setVisualNovo(on: boolean): void {
  if (on) document.documentElement.setAttribute('data-look', 'ios');
  else document.documentElement.removeAttribute('data-look');
  try {
    localStorage.setItem(LOOK_STORAGE_KEY, on ? 'ios' : 'classic');
  } catch {
    // Blocked or full storage (Safari private mode): the look still applies to this page load.
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/crm/src/lib/__tests__/visualLook.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/lib/visualLook.ts apps/crm/src/lib/__tests__/visualLook.test.ts
git commit -m "feat(crm): visualLook module for the desktop Visual novo toggle

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Pre-paint script

**Files:**
- Modify: `apps/crm/index.html` (the inline script under `<!-- Apply dark theme before React hydrates to avoid flash -->`, currently lines 16-24)
- Test: `apps/crm/src/__tests__/visualNovoPrePaint.test.ts`

**Interfaces:**
- Consumes: `shouldApplyVisualNovo` from Task 1 (the test cross-checks the inline script against it).

- [ ] **Step 1: Write the failing test**

Create `apps/crm/src/__tests__/visualNovoPrePaint.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { shouldApplyVisualNovo } from '../lib/visualLook';

// The first inline <script> in index.html is the pre-paint IIFE that applies data-theme
// (and now data-look) before React mounts. Run its first statement (the IIFE) in jsdom.
const html = readFileSync('apps/crm/index.html', 'utf8');
const script = html.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1] ?? '';
const prePaint = script.slice(0, script.indexOf('})();') + '})();'.length);

function runPrePaint() {
  new Function(prePaint)();
}

describe('index.html pre-paint script and data-look', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-look');
    document.documentElement.removeAttribute('data-theme');
  });

  it('was found', () => {
    expect(prePaint).toContain("localStorage.getItem('theme')");
    expect(prePaint).toContain("localStorage.getItem('look')");
  });

  it.each([null, 'ios', 'classic', 'true', '1', 'IOS'])(
    'agrees with shouldApplyVisualNovo for stored %s',
    (stored) => {
      if (stored !== null) localStorage.setItem('look', stored);
      runPrePaint();
      expect(document.documentElement.getAttribute('data-look') === 'ios').toBe(
        shouldApplyVisualNovo(stored),
      );
    },
  );

  it('still applies the dark theme', () => {
    localStorage.setItem('theme', 'dark');
    runPrePaint();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/crm/src/__tests__/visualNovoPrePaint.test.ts`
Expected: FAIL on "was found" (no `localStorage.getItem('look')` yet) and on the `'ios'` case.

- [ ] **Step 3: Edit the inline script**

In `apps/crm/index.html` replace:

```html
    <!-- Apply dark theme before React hydrates to avoid flash -->
    <script>
      (function() {
        const hash = window.location.hash;
        if (hash === '#/' || hash === '#/login') return;
        if (localStorage.getItem('theme') === 'dark') {
          document.documentElement.setAttribute('data-theme', 'dark');
        }
      })();
```

with:

```html
    <!-- Apply dark theme and the Visual novo look before React hydrates to avoid flash -->
    <script>
      (function() {
        const hash = window.location.hash;
        if (hash === '#/' || hash === '#/login') return;
        if (localStorage.getItem('theme') === 'dark') {
          document.documentElement.setAttribute('data-theme', 'dark');
        }
        // Same rule as shouldApplyVisualNovo in src/lib/visualLook.ts: only the exact value
        // 'ios' turns it on; a missing key means "never chose" (VISUAL_NOVO_DEFAULT, off today).
        if (localStorage.getItem('look') === 'ios') {
          document.documentElement.setAttribute('data-look', 'ios');
        }
      })();
```

Leave everything after `})();` (the standalone/iOS block) untouched.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/crm/src/__tests__/visualNovoPrePaint.test.ts && npx eslint apps/crm/src/__tests__/visualNovoPrePaint.test.ts`
Expected: PASS (8 tests) and no lint errors. If ESLint reports `no-new-func` on `new Function(prePaint)()`, add `// eslint-disable-next-line no-new-func -- runs index.html's inline pre-paint script verbatim` on the line above it.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/index.html apps/crm/src/__tests__/visualNovoPrePaint.test.ts
git commit -m "feat(crm): apply the Visual novo look before first paint

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Sidebar menu item, i18n and analytics event

**Files:**
- Modify: `apps/crm/src/components/layout/Sidebar.tsx` (imports at the top; state near `isDark` at ~line 61; `toggleTheme` at ~line 146; the user dropdown theme button at ~lines 461-470)
- Modify: `apps/crm/src/lib/analytics.ts` (the `AnalyticsEvent` union starting at line 9)
- Modify: `packages/i18n/locales/pt/common.json`, `packages/i18n/locales/en/common.json` (the `sidebar` object, after `"darkMode"` at line 47)
- Test: `apps/crm/src/components/layout/__tests__/Sidebar.test.tsx`

**Interfaces:**
- Consumes: `isVisualNovoOn()`, `setVisualNovo(on)` from Task 1 (`@/lib/visualLook`); `captureEvent(event, props?)` from `@/lib/analytics`.
- Produces: the menu item labelled `t('sidebar.visualNovo')`, rendered only when the sidebar is not a drawer.

- [ ] **Step 1: Write the failing tests**

In `apps/crm/src/components/layout/__tests__/Sidebar.test.tsx`:

Add this mock next to the other `vi.mock` calls at the top of the file:

```ts
vi.mock('@/lib/analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/analytics')>()),
  captureEvent: vi.fn(),
}));
```

Add this import with the other imports (after the `vi.mock` block):

```ts
import { captureEvent } from '@/lib/analytics';
```

In the `beforeEach` of `describe('Sidebar', …)`, after `document.documentElement.removeAttribute('data-theme');`, add:

```ts
    document.documentElement.removeAttribute('data-look');
    vi.mocked(captureEvent).mockClear();
```

Add these tests inside `describe('Sidebar', …)`, after the theme-toggle test:

```ts
  it('toggles the Visual novo look from the user menu and tracks it', () => {
    setAuth();
    renderSidebar('/dashboard');

    fireEvent.click(screen.getByText('Ana Maria'));
    const item = screen.getByText('Visual novo (beta)').closest('button')!;
    expect(item).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(item);
    expect(document.documentElement).toHaveAttribute('data-look', 'ios');
    expect(localStorage.getItem('look')).toBe('ios');
    expect(item).toHaveAttribute('aria-pressed', 'true');
    expect(item.querySelector('.user-dropdown-item-check')).not.toBeNull();
    expect(captureEvent).toHaveBeenLastCalledWith('visual_novo_toggled', { on: true });

    fireEvent.click(item);
    expect(document.documentElement).not.toHaveAttribute('data-look');
    expect(localStorage.getItem('look')).toBe('classic');
    expect(item).toHaveAttribute('aria-pressed', 'false');
    expect(item.querySelector('.user-dropdown-item-check')).toBeNull();
    expect(captureEvent).toHaveBeenLastCalledWith('visual_novo_toggled', { on: false });
  });

  it('starts checked when the look is already applied', () => {
    document.documentElement.setAttribute('data-look', 'ios');
    setAuth();
    renderSidebar('/dashboard');

    fireEvent.click(screen.getByText('Ana Maria'));
    expect(screen.getByText('Visual novo (beta)').closest('button')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('does not offer the Visual novo toggle in the drawer (the look only applies from 1101px)', () => {
    setAuth();
    renderSidebar('/dashboard', { isDrawer: true, isOpen: true, onClose: vi.fn() });

    fireEvent.click(screen.getByText('Ana Maria'));
    expect(screen.getByText('Modo Escuro')).toBeInTheDocument();
    expect(screen.queryByText('Visual novo (beta)')).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run apps/crm/src/components/layout/__tests__/Sidebar.test.tsx`
Expected: the two new toggle tests FAIL (no "Visual novo (beta)" text); the drawer test passes vacuously; existing tests pass.

- [ ] **Step 3: Add the event to the analytics union**

In `apps/crm/src/lib/analytics.ts`, inside `export type AnalyticsEvent =` (line 9), add a member right after `| 'client_created'`:

```ts
  // Desktop "Visual novo" beta toggle in the sidebar user menu ({ on: boolean }).
  | 'visual_novo_toggled'
```

- [ ] **Step 4: Add the i18n strings**

In `packages/i18n/locales/pt/common.json`, after the line `"darkMode": "Modo Escuro",` add:

```json
    "visualNovo": "Visual novo (beta)",
```

In `packages/i18n/locales/en/common.json`, after `"darkMode": "Dark Mode",` add:

```json
    "visualNovo": "New look (beta)",
```

- [ ] **Step 5: Wire the Sidebar**

In `apps/crm/src/components/layout/Sidebar.tsx`:

Add imports after `import { GuideNavItem } from '../guide/GuidePill';`:

```ts
import { isVisualNovoOn, setVisualNovo } from '@/lib/visualLook';
import { captureEvent } from '@/lib/analytics';
```

Right after the `isDark` state:

```ts
  const [isDark, setIsDark] = useState(
    document.documentElement.getAttribute('data-theme') === 'dark',
  );
```

add:

```ts
  const [visualNovo, setVisualNovoState] = useState(isVisualNovoOn);
```

Right after the `toggleTheme` function, add:

```ts
  const toggleVisualNovo = () => {
    const next = !visualNovo;
    setVisualNovo(next);
    setVisualNovoState(next);
    captureEvent('visual_novo_toggled', { on: next });
  };
```

In the user dropdown, directly after the theme button (the `<button className="user-dropdown-item" …>` whose label is `isDark ? t('sidebar.lightMode') : t('sidebar.darkMode')`), add:

```tsx
                {!isDrawer && (
                  <button
                    className="user-dropdown-item"
                    aria-pressed={visualNovo}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleVisualNovo();
                    }}
                  >
                    <i className="ph-bold ph-sparkle" />
                    <span>{t('sidebar.visualNovo')}</span>
                    {visualNovo && <i className="ph-bold ph-check user-dropdown-item-check" />}
                  </button>
                )}
```

(`isDrawer` is already a prop of `Sidebar`; the drawer is the 768-1100px layout where the look never applies.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run apps/crm/src/components/layout/__tests__/Sidebar.test.tsx`
Expected: PASS, including the 3 new tests.

- [ ] **Step 7: Commit**

```bash
git add apps/crm/src/components/layout/Sidebar.tsx apps/crm/src/lib/analytics.ts packages/i18n/locales/pt/common.json packages/i18n/locales/en/common.json apps/crm/src/components/layout/__tests__/Sidebar.test.tsx
git commit -m "feat(crm): Visual novo (beta) toggle in the desktop user menu

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `data-slot` hooks and the section-header marker

**Files:**
- Modify: `apps/crm/src/components/ui/button.tsx` (the `Comp` render in `Button`)
- Modify: `apps/crm/src/components/ui/tabs.tsx` (`TabsList`, `TabsTrigger`)
- Modify: `apps/crm/src/pages/dashboard/components/ClientHealthMonitor.tsx:36` (`<header className="header animate-up">`)
- Test: `apps/crm/src/components/ui/__tests__/dataSlots.test.tsx`

**Interfaces:**
- Produces: `[data-slot='button']` on every shadcn Button root (including `asChild` children), `[data-slot='tabs-list']`, `[data-slot='tabs-trigger']` (Radix keeps `data-state="active"` on the active trigger), and the class `header--section` on the "Saúde dos clientes" header. Task 5's CSS targets these.

- [ ] **Step 1: Confirm nothing in the base CSS reads the new hooks**

Run: `grep -rn "data-slot\|header--section" apps/crm/style.css apps/crm/src --include='*.css'`
Expected: no output. (If anything matches, stop: toggle-off would no longer be pixel-identical.)

- [ ] **Step 2: Write the failing test**

Create `apps/crm/src/components/ui/__tests__/dataSlots.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Button } from '../button';
import { Tabs, TabsList, TabsTrigger } from '../tabs';

describe('data-slot hooks for the Visual novo sheet', () => {
  it('marks the Button root', () => {
    render(<Button>Salvar</Button>);
    expect(screen.getByRole('button', { name: 'Salvar' })).toHaveAttribute('data-slot', 'button');
  });

  it('passes the mark through asChild', () => {
    render(
      <Button asChild>
        <a href="/clientes">Abrir</a>
      </Button>,
    );
    expect(screen.getByRole('link', { name: 'Abrir' })).toHaveAttribute('data-slot', 'button');
  });

  it('marks the tabs list and triggers, with Radix data-state on the active one', () => {
    render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">Geral</TabsTrigger>
          <TabsTrigger value="b">Instagram</TabsTrigger>
        </TabsList>
      </Tabs>,
    );
    expect(screen.getByRole('tablist')).toHaveAttribute('data-slot', 'tabs-list');
    const active = screen.getByRole('tab', { name: 'Geral' });
    expect(active).toHaveAttribute('data-slot', 'tabs-trigger');
    expect(active).toHaveAttribute('data-state', 'active');
    expect(screen.getByRole('tab', { name: 'Instagram' })).toHaveAttribute(
      'data-slot',
      'tabs-trigger',
    );
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run apps/crm/src/components/ui/__tests__/dataSlots.test.tsx`
Expected: FAIL (no `data-slot` attributes).

- [ ] **Step 4: Add the hooks**

In `apps/crm/src/components/ui/button.tsx` replace:

```tsx
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
```

with:

```tsx
      <Comp
        data-slot="button"
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
```

In `apps/crm/src/components/ui/tabs.tsx`, in `TabsList` change `<TabsPrimitive.List` + `ref={ref}` to:

```tsx
  <TabsPrimitive.List
    ref={ref}
    data-slot="tabs-list"
```

and in `TabsTrigger`:

```tsx
  <TabsPrimitive.Trigger
    ref={ref}
    data-slot="tabs-trigger"
```

(keep `className` and `{...props}` exactly as they are, after these lines.)

In `apps/crm/src/pages/dashboard/components/ClientHealthMonitor.tsx` replace:

```tsx
      <header className="header animate-up">
```

with:

```tsx
      {/* header--section: a mid-page section heading, not the page title. The Visual novo
          sheet (src/styles/visual-novo.css) skips it when enlarging page titles. */}
      <header className="header header--section animate-up">
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run apps/crm/src/components/ui/__tests__/dataSlots.test.tsx apps/crm/src/pages/dashboard`
Expected: PASS (the dashboard suites still pass; nothing asserts the header's exact class list).

- [ ] **Step 6: Commit**

```bash
git add apps/crm/src/components/ui/button.tsx apps/crm/src/components/ui/tabs.tsx apps/crm/src/components/ui/__tests__/dataSlots.test.tsx apps/crm/src/pages/dashboard/components/ClientHealthMonitor.tsx
git commit -m "feat(crm): data-slot hooks on Button and Tabs, section marker on the health header

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The override sheet and its contract test

**Files:**
- Create: `apps/crm/src/styles/visual-novo.css`
- Modify: `apps/crm/src/main.tsx:26` (after `import '../style.css';`)
- Test: `apps/crm/src/__tests__/visualNovoContracts.test.ts`

**Interfaces:**
- Consumes: `data-look` (Tasks 1-2), `[data-slot='button' | 'tabs-list' | 'tabs-trigger']` and `.header--section` (Task 4).

- [ ] **Step 1: Write the failing contract test**

Create `apps/crm/src/__tests__/visualNovoContracts.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import postcss, { type AtRule } from 'postcss';
import { describe, expect, it } from 'vitest';

const SHEET = 'apps/crm/src/styles/visual-novo.css';
const css = readFileSync(SHEET, 'utf8');
const root = postcss.parse(css);

describe('Visual novo sheet contracts', () => {
  it('is an ordinary stylesheet: no @layer (an unlayered base rule would beat a layered override)', () => {
    let layers = 0;
    root.walkAtRules('layer', () => {
      layers += 1;
    });
    expect(layers).toBe(0);
  });

  it('has exactly one top-level block, @media (min-width: 1101px), holding every rule', () => {
    const blocks = root.nodes.filter((node) => node.type !== 'comment');
    expect(blocks).toHaveLength(1);
    const media = blocks[0] as AtRule;
    expect(media.type).toBe('atrule');
    expect(media.name).toBe('media');
    expect(media.params.replace(/\s+/g, ' ')).toBe('(min-width: 1101px)');
    root.walkRules((rule) => {
      expect(rule.parent).toBe(media);
    });
  });

  it('starts every selector with html carrying [data-look=ios], so nothing matches with the toggle off', () => {
    let count = 0;
    root.walkRules((rule) => {
      for (const selector of rule.selectors) {
        const first = selector.trim().split(/\s+/)[0];
        expect(first, selector).toMatch(/^html(\[[^\]]+\])+$/);
        expect(first, selector).toContain("[data-look='ios']");
        count += 1;
      }
    });
    expect(count).toBeGreaterThan(20);
  });

  it('never uses !important', () => {
    root.walkDecls((decl) => {
      expect(decl.important, `${decl.prop} in ${(decl.parent as { selector?: string }).selector}`).toBe(
        false,
      );
    });
  });

  it('rounds exactly the agreed button set and none of the page-specific ones', () => {
    for (const cls of [
      "[data-slot='button']",
      '.btn-primary',
      '.btn-secondary',
      '.btn-danger',
      '.btn-danger-outline',
      '.btn-icon',
      '.btn-icon--danger',
      '.btn-upgrade',
    ]) {
      expect(css).toContain(cls);
    }
    for (const cls of [
      '.btn-confirmar',
      '.btn-complete-etapa',
      '.btn-revert-etapa',
      '.btn-edit-workflow',
      '.btn-remove-member',
      '.btn-instagram-action',
      '.btn-integration',
    ]) {
      expect(css).not.toContain(cls);
    }
  });

  it('is imported by the CRM entry right after style.css, and not by the Hub', () => {
    const crmMain = readFileSync('apps/crm/src/main.tsx', 'utf8');
    const base = crmMain.indexOf("import '../style.css';");
    const sheet = crmMain.indexOf("import './styles/visual-novo.css';");
    expect(base).toBeGreaterThan(-1);
    expect(sheet).toBeGreaterThan(base);
    expect(readFileSync('apps/hub/src/main.tsx', 'utf8')).not.toContain('visual-novo');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/crm/src/__tests__/visualNovoContracts.test.ts`
Expected: FAIL, `ENOENT` on `apps/crm/src/styles/visual-novo.css`.

- [ ] **Step 3: Create the sheet**

Create `apps/crm/src/styles/visual-novo.css` with exactly:

```css
/*
 * Visual novo, desktop level 1: the iOS idiom of the phone redesign in desktop page content.
 * Spec: docs/superpowers/specs/2026-10-12-desktop-visual-novo-l1-design.md
 *
 * Opt-in per browser: html[data-look='ios'] (src/lib/visualLook.ts, index.html pre-paint).
 * An ordinary stylesheet on purpose, never @layer: unlayered base rules would beat a layer.
 * Every rule lives in the 1101px block (the static-sidebar desktop shell) and every selector
 * starts with html[data-look='ios'], so the toggle off is today's look exactly.
 * src/__tests__/visualNovoContracts.test.ts enforces both.
 */
@media (min-width: 1101px) {
  /* Tokens mirror the phone kit (--phone-*); dark group = today's dark --card-bg. */
  html[data-look='ios'] .app-container {
    --vn-canvas: #f2f2f7;
    --vn-group: #ffffff;
    --vn-fill: rgba(118, 118, 128, 0.12);
    --vn-thumb: #ffffff;
    --vn-radius-group: 16px;
    --vn-title: 34px;
  }

  html[data-theme='dark'][data-look='ios'] .app-container {
    --vn-canvas: #0a0c0f;
    --vn-group: #12151a;
    --vn-fill: rgba(118, 118, 128, 0.24);
    --vn-thumb: #3a404d;
  }

  /* 1. Canvas. Full-bleed pages (Mensagens, Arquivos) keep their own surfaces. */
  html[data-look='ios'] .app-container .main-content:not(:has(> .page-full-bleed)) {
    background: var(--vn-canvas);
  }

  /* 2. Page title. Section headers (.header--section) and the Analytics account identity
        header keep today's treatment. */
  html[data-look='ios'] .app-container .header:not(.header--section) .header-title:not(:has(.conta-identity)) h1,
  html[data-look='ios'] .app-container .header:not(.header--section) .header-title:not(:has(.conta-identity)) h2 {
    font-size: var(--vn-title);
    font-weight: 700;
    letter-spacing: -0.02em;
    line-height: 1.15;
  }

  /* A title with a direct-child subtitle stacks, subtitle on top as a small eyebrow. Headers
     that lay out h1 + info icon as an inline-styled row have no direct-child p and keep the row. */
  html[data-look='ios'] .app-container .header:not(.header--section) .header-title:not(:has(.conta-identity)):has(> p) {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
  }

  html[data-look='ios'] .app-container .header:not(.header--section) .header-title:not(:has(.conta-identity)) > p {
    order: -1;
    margin: 0 0 2px;
    font-family: var(--font-main);
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0;
    color: var(--text-light);
  }

  /* 3. Cards: borderless white groups. The unused colour variants are left alone. */
  html[data-look='ios'] .app-container .card:not(.card-blue):not(.card-yellow):not(.card-teal):not(.card-dark) {
    background: var(--vn-group);
    border-color: transparent;
    box-shadow: none;
    border-radius: var(--vn-radius-group);
  }

  /* 4. KPIs: separate tiles instead of one hairline-divided block. */
  html[data-look='ios'] .app-container .kpi-grid {
    gap: 12px;
    background: transparent;
    border: 0;
    box-shadow: none;
    overflow: visible;
  }

  html[data-look='ios'] .app-container .kpi-card {
    background: var(--vn-group);
    border: 0;
    border-radius: var(--vn-radius-group);
    box-shadow: none;
  }

  /* StatCardGrid pads short rows with filler cells; they must stay invisible. */
  html[data-look='ios'] .app-container .kpi-card--filler {
    background: transparent;
  }

  /* Restated: the tile rule above would otherwise drop these base states. */
  html[data-look='ios'] .app-container button.kpi-card--clickable:hover {
    background: var(--surface-hover);
  }

  html[data-look='ios'] .app-container .kpi-card[data-active='true'] {
    box-shadow: inset 0 0 0 2px var(--primary-color);
  }

  /* 5. Segmented controls: a grey track with a raised thumb on the active segment. */
  html[data-look='ios'] .app-container .page-tabs {
    padding: 2px;
    border-radius: 9px;
    background: var(--vn-fill);
  }

  html[data-look='ios'] .app-container .page-tab {
    border-radius: 7px;
    font-size: 13px;
  }

  html[data-look='ios'] .app-container .calendar-tabs,
  html[data-look='ios'] .app-container .board-tabs {
    align-items: center;
    gap: 0;
    width: fit-content;
    max-width: 100%;
    padding: 2px;
    border-bottom: 0;
    border-radius: 9px;
    background: var(--vn-fill);
  }

  html[data-look='ios'] .app-container .calendar-tab,
  html[data-look='ios'] .app-container .board-tab:not(.board-tab-add) {
    padding: 6px 14px;
    border-radius: 7px;
    font-family: var(--font-main);
    font-size: 13px;
    letter-spacing: 0;
    text-transform: none;
  }

  /* The "+ Novo template" action stays a plain button at the end of the track. */
  html[data-look='ios'] .app-container .board-tab-add {
    padding: 6px 12px;
  }

  html[data-look='ios'] .app-container .calendar-tab.active::after,
  html[data-look='ios'] .app-container .board-tab.active::after {
    display: none;
  }

  html[data-look='ios'] .app-container [data-slot='tabs-list'] {
    padding: 2px;
    border-radius: 9px;
    background: var(--vn-fill);
  }

  html[data-look='ios'] .app-container [data-slot='tabs-trigger'] {
    border-radius: 7px;
  }

  html[data-look='ios'] .app-container .page-tab.active,
  html[data-look='ios'] .app-container .calendar-tab.active,
  html[data-look='ios'] .app-container .board-tab.active:not(.board-tab-add),
  html[data-look='ios'] .app-container [data-slot='tabs-trigger'][data-state='active'] {
    background: var(--vn-thumb);
    border-color: transparent;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
    color: var(--text-main);
  }

  /* 6. Pill buttons: the shadcn Button and the generic .btn-* classes only. */
  html[data-look='ios'] .app-container [data-slot='button'],
  html[data-look='ios'] .app-container .btn-primary,
  html[data-look='ios'] .app-container .btn-secondary,
  html[data-look='ios'] .app-container .btn-danger,
  html[data-look='ios'] .app-container .btn-danger-outline,
  html[data-look='ios'] .app-container .btn-icon,
  html[data-look='ios'] .app-container .btn-icon--danger,
  html[data-look='ios'] .app-container .btn-upgrade {
    border-radius: 999px;
  }
}
```

- [ ] **Step 4: Import it**

In `apps/crm/src/main.tsx` replace:

```ts
import '../style.css';
```

with:

```ts
import '../style.css';
import './styles/visual-novo.css';
```

- [ ] **Step 5: Format, then run the test**

Run: `npx prettier --write apps/crm/src/styles/visual-novo.css apps/crm/src/__tests__/visualNovoContracts.test.ts && npx vitest run apps/crm/src/__tests__/visualNovoContracts.test.ts`
Expected: PASS (6 tests). Prettier may rewrap the long selectors; the contract still holds because postcss splits selectors on commas.

- [ ] **Step 6: Commit**

```bash
git add apps/crm/src/styles/visual-novo.css apps/crm/src/main.tsx apps/crm/src/__tests__/visualNovoContracts.test.ts
git commit -m "feat(crm): Visual novo override sheet for desktop page content

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Browser sweep, gates, PR

**Files:** none planned. Any fix found in the sweep goes in `apps/crm/src/styles/visual-novo.css` (never in `style.css`), keeps the contract test green, and is committed as `fix(crm): Visual novo <what>`.

- [ ] **Step 1: Start the CRM against staging and log in with the seed account**

Use the Browser pane: `preview_start { name: "crm-staging" }`, then read `preview_logs` for the real "Local:" port (the tool's port is not authoritative). Worktrees have no `.env.staging`: copy it from `/Users/eduardosouza/Projects/sm-crm/.env.staging` into the worktree root first (gitignored; never `git add`). Log in with the seed technique from memory `reference_seed_login_browser_verification.md`: a node script reads `.env.staging`, signs in, writes `apps/crm/zz-seed-session.json`; the page fetches `/zz-seed-session.json` with `Accept: application/json`, stores it under its `key` in `localStorage`, navigates to `/dashboard`; delete the json right after. If edge functions fail from localhost (staging `ALLOWED_ORIGINS`), stub `functions/v1/workspace-limits` per `reference_local_browser_verify_stub_edge_functions.md`.

- [ ] **Step 2: Sweep with the toggle on**

`resize_window` 1440x900. Turn the look on through the user menu (or `localStorage.setItem('look','ios')` + reload). Visit, in light and then dark (`document.documentElement.setAttribute('data-theme','dark')`): `/dashboard`, `/entregas` (board tabs), `/clientes`, `/calendario` (calendar tabs), `/financeiro`, `/tarefas`, `/equipe` (table in a card), `/analytics`, an Analytics da conta page (identity header unchanged), `/mensagens` and `/arquivos` (full-bleed: no grey canvas), `/configuracao`, and open one Sheet (a task detail on `/tarefas`) to confirm overlays are unchanged. For each: screenshot; check no white-on-white nested cards (if found, add `html[data-look='ios'] .app-container .card .card { background: var(--vn-fill); }` and re-check), no invisible KPI filler, segmented tabs readable, buttons pill-shaped only where listed.

- [ ] **Step 3: Check the boundaries**

At 1000x800 with the toggle on: `/dashboard` looks like today (no grey canvas, no large title) and the drawer user menu has no "Visual novo" item. With the toggle off at 1440: on `/dashboard` and `/entregas`, `getComputedStyle` of `.main-content` background, the first `.card` border/radius/shadow, the first `.kpi-grid` gap/background and the first `[data-slot='button']` border-radius match `main` (run the same snippet on a `main` checkout dev server, or compare to the base values in `style.css`: `--bg-color #fdfdfd`, `.card` radius 12px, `.kpi-grid` gap 1px).

- [ ] **Step 4: Run every gate**

```bash
npm run lint
npm run format:check
npx tsc -p apps/crm/tsconfig.json --noEmit
npx tsc -p apps/hub/tsconfig.json --noEmit
npx tsc -p apps/admin/tsconfig.json --noEmit
npx tsc -p tsconfig.scripts.json
npm run test
```

Expected: all exit 0. (`npm run format` fixes formatting; re-run `format:check`.)

- [ ] **Step 5: Clean up and open the PR**

Remove the copied `.env.staging` and any seed/stub files; `git status` must show only intended changes. Rebase on `origin/main` if it moved (`git fetch origin && git rebase origin/main`), push, and open the PR with `gh pr create` (title `feat(crm): Visual novo (beta) desktop look, level 1`; body: what it does, that it ships off by default and is frontend-only so merge = deploy, the sweep screenshots, the spec and mockup links, ending with the Claude Code attribution line). Then follow the session's ccd_pr instructions (`get_status`, bind the PR).
