# Vidro Body Skin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Under the Vidro look (flag on, ≥1101px), every page body's tables, cards, buttons, badges,
form fields, controls, boards, overlays and chat bubbles look like the V3 mockups. No page layout
changes, and the flag-off look stays pixel-identical.

**Architecture:**
- **Token remap.** A remap on `html[data-look='vidro'] body:has(.app-container)` recolours everything
  that reads the shared surface and border tokens.
- **Hooks.** Inert `data-slot`, `data-variant`, `data-size` and `data-layout` hooks on the shadcn
  primitives give the CSS stable targets.
- **CSS files.** One file per component family under `apps/crm/src/styles/vidro-body/` holds the shape
  rules.
- **Task order.** One serial scaffold task does every shared edit. Nine family tasks then run in
  parallel on disjoint files. A final task adds the cross-family rules and verifies everything in a real
  browser.

**Tech Stack:** React 19, Tailwind 3.4 (utilities are (0,1,0) and variants (0,2,0)), shadcn/Radix,
plain CSS imported from `main.tsx`, Vitest + Testing Library, postcss (contract tests), Playwright
(the browser harness in the scratchpad).

**Spec:** `docs/superpowers/specs/2026-10-13-vidro-body-skin-design.md` (read it; this plan argues from
it). The shell spec is `docs/superpowers/specs/2026-10-12-desktop-vidro-design.md`.

## Global Constraints

- **Look gate:**
  - Every selector starts with `html[data-look='vidro']`.
  - Every rule sits inside `@media (min-width: 1101px)`. The only exception is the existing Fluxos print
    block in `vidro.css`.
  - No `@layer` and no `!important`. `apps/crm/style.css` is never edited.
- **Prefixes:**
  - Page-body rules use **`PB`** = `html[data-look='vidro'] body:has(.app-container) .vidro-panel`.
    The sidebar is not inside `.vidro-panel`, so it is never touched. Drawers and toolbars are inside it.
  - Overlay rules (portaled to `body`) use **`PO`** = `html[data-look='vidro'] body:has(.app-container)`.
  - Dark mirrors: `html[data-theme='dark'][data-look='vidro'] body:has(.app-container) …`.
- **Flag off is pixel-identical.**
  - Markup may only gain inert hooks: `data-slot`, `data-variant`, `data-size`, `data-layout`, or a class
    with no CSS outside the vidro files.
  - Inline-style escapes drop their style only while `useVidroShell()` is true.
- **Interaction states:** every restyled interactive element restates `:hover`, `:focus-visible`,
  `:disabled` / `[aria-disabled='true']` and each of its `data-state` / `aria-pressed` /
  `aria-selected` / `.active` variants.
  - Focus ring: `outline: none; box-shadow: 0 0 0 3px rgba(255, 191, 48, 0.55)`, combined with any
    resting shadow.
  - Disabled: `opacity: 0.5; cursor: not-allowed`, with hover suppressed.
- **Sticky or fixed** elements never take a translucent token: use `var(--vd-solid)`.
- **Selector alternatives** use `:is(...)` or commas, never `'a'|'b'`.
- **Copy:** Portuguese UI, and no em-dashes in user-facing copy (none is added here).
- **Commits:**
  - End every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - Run prettier and eslint on touched files only.
  - Never run a repo-wide formatter.

## Review Focus

1. **Dark mode surfaces.** A translucent token on a sticky or fixed element lets content show through.
   Expect opaque headers, panels and dialogs in dark. The Task 11 dark sweep plus the contract test in
   Task 1 (sticky classes must not use translucent tokens) pin it.
2. **Keyboard focus** after a restyle. Expect a visible ring on every Button, row link, Switch, Checkbox,
   Input and menu item. Task 11's `states` harness mode pins it.
3. **Shell regressions.** Expect the toolbar, capsule and sidebar to look exactly as on PR #695 HEAD.
   Task 2 keeps `.vidro-toolbar [data-slot='button']` at the toolbar's height, and Task 11's sweep
   compares the toolbar against the pre-skin screenshots.
4. **Portaled menus on routes outside AppLayout** (login, afiliados). Expect them classic. The
   `body:has(.app-container)` prefix guarantees it, and Task 1's contract test enforces the prefix on
   overlay hooks.
5. **Sidebar default for an existing user who already chose:** a stored `'0'` must keep the rail under
   Vidro. Task 1 has a unit test.

---

## File structure

| File | Responsibility | Task |
|---|---|---|
| `apps/crm/src/components/ui/{button,alert-dialog,card,input,textarea,table,select,checkbox,switch,dialog,sheet,popover,dropdown-menu,command,toggle-group,tooltip,calendar}.tsx` | inert hooks | 1 |
| `apps/crm/src/components/ui/__tests__/dataSlots.test.tsx` | hook pins | 1 |
| `apps/crm/src/pages/arquivos/components/FileGrid.tsx`, `apps/crm/src/pages/ideias/*` (card roots) | hand-placed hooks | 1 |
| `apps/crm/src/hooks/useVidro.ts`, `apps/crm/src/components/layout/AppLayout.tsx` | `isResolved`, sidebar tri-state | 1 |
| `apps/crm/src/styles/vidro.css` | token block moved; button-radius rule deleted | 1 |
| `apps/crm/src/styles/vidro-body/tokens.css` | new and remapped tokens | 1 |
| `apps/crm/src/styles/vidro-body/{buttons,tables,cards,badges,forms,controls,boards,overlays,chat,compositions}.css` | created empty with headers in Task 1, filled by Tasks 2-11 | 1 → 2-11 |
| `apps/crm/src/main.tsx` | ten imports | 1 |
| `apps/crm/src/__tests__/vidroContracts.test.ts` | guards over all vidro files | 1 |
| `apps/crm/src/__tests__/vidroBody.<family>.test.ts` | per-family declaration pins | 2-10 |
| Escapes: `pages/entregas/components/{WorkflowCard,PostProcessCard}.tsx`, `components/ui/date-time-picker.tsx` | buttons escapes | 2 |
| `components/help/EmptyStateGuide.tsx`, `pages/entregas/components/{ModeToggle,EntidadeToggle,PropertyPanel}.tsx`, `pages/analytics-conta/AnalyticsContaPage.tsx` | cards escapes | 4 |
| `pages/calendario/agenda/{EventoPopover,EventoRapidoCard}.tsx`, `pages/calendario/camadas/CamadaPopover.tsx` | overlays escapes | 9 |
| `pages/mensagens/components/ConversationThread.tsx` | chat hook classes | 10 |

Locate the exact paths of `ModeToggle`, `EntidadeToggle` and `PropertyPanel` with
`git ls-files apps/crm/src | grep -E 'ModeToggle|EntidadeToggle|PropertyPanel'`.

---

## Wave 1 (serial)

### Task 1: Scaffold: hooks, tokens, file split, contracts, sidebar default

**Files:**
- Modify: the 17 primitives listed above, `FileGrid.tsx`, the Ideias card component(s), `useVidro.ts`,
  `AppLayout.tsx`, `vidro.css`, `main.tsx`, `vidroContracts.test.ts`, `dataSlots.test.tsx`,
  `AppLayout.test.tsx`
- Create: `apps/crm/src/styles/vidro-body/*.css` (eleven files)

**Interfaces:**
- **Produces, hooks:** `data-slot` values exactly as in the spec's Hooks table; `Button` adds
  `data-variant` (default `'default'`) and `data-size` (default `'default'`); DialogContent desktop
  branch adds `data-layout` (`'default'` | `'fullscreen'`); Calendar `classNames` adds the classes
  `vidro-cal-nav` / `vidro-cal-day`.
- **Produces, `useVidro()`:** returns `{ enabled, active, optedOut, setOptedOut, isResolved }`, where
  `isResolved: boolean` is the limits query's `isSuccess`.
- **Produces, tokens in `tokens.css`:**
  - new: `--vd-txt2`, `--vd-icon`, `--vd-cta`, `--vd-cta-fg`, `--vd-cta-hover`, `--vd-ok`,
    `--vd-warn`, `--vd-tg-{info,warn,ok,neutral,bad}` and their `-bg`, `--vd-switch-on`,
    `--vd-overlay`, `--vd-menu`;
  - remapped: `--border-color`, `--surface-main`, `--surface-hover`, `--surface-1/2/3`, and the shadcn
    `--border`, `--input`, `--muted`, `--accent`, `--popover`, `--card`.

- [ ] **Step 1: Write the failing hook tests.** Append to
  `apps/crm/src/components/ui/__tests__/dataSlots.test.tsx`:

```tsx
import { Card, CardContent, CardHeader, CardTitle } from '../card';
import { Input } from '../input';
import { Textarea } from '../textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../table';
import { Checkbox } from '../checkbox';
import { Switch } from '../switch';
import { buttonVariants } from '../button';

describe('vidro body hooks', () => {
  it('Button carries variant and size, defaulting to default', () => {
    render(
      <>
        <Button>A</Button>
        <Button variant="outline" size="sm">
          B
        </Button>
      </>,
    );
    const a = screen.getByRole('button', { name: 'A' });
    expect(a).toHaveAttribute('data-variant', 'default');
    expect(a).toHaveAttribute('data-size', 'default');
    const b = screen.getByRole('button', { name: 'B' });
    expect(b).toHaveAttribute('data-variant', 'outline');
    expect(b).toHaveAttribute('data-size', 'sm');
    expect(b.className).toBe(buttonVariants({ variant: 'outline', size: 'sm' }));
  });

  it('marks Card, Input, Textarea, Table parts, Checkbox, Switch', () => {
    const { container } = render(
      <>
        <Card>
          <CardHeader>
            <CardTitle>T</CardTitle>
          </CardHeader>
          <CardContent>c</CardContent>
        </Card>
        <Input aria-label="i" />
        <Textarea aria-label="t" />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>H</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>C</TableCell>
            </TableRow>
          </TableBody>
        </Table>
        <Checkbox aria-label="cb" />
        <Switch aria-label="sw" />
      </>,
    );
    for (const slot of [
      'card',
      'card-header',
      'card-title',
      'card-content',
      'table-container',
      'table',
      'table-header',
      'table-body',
      'table-row',
      'table-head',
      'table-cell',
      'switch-thumb',
    ]) {
      expect(container.querySelector(`[data-slot='${slot}']`), slot).not.toBeNull();
    }
    expect(screen.getByRole('textbox', { name: 'i' })).toHaveAttribute('data-slot', 'input');
    expect(screen.getByRole('textbox', { name: 't' })).toHaveAttribute('data-slot', 'textarea');
    expect(screen.getByRole('checkbox', { name: 'cb' })).toHaveAttribute('data-slot', 'checkbox');
    expect(screen.getByRole('switch', { name: 'sw' })).toHaveAttribute('data-slot', 'switch');
  });
});
```

  Add a second test file, `apps/crm/src/components/ui/__tests__/dataSlotsOverlays.test.tsx`. It opens
  each portaled primitive, using `defaultOpen` / `open` props with the existing mocks pattern from
  `dialog-confirm-close.test.tsx` for Dialog, and asserts:
  - `document.querySelector("[data-slot='dialog-content'][data-layout='default']")`;
  - `[data-slot='dialog-overlay']`;
  - `alert-dialog-content`, `alert-dialog-overlay`;
  - `sheet-content`, `sheet-overlay`;
  - `popover-content`;
  - `dropdown-menu-content`, `dropdown-menu-item`, `dropdown-menu-sub-trigger`,
    `dropdown-menu-separator`, `dropdown-menu-label`;
  - `select-trigger` (rendered closed is enough for the trigger);
  - `command`, `command-input`, `command-item`;
  - `toggle-group`, `toggle-group-item`;
  - `tooltip-content` (`TooltipProvider` + `open`).

  Also that `AlertDialogAction` has `data-slot="button"`, `data-variant="default"` and
  `AlertDialogCancel` has `data-variant="outline"`. And that a `<Dialog>` with `layout="fullscreen"`
  renders `data-layout="fullscreen"`; read `dialog.tsx` for the prop name it actually uses, which may be
  a boolean `fullscreen`, and map it to the attribute.

- [ ] **Step 2: Run them to verify they fail.**
  Run: `npx vitest run apps/crm/src/components/ui/__tests__/dataSlots.test.tsx apps/crm/src/components/ui/__tests__/dataSlotsOverlays.test.tsx`
  Expected: FAIL on the new assertions; the existing two tests pass.

- [ ] **Step 3: Add the hooks.**
  - Each is an attribute on the existing root or part element. **Do not change any className string.**
  - Button:

```tsx
<Comp
  data-slot="button"
  data-variant={variant ?? 'default'}
  data-size={size ?? 'default'}
  className={cn(buttonVariants({ variant, size, className }))}
  ref={ref}
  {...props}
/>
```

  - `AlertDialogAction` gets `data-slot="button" data-variant="default" data-size="default"`, and
    `AlertDialogCancel` the same with `data-variant="outline"`, placed before `{...props}`.
  - The table wrapper `<div className="relative w-full overflow-auto">` gets
    `data-slot="table-container"`.
  - The Calendar `classNames` entries for the nav buttons and `day_button` get `vidro-cal-nav` /
    `vidro-cal-day` appended to their string. **These two are inert class additions.**
  - Dialog desktop branch: `data-slot="dialog-content"` and `data-layout={fullscreen ? 'fullscreen' : 'default'}`.
    The phone branch (`dialog.tsx:214-268`) gets nothing.
  - `CommandDialog` passes `layout` (or `fullscreen`) through unchanged.

- [ ] **Step 4: Hand-placed hooks.**
  - `FileGrid.tsx:255` `<table className="w-full text-sm">` → add `data-slot="table"`.
  - The grid-mode tile root elements in the same file → `data-slot="card"`.
  - Ideias: find the card root(s) with `grep -n "rounded" apps/crm/src/pages/ideias/*.tsx apps/crm/src/components/ideias/*.tsx`;
    on the element that renders one idea card, add `data-slot="card"`.
  - Add one test per file in the existing page test suites, asserting the attribute is present. If a
    page has no test file, add the assertion to a new `__tests__/<Page>.hooks.test.tsx` that renders
    with the suite's existing mocks.

- [ ] **Step 5: Run the hook tests to verify they pass.**
  Run: the two `dataSlots*` files plus `npx vitest run apps/crm/src/components/ui apps/crm/src/pages/arquivos apps/crm/src/pages/ideias`
  Expected: PASS. Every existing test still passes, and no snapshot changes (there are none on the
  primitives).

- [ ] **Step 6: Write the failing sidebar-default test.** In
  `apps/crm/src/components/layout/__tests__/AppLayout.test.tsx`:
  - Extend the `useVidro` mock (around line 72) with `isResolved: true`.
  - Add these cases at ≥1101px (the suite's existing width helper):

```tsx
describe('sidebar default under Vidro', () => {
  beforeEach(() => localStorage.removeItem('sidebar-pinned'));

  it('starts pinned when nothing is stored and the look is active', () => {
    vidroState = { ...vidroState, enabled: true, active: true, isResolved: true };
    renderLayout();
    expect(document.querySelector('.app-container')).not.toHaveAttribute('data-sidebar-collapsed');
  });

  it('keeps the rail when the user stored 0', () => {
    localStorage.setItem('sidebar-pinned', '0');
    vidroState = { ...vidroState, enabled: true, active: true, isResolved: true };
    renderLayout();
    expect(document.querySelector('.app-container')).toHaveAttribute('data-sidebar-collapsed');
  });

  it('rail when nothing is stored and the look is classic', () => {
    vidroState = { ...vidroState, enabled: true, active: false, optedOut: true, isResolved: true };
    renderLayout();
    expect(document.querySelector('.app-container')).toHaveAttribute('data-sidebar-collapsed');
  });

  it('never writes storage on its own', () => {
    vidroState = { ...vidroState, enabled: true, active: true, isResolved: true };
    renderLayout();
    expect(localStorage.getItem('sidebar-pinned')).toBeNull();
  });
});
```

  Adapt `vidroState` / `renderLayout` to the names the suite actually uses. Read lines 1-120 first.
  Also add a `useVidro` hook test (`apps/crm/src/hooks/__tests__/useVidro.test.tsx` exists; extend
  it) asserting that `isResolved` mirrors the limits mock's `isSuccess`.

- [ ] **Step 7: Run them to verify they fail.**
  Run: `npx vitest run apps/crm/src/components/layout/__tests__/AppLayout.test.tsx apps/crm/src/hooks/__tests__/useVidro.test.tsx`
  Expected: FAIL in the new cases only.

- [ ] **Step 8: Implement.** In `useVidro.ts`, return `isResolved: isSuccess`. In `AppLayout.tsx`,
  replace `useSidebarPinned` with this tri-state version and derive the effective value after
  `useVidro()`:

```tsx
type PinPref = '1' | '0' | null;

function readPinPref(): PinPref {
  try {
    const v = localStorage.getItem(SIDEBAR_PINNED_STORAGE_KEY);
    return v === '1' || v === '0' ? v : null;
  } catch {
    return null;
  }
}

function useSidebarPinPref() {
  const [pref, setPref] = useState<PinPref>(readPinPref);
  const choose = useCallback((next: boolean) => {
    const v: PinPref = next ? '1' : '0';
    try {
      localStorage.setItem(SIDEBAR_PINNED_STORAGE_KEY, v);
    } catch {
      // localStorage unavailable -- preference just won't persist.
    }
    setPref(v);
  }, []);
  return [pref, choose] as const;
}

// inside AppLayout, after `const vidro = useVidro();`
const [pinPref, choosePinned] = useSidebarPinPref();
const [vidroSeed] = useState(isVidroAttributeSet);
// Unset preference follows the look (spec: Sidebar default open): pinned under Vidro, rail in classic.
const sidebarPinned =
  pinPref === '1' ? true : pinPref === '0' ? false : vidro.isResolved ? vidro.active : vidroSeed || vidro.active;
const toggleSidebarPinned = useCallback(() => choosePinned(!sidebarPinned), [choosePinned, sidebarPinned]);
```

  Move the hook call order so `useVidro()` runs before `sidebarPinned` is computed; it currently runs
  after `useSidebarPinned()`. Keep the existing comment block above it, updated. Import
  `isVidroAttributeSet` from `@/lib/vidroLook`.

- [ ] **Step 9: Run them to verify they pass.** Same command as Step 7, then
  `npx vitest run apps/crm/src/components/layout` (all of it). Expected: PASS.

- [ ] **Step 10: Write the failing contract tests.** Rewrite the top of `vidroContracts.test.ts` to
  load every vidro file:

```ts
import { readdirSync, readFileSync } from 'node:fs';

const BODY_DIR = 'apps/crm/src/styles/vidro-body';
const FILES = [
  'apps/crm/src/styles/vidro.css',
  ...readdirSync(BODY_DIR)
    .filter((f) => f.endsWith('.css'))
    .map((f) => `${BODY_DIR}/${f}`),
];
const parsed = FILES.map((file) => ({ file, root: postcss.parse(readFileSync(file, 'utf8')) }));
const BODY_ORDER = [
  'tokens',
  'buttons',
  'tables',
  'cards',
  'badges',
  'forms',
  'controls',
  'boards',
  'overlays',
  'chat',
  'compositions',
];
```

  Wrap the existing guard tests (`@layer`/`!important`, the 1101px block, the `html[data-look]` start,
  no bare `.app-container`) in `describe.each(parsed)`. Keep the `.card` `:not()` chain test and the
  print test pointed at `vidro.css` and `cards.css` only. Add:

```ts
it('imports every vidro-body file after vidro.css, in order', () => {
  const at = (name: string) => main.indexOf(`./styles/vidro-body/${name}.css`);
  expect(main.indexOf('./styles/vidro.css')).toBeGreaterThan(-1);
  let prev = main.indexOf('./styles/vidro.css');
  for (const name of BODY_ORDER) {
    expect(at(name), name).toBeGreaterThan(prev);
    prev = at(name);
  }
});

const OVERLAY_HOOKS = [
  "[data-slot='dialog-overlay']",
  "[data-slot='dialog-content']",
  "[data-slot='alert-dialog-overlay']",
  "[data-slot='alert-dialog-content']",
  "[data-slot='sheet-overlay']",
  "[data-slot='sheet-content']",
  "[data-slot='popover-content']",
  "[data-slot='dropdown-menu-content']",
  "[data-slot='dropdown-menu-sub-content']",
  "[data-slot='select-content']",
  "[data-slot='command']",
  '[data-sonner-toast]',
];
it.each(parsed)('$file scopes overlay hooks with body:has(.app-container)', ({ root }) => {
  root.walkRules((rule) => {
    for (const s of rule.selectors) {
      if (OVERLAY_HOOKS.some((h) => s.includes(h))) expect(s, s).toContain('body:has(.app-container)');
    }
  });
});

it('tokens.css declares every new token in light and dark', () => {
  const tokens = parsed.find((p) => p.file.endsWith('tokens.css'))!.root;
  const light = new Set<string>();
  const dark = new Set<string>();
  tokens.walkRules((r) => {
    const bucket = r.selector.includes("[data-theme='dark']") ? dark : light;
    r.walkDecls((d) => d.prop.startsWith('--') && bucket.add(d.prop));
  });
  for (const t of [
    '--vd-txt2',
    '--vd-cta',
    '--vd-cta-fg',
    '--vd-cta-hover',
    '--vd-tg-ok',
    '--vd-tg-ok-bg',
    '--vd-tg-bad',
    '--vd-tg-bad-bg',
    '--vd-tg-info',
    '--vd-tg-info-bg',
    '--vd-tg-warn',
    '--vd-tg-warn-bg',
    '--vd-tg-neutral',
    '--vd-tg-neutral-bg',
    '--vd-switch-on',
    '--vd-overlay',
    '--vd-menu',
    '--border-color',
    '--surface-main',
    '--surface-hover',
    '--border',
    '--muted',
  ]) {
    expect(light.has(t), `light ${t}`).toBe(true);
    expect(dark.has(t), `dark ${t}`).toBe(true);
  }
});

it('vidro.css declares the shared tokens on body:has(.app-container), not .app-container', () => {
  const shell = parsed.find((p) => p.file.endsWith('/vidro.css'))!.root;
  shell.walkDecls('--vd-panel', (d) => {
    expect((d.parent as Rule).selector).toContain('body:has(.app-container)');
  });
});

const STICKY = ['.scheduled-panel', '.rb-editor-header'];
it.each(parsed)('$file keeps sticky surfaces opaque', ({ root }) => {
  root.walkRules((rule) => {
    if (!STICKY.some((c) => rule.selector.includes(c))) return;
    rule.walkDecls(/^background(-color)?$/, (d) => {
      expect(d.value, rule.selector).not.toMatch(/--vd-(tile|fill|group|glass|panel|menu)/);
    });
  });
});
```

- [ ] **Step 11: Run them to verify they fail.**
  Run: `npx vitest run apps/crm/src/__tests__/vidroContracts.test.ts`
  Expected: FAIL. The `vidro-body` directory and the imports are missing, and `--vd-panel` is still on
  `.app-container`.

- [ ] **Step 12: Create the CSS files.**
  - Each of the eleven `vidro-body/*.css` files starts with this header (family name filled in) and an
    empty `@media (min-width: 1101px) {}` block:

```css
/*
 * Vidro body skin: <family>.
 * Spec: docs/superpowers/specs/2026-10-13-vidro-body-skin-design.md
 * Only selectors for this family (cross-family rules go in compositions.css).
 * Guards: every selector starts with html[data-look='vidro']; everything inside
 * @media (min-width: 1101px); no @layer; no !important. Page-body prefix:
 * html[data-look='vidro'] body:has(.app-container) .vidro-panel; overlays drop `.vidro-panel`.
 */
@media (min-width: 1101px) {
}
```

  - In `main.tsx`, directly after `import './styles/vidro.css';`, add the eleven imports in
    `BODY_ORDER`.
  - In `vidro.css`:
    - change the token selector `html[data-look='vidro'] .app-container {` to declare only
      `--topbar-height`, `background-color` and `background-image`;
    - move every `--vd-*` declaration into a new rule `html[data-look='vidro'] body:has(.app-container) { … }`
      placed just above it;
    - do the same for the dark block, as
      `html[data-theme='dark'][data-look='vidro'] body:has(.app-container) { … }`;
    - delete the button-radius rule (the eight-selector rule ending in `.btn-upgrade { border-radius: 999px; }`).
  - Fill `tokens.css` inside its media block:

```css
  html[data-look='vidro'] body:has(.app-container) {
    --vd-txt2: #4b5563;
    --vd-icon: #4b5563;
    --vd-cta: #12151a;
    --vd-cta-fg: #ffffff;
    --vd-cta-hover: var(--cta-hover);
    --vd-ok: #15803d;
    --vd-warn: #b45309;
    --vd-tg-info: #1d4ed8;
    --vd-tg-info-bg: #eaf1ff;
    --vd-tg-warn: #b45309;
    --vd-tg-warn-bg: #fff3dc;
    --vd-tg-ok: #15803d;
    --vd-tg-ok-bg: #e6f8ee;
    --vd-tg-neutral: #374151;
    --vd-tg-neutral-bg: #eceef1;
    --vd-tg-bad: #b91c1c;
    --vd-tg-bad-bg: #fdecec;
    --vd-switch-on: #34c759;
    --vd-overlay: rgba(18, 21, 26, 0.32);
    --vd-menu: rgba(255, 255, 255, 0.86);
    /* Shared tokens remapped (spec: Remapped shared tokens). --card-bg, text, danger and primary stay. */
    --border-color: var(--vd-sep);
    --surface-main: var(--vd-group);
    --surface-hover: var(--vd-fill);
    --surface-1: #f4f4f6;
    --surface-2: rgba(118, 118, 128, 0.12);
    --surface-3: rgba(118, 118, 128, 0.2);
    /* shadcn HSL triplets. Panel ≈ rgba(255,255,255,.94) over #eceef3 ≈ rgb(254,254,255).
       --vd-sep over it ≈ rgb(231,231,232); --vd-fill over it ≈ rgb(238,238,240). */
    --border: 240 2% 91%;
    --input: 240 2% 91%;
    --muted: 240 5% 94%;
    --accent: 240 5% 94%;
    --popover: 0 0% 100%;
    --card: 0 0% 100%;
  }

  html[data-theme='dark'][data-look='vidro'] body:has(.app-container) {
    --vd-txt2: #a1a8b5;
    --vd-icon: #a1a8b5;
    --vd-cta: #e8eaf0;
    --vd-cta-fg: #12151a;
    --vd-cta-hover: var(--cta-hover);
    --vd-ok: #3ecf8e;
    --vd-warn: #f5a342;
    --vd-tg-info: #93b4ff;
    --vd-tg-info-bg: rgba(57, 132, 255, 0.18);
    --vd-tg-warn: #f5b041;
    --vd-tg-warn-bg: rgba(245, 163, 66, 0.18);
    --vd-tg-ok: #5fd4a0;
    --vd-tg-ok-bg: rgba(62, 207, 142, 0.16);
    --vd-tg-neutral: #c3c8d1;
    --vd-tg-neutral-bg: rgba(255, 255, 255, 0.09);
    --vd-tg-bad: #ff8a7a;
    --vd-tg-bad-bg: rgba(245, 90, 66, 0.18);
    --vd-switch-on: #34c759;
    --vd-overlay: rgba(0, 0, 0, 0.55);
    --vd-menu: rgba(30, 34, 42, 0.86);
    --border-color: var(--vd-sep);
    --surface-main: var(--vd-group);
    --surface-hover: var(--vd-fill);
    --surface-1: rgba(255, 255, 255, 0.05);
    --surface-2: rgba(118, 118, 128, 0.24);
    --surface-3: rgba(118, 118, 128, 0.32);
    /* Panel rgba(15,17,21,.86) over #0a0c0f ≈ rgb(14,16,20). --vd-sep over it ≈ rgb(34,36,40);
       --vd-fill over it ≈ rgb(39,41,46); --vd-group over it ≈ rgb(21,23,27). */
    --border: 220 8% 15%;
    --input: 220 8% 15%;
    --muted: 223 8% 17%;
    --accent: 223 8% 17%;
    --popover: 222 16% 13%;
    --card: 220 13% 9%;
  }
```

  Check the light composites quickly with a node one-liner, and correct a triplet if it is off by more
  than 1%.

- [ ] **Step 13: Run all vidro tests and the layout and primitive suites.**
  Run: `npx vitest run apps/crm/src/__tests__/vidroContracts.test.ts apps/crm/src/components apps/crm/src/hooks`
  Expected: PASS.

- [ ] **Step 14: Typecheck, lint and format the touched files.**
  Run: `npx tsc -p apps/crm/tsconfig.json --noEmit && npx eslint <touched files> && npx prettier --check <touched files>`
  Expected: clean.

- [ ] **Step 15: Commit.**

```bash
git add apps/crm/src/components/ui apps/crm/src/pages/arquivos apps/crm/src/pages/ideias apps/crm/src/components/ideias apps/crm/src/hooks apps/crm/src/components/layout apps/crm/src/styles apps/crm/src/main.tsx apps/crm/src/__tests__/vidroContracts.test.ts
git commit -m "feat(crm): Vidro body skin scaffold: primitive hooks, tokens, family files, sidebar default

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Wave 2 (parallel: Tasks 2-10; each touches only its own CSS file, its own test file and its listed TSX escapes)

Each family task follows the same five steps:
1. Write `apps/crm/src/__tests__/vidroBody.<family>.test.ts` (failing).
2. Run it and confirm it fails.
3. Fill `vidro-body/<family>.css` and do the TSX escapes, with their tests.
4. Run the family test, `vidroContracts.test.ts` and any touched page suites (PASS).
5. Run eslint and prettier on touched files, then commit.

All of them share this postcss helper. Copy it into the test file; it is short, and copying keeps the
tasks independent:

```ts
import { readFileSync } from 'node:fs';
import postcss, { type Rule } from 'postcss';
import { expect } from 'vitest';

export function loadFamily(name: string) {
  const root = postcss.parse(readFileSync(`apps/crm/src/styles/vidro-body/${name}.css`, 'utf8'));
  const decl = (selectorPart: string, prop: string): string[] => {
    const out: string[] = [];
    root.walkRules((r: Rule) => {
      if (!r.selectors.some((s) => s.includes(selectorPart))) return;
      r.walkDecls(prop, (d) => {
        out.push(d.value);
      });
    });
    return out;
  };
  const hasSelector = (part: string) => {
    let found = false;
    root.walkRules((r) => {
      if (r.selectors.some((s) => s.includes(part))) found = true;
    });
    return found;
  };
  return { root, decl, hasSelector };
}

export function expectStates(
  hasSelector: (p: string) => boolean,
  hook: string,
  states = [':hover', ':focus-visible', ':disabled'],
) {
  for (const st of states) expect(hasSelector(`${hook}${st}`) || hasSelector(`${hook}):is(`), `${hook}${st}`).toBe(true);
}
```

A family that uses `:is(...)` groupings may assert the state on the grouped selector string instead.
Make the assertion match how the file is written; the point is that every state exists.

### Task 2: Buttons (`buttons.css`)

**Files:**
- Modify: `apps/crm/src/styles/vidro-body/buttons.css`, `pages/entregas/components/WorkflowCard.tsx`,
  `pages/entregas/components/PostProcessCard.tsx`, `components/ui/date-time-picker.tsx`
- Test: `apps/crm/src/__tests__/vidroBody.buttons.test.ts`, the existing `WorkflowCard` /
  `PostProcessCard` / `date-time-picker` tests

**Interfaces:**
- Consumes: the Task 1 hooks (`data-variant`, `data-size`, `vidro-cal-nav`, `vidro-cal-day`) and the
  tokens `--vd-cta`, `--vd-cta-fg`, `--vd-cta-hover`, `--vd-cap`, `--vd-cap-bd`, `--vd-fill`,
  `--vd-tg-bad`, `--vd-tg-bad-bg`, `--vd-group`.
- Produces: the classes `vidro-board-action`, `vidro-board-action--complete`,
  `vidro-board-action--revert` (rendered only under Vidro).

- [ ] **Step 1: Failing test.**

```ts
import { describe, expect, it } from 'vitest';
// paste loadFamily + expectStates here
const { decl, hasSelector } = loadFamily('buttons');
describe('buttons.css', () => {
  it('CTA: ink pill', () => {
    expect(decl("[data-variant='default']", 'background').join()).toContain('var(--vd-cta)');
    expect(decl('.btn-primary', 'border-radius')).toContain('999px');
    expect(decl("[data-variant='default']", 'height')).toContain('36px');
  });
  it('glass, ghost, danger looks exist', () => {
    expect(decl("[data-variant='outline']", 'background').join()).toContain('var(--vd-cap)');
    expect(decl("[data-variant='ghost']", 'background').join()).toMatch(/transparent/);
    expect(decl("[data-variant='destructive']", 'background').join()).toContain('var(--vd-tg-bad-bg)');
  });
  it('restates hover, focus-visible, disabled on every look', () => {
    for (const h of ["[data-variant='default']", "[data-variant='outline']", "[data-variant='ghost']", "[data-variant='destructive']", '.btn-primary', '.btn-secondary', '.post-editor-btn', '.vidro-cal-day']) {
      expectStates(hasSelector, h);
    }
  });
  it('keeps the toolbar button margin rule out of this file', () => {
    expect(hasSelector('.sidebar')).toBe(false);
  });
});
```

  Add `vitest` cases to `WorkflowCard` / `PostProcessCard` tests:
  - With the flag off (default mocks), the action button has `btn-edit-workflow` (or
    `btn-complete-etapa` / `btn-revert-etapa`).
  - Inside `VidroToolbarHarness` (`apps/crm/src/test/vidroToolbar.tsx`, which sets `vidroShell`), it
    has `vidro-board-action` (plus `--complete` / `--revert`) and **not** the `!important` class.
  - Same pattern for `date-time-picker`: under the harness, the trigger has no inline `borderRadius`;
    without it, the inline style is unchanged.

- [ ] **Step 2: Run, expect FAIL.**
  `npx vitest run apps/crm/src/__tests__/vidroBody.buttons.test.ts apps/crm/src/pages/entregas/components apps/crm/src/components/ui/__tests__/date-time-picker.test.tsx`

- [ ] **Step 3: Implement `buttons.css`.**
  - **Scope:**
    - page-body rules use `PB`;
    - add the same selectors under
      `html[data-look='vidro'] body:has(.app-container) :is([data-slot='dialog-content'], [data-slot='alert-dialog-content'], [data-slot='sheet-content'], [data-slot='popover-content'])`
      so buttons inside overlays match;
    - **do not** style anything inside `.vidro-capsule` or `.sidebar`.
  - **Toolbar check:** `.vidro-toolbar [data-slot='button']` keeps `margin-bottom: 0` from `vidro.css`.
    Its CTA must be 36px tall, which matches.
  - Core rules (extend each selector list exactly as the spec §1 table lists):

```css
  /* CTA */
  html[data-look='vidro'] body:has(.app-container) .vidro-panel :is([data-slot='button']:is([data-variant='default'], [data-variant='ink']), .btn-primary, .btn-upgrade, .btn-confirmar, .drawer-send-btn, .drawer-reply-btn, .comment-reply-submit, .comment-add-submit, .calendar-detail-btn--primary, .time-picker-confirm, .vidro-board-action--complete) {
    height: 36px;
    border-radius: 999px;
    border: 0;
    background: var(--vd-cta);
    color: var(--vd-cta-fg);
    font-size: 13px;
    font-weight: 600;
    padding: 0 16px;
    box-shadow: 0 8px 18px -8px rgba(18, 21, 26, 0.5);
  }
  html[data-look='vidro'] body:has(.app-container) .vidro-panel :is([data-slot='button']:is([data-variant='default'], [data-variant='ink']), .btn-primary, .btn-upgrade, .btn-confirmar, .drawer-send-btn, .drawer-reply-btn, .comment-reply-submit, .comment-add-submit, .calendar-detail-btn--primary, .time-picker-confirm, .vidro-board-action--complete):is(:hover, [data-state='open']):not(:disabled) {
    background: var(--vd-cta-hover);
  }
  html[data-look='vidro'] body:has(.app-container) .vidro-panel :is([data-slot='button']:is([data-variant='default'], [data-variant='ink']), .btn-primary, .btn-upgrade, .btn-confirmar, .drawer-send-btn, .drawer-reply-btn, .comment-reply-submit, .comment-add-submit, .calendar-detail-btn--primary, .time-picker-confirm, .vidro-board-action--complete):focus-visible {
    outline: none;
    box-shadow: 0 0 0 3px rgba(255, 191, 48, 0.55), 0 8px 18px -8px rgba(18, 21, 26, 0.5);
  }
  html[data-look='vidro'] body:has(.app-container) .vidro-panel :is([data-slot='button']:is([data-variant='default'], [data-variant='ink']), .btn-primary, .btn-upgrade, .btn-confirmar, .drawer-send-btn, .drawer-reply-btn, .comment-reply-submit, .comment-add-submit, .calendar-detail-btn--primary, .time-picker-confirm, .vidro-board-action--complete):is(:disabled, [aria-disabled='true']) {
    opacity: 0.5;
    cursor: not-allowed;
    background: var(--vd-cta);
  }
```

  - **Glass:** the same four-rule pattern with these values:
    - resting: `height: 36px; border-radius: 999px; border: 1px solid var(--vd-cap-bd); background: var(--vd-cap); color: var(--text-main); font-size: 13px; font-weight: 600; padding: 0 14px; box-shadow: 0 6px 16px -8px rgba(18, 21, 26, 0.2);`
    - hover: `background: var(--vd-group)`;
    - `.drawer-calendar-btn.active`: `background: var(--vd-sel); color: var(--vd-sel-fg)`.
  - **Ghost:** the four-rule pattern with these values:
    - resting: `background: transparent; border: 0; border-radius: 999px; box-shadow: none; color: inherit;`
    - hover: `background: var(--vd-fill)`;
    - the icon-only subset (`[data-size='icon']`, `.btn-icon`, `.agenda-icon-btn`, `.calendar-nav button`,
      `.month-grid-nav-btn`, `.concluded-reopen-btn`, `.drawer-post-history-btn`, `.drawer-kebab-btn`,
      `.drawer-close-btn`, `.drawer-delete-btn`, `.vidro-cal-nav`, `.vidro-cal-day`) gets
      `width: 32px; height: 32px; padding: 0; display: inline-flex; align-items: center; justify-content: center;`;
    - danger-hover subset (`.btn-icon--danger`, `.rb-edit-btn-danger`, `.drawer-delete-btn`): hover
      `color: var(--vd-tg-bad); background: var(--vd-tg-bad-bg)`;
    - `.post-editor-btn:is(.is-active, [aria-pressed='true'])`:
      `background: var(--vd-fill); font-weight: 600`.
  - **Danger:**
    - resting: the CTA geometry with `background: var(--vd-tg-bad-bg); color: var(--vd-tg-bad); box-shadow: none`;
    - hover: `background: var(--danger-text); color: #fff`, plus the dark mirror with `var(--danger)`;
    - `.btn-danger-outline`: `background: transparent; border: 1px solid var(--vd-tg-bad)`.
  - **Day picker:**
    - selected (`.vidro-cal-day[aria-selected='true']`, or DayPicker's selected modifier class in
      `calendar.tsx`'s `classNames.selected` applied to the day cell, so use `:is([aria-selected='true'], .rdp-selected *)`
      after checking the real DOM in `calendar.tsx`):
      `background: var(--vd-cta); color: var(--vd-cta-fg)`;
    - today (`classNames.today` cell): `box-shadow: inset 0 0 0 2px #ffbf30`;
    - outside: `color: var(--vd-txt3)`.
  - **Sizes:**
    - `[data-size='sm']`: `height: 30px; font-size: 12px; padding: 0 12px`;
    - `[data-size='lg']`: `height: 40px`;
    - the `[data-size='icon']` circle as above.
  - **Dashed adders** (`.board-add-card`, `.drawer-add-post-btn`):
    `border-radius: 12px; border-color: var(--vd-sep)`, and hover `background: var(--vd-fill)`.
  - **Parent-scoped buttons:**
    - Run `grep -nE '^[^/]*[a-z0-9_-]+\s+button\s*[{,:]' apps/crm/style.css` and add every desktop
      body result (skip `.sidebar`, `.topbar`, `phone-`, `hub-`, `lp`) to the ghost selector list as
      `.<parent> button`;
    - list them in the task report.

- [ ] **Step 4: TSX escapes.**
  - `WorkflowCard.tsx` / `PostProcessCard.tsx`: `const vidroShell = useVidroShell();` (import from
    `@/components/layout/PageToolbarContext`). For each action button:
    `className={vidroShell ? 'vidro-board-action vidro-board-action--complete' : 'btn-complete-etapa'}`.
    Map `btn-edit-workflow` to `vidro-board-action`, `btn-revert-etapa` to `vidro-board-action--revert`
    and `btn-complete-etapa` to `--complete`, keeping any other classes the element already has.
  - `date-time-picker.tsx:156-166`: `style={vidroShell ? undefined : { …existing… }}`.

- [ ] **Step 5: Run, expect PASS** (the Step 2 command + `vidroContracts.test.ts`). Then eslint and
  prettier on the touched files.

- [ ] **Step 6: Commit.**
  `git commit -m "feat(crm): Vidro body skin: buttons" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 3: Tables and list rows (`tables.css`)

**Files:** Modify `vidro-body/tables.css`. Test `__tests__/vidroBody.tables.test.ts`.
**Interfaces:** Consumes the `table*` hooks (Task 1), `--vd-sep`, `--vd-fill` and `--vd-txt3`. Produces
nothing.

- [ ] **Step 1: Failing test.**

```ts
const { decl, hasSelector } = loadFamily('tables');
describe('tables.css', () => {
  it('header cells: 11px/600 txt3, no uppercase', () => {
    expect(decl("[data-slot='table-head']", 'font-size')).toContain('11px');
    expect(decl("[data-slot='table-head']", 'text-transform')).toContain('none');
    expect(decl('.data-table th', 'color').join()).toContain('var(--vd-txt3)');
  });
  it('body cells: 46px rows with --vd-sep separators', () => {
    expect(decl("[data-slot='table-cell']", 'height')).toContain('46px');
    expect(decl("[data-slot='table-cell']", 'border-bottom').join()).toContain('var(--vd-sep)');
  });
  it('row hover, selected and last-row states', () => {
    expect(hasSelector("[data-slot='table-row']:hover")).toBe(true);
    expect(hasSelector("[data-state='selected']")).toBe(true);
    expect(hasSelector(':last-child')).toBe(true);
  });
  it('list rows', () => {
    for (const c of ['.today-row', '.fila-row', '.config-member-row', '.concluded-wf-row', '.rb-layers-row']) {
      expect(hasSelector(c), c).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement.** Prefix `PB`. Match each pair: `[data-slot='table']` with `.data-table`;
  `table-head` with `.data-table th` and `[data-slot='table'] th`; `table-cell` with `.data-table td`
  and `[data-slot='table'] td`.

```css
  html[data-look='vidro'] body:has(.app-container) .vidro-panel :is([data-slot='table'], .data-table) {
    font-size: 13px;
    border-collapse: collapse;
  }
  html[data-look='vidro'] body:has(.app-container) .vidro-panel :is([data-slot='table-head'], .data-table th, [data-slot='table'] th) {
    font-size: 11px;
    font-weight: 600;
    color: var(--vd-txt3);
    text-transform: none;
    letter-spacing: 0;
    padding: 10px 12px;
    height: auto;
    background: transparent;
    border-bottom: 1px solid var(--vd-sep);
  }
  html[data-look='vidro'] body:has(.app-container) .vidro-panel :is([data-slot='table-cell'], .data-table td, [data-slot='table'] td) {
    padding: 0 12px;
    height: 46px;
    border-bottom: 1px solid var(--vd-sep);
  }
  html[data-look='vidro'] body:has(.app-container) .vidro-panel :is([data-slot='table-row'], .data-table tr, [data-slot='table'] tr) {
    border-bottom: 0;
  }
  html[data-look='vidro'] body:has(.app-container) .vidro-panel :is([data-slot='table-body'], .data-table tbody, [data-slot='table'] tbody) > tr:last-child > td {
    border-bottom: 0;
  }
  html[data-look='vidro'] body:has(.app-container) .vidro-panel :is([data-slot='table-body'], .data-table tbody, [data-slot='table'] tbody) > tr:is(:hover, [data-state='selected']) > td {
    background: var(--vd-fill);
  }
  html[data-look='vidro'] body:has(.app-container) .vidro-panel :is([data-slot='table-body'], .data-table tbody, [data-slot='table'] tbody) > tr:is(:hover, [data-state='selected']) > td:first-child {
    border-radius: 10px 0 0 10px;
  }
  html[data-look='vidro'] body:has(.app-container) .vidro-panel :is([data-slot='table-body'], .data-table tbody, [data-slot='table'] tbody) > tr:is(:hover, [data-state='selected']) > td:last-child {
    border-radius: 0 10px 10px 0;
  }
  html[data-look='vidro'] body:has(.app-container) .vidro-panel [data-slot='table-row']:hover {
    background: transparent;
  }
```

  The last rule neutralises shadcn's `hover:bg-muted/50` on the `<tr>`, so the rounded cell fill
  shows. List rows (`.today-row`, `.fila-row`, `.config-member-row`, `.concluded-wf-row`,
  `.rb-layers-row`) get `border-radius: 12px; border-color: var(--vd-sep);`, and hover
  `background: var(--vd-fill)`. `.fila-row.is-top` keeps its inset rail (do not set `box-shadow`
  there). Table padding inside a card belongs to compositions (Task 11).

- [ ] **Step 4: Run, expect PASS.** Lint and format.
- [ ] **Step 5: Commit** `feat(crm): Vidro body skin: tables and list rows`.

### Task 4: Cards and surfaces (`cards.css`)

**Files:**
- Modify: `vidro-body/cards.css`, `components/help/EmptyStateGuide.tsx`, the Entregas
  `ModeToggle` / `EntidadeToggle` / `PropertyPanel`, and `pages/analytics-conta/AnalyticsContaPage.tsx`
  (the four inline `background: 'var(--card-bg)'`).
- Test: `__tests__/vidroBody.cards.test.ts`, plus the existing suites of the touched TSX files.

**Interfaces:**
- Consumes: `data-slot='card*'` and `--vd-group`, `--vd-tile`, `--vd-sep`, `--vd-solid`, `--vd-menu`,
  `--vd-cap-bd`.
- Produces: the class `vidro-empty` (EmptyStateGuide under Vidro).

- [ ] **Step 1: Failing test.**

```ts
const { decl, hasSelector } = loadFamily('cards');
describe('cards.css', () => {
  it('groups, tiles and inner items', () => {
    expect(decl("[data-slot='card']", 'background').join()).toContain('var(--vd-group)');
    expect(decl('.config-shell', 'background').join()).toContain('var(--vd-tile)');
    expect(decl('.scheduled-item', 'border-radius')).toContain('12px');
  });
  it('sticky .scheduled-panel is opaque', () => {
    expect(decl('.scheduled-panel', 'background').join()).toContain('var(--vd-solid)');
  });
  it('report editor chrome and empty states are covered', () => {
    for (const c of ['.rb-edit-toolbar', '.rb-text-toolbar', '.rb-img-panel', '.rb-layers-rail', '.vidro-empty', '.board-empty', '.drawer-empty', '.cliente-finance-empty']) {
      expect(hasSelector(c), c).toBe(true);
    }
  });
});
```

  For each escape, add a test: under `VidroToolbarHarness` the inline background or border is absent
  (and `EmptyStateGuide` has the class `vidro-empty`); without the harness the inline style is unchanged.

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement `cards.css`** (prefix `PB`). Use the spec §3 lists verbatim.

```css
  html[data-look='vidro'] body:has(.app-container) .vidro-panel :is([data-slot='card'], .team-card, .today-card, .analytics-post-card, .latest-instagram-post-card, .agenda-view, .agenda-sidebar__card, .concluded-client-card, .fila-group) {
    background: var(--vd-group);
    border: 1px solid var(--vd-sep);
    border-radius: 16px;
    box-shadow: none;
  }
  html[data-look='vidro'] body:has(.app-container) .vidro-panel .fila-top {
    background: var(--vd-group);
    border-radius: 16px;
    box-shadow: none;
  }
  html[data-look='vidro'] body:has(.app-container) .vidro-panel :is(.config-shell, .post-production, .rb-layers-rail) {
    background: var(--vd-tile);
    border: 0;
    border-radius: 16px;
    box-shadow: none;
  }
  html[data-look='vidro'] body:has(.app-container) .vidro-panel .analytics-callout {
    border-radius: 16px;
  }
  html[data-look='vidro'] body:has(.app-container) .vidro-panel .scheduled-panel {
    background: var(--vd-solid);
    border-radius: 16px;
  }
  html[data-look='vidro'] body:has(.app-container) .vidro-panel :is(.scheduled-item, .cliente-date-card, .cliente-address-card, .niche-month-card, .drawer-post-item) {
    background: var(--vd-group);
    border: 1px solid var(--vd-sep);
    border-radius: 12px;
    box-shadow: none;
  }
  html[data-look='vidro'] body:has(.app-container) .vidro-panel :is(.rb-edit-toolbar, .rb-text-toolbar, .rb-img-panel) {
    background: var(--vd-menu);
    -webkit-backdrop-filter: blur(24px) saturate(1.6);
    backdrop-filter: blur(24px) saturate(1.6);
    border: 1px solid var(--vd-cap-bd);
    border-radius: 14px;
    box-shadow: 0 18px 40px -16px rgba(18, 21, 26, 0.35);
  }
  html[data-look='vidro'] body:has(.app-container) .vidro-panel .rb-editor-header[data-stuck] {
    background: var(--vd-solid);
  }
  html[data-look='vidro'] body:has(.app-container) .vidro-panel [data-slot='card-title'] {
    font-size: 15px;
    font-weight: 600;
    letter-spacing: -0.01em;
  }
```

  - **Analytics surfaces:**
    - Run `grep -nE '^\.analytics-[a-z_-]+\s*\{' apps/crm/style.css`.
    - For each class whose rule sets a `background` plus a `border` or `border-radius`, assign it to
      the group list (bordered card-like) or the tile list (filled panel-like).
    - List each decision in the report.
    - `.latest-instagram-posts` and `.analytics-callout__item` are tiles.
  - **Empty states:**
    - `:is(.board-empty, .drawer-empty)`: `font-size: 13px; color: var(--vd-txt3); opacity: 1; font-family: inherit; letter-spacing: 0;`.
    - `.cliente-finance-empty`: `border-color: var(--vd-sep); border-radius: 16px;`.
    - `.vidro-empty`: `background: var(--vd-tile); border: 0; border-radius: 16px; padding: 20px;`.
      Its title child is `var(--text-main)` and its body `var(--vd-txt2)`. Read the element structure in
      `EmptyStateGuide.tsx` and target its children by their tag or existing class.

- [ ] **Step 4: TSX escapes.** In each listed file, use `const vidroShell = useVidroShell();`, then:
  - **Inline backgrounds:** `style={vidroShell ? { ...rest } : { ...rest, background: 'var(--card-bg)' }}`,
    where `rest` keeps only the non-colour layout props.
  - **EmptyStateGuide:** under `vidroShell`, render `className="vidro-empty"` (merged with any existing
    className) and drop the `border`, `background` and three `color` inline properties.

- [ ] **Step 5: Run, expect PASS.** Lint and format.
- [ ] **Step 6: Commit** `feat(crm): Vidro body skin: cards and surfaces`.

### Task 5: Badges and pills (`badges.css`)

**Files:** Modify `vidro-body/badges.css`. Test `__tests__/vidroBody.badges.test.ts`.
**Interfaces:** Consumes the `--vd-tg-*` tokens. Produces nothing.

- [ ] **Step 1: Failing test.**

```ts
const { decl, hasSelector } = loadFamily('badges');
describe('badges.css', () => {
  it('tg geometry', () => {
    expect(decl('.badge', 'font-size')).toContain('11px');
    expect(decl('.badge', 'border-radius')).toContain('999px');
    expect(decl('.badge', 'border-color')).toContain('transparent');
  });
  it('tones', () => {
    expect(decl('.badge-success', 'color').join()).toContain('var(--vd-tg-ok)');
    expect(decl('.badge-danger', 'background').join()).toContain('var(--vd-tg-bad-bg)');
    expect(decl('.badge-info', 'color').join()).toContain('var(--vd-tg-info)');
    expect(decl('.badge-warning', 'color').join()).toContain('var(--vd-tg-warn)');
  });
  it('geometry-only pills and plain counts', () => {
    for (const c of ['.post-status-chip', '.post-tipo-badge', '.board-card-deadline', '.post-fluxo-tag', '.fila-pill', '.auto-schedule-badge', '.event-pill']) {
      expect(hasSelector(c), c).toBe(true);
    }
    expect(decl('.board-column-count', 'background').join()).toMatch(/transparent|none/);
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** (prefix `PB`, and also `PO :is([data-slot='dialog-content'], [data-slot='sheet-content'], [data-slot='popover-content'])`
  for badges inside overlays):
  - **Geometry**, on `.badge` and the "same geometry" list from spec §4:
    `font-size: 11px; font-weight: 600; border-radius: 999px; padding: 2px 9px; border-color: transparent; white-space: nowrap; line-height: 1.5;`.
  - **Tones** set `color` / `background`:
    - `.badge-success` → ok;
    - `.badge-warning` → warn;
    - `.badge-danger` → bad;
    - `.badge-info` → info;
    - `:is(.badge, .badge-neutral):not(.badge-success, .badge-warning, .badge-danger, .badge-info, .badge-primary, .badge-outline, .badge--solid)`
      → neutral;
    - `.badge-primary` → `#92400e` on `#fff3dc`, with the dark mirror `#f5b041` on
      `rgba(245, 163, 66, 0.18)`.
  - **`.badge-outline`:** `border-color: var(--vd-sep)`.
  - **`.badge--solid`:** geometry only; do not set its colours.
  - **`.badge--sm`:** `font-size: 10px; padding: 1px 7px;`.
  - **Geometry-only pills** (the spec §4 list) keep their own `background` / `color` / variables; only
    geometry plus `border-color: transparent`. The exception is `.post-fluxo-tag--avulso`, which keeps
    its dashed border.
  - **Counts** (`.board-column-count`, `.today-group-count`, `.list-group-count`):
    `background: transparent; border: 0; color: var(--vd-txt3); font-size: 11px; font-weight: 600; font-family: inherit; padding: 0;`.
  - **`.event-pill`:** `border-radius: 6px; font-size: 11px; font-family: inherit;`.
- [ ] **Step 4: Run, expect PASS.** Lint and format.
- [ ] **Step 5: Commit** `feat(crm): Vidro body skin: badges and pills`.

### Task 6: Form fields (`forms.css`)

**Files:** Modify `vidro-body/forms.css`. Test `__tests__/vidroBody.forms.test.ts`.
**Interfaces:** Consumes the `input`, `textarea`, `select-trigger`, `checkbox`, `switch` and
`switch-thumb` hooks, plus `--vd-fill`, `--vd-group`, `--vd-sep`, `--vd-txt3`, `--vd-cta`,
`--vd-cta-fg` and `--vd-switch-on`.

- [ ] **Step 1: Failing test.**

```ts
const { decl, hasSelector } = loadFamily('forms');
describe('forms.css', () => {
  it('fields: fill, transparent border, radius 10', () => {
    expect(decl("[data-slot='input']", 'background').join()).toContain('var(--vd-fill)');
    expect(decl("[data-slot='input']", 'border-radius')).toContain('10px');
    expect(hasSelector("[data-slot='input']:focus-visible") || hasSelector(':focus-visible')).toBe(true);
  });
  it('select placeholder and search pill', () => {
    expect(hasSelector("[data-slot='select-trigger'][data-placeholder]")).toBe(true);
    expect(decl("input[type='search']", 'border-radius')).toContain('999px');
  });
  it('checkbox ink and switch geometry', () => {
    expect(decl("[data-slot='checkbox'][data-state='checked']", 'background').join()).toContain('var(--vd-cta)');
    expect(decl("[data-slot='switch']", 'width')).toContain('38px');
    expect(decl("[data-slot='switch'][data-state='checked']", 'background').join()).toContain('var(--vd-switch-on)');
    expect(decl("[data-slot='switch-thumb']", 'width')).toContain('18px');
  });
  it('restates disabled and focus on switch and checkbox', () => {
    for (const h of ["[data-slot='switch']", "[data-slot='checkbox']"]) {
      expect(hasSelector(`${h}:focus-visible`), h).toBe(true);
      expect(hasSelector(`${h}:disabled`), h).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.** Prefix `PB`, also duplicated under the overlay-content prefix (as in
  Task 5) so fields inside dialogs match.
  - **Fields:** the spec §5 list, including the raw elements
    `.vidro-panel :is(input:is([type='text'], [type='search'], [type='email'], [type='url'], [type='number'], [type='date'], [type='tel'], :not([type])), select, textarea):not([data-slot])`.
    - Resting:
      `background: var(--vd-fill); border: 1px solid transparent; border-radius: 10px; min-height: 34px; font-size: 13px; color: var(--text-main); box-shadow: none; font-family: inherit; letter-spacing: 0;`.
      Use `height` only on single-line inputs and select triggers; textareas get
      `padding: 8px 12px; height: auto`.
    - `::placeholder` and `[data-slot='select-trigger'][data-placeholder]`: `color: var(--vd-txt3)`.
    - `:focus-visible` (and `:focus` for native fields):
      `background: var(--vd-group); border-color: var(--vd-sep); outline: none; box-shadow: 0 0 0 3px rgba(255, 191, 48, 0.45);`.
    - `:disabled`: `opacity: 0.5; cursor: not-allowed`.
    - `[aria-invalid='true']`: `border-color: var(--vd-tg-bad)`.
  - **Search:** `input[type='search']` and `.search-input-pill` get
    `border-radius: 999px; height: 30px; padding: 0 12px;`. The `!rounded-full` call sites already match.
  - **Select trigger chevron:** `[data-slot='select-trigger'] svg { color: var(--vd-txt3); opacity: 1; }`.
  - **Checkbox:**
    - resting: `width: 16px; height: 16px; border-radius: 5px; border: 1.5px solid var(--vd-txt3); background: transparent; box-shadow: none;`;
    - `:is([data-state='checked'], [data-state='indeterminate'])`:
      `background: var(--vd-cta); border-color: var(--vd-cta); color: var(--vd-cta-fg);`;
    - `:focus-visible`: the ring;
    - `:disabled`: `opacity: 0.5`.
  - **Switch:**
    - resting: `width: 38px; height: 22px; border-radius: 999px; border-width: 2px; background: var(--vd-fill); box-shadow: none;`;
    - `[data-state='checked']`: `background: var(--vd-switch-on)`;
    - thumb: `width: 18px; height: 18px; background: #fff; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);`;
    - `:focus-visible`: the ring;
    - `:disabled`: `opacity: 0.5`.
    - Leave the thumb `transform` alone; `translate-x-4` is 16px, which equals 38 − 4 (border) − 18.
  - **Native radios:** `.vidro-panel input[type='radio'] { accent-color: var(--vd-cta); }`.
- [ ] **Step 4: Run, expect PASS.** Lint and format.
- [ ] **Step 5: Commit** `feat(crm): Vidro body skin: form fields`.

### Task 7: Segmented controls, chips, side navs (`controls.css`)

**Files:** Modify `vidro-body/controls.css`. Test `__tests__/vidroBody.controls.test.ts`.
**Interfaces:** Consumes the `toggle-group` / `toggle-group-item` hooks and `--vd-fill`, `--vd-sel`,
`--vd-sel-fg`.

- [ ] **Step 1: Failing test.**

```ts
const { decl, hasSelector } = loadFamily('controls');
describe('controls.css', () => {
  it('segmented capsule for vista-tabs, icon-seg, toggle-group', () => {
    expect(decl('.vista-tabs', 'border-radius')).toContain('999px');
    expect(decl("[data-slot='toggle-group-item'][data-state='on']", 'background').join()).toContain('var(--vd-sel)');
    expect(hasSelector('.icon-seg__item')).toBe(true);
  });
  it('chips', () => {
    expect(decl('.today-chip', 'height')).toContain('28px');
    expect(hasSelector(".today-chip[aria-pressed='true']")).toBe(true);
    expect(hasSelector('.platform-chip--on')).toBe(true);
  });
  it('side navs take the quiet fill', () => {
    expect(decl('.cliente-tabs-nav__item.active', 'background').join() + decl('.config-nav-item.active', 'background').join()).toContain('var(--vd-fill)');
  });
});
```

  Before writing the side-nav assertion, check the real active-state selector of `.cliente-tabs-nav__item`
  and `.config-nav-item` in `style.css` (`grep -n "cliente-tabs-nav__item\|config-nav-item" apps/crm/style.css`).
  Use it, whether it is `.active`, `[aria-current]` or `--active`.

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** (prefix `PB`):
  - **Track:** `display: inline-flex; gap: 2px; padding: 2px; border-radius: 999px; background: var(--vd-fill); border: 0; box-shadow: none;`.
  - **Item:** `height: 28px; border-radius: 999px; padding: 0 14px; font-size: 13px; font-weight: 500; text-transform: none; letter-spacing: 0; background: transparent; border: 0; box-shadow: none; color: var(--text-main);`.
    - Hover: `background: rgba(118, 118, 128, 0.12)` when not selected.
    - Selected (`.vista-tab--active`, `.icon-seg__item[data-state='on']` / `[aria-pressed='true']`,
      `[data-slot='toggle-group-item'][data-state='on']`): `background: var(--vd-sel); color: var(--vd-sel-fg);`.
    - Focus ring and disabled as usual.
    - Underline pseudo-elements on `.vista-tab::after`: `display: none`.
    - `.vista-tab--add` and `.vista-tab-more` are ghost: transparent background, hover fill.
    - Exclude `.agenda-segmented`, which `vidro.css` already covers:
      `[data-slot='toggle-group']:not(.agenda-segmented)`.
  - **Chips** (spec §6 list): `height: 28px; border-radius: 999px; background: var(--vd-fill); border: 0; font-size: 12px; font-weight: 500; padding: 0 12px; color: var(--text-main); box-shadow: none;`.
    - `:is(.on, [aria-pressed='true'], [data-state='on'], .platform-chip--on)`: `background: var(--vd-sel); color: var(--vd-sel-fg);`.
    - `.today-chip.is-danger[aria-pressed='true']`: keep the danger colour,
      `background: var(--vd-tg-bad-bg); color: var(--vd-tg-bad)`.
    - Focus and disabled as usual.
  - **Side navs:** `height: 30px; border-radius: 10px; font-size: 13px;`.
    - Active: `background: var(--vd-fill); font-weight: 600; box-shadow: none;`.
    - Hover: `background: var(--vd-fill)`.
- [ ] **Step 4: Run, expect PASS.** Lint and format.
- [ ] **Step 5: Commit** `feat(crm): Vidro body skin: segmented controls, chips, side navs`.

### Task 8: Kanban and calendar (`boards.css`)

**Files:** Modify `vidro-body/boards.css`. Test `__tests__/vidroBody.boards.test.ts`.

- [ ] **Step 1: Failing test.**

```ts
const { decl } = loadFamily('boards');
describe('boards.css', () => {
  it('columns are tiles, cards are kcards', () => {
    expect(decl('.board-column', 'background').join()).toContain('var(--vd-tile)');
    expect(decl('.board-column-title', 'text-transform')).toContain('none');
    expect(decl('.board-card', 'border-radius')).toContain('12px');
    expect(decl('.board-card', 'box-shadow').join()).toMatch(/none/);
  });
  it('calendar cells', () => {
    expect(decl('.calendar-day', 'border-radius')).toContain('12px');
    expect(decl('.calendar-day.today', 'border').join() + decl('.calendar-day.today', 'border-color').join()).toContain('#ffbf30');
    expect(decl('.agenda-fc', '--fc-border-color').join()).toContain('var(--vd-sep)');
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** (prefix `PB`):
  - **`.board-column`:** `background: var(--vd-tile); border: 0; box-shadow: none; border-radius: 16px; padding: 10px;`.
    - `.board-column-header`: `background: transparent; border-bottom: 0; min-height: 0; padding: 2px 4px 8px;`.
    - `.board-column-title`: `font-size: 12px; font-weight: 600; text-transform: none; letter-spacing: 0; font-family: inherit;`.
    - `.board-column-body`: `background: transparent; padding: 0;`.
  - **`:is(.board-card, .board-post-card)`:** `background: var(--vd-group); border: 1px solid var(--vd-sep); border-radius: 12px; padding: 10px 12px; box-shadow: none;`.
    - Hover: `box-shadow: 0 6px 16px -10px rgba(18, 21, 26, 0.3)`. Leave `transform` alone.
    - `:focus-within`: the ring.
  - **`.board-drop-slot`:** `border-radius: 12px`.
  - **`:is(.calendar-day, .calendar-cell)`:** `background: var(--vd-group); border: 1px solid var(--vd-sep); border-radius: 12px;`.
    - `:is(.today, .selected)`: `border: 2px solid #ffbf30`. Keep the existing tint background.
    - `.calendar-day.empty`: `background: transparent; border-color: transparent`.
  - **`:is(.calendar-post-card, .sidebar-post-card)`:** `border-radius: 8px; border-color: var(--vd-sep);`.
  - **`.agenda-fc`:** `--fc-border-color: var(--vd-sep); --fc-page-bg-color: transparent; --fc-neutral-bg-color: var(--vd-fill);`.
- [ ] **Step 4: Run, expect PASS.** Lint and format.
- [ ] **Step 5: Commit** `feat(crm): Vidro body skin: kanban and calendar`.

### Task 9: Overlays (`overlays.css`)

**Files:**
- Modify: `vidro-body/overlays.css`, `pages/calendario/agenda/EventoPopover.tsx` (~859-870),
  `EventoRapidoCard.tsx` (~135-147), `pages/calendario/camadas/CamadaPopover.tsx` (~377-388).
- Test: `__tests__/vidroBody.overlays.test.ts`, plus each popover's existing suite.

**Interfaces:**
- Consumes: the overlay hooks (with `data-layout`), and `--vd-panel`, `--vd-glass-bd`, `--vd-shadow`,
  `--vd-overlay`, `--vd-menu`, `--vd-cap-bd`, `--vd-fill`, `--vd-sep`, `--vd-solid`.

- [ ] **Step 1: Failing test.**

```ts
const { decl, hasSelector } = loadFamily('overlays');
describe('overlays.css', () => {
  it('dialogs: panel glass, radius 20, fullscreen excluded', () => {
    expect(decl("[data-slot='dialog-content']", 'border-radius')).toContain('20px');
    expect(hasSelector(":not([data-layout='fullscreen'])")).toBe(true);
    expect(decl('.drawer-panel', 'background').join()).toContain('var(--vd-panel)');
  });
  it('menus and items', () => {
    expect(decl("[data-slot='dropdown-menu-content']", 'background').join()).toContain('var(--vd-menu)');
    expect(hasSelector("[data-slot='dropdown-menu-sub-trigger'][data-state='open']")).toBe(true);
    expect(hasSelector('[data-highlighted]')).toBe(true);
    expect(hasSelector('[data-disabled]')).toBe(true);
  });
  it('toasts and fallbacks', () => {
    expect(hasSelector('[data-sonner-toast]')).toBe(true);
    let fallback = false;
    loadFamily('overlays').root.walkAtRules((a) => {
      if (/prefers-reduced-transparency|supports not/.test(a.params)) fallback = true;
    });
    expect(fallback).toBe(true);
  });
});
```

  For the three popovers, add a test: under `VidroToolbarHarness` the content has no inline
  `background` / `borderColor` / `borderRadius`; without it they are unchanged.

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** (prefix `PO`; `.drawer-panel` / `.drawer-overlay` also under `PO`, since a
  descendant match from `body` works):
  - **Dialogs:**
    `:is([data-slot='dialog-content']:not([data-layout='fullscreen']), [data-slot='alert-dialog-content'], .drawer-panel)`
    gets
    `background: var(--vd-panel); -webkit-backdrop-filter: blur(30px) saturate(1.6); backdrop-filter: blur(30px) saturate(1.6); border: 1px solid var(--vd-glass-bd); border-radius: 20px; box-shadow: var(--vd-shadow);`.
  - **Overlays:** `:is([data-slot='dialog-overlay'], [data-slot='alert-dialog-overlay'], [data-slot='sheet-overlay'], .drawer-overlay)`
    gets `background: var(--vd-overlay); -webkit-backdrop-filter: blur(2px); backdrop-filter: blur(2px);`.
  - **`[data-slot='sheet-content']`:** `background: var(--vd-panel)` plus the blur.
    - The radius is on the inner edge only:
      `.sheet-pane--right` → `border-radius: 20px 0 0 20px`;
      `--left` → `0 20px 20px 0`;
      `--bottom` → `20px 20px 0 0`;
      `--top` → `0 0 20px 20px`.
    - `border-color: var(--vd-glass-bd)`.
  - **Menus:** the spec §8 list, written as `PO :is([data-slot='popover-content'], [data-slot='dropdown-menu-content'], [data-slot='dropdown-menu-sub-content'], [data-slot='select-content'], .comment-popover, .comment-add-popover, .calendar-day-popover, .post-timeline-popover, .context-help__popover, .time-picker-popover, .mention-suggestion-list, .color-dropdown)`,
    gets
    `background: var(--vd-menu); -webkit-backdrop-filter: blur(24px) saturate(1.6); backdrop-filter: blur(24px) saturate(1.6); border: 1px solid var(--vd-cap-bd); border-radius: 14px; box-shadow: 0 18px 40px -16px rgba(18, 21, 26, 0.35);`.
    Do **not** override `padding` on `popover-content`: popovers lay out their own padding. Menu
    padding of 5px applies to `dropdown-menu-content`, `dropdown-menu-sub-content` and
    `select-content` only.
    - `[data-slot='command']` (inside a dialog): `background: transparent`.
  - **Items:** `:is([data-slot='dropdown-menu-item'], [data-slot='dropdown-menu-sub-trigger'], [data-slot='select-item'], [data-slot='command-item'])`
    gets `border-radius: 8px; min-height: 30px; font-size: 13px;`.
    - `:is([data-highlighted], [aria-selected='true'], [data-state='open'])`: `background: var(--vd-fill)`.
    - `[data-disabled]`: `opacity: 0.5`.
    - `:focus-visible`: `outline: none; background: var(--vd-fill)`.
  - **Separators:** `:is([data-slot='dropdown-menu-separator'], [data-slot='select-separator'])`
    gets `background: var(--vd-sep)`.
  - **Toasts:** `PO .toaster [data-sonner-toast]` gets the menu glass and `border-radius: 14px`.
    - `[data-button]`: the CTA geometry and colours from spec §1, written out here, not imported.
    - `[data-cancel]`: ghost.
  - **Fallbacks:** inside
    `@media (min-width: 1101px) and (prefers-reduced-transparency: reduce)` and a separate
    `@supports not (backdrop-filter: blur(1px)) { @media (min-width: 1101px) { … } }`, the dialog,
    sheet, menu and toast selectors get `background: var(--vd-solid); backdrop-filter: none;`.
- [ ] **Step 4: TSX escapes.** In the three popovers, drop the inline `background` / `borderColor` /
  `borderRadius` while `useVidroShell()` is true, and keep the other inline properties.
  `useVidroShell` reads context, so it works inside the portal; this was verified in the shell review.
- [ ] **Step 5: Run, expect PASS.** Lint and format.
- [ ] **Step 6: Commit** `feat(crm): Vidro body skin: overlays, menus, toasts`.

### Task 10: Chat bubbles (`chat.css`)

**Files:**
- Modify: `vidro-body/chat.css`, `pages/mensagens/components/ConversationThread.tsx`.
- Test: `__tests__/vidroBody.chat.test.ts`, plus the ConversationThread suite (or create
  `pages/mensagens/components/__tests__/ConversationThread.vidro.test.tsx` with the suite's mocks).

**Interfaces:** Produces the classes `vidro-bubble`, `vidro-bubble--me` and `vidro-bubble--them`.
They are always rendered (inert, with no CSS outside the vidro files).

- [ ] **Step 1: Failing test.**

```ts
const { decl } = loadFamily('chat');
describe('chat.css', () => {
  it('bubbles', () => {
    expect(decl('.vidro-bubble', 'border-radius')).toContain('18px');
    expect(decl('.vidro-bubble--me', 'background').join()).toContain('var(--vd-sel)');
    expect(decl('.vidro-bubble--them', 'background').join()).toContain('var(--vd-fill)');
    expect(decl('.approval-bubble--team', 'background').join()).toContain('var(--vd-sel)');
  });
});
```

  TSX test: render a thread with one own and one received message. The own bubble element has
  `vidro-bubble vidro-bubble--me`; the other has `--them`; the existing Tailwind classes are unchanged.

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
  - In `ConversationThread.tsx` (~146), append ` vidro-bubble vidro-bubble--me` / `--them` to the
    bubble's className by message ownership, keeping everything else.
  - CSS (prefix `PB`):
    - `.vidro-bubble`: `border-radius: 18px; padding: 9px 13px; font-size: 13px; line-height: 1.4;`.
    - `--me`: `background: var(--vd-sel); color: var(--vd-sel-fg); border-bottom-right-radius: 6px;`.
    - `--them`: `background: var(--vd-fill); color: var(--text-main); border-bottom-left-radius: 6px;`.
    - `.approval-bubble--team` gets the `--me` look and `.approval-bubble--client` the `--them` look
      (radius 18px, same paddings), with `border: 0` and their margins kept.
- [ ] **Step 4: Run, expect PASS.** Lint and format.
- [ ] **Step 5: Commit** `feat(crm): Vidro body skin: chat bubbles`.

---

## Wave 3 (serial)

### Task 11: Compositions and real-browser verification

**Files:**
- Modify: `vidro-body/compositions.css`.
- Modify (scratchpad, not committed): the Playwright harness `vidro.mjs` gains the `states`,
  `overlays` and `sidebar` modes.
- Test: `__tests__/vidroBody.compositions.test.ts`.

**Interfaces:** Consumes everything above.

- [ ] **Step 1: Failing test.**

```ts
const { hasSelector } = loadFamily('compositions');
describe('compositions.css', () => {
  it('tables inside cards, buttons in rows, badges in kanban, cards in dialogs', () => {
    expect(hasSelector(".card:has(> [data-slot='table-container'])")).toBe(true);
    expect(hasSelector("[data-slot='table-cell'] [data-slot='button']")).toBe(true);
    expect(hasSelector('.board-card .badge')).toBe(true);
    expect(hasSelector("[data-slot='dialog-content'] [data-slot='card']")).toBe(true);
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement the compositions.**
  - `PB .card:is(:has(> [data-slot='table-container']), :has(.data-table))`: `padding: 4px`.
  - `PB [data-slot='table-cell'] [data-slot='button'][data-size='icon']`: `width: 28px; height: 28px`.
  - `PB :is(.board-card, .board-post-card) .badge`: `font-size: 10px; padding: 1px 7px`.
  - `PO [data-slot='dialog-content'] [data-slot='card']`: `background: var(--vd-tile); border: 0`.
  - Add any composition the sweep (Step 5) shows is needed, each with a one-line comment naming the
    page.

- [ ] **Step 4: Run the gates.** `npm run lint`, `npm run format:check`, the four `tsc`,
  `npm run test`. Expected: green.

- [ ] **Step 5: Browser verification** against the staging dev server, using the existing harness in the
  scratchpad (`shots/vidro.mjs`):
  - Copy `.env.staging` in for this step and delete it afterwards.
  - Seed `sidebar-pinned='0'` in the existing matrix check 6.
  - Add three modes:
    - **`states`:** on Clientes, Entregas (board), Tarefas and Configurações:
      - Tab to a Button, a table row link, a Switch, a Checkbox and an Input. Each `:focus-visible`
        computed `box-shadow` or `outline-style` must not be `none`.
      - Hover a table row and a ghost button. The background must change.
      - A disabled Button must have computed opacity below 1.
    - **`overlays`:** open a Dialog, a DropdownMenu, a Select, a Popover and a Sheet. Screenshot each in
      light and dark.
    - **`sidebar`:** a user with no `sidebar-pinned` key gets a pinned sidebar under Vidro and the rail
      with the flag off. A user with `'0'` gets the rail.
  - Run:
    - the matrix (26 checks plus the new sidebar check);
    - the sweep (21 pages × 1440 light, 1440 dark, 1101 pinned);
    - parity (flag off vs an `origin/main` server: 21 pages, plus the three overlay states);
    - `states`;
    - `overlays`.
  - Fix anything found:
    - a cross-family issue goes in `compositions.css`;
    - a single-family issue is fixed in that family's file, noted in the report as a controller-approved
      cross-file edit.
- [ ] **Step 6: Publish screenshots** to the canvas as a new "Implementado (corpo)" row, following the
  `Impl-*` board pattern.
- [ ] **Step 7: Commit** `feat(crm): Vidro body skin: compositions + verification fixes`.

---

## Self-review notes

- **Spec coverage:**
  - Tokens → Task 1.
  - Hooks (every primitive, plus the hand-placed ones and the calendar) → Task 1.
  - Escapes → Tasks 2, 4, 9 and 10.
  - Families §1-§9 → Tasks 2-10. §10 compositions → Task 11.
  - Sidebar default → Task 1.
  - Contract test → Task 1.
  - Verification → Task 11.
  - Residuals need no task.
- **Interface names used across tasks:**
  - Classes: `vidro-board-action{,--complete,--revert}`, `vidro-empty`, `vidro-bubble{,--me,--them}`,
    `vidro-cal-nav`, `vidro-cal-day`.
  - `useVidro().isResolved`.
  - The `data-slot` values in the spec table.
  - `data-layout='fullscreen'|'default'`.
  - Each name is defined in exactly one task.
