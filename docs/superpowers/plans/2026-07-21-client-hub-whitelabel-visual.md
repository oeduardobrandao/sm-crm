# Client Hub Whitelabel Visual Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle every page of the production Client Hub (`apps/hub/`) to the neutral, editorial whitelabel visual system defined in the design handoff (`Hub Whitelabel.dc.html`), replacing the current amber (`#FFBF30`) accent with a CSS-variable token system driven by the workspace's existing `brand_color`, moving desktop navigation to a fixed sidebar and mobile navigation to a hamburger drawer, restructuring Home to an action-first "cards" layout, and adding a new Mensagens page.

**Architecture:** A pure theme resolver (`theme.ts`) computes light/dark CSS custom properties (`--hub-*`) — including luminance-derived accent-safety fallbacks — from the workspace's `brand_color`. `HubShell` injects these as inline CSS variables at the tree root (replacing the single unused `--brand-color` var it injects today) and lifts the existing `useTheme()` hook so dark-mode state is shared, not duplicated, between the shell and nav. `HubNav.tsx` is replaced by two new components — `HubSidebar` (desktop, fixed 240px) and `HubMobileNav` (compact top bar + right-side hamburger drawer, reusing the existing focus-trap/scroll-lock logic). Every existing page and shared post-card component gets a mechanical token-swap pass: `stone-*`/`amber-*`/`#FFBF30` Tailwind classes and hex literals are replaced by new `.hub-*` utility classes (defined once in `apps/hub/index.html`) that resolve to the CSS variables, so the existing hand-maintained `[data-theme="dark"] .some-tailwind-class {}` override list in `index.html` can be deleted rather than extended. Instagram-brand-chrome colors inside `InstagramPostCard`, `StoryPostCard`, and `InstagramGridPreview` are deliberately left untouched (they mimic real Instagram UI, not the Hub's own design system), and the dashboard's Chart.js-driven charts (`FollowerChart`, `ReachChart`, `PeriodSelector`) keep their existing `#eab308` accent as an explicit, disclosed scope boundary — canvas gradients cannot consume CSS variables and are out of scope for this pass.

**Tech Stack:** React 19, TypeScript, React Router v6, TanStack Query, Tailwind CSS (arbitrary-value `var()` classes), lucide-react, Vitest + Testing Library.

## Global Constraints

- No Supabase migrations, no new edge functions, no CRM admin panel this phase. The only "configuration" input is the workspace's existing `brand_color` column (already a working color picker on the CRM's Configuração page, already returned by `hub-bootstrap`) — do not add a new field, table, or form.
- Accent color = `bootstrap.workspace.brand_color`, resolved through `resolveHubTheme()`. Do not hardcode a new accent literal anywhere in touched files; always reference `var(--hub-acc)` / `var(--hub-acc-fg)`.
- Desktop nav = fixed 240px sidebar ("Lateral" in the handoff). Mobile nav = hamburger drawer ("Hambúrguer"). Home layout = "Cartões" (cards). These three are fixed application defaults for this phase — there is no per-agency switcher yet, so do not build one.
- Keep every existing route (Home, Aprovações, Postagens, Marca, Páginas, Briefing, Ideias, Relatórios) reachable from nav. Nothing is removed. Add Mensagens as a new route/nav item.
- Mensagens ships UI-only: local React state seeded with fixture messages, no persistence, no Supabase table, no edge function, no unread badge (there is no real unread-tracking data source). This mirrors the design handoff's own reference implementation, which is also local-state-only.
- Omit design elements with no real backing feature in production: the "Atualizações" (notifications) sidebar row, the "Favoritos" (Instagram do café / Drive de materiais) shortcut list, the account-switcher chevron button, and the "Configurações"/"Suporte" footer buttons. Do not render dead-end buttons. Keep the existing, genuinely-wired language-cycle and light/dark theme toggle controls instead, placed in the sidebar/drawer footer.
- Reuse the existing `useTheme()` hook (`apps/hub/src/hooks/useTheme.ts`) unchanged — do not rearchitect how dark mode is triggered, only the token *values* it drives. Lift the single `useTheme()` call to `HubShell` and share `{ theme, toggleTheme }` via `HubContext` so the shell (resolving CSS vars) and the nav (rendering the toggle button) never fall out of sync.
- Reuse the fonts already loaded in `apps/hub/index.html` (Fraunces, Instrument Sans) — no new `@font-face` or Google Fonts link.
- Luminance-derived accent-safety rules must match the design handoff exactly: relative luminance `L = 0.2126R + 0.7152G + 0.0722B` (0–1 scale); if dark mode and `L(acc) < 0.18`, fall back to `#F5F5F5`; if light mode and `L(acc) > 0.85`, fall back to `#171717`; `accFg = L(acc) > 0.55 ? '#171717' : '#ffffff'`.
- Status/approval pill tinting uses `color-mix(in srgb, var(--hub-acc) <pct>%, transparent)` — no polyfill, this targets evergreen browsers only.
- Icons: `lucide-react` only, stroke width 1.75 default / 2.25 active, matching the existing convention.
- Instagram-brand chrome (avatar gradient ring, `#0095f6`/`#262626`/`#efefef`/`#8e8e8e`/`#dbdbdb`/`#ed4956`/`#E1306C`, carousel dot colors) inside `InstagramPostCard.tsx`, `StoryPostCard.tsx`, and `InstagramGridPreview.tsx` is explicitly OUT OF SCOPE — leave every one of those literals as-is. Only the non-Instagram-chrome parts of those three files (approval buttons, focus rings, the `#FFBF30` references, the `--border-color`/`--text-light` bug) are touched.
- Dashboard chart accent (`#eab308` in `FollowerChart.tsx`, `ReachChart.tsx`, `PeriodSelector.tsx`) is explicitly OUT OF SCOPE for this phase — Chart.js canvas gradients cannot read CSS custom properties without extra JS plumbing per chart. `DashboardSection.tsx`'s own skeleton/text classes ARE in scope (they're plain Tailwind, not canvas).
- Per-post-type color maps (`PostCalendar.tsx`'s `TIPO_COLOR`, `TopPostsRow.tsx`'s `TIPO_COLORS`) and per-workspace DB-driven property colors (`PostCard.tsx`'s `opt.color`) are semantic/data-driven, not accent-tied — leave their color *values* unchanged; only the surrounding neutral chrome (`stone-*` text/borders) in those same files is tokenized.
- `PostagensPage.tsx`'s `StatusTag`/`STATUS_COLORS`/`STATUS_LABELS` (7-status semantic system: orange/green/red/blue/pink/gold) stay unchanged — they're already theme-independent translucent chips, not part of the amber-accent problem.
- Loading spinners (`animate-spin ... border-stone-300 border-t-stone-900`, repeated verbatim across nearly every page and `HubShell.tsx`'s own loading state) are left as literal `stone` classes everywhere in this plan — they're a transient, low-emphasis loading indicator, not brand-facing chrome, and are explicitly out of scope for the token swap.
- After every task: run its focused test file. After all tasks: `npm run build:hub`, `npm run test`, `npm run lint`, `npm run format:check`.

---

## File Structure

### New files

- `apps/hub/src/theme.ts` — `resolveHubTheme(accentColor, dark)`, `relativeLuminance()`, `ResolvedHubTheme` type.
- `apps/hub/src/theme.test.ts`
- `apps/hub/src/hooks/usePendingApprovalsCount.ts` — shared `useQuery(['hub-posts', token])` + pending-count filter, used by both `HubSidebar` and `HubMobileNav` so the computation isn't duplicated across the two nav surfaces.
- `apps/hub/src/hooks/__tests__/usePendingApprovalsCount.test.tsx`
- `apps/hub/src/components/StatusPill.tsx` — shared tri-tone pill (`accent` / `danger` / `neutral`) used by Home, Aprovações, Postagens' pending pill, Páginas.
- `apps/hub/src/components/__tests__/StatusPill.test.tsx`
- `apps/hub/src/shell/HubSidebar.tsx` — desktop 240px fixed sidebar.
- `apps/hub/src/shell/HubMobileNav.tsx` — mobile top bar + right-side hamburger drawer.
- `apps/hub/src/shell/__tests__/HubSidebar.test.tsx`
- `apps/hub/src/shell/__tests__/HubMobileNav.test.tsx`
- `apps/hub/src/pages/MensagensPage.tsx`
- `apps/hub/src/pages/__tests__/mensagensPage.test.tsx`

### Modified files

- `apps/hub/index.html` — new `--hub-*` CSS variables, new `.hub-*` utility/button/pill classes, delete the old hand-maintained `[data-theme="dark"] .some-class {}` override list.
- `apps/hub/src/HubContext.tsx` — add `theme`/`toggleTheme` to context value.
- `apps/hub/src/shell/HubShell.tsx` — call `useTheme()`, resolve+inject `--hub-*` vars, render `HubSidebar` + `HubMobileNav`, shift content margin for the sidebar.
- `apps/hub/src/router.tsx` — add `mensagens` route.
- `apps/hub/src/pages/HomePage.tsx` — hero, KPI grid, Calendário + Recursos two-column layout.
- `apps/hub/src/pages/AprovacoesPage.tsx`, `PostagensPage.tsx`, `PostagemFocoPage.tsx`, `MarcaPage.tsx`, `PaginasPage.tsx`, `PaginaPage.tsx`, `BriefingPage.tsx`, `IdeiasPage.tsx`, `Relatorios.tsx`, `RelatorioView.tsx` — token-swap pass.
- `apps/hub/src/components/PostCard.tsx`, `FeedPreviewButton.tsx`, `InstagramPostCard.tsx`, `StoryPostCard.tsx`, `TextPostCard.tsx`, `InstagramGridPreview.tsx`, `PostCalendar.tsx`, `components/dashboard/DashboardSection.tsx` — token-swap pass (scoped per Global Constraints).

### Removed

- `apps/hub/src/shell/HubNav.tsx` and `apps/hub/src/shell/__tests__/HubNav.test.tsx` (replaced by `HubSidebar` + `HubMobileNav`).

---

### Task 1: Theme resolver

**Files:**
- Create: `apps/hub/src/theme.ts`
- Test: `apps/hub/src/theme.test.ts`

**Interfaces:**
- Produces: `resolveHubTheme(accentColor: string | null | undefined, dark: boolean): ResolvedHubTheme`, `ResolvedHubTheme = { vars: Record<string, string> }`, `relativeLuminance(hex: string): number` (exported for the test file).

- [ ] **Step 1: Write the failing test**

```ts
// apps/hub/src/theme.test.ts
import { describe, expect, it } from 'vitest';
import { resolveHubTheme, relativeLuminance } from './theme';

describe('relativeLuminance', () => {
  it('computes near-0 for near-black and near-1 for near-white', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 2);
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 2);
  });
});

describe('resolveHubTheme', () => {
  it('light mode: uses the accent as-is when safe, and derives a dark foreground', () => {
    const t = resolveHubTheme('#315c4c', false);
    expect(t.vars['--hub-acc']).toBe('#315c4c');
    expect(t.vars['--hub-acc-fg']).toBe('#ffffff');
    expect(t.vars['--hub-bg']).toBe('#FAFAFA');
    expect(t.vars['--hub-card']).toBe('#FFFFFF');
  });

  it('light mode: falls back to graphite when the accent is too close to white', () => {
    const t = resolveHubTheme('#fefefe', false);
    expect(t.vars['--hub-acc']).toBe('#171717');
    expect(t.vars['--hub-acc-fg']).toBe('#ffffff');
  });

  it('dark mode: falls back to near-white when the accent is too close to black', () => {
    const t = resolveHubTheme('#0a0a0a', true);
    expect(t.vars['--hub-acc']).toBe('#F5F5F5');
    expect(t.vars['--hub-acc-fg']).toBe('#171717');
    expect(t.vars['--hub-bg']).toBe('#0E0E0E');
  });

  it('picks a dark foreground for a light accent, and a light foreground for a dark accent', () => {
    expect(resolveHubTheme('#eab308', false).vars['--hub-acc-fg']).toBe('#171717');
    expect(resolveHubTheme('#171717', false).vars['--hub-acc-fg']).toBe('#ffffff');
  });

  it('defaults to graphite when accentColor is missing or malformed', () => {
    expect(resolveHubTheme(null, false).vars['--hub-acc']).toBe('#171717');
    expect(resolveHubTheme('not-a-color', false).vars['--hub-acc']).toBe('#171717');
    expect(resolveHubTheme('#fff', false).vars['--hub-acc']).toBe('#171717');
  });

  it('sets the dark logo filter only in dark mode', () => {
    expect(resolveHubTheme('#171717', false).vars['--hub-logo-filter']).toBe('none');
    expect(resolveHubTheme('#171717', true).vars['--hub-logo-filter']).toBe(
      'invert(1) brightness(1.6)',
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- theme.test.ts`
Expected: FAIL — `Cannot find module './theme'`.

- [ ] **Step 3: Implement the resolver**

```ts
// apps/hub/src/theme.ts
export interface ResolvedHubTheme {
  vars: Record<string, string>;
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function hexToRgb(hex: string): [number, number, number] {
  const int = parseInt(hex.slice(1), 16);
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => c / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const LIGHT = {
  bg: '#FAFAFA',
  card: '#FFFFFF',
  txt: '#171717',
  tx2: '#525252',
  tx3: '#8A8A8A',
  bd: 'rgba(0,0,0,.08)',
  bd2: 'rgba(0,0,0,.2)',
  soft: '#F4F4F4',
  logoFilter: 'none',
};

const DARK = {
  bg: '#0E0E0E',
  card: '#181818',
  txt: '#F5F5F5',
  tx2: '#B3B3B3',
  tx3: '#8A8A8A',
  bd: 'rgba(255,255,255,.09)',
  bd2: 'rgba(255,255,255,.22)',
  soft: '#242424',
  logoFilter: 'invert(1) brightness(1.6)',
};

export function resolveHubTheme(
  accentColor: string | null | undefined,
  dark: boolean,
): ResolvedHubTheme {
  let acc = accentColor && HEX_RE.test(accentColor) ? accentColor : '#171717';
  const lum = relativeLuminance(acc);
  if (dark && lum < 0.18) acc = '#F5F5F5';
  else if (!dark && lum > 0.85) acc = '#171717';
  const accFg = relativeLuminance(acc) > 0.55 ? '#171717' : '#ffffff';

  const t = dark ? DARK : LIGHT;

  return {
    vars: {
      '--hub-bg': t.bg,
      '--hub-card': t.card,
      '--hub-txt': t.txt,
      '--hub-tx2': t.tx2,
      '--hub-tx3': t.tx3,
      '--hub-bd': t.bd,
      '--hub-bd2': t.bd2,
      '--hub-soft': t.soft,
      '--hub-acc': acc,
      '--hub-acc-fg': accFg,
      '--hub-logo-filter': t.logoFilter,
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- theme.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/hub/src/theme.ts apps/hub/src/theme.test.ts
git commit -m "feat(hub): add whitelabel theme token resolver"
```

---

### Task 2: Global CSS token rewrite (`index.html`)

**Files:**
- Modify: `apps/hub/index.html`

**Interfaces:**
- Consumes: nothing (pure CSS).
- Produces: CSS custom properties `--hub-bg/--hub-card/--hub-txt/--hub-tx2/--hub-tx3/--hub-bd/--hub-bd2/--hub-soft/--hub-acc/--hub-acc-fg/--hub-logo-filter` (values injected per-request by `HubShell` in Task 4, this task only needs *fallback* defaults so the page doesn't flash unstyled before React mounts); new classes `.hub-txt`, `.hub-tx2`, `.hub-tx3`, `.hub-bg-card`, `.hub-bg-soft`, `.hub-border`, `.hub-border-strong`, `.hub-acc-text`, `.hub-btn-primary`, `.hub-btn-secondary`, `.hub-pill`, `.hub-pill-accent`, `.hub-pill-danger`, `.hub-pill-neutral`.

- [ ] **Step 1: Replace the `:root` block and remove the hardcoded amber/dark-mode override list**

Find this block (lines 10–14 of the current file):

```html
    <style>
      :root {
        --hub-font-display: 'Fraunces', ui-serif, Georgia, serif;
        --hub-font-sans: 'Instrument Sans', ui-sans-serif, system-ui, sans-serif;
      }
```

Replace with:

```html
    <style>
      :root {
        --hub-font-display: 'Fraunces', ui-serif, Georgia, serif;
        --hub-font-sans: 'Instrument Sans', ui-sans-serif, system-ui, sans-serif;
        /* Fallback values only — HubShell overrides these inline via resolveHubTheme() before paint. */
        --hub-bg: #FAFAFA;
        --hub-card: #FFFFFF;
        --hub-txt: #171717;
        --hub-tx2: #525252;
        --hub-tx3: #8A8A8A;
        --hub-bd: rgba(0,0,0,.08);
        --hub-bd2: rgba(0,0,0,.2);
        --hub-soft: #F4F4F4;
        --hub-acc: #171717;
        --hub-acc-fg: #ffffff;
        --hub-logo-filter: none;
      }
```

- [ ] **Step 2: Replace `.hub-root` base colors, `.hub-noise`, `.accent-bar`, and `.hub-card` to consume the new variables**

Find:

```html
      .hub-root {
        background-color: #FAFAF7;
        color: #1C1917;
        -webkit-font-smoothing: antialiased;
        text-rendering: optimizeLegibility;
      }
      .hub-root .hub-noise {
        background-image:
          radial-gradient(1200px 600px at 10% -10%, rgba(255, 191, 48, 0.06), transparent 60%),
          radial-gradient(900px 500px at 110% 10%, rgba(28, 25, 23, 0.035), transparent 60%);
      }
      .hub-root .accent-bar {
        display: inline-block;
        width: 6px;
        height: 6px;
        border-radius: 9999px;
        background-color: #FFBF30;
        box-shadow: 0 0 0 4px rgba(255, 191, 48, 0.18);
        margin-right: 10px;
        vertical-align: middle;
      }
      .hub-root .hub-card {
        background-color: #ffffff;
        border: 1px solid rgba(231, 229, 228, 0.9);
        border-radius: 12px;
        box-shadow: 0 1px 0 rgba(0,0,0,0.02), 0 1px 2px rgba(28, 25, 23, 0.04);
      }
      .hub-root .hub-card-hover:hover {
        border-color: rgba(214, 211, 209, 1);
        box-shadow: 0 1px 0 rgba(0,0,0,0.02), 0 6px 16px -8px rgba(28, 25, 23, 0.08);
        transform: translateY(-1px);
      }
```

Replace with:

```html
      .hub-root {
        background-color: var(--hub-bg);
        color: var(--hub-txt);
        -webkit-font-smoothing: antialiased;
        text-rendering: optimizeLegibility;
      }
      .hub-root .hub-noise {
        background-image:
          radial-gradient(1200px 600px at 10% -10%, color-mix(in srgb, var(--hub-acc) 6%, transparent), transparent 60%),
          radial-gradient(900px 500px at 110% 10%, color-mix(in srgb, var(--hub-txt) 3.5%, transparent), transparent 60%);
      }
      .hub-root .accent-bar {
        display: inline-block;
        width: 6px;
        height: 6px;
        border-radius: 9999px;
        background-color: var(--hub-acc);
        box-shadow: 0 0 0 4px color-mix(in srgb, var(--hub-acc) 18%, transparent);
        margin-right: 10px;
        vertical-align: middle;
      }
      .hub-root .hub-card {
        background-color: var(--hub-card);
        border: 1px solid var(--hub-bd);
        border-radius: 12px;
        box-shadow: 0 1px 0 rgba(0,0,0,0.02), 0 1px 2px rgba(28, 25, 23, 0.04);
      }
      .hub-root .hub-card-hover:hover {
        border-color: var(--hub-bd2);
        box-shadow: 0 1px 0 rgba(0,0,0,0.02), 0 6px 16px -8px rgba(28, 25, 23, 0.08);
        transform: translateY(-1px);
      }
      /* Neutral text/surface/border utilities — replace stone-* Tailwind classes in touched files. */
      .hub-root .hub-txt { color: var(--hub-txt); }
      .hub-root .hub-tx2 { color: var(--hub-tx2); }
      .hub-root .hub-tx3 { color: var(--hub-tx3); }
      .hub-root .hub-bg-card { background-color: var(--hub-card); }
      .hub-root .hub-bg-soft { background-color: var(--hub-soft); }
      .hub-root .hub-border { border-color: var(--hub-bd); }
      .hub-root .hub-border-strong { border-color: var(--hub-bd2); }
      .hub-root .hub-acc-text { color: var(--hub-acc); }
      /* Primary/secondary buttons — replaces the repeated `bg-stone-900 text-white hover:bg-stone-800`
         and `border-stone-200 ... hover:bg-stone-50` pairs found across every post-card component. */
      .hub-root .hub-btn-primary {
        background-color: var(--hub-acc);
        color: var(--hub-acc-fg);
        transition: opacity 200ms ease;
      }
      .hub-root .hub-btn-primary:hover { opacity: 0.88; }
      .hub-root .hub-btn-secondary {
        background-color: transparent;
        color: var(--hub-tx2);
        border: 1px solid var(--hub-bd2);
        transition: background-color 200ms ease;
      }
      .hub-root .hub-btn-secondary:hover { background-color: var(--hub-soft); }
      /* Status pills — approved/correction/pending tri-tone, matches StatusPill.tsx tones. */
      .hub-root .hub-pill {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        border-radius: 9999px;
        padding: 0.15rem 0.65rem;
        font-size: 11px;
        font-weight: 600;
      }
      .hub-root .hub-pill-accent {
        background: color-mix(in srgb, var(--hub-acc) 12%, transparent);
        color: var(--hub-acc);
        box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--hub-acc) 35%, transparent);
      }
      .hub-root .hub-pill-danger {
        background: transparent;
        color: #B0472E;
        box-shadow: inset 0 0 0 1px rgba(176,71,46,.4);
      }
      .hub-root .hub-pill-neutral {
        background: transparent;
        color: var(--hub-tx2);
        box-shadow: inset 0 0 0 1px var(--hub-bd2);
      }
```

- [ ] **Step 3: Delete the entire hand-maintained dark-mode override block**

Delete everything from the `/* ── Dark mode ─────────────────────────────────────────── */` comment through the closing brace right before the `/* Mobile audit (#1) ... */` comment — i.e. delete lines (in the original file) from:

```html
      /* ── Dark mode ─────────────────────────────────────────── */
      .hub-root[data-theme="dark"] {
```

through:

```html
      .hub-root[data-theme="dark"] .bg-stone-100.text-stone-700 {
        background-color: #292524;
        color: #A8A29E;
      }
```

(the whole ~78-line block). It is no longer needed: every color that used to require a manual dark-mode override now resolves automatically through `--hub-*` variables, whose *values* flip in `theme.ts`/`HubShell`, not through a parallel Tailwind-class override list. Do NOT delete the `/* Mobile audit (#1) ... */` block and its `@media (max-width: 640px)` rule directly below it — that 16px-input-zoom fix is unrelated to color and must stay.

- [ ] **Step 4: Manually verify no other file references the deleted classes**

Run: `grep -rn "hub-root\[data-theme" apps/hub/index.html`
Expected: no matches (confirms the block was fully removed).

- [ ] **Step 5: Commit**

```bash
git add apps/hub/index.html
git commit -m "feat(hub): replace amber palette with CSS-variable token system"
```

---

### Task 3: `HubContext` shares theme state

**Files:**
- Modify: `apps/hub/src/HubContext.tsx`
- Test: `apps/hub/src/__tests__/HubContext.test.tsx` (extend existing file)

**Interfaces:**
- Produces: `HubContextValue` gains `theme: 'light' | 'dark'` and `toggleTheme: () => void`.
- Consumes: nothing new (values are supplied by whoever constructs the provider — `HubShell` in Task 4).

- [ ] **Step 1: Read the existing test file to match its conventions**

Run: `sed -n '1,40p' apps/hub/src/__tests__/HubContext.test.tsx`

- [ ] **Step 2: Write the failing test addition**

Add to `apps/hub/src/__tests__/HubContext.test.tsx` (inside the existing `describe` block, alongside the existing bootstrap/token assertions):

```tsx
it('exposes theme and toggleTheme from the provider value', () => {
  const toggleTheme = vi.fn();
  function Probe() {
    const { theme, toggleTheme: toggle } = useHub();
    return (
      <button onClick={toggle} data-testid="probe">
        {theme}
      </button>
    );
  }
  render(
    <HubContext.Provider
      value={{ bootstrap: BOOTSTRAP_FIXTURE, token: 't', workspace: 'w', theme: 'dark', toggleTheme }}
    >
      <Probe />
    </HubContext.Provider>,
  );
  const btn = screen.getByTestId('probe');
  expect(btn).toHaveTextContent('dark');
  fireEvent.click(btn);
  expect(toggleTheme).toHaveBeenCalledTimes(1);
});
```

(Reuse whatever bootstrap fixture constant the existing file already defines — do not redefine `BOOTSTRAP_FIXTURE` if one already exists under a different name; match the existing file's naming.)

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test -- HubContext.test.tsx`
Expected: FAIL — TypeScript error, `theme`/`toggleTheme` missing on the provider value type.

- [ ] **Step 4: Extend the context type**

```ts
// apps/hub/src/HubContext.tsx
import { createContext, useContext } from 'react';
import type { HubBootstrap } from './types';

interface HubContextValue {
  bootstrap: HubBootstrap;
  token: string;
  workspace: string;
  theme: 'light' | 'dark';
  toggleTheme: () => void;
}

export const HubContext = createContext<HubContextValue | null>(null);

export function useHub(): HubContextValue {
  const ctx = useContext(HubContext);
  if (!ctx) throw new Error('useHub must be used inside HubContext.Provider');
  return ctx;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -- HubContext.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/hub/src/HubContext.tsx apps/hub/src/__tests__/HubContext.test.tsx
git commit -m "feat(hub): share theme state through HubContext"
```

---

### Task 4: `HubShell` resolves and injects the theme

**Files:**
- Modify: `apps/hub/src/shell/HubShell.tsx`
- Test: `apps/hub/src/shell/__tests__/HubShell.test.tsx` (extend existing file)

**Interfaces:**
- Consumes: `resolveHubTheme` from `../theme` (Task 1), `useTheme` from `../hooks/useTheme` (unchanged), `HubSidebar` from `./HubSidebar` (Task 5), `HubMobileNav` from `./HubMobileNav` (Task 5).
- Produces: renders `<style>` with the full `--hub-*` variable set (replacing the old single `--brand-color` line), provides `theme`/`toggleTheme` on `HubContext`, wraps content with `padding-left: 240px` on desktop for the fixed sidebar.

- [ ] **Step 1: Read the existing test file to match its render/mock conventions**

Run: `sed -n '1,50p' apps/hub/src/shell/__tests__/HubShell.test.tsx`
Note whatever helper it already uses to render `HubShell` with a mocked `fetchBootstrap` and router context (e.g. a `renderWithRouter`/`buildWrapper`-style function) — reuse that exact helper by name in Step 2 below instead of inventing a second one.

- [ ] **Step 2: Write the failing test addition**

Add to `apps/hub/src/shell/__tests__/HubShell.test.tsx`, calling whatever render helper Step 1 found (do not introduce a new one):

```tsx
it('injects resolved --hub-* CSS variables based on workspace brand_color and theme', () => {
  render(<HubShell />, { wrapper: buildRouterWrapper() }); // reuse this file's existing render helper
  const styleTag = document.querySelector('style');
  expect(styleTag?.textContent).toContain('--hub-acc:');
  expect(styleTag?.textContent).toContain('--hub-bg:');
});
```

(Match whatever mock/wrapper helper the existing `HubShell.test.tsx` already uses for `fetchBootstrap` and routing — do not introduce a second mocking strategy.)

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test -- HubShell.test.tsx`
Expected: FAIL — style tag textContent doesn't contain `--hub-acc:`.

- [ ] **Step 4: Rewrite `HubShell.tsx`**

```tsx
// apps/hub/src/shell/HubShell.tsx
import { useEffect, useState } from 'react';
import { Outlet, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { HubContext } from '../HubContext';
import { HubSidebar } from './HubSidebar';
import { HubMobileNav } from './HubMobileNav';
import { useTheme } from '../hooks/useTheme';
import { resolveHubTheme } from '../theme';
import { fetchBootstrap } from '../api';
import type { HubBootstrap } from '../types';

export function HubShell() {
  const { workspace, token } = useParams<{ workspace: string; token: string }>();
  const { t } = useTranslation();
  const [bootstrap, setBootstrap] = useState<HubBootstrap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const { theme, toggleTheme } = useTheme();

  useEffect(() => {
    if (!workspace || !token) return;
    fetchBootstrap(workspace, token)
      .then(setBootstrap)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [workspace, token]);

  useEffect(() => {
    if (!bootstrap?.workspace.logo_url) return;
    let link = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = bootstrap.workspace.logo_url;
  }, [bootstrap]);

  if (loading) {
    return (
      <div className="hub-root min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-stone-300 border-t-stone-900" />
      </div>
    );
  }

  if (error || !bootstrap) {
    return (
      <div className="hub-root min-h-screen flex flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="font-display text-2xl font-medium hub-txt">{t('hub.invalidLink')}</p>
        <p className="text-sm hub-tx2">{error}</p>
      </div>
    );
  }

  if (!bootstrap.is_active) {
    return (
      <div className="hub-root min-h-screen flex flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="font-display text-2xl font-medium hub-txt">{t('hub.accessDisabled')}</p>
        <p className="text-sm hub-tx2">{t('hub.contactAgency')}</p>
      </div>
    );
  }

  const resolved = resolveHubTheme(bootstrap.workspace.brand_color, theme === 'dark');
  const styleText = Object.entries(resolved.vars)
    .map(([k, v]) => `${k}: ${v};`)
    .join(' ');

  return (
    <HubContext.Provider value={{ bootstrap, token: token!, workspace: workspace!, theme, toggleTheme }}>
      <style>{`:root { ${styleText} }`}</style>
      <div className="hub-root min-h-screen flex flex-col">
        <HubSidebar />
        <HubMobileNav />
        <main className="hub-noise flex-1 md:pl-[240px]">
          <div className="mx-auto w-full max-w-5xl px-5 sm:px-8 py-8 sm:py-12 pb-28 md:pb-16">
            <Outlet />
          </div>
        </main>
      </div>
    </HubContext.Provider>
  );
}
```

Note: the loading/error/disabled early-return states above still use raw `border-stone-*`/`hub-txt`/`hub-tx2` — `hub-txt`/`hub-tx2` already resolve via the Task 2 classes and the fallback `:root` values, so they render correctly even before `bootstrap` loads.

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -- HubShell.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/hub/src/shell/HubShell.tsx apps/hub/src/shell/__tests__/HubShell.test.tsx
git commit -m "feat(hub): resolve and inject whitelabel theme variables in HubShell"
```

---

### Task 5: `HubSidebar` + `HubMobileNav` replace `HubNav`

**Files:**
- Create: `apps/hub/src/hooks/usePendingApprovalsCount.ts`
- Create: `apps/hub/src/hooks/__tests__/usePendingApprovalsCount.test.tsx`
- Create: `apps/hub/src/shell/HubSidebar.tsx`
- Create: `apps/hub/src/shell/HubMobileNav.tsx`
- Create: `apps/hub/src/shell/__tests__/HubSidebar.test.tsx`
- Create: `apps/hub/src/shell/__tests__/HubMobileNav.test.tsx`
- Delete: `apps/hub/src/shell/HubNav.tsx`
- Delete: `apps/hub/src/shell/__tests__/HubNav.test.tsx`

**Interfaces:**
- Consumes: `useHub()` (now carrying `theme`/`toggleTheme` per Task 3), `theme`/`toggleTheme` via context (not called directly — the `useTheme()` hook now lives only in `HubShell`).
- Produces: `usePendingApprovalsCount(token: string): number` (shared between both nav components via `../hooks/usePendingApprovalsCount` — do not duplicate its filter logic inline in either component). Both nav components read route params themselves (`useParams`, `useLocation`) exactly like the old `HubNav.tsx` did.

- [ ] **Step 1: Write the failing hook test**

```tsx
// apps/hub/src/hooks/__tests__/usePendingApprovalsCount.test.tsx
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { usePendingApprovalsCount } from '../usePendingApprovalsCount';

vi.mock('../../api', () => ({
  fetchPosts: vi.fn().mockResolvedValue({
    posts: [
      { status: 'enviado_cliente' },
      { status: 'enviado_cliente' },
      { status: 'aprovado_cliente' },
    ],
  }),
}));

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient();
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('usePendingApprovalsCount', () => {
  it('counts only enviado_cliente posts', async () => {
    const { result } = renderHook(() => usePendingApprovalsCount('tok'), { wrapper });
    await waitFor(() => expect(result.current).toBe(2));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- usePendingApprovalsCount.test.tsx`
Expected: FAIL — `Cannot find module '../usePendingApprovalsCount'`.

- [ ] **Step 3: Implement the hook**

```ts
// apps/hub/src/hooks/usePendingApprovalsCount.ts
import { useQuery } from '@tanstack/react-query';
import { fetchPosts } from '../api';

export function usePendingApprovalsCount(token: string): number {
  const { data } = useQuery({ queryKey: ['hub-posts', token], queryFn: () => fetchPosts(token) });
  return (data?.posts ?? []).filter((p) => p.status === 'enviado_cliente').length;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- usePendingApprovalsCount.test.tsx`
Expected: PASS.

- [ ] **Step 5: Write the failing sidebar test**

```tsx
// apps/hub/src/shell/__tests__/HubSidebar.test.tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { HubSidebar } from '../HubSidebar';
import { HubContext } from '../../HubContext';
import type { HubBootstrap } from '../../types';

vi.mock('../../api', () => ({
  fetchPosts: vi.fn().mockResolvedValue({ posts: [], postApprovals: [], instagramProfile: null }),
}));

const BOOTSTRAP: HubBootstrap = {
  workspace: { name: 'Café da Manhã', logo_url: null, brand_color: '#171717' },
  cliente_nome: 'Débora Lima',
  is_active: true,
  cliente_id: 1,
};

function renderSidebar(pathname: string) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[pathname]}>
        <HubContext.Provider
          value={{ bootstrap: BOOTSTRAP, token: 'tok', workspace: 'ws', theme: 'light', toggleTheme: vi.fn() }}
        >
          <Routes>
            <Route path="/:workspace/hub/:token/*" element={<HubSidebar />} />
          </Routes>
        </HubContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('HubSidebar', () => {
  it('renders all nine destinations including the new Mensagens item', () => {
    renderSidebar('/ws/hub/tok');
    for (const label of [
      'Início',
      'Aprovações',
      'Postagens',
      'Páginas',
      'Briefing',
      'Marca',
      'Ideias',
      'Relatórios',
      'Mensagens',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('shows the workspace name and client name, with no account-switcher or notifications row', () => {
    renderSidebar('/ws/hub/tok');
    expect(screen.getByText('Café da Manhã')).toBeInTheDocument();
    expect(screen.getByText('Débora Lima')).toBeInTheDocument();
    expect(screen.queryByText('Atualizações')).not.toBeInTheDocument();
    expect(screen.queryByText('Configurações')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npm run test -- HubSidebar.test.tsx`
Expected: FAIL — `Cannot find module '../HubSidebar'`.

- [ ] **Step 7: Implement `HubSidebar.tsx`**

```tsx
// apps/hub/src/shell/HubSidebar.tsx
import { Link, useLocation, useParams } from 'react-router-dom';
import {
  Home,
  CheckSquare,
  LayoutList,
  FileText,
  BookOpen,
  Palette,
  Lightbulb,
  FileBarChart,
  MessageCircle,
  Sun,
  Moon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useHub } from '../HubContext';
import { usePendingApprovalsCount } from '../hooks/usePendingApprovalsCount';
import { changeLanguage, SUPPORTED_LANGUAGES } from '@mesaas/i18n';
import type { Language } from '@mesaas/i18n';

const LANGUAGE_FLAGS: Record<Language, string> = {
  pt: '\u{1F1E7}\u{1F1F7}',
  en: '\u{1F1FA}\u{1F1F8}',
};

const NAV_ITEMS = [
  { label: 'Início', labelKey: 'nav.home', icon: Home, path: '' },
  { label: 'Aprovações', labelKey: 'nav.aprovacoes', icon: CheckSquare, path: '/aprovacoes' },
  { label: 'Postagens', labelKey: 'nav.postagens', icon: LayoutList, path: '/postagens' },
  { label: 'Páginas', labelKey: 'nav.paginas', icon: FileText, path: '/paginas' },
  { label: 'Briefing', labelKey: 'nav.briefing', icon: BookOpen, path: '/briefing' },
  { label: 'Marca', labelKey: 'nav.marca', icon: Palette, path: '/marca' },
  { label: 'Ideias', labelKey: 'nav.ideias', icon: Lightbulb, path: '/ideias' },
  { label: 'Relatórios', labelKey: 'nav.relatorios', icon: FileBarChart, path: '/relatorios' },
  { label: 'Mensagens', labelKey: 'nav.mensagens', icon: MessageCircle, path: '/mensagens' },
];

function cycleLanguage(current: string) {
  const idx = SUPPORTED_LANGUAGES.indexOf(current as Language);
  changeLanguage(SUPPORTED_LANGUAGES[(idx + 1) % SUPPORTED_LANGUAGES.length]);
}

export function HubSidebar() {
  const { bootstrap, theme, toggleTheme } = useHub();
  const { workspace, token } = useParams<{ workspace: string; token: string }>();
  const { pathname } = useLocation();
  const { t, i18n } = useTranslation();
  const base = `/${workspace}/hub/${token}`;
  const pendingCount = usePendingApprovalsCount(token!);

  const initial = bootstrap.workspace.name.trim().charAt(0).toUpperCase();

  return (
    <aside className="hidden md:flex fixed left-0 top-0 bottom-0 w-[240px] z-30 flex-col hub-bg-card border-r hub-border">
      <div className="flex items-center gap-2.5 px-3.5 pt-4.5 pb-4">
        {bootstrap.workspace.logo_url ? (
          <img
            src={bootstrap.workspace.logo_url}
            alt={bootstrap.workspace.name}
            className="w-9 h-9 rounded-full object-cover flex-shrink-0"
          />
        ) : (
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center font-display text-[16px] font-semibold flex-shrink-0 hub-btn-primary"
            aria-hidden="true"
          >
            {initial}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-[14.5px] tracking-tight truncate hub-txt">
            {bootstrap.workspace.name}
          </div>
          <div className="text-[11.5px] hub-tx3">{t('hub.clientPortal', 'Hub do cliente')}</div>
        </div>
      </div>
      <nav className="flex flex-col gap-0.5 px-3 py-3 border-t hub-border overflow-y-auto">
        {NAV_ITEMS.map(({ label, labelKey, icon: Icon, path }) => {
          const href = `${base}${path}`;
          const active = path === '' ? pathname === base : pathname.startsWith(`${base}${path}`);
          const badge = path === '/aprovacoes' ? pendingCount : null;
          return (
            <Link
              key={path}
              to={href}
              className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-[13.5px] min-h-[40px] transition-colors ${
                active ? 'font-semibold hub-txt hub-bg-soft' : 'font-medium hub-tx2 hover:hub-bg-soft'
              }`}
            >
              <Icon size={17} strokeWidth={active ? 2.25 : 1.75} />
              <span className="flex-1">{t(labelKey, label)}</span>
              {!!badge && (
                <span className="min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center hub-btn-primary">
                  {badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto flex items-center gap-2 px-3.5 py-3.5 border-t hub-border">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold truncate hub-txt">{bootstrap.cliente_nome}</div>
        </div>
        <button
          onClick={() => cycleLanguage(i18n.language)}
          aria-label={t('sidebar.language')}
          className="w-8 h-8 flex items-center justify-center rounded-full hub-tx3 hover:hub-bg-soft transition-colors text-sm"
        >
          {LANGUAGE_FLAGS[i18n.language as Language] || LANGUAGE_FLAGS.pt}
        </button>
        <button
          onClick={toggleTheme}
          aria-label={theme === 'dark' ? t('sidebar.lightMode') : t('sidebar.darkMode')}
          className="w-8 h-8 flex items-center justify-center rounded-full hub-tx3 hover:hub-bg-soft transition-colors"
        >
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </div>
    </aside>
  );
}
```

- [ ] **Step 8: Run the sidebar test to verify it passes**

Run: `npm run test -- HubSidebar.test.tsx`
Expected: PASS.

- [ ] **Step 9: Write the failing mobile-nav test**

```tsx
// apps/hub/src/shell/__tests__/HubMobileNav.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { HubMobileNav } from '../HubMobileNav';
import { HubContext } from '../../HubContext';
import type { HubBootstrap } from '../../types';

vi.mock('../../api', () => ({
  fetchPosts: vi.fn().mockResolvedValue({ posts: [], postApprovals: [], instagramProfile: null }),
}));

const BOOTSTRAP: HubBootstrap = {
  workspace: { name: 'Café da Manhã', logo_url: null, brand_color: '#171717' },
  cliente_nome: 'Débora Lima',
  is_active: true,
  cliente_id: 1,
};

function renderMobileNav() {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/ws/hub/tok']}>
        <HubContext.Provider
          value={{ bootstrap: BOOTSTRAP, token: 'tok', workspace: 'ws', theme: 'light', toggleTheme: vi.fn() }}
        >
          <Routes>
            <Route path="/:workspace/hub/:token/*" element={<HubMobileNav />} />
          </Routes>
        </HubContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('HubMobileNav', () => {
  it('opens a right-side drawer with all nine destinations and closes on Escape', () => {
    renderMobileNav();
    fireEvent.click(screen.getByRole('button', { name: /abrir menu|open menu/i }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText('Mensagens')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 10: Run test to verify it fails**

Run: `npm run test -- HubMobileNav.test.tsx`
Expected: FAIL — `Cannot find module '../HubMobileNav'`.

- [ ] **Step 11: Implement `HubMobileNav.tsx`**, reusing the existing focus-trap/scroll-lock effect from the old `HubNav.tsx`'s "Mais" sheet, widened to cover all nine items and slid from the right instead of the bottom:

```tsx
// apps/hub/src/shell/HubMobileNav.tsx
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import {
  Home,
  CheckSquare,
  LayoutList,
  FileText,
  BookOpen,
  Palette,
  Lightbulb,
  FileBarChart,
  MessageCircle,
  Menu,
  X,
  Sun,
  Moon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useHub } from '../HubContext';
import { usePendingApprovalsCount } from '../hooks/usePendingApprovalsCount';

const NAV_ITEMS = [
  { label: 'Início', labelKey: 'nav.home', icon: Home, path: '' },
  { label: 'Aprovações', labelKey: 'nav.aprovacoes', icon: CheckSquare, path: '/aprovacoes' },
  { label: 'Postagens', labelKey: 'nav.postagens', icon: LayoutList, path: '/postagens' },
  { label: 'Páginas', labelKey: 'nav.paginas', icon: FileText, path: '/paginas' },
  { label: 'Briefing', labelKey: 'nav.briefing', icon: BookOpen, path: '/briefing' },
  { label: 'Marca', labelKey: 'nav.marca', icon: Palette, path: '/marca' },
  { label: 'Ideias', labelKey: 'nav.ideias', icon: Lightbulb, path: '/ideias' },
  { label: 'Relatórios', labelKey: 'nav.relatorios', icon: FileBarChart, path: '/relatorios' },
  { label: 'Mensagens', labelKey: 'nav.mensagens', icon: MessageCircle, path: '/mensagens' },
];

export function HubMobileNav() {
  const { bootstrap, theme, toggleTheme } = useHub();
  const { workspace, token } = useParams<{ workspace: string; token: string }>();
  const { pathname } = useLocation();
  const { t } = useTranslation();
  const base = `/${workspace}/hub/${token}`;
  const pendingCount = usePendingApprovalsCount(token!);

  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstItemRef = useRef<HTMLAnchorElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        return;
      }
      if (e.key !== 'Tab') return;
      const focusables = drawerRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled])',
      );
      if (!focusables || focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    firstItemRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      triggerRef.current?.focus();
    };
  }, [open]);

  return (
    <>
      <header className="md:hidden sticky top-0 z-20 h-[54px] px-5 flex items-center justify-between border-b hub-border hub-bg-card">
        <span className="font-display text-[15px] font-medium hub-txt">{bootstrap.workspace.name}</span>
        <div className="flex items-center gap-2">
          <span className="text-[11px] hub-tx3 truncate max-w-[100px]">{bootstrap.cliente_nome}</span>
          <button
            type="button"
            ref={triggerRef}
            aria-label={t('nav.openMenu', 'Abrir menu')}
            aria-haspopup="dialog"
            aria-expanded={open}
            onClick={() => setOpen(true)}
            className="w-10 h-10 rounded-lg border hub-border flex items-center justify-center hub-txt"
          >
            <Menu size={18} />
          </button>
        </div>
      </header>

      {open && (
        <div className="md:hidden fixed inset-0 z-40">
          <div className="absolute inset-0 bg-black/35" onClick={() => setOpen(false)} aria-hidden="true" />
          <div
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label={t('nav.menu', 'Menu')}
            className="hub-fade-up absolute top-0 right-0 bottom-0 w-[min(300px,84vw)] hub-bg-card border-l hub-border flex flex-col p-3 overflow-y-auto shadow-[0_20px_40px_rgba(0,0,0,.15)]"
          >
            <div className="flex items-center justify-between px-2 pb-3.5">
              <span className="font-display text-[15px] font-medium hub-txt">{bootstrap.workspace.name}</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t('actions.close', 'Fechar')}
                className="w-9 h-9 rounded-full flex items-center justify-center hub-tx2 hover:hub-bg-soft"
              >
                <X size={18} />
              </button>
            </div>
            <nav className="flex flex-col gap-0.5">
              {NAV_ITEMS.map(({ label, labelKey, icon: Icon, path }, i) => {
                const href = `${base}${path}`;
                const active = path === '' ? pathname === base : pathname.startsWith(`${base}${path}`);
                const badge = path === '/aprovacoes' ? pendingCount : null;
                return (
                  <Link
                    key={path}
                    to={href}
                    ref={i === 0 ? firstItemRef : undefined}
                    onClick={() => setOpen(false)}
                    className={`flex items-center gap-3 px-3 py-3 rounded-lg min-h-[48px] transition-colors ${
                      active ? 'font-semibold hub-txt hub-bg-soft' : 'font-medium hub-tx2 hover:hub-bg-soft'
                    }`}
                  >
                    <Icon size={18} strokeWidth={active ? 2.25 : 1.75} />
                    <span className="flex-1 text-[15px]">{t(labelKey, label)}</span>
                    {!!badge && (
                      <span className="min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center hub-btn-primary">
                        {badge}
                      </span>
                    )}
                  </Link>
                );
              })}
            </nav>
            <div className="mt-auto flex items-center gap-3 px-2 pt-3.5 border-t hub-border">
              <div className="flex-1">
                <div className="text-[13.5px] font-semibold hub-txt">{bootstrap.cliente_nome}</div>
              </div>
              <button
                onClick={toggleTheme}
                aria-label={theme === 'dark' ? t('sidebar.lightMode') : t('sidebar.darkMode')}
                className="w-9 h-9 flex items-center justify-center rounded-full hub-tx2 hover:hub-bg-soft"
              >
                {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 12: Run test to verify it passes**

Run: `npm run test -- HubMobileNav.test.tsx`
Expected: PASS.

- [ ] **Step 13: Delete the old nav file and its test**

```bash
git rm apps/hub/src/shell/HubNav.tsx apps/hub/src/shell/__tests__/HubNav.test.tsx
```

- [ ] **Step 14: Run the full Hub test suite to confirm nothing else imports `HubNav`**

Run: `grep -rn "HubNav" apps/hub/src --include="*.tsx" --include="*.ts"`
Expected: no matches.

Run: `npm run test -- apps/hub`
Expected: PASS (no leftover references break other suites).

- [ ] **Step 15: Commit**

```bash
git add apps/hub/src/shell
git commit -m "feat(hub): replace HubNav with sidebar + hamburger drawer navigation"
```

---

### Task 6: Add the Mensagens route and page

**Files:**
- Create: `apps/hub/src/pages/MensagensPage.tsx`
- Create: `apps/hub/src/pages/__tests__/mensagensPage.test.tsx`
- Modify: `apps/hub/src/router.tsx`

**Interfaces:**
- Produces: `MensagensPage` component, local-only, no exported hooks.
- Consumes: `useHub()` for `bootstrap.cliente_nome` (chat header).

- [ ] **Step 1: Write the failing test**

```tsx
// apps/hub/src/pages/__tests__/mensagensPage.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MensagensPage } from '../MensagensPage';
import { HubContext } from '../../HubContext';
import type { HubBootstrap } from '../../types';

const BOOTSTRAP: HubBootstrap = {
  workspace: { name: 'Café da Manhã', logo_url: null, brand_color: '#171717' },
  cliente_nome: 'Débora Lima',
  is_active: true,
  cliente_id: 1,
};

function renderPage() {
  return render(
    <HubContext.Provider
      value={{ bootstrap: BOOTSTRAP, token: 'tok', workspace: 'ws', theme: 'light', toggleTheme: vi.fn() }}
    >
      <MensagensPage />
    </HubContext.Provider>,
  );
}

describe('MensagensPage', () => {
  it('seeds fixture messages and appends a new one on send', () => {
    renderPage();
    expect(screen.getByText(/subi o reels/i)).toBeInTheDocument();
    const input = screen.getByPlaceholderText(/enviar mensagem/i);
    fireEvent.change(input, { target: { value: 'Perfeito, obrigado!' } });
    fireEvent.click(screen.getByRole('button', { name: /enviar/i }));
    expect(screen.getByText('Perfeito, obrigado!')).toBeInTheDocument();
    expect(input).toHaveValue('');
  });

  it('sends on Enter and ignores empty submissions', () => {
    renderPage();
    const input = screen.getByPlaceholderText(/enviar mensagem/i);
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.change(input, { target: { value: '  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.change(input, { target: { value: 'Oi!' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByText('Oi!')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- mensagensPage.test.tsx`
Expected: FAIL — `Cannot find module '../MensagensPage'`.

- [ ] **Step 3: Implement `MensagensPage.tsx`**

```tsx
// apps/hub/src/pages/MensagensPage.tsx
import { useState } from 'react';
import { useHub } from '../HubContext';

interface Message {
  id: number;
  from: 'me' | 'them';
  text: string;
  time: string;
}

const SEED_MESSAGES: Message[] = [
  { id: 1, from: 'them', text: 'Oi! Subi o reels, dá uma olhada.', time: '10:42' },
  { id: 2, from: 'me', text: 'Aprovado! Só troca o CTA no final.', time: '10:58' },
  { id: 3, from: 'them', text: 'Feito! Subi a nova versão.', time: '11:04' },
];

export function MensagensPage() {
  const { bootstrap } = useHub();
  const [messages, setMessages] = useState<Message[]>(SEED_MESSAGES);
  const [draft, setDraft] = useState('');

  function send() {
    const text = draft.trim();
    if (!text) return;
    setMessages((prev) => [...prev, { id: prev.length + 1, from: 'me', text, time: 'agora' }]);
    setDraft('');
  }

  return (
    <div className="flex flex-col gap-4 hub-fade-up">
      <header>
        <p className="text-[13px] font-medium hub-tx3 mb-1">Comunicação</p>
        <h1 className="font-display text-[1.7rem] sm:text-[2.4rem] font-medium tracking-tight hub-txt">
          Mensagens
        </h1>
      </header>
      <div className="hub-card flex flex-col min-h-[480px] overflow-hidden">
        <div className="flex items-center gap-3 px-4.5 py-3.5 border-b hub-border">
          <div className="w-[38px] h-[38px] rounded-full hub-bg-soft flex items-center justify-center text-[13px] font-semibold hub-txt">
            {bootstrap.cliente_nome
              .split(' ')
              .slice(0, 2)
              .map((p) => p.charAt(0).toUpperCase())
              .join('')}
          </div>
          <div className="flex-1">
            <div className="font-semibold text-[15px] hub-txt">{bootstrap.cliente_nome}</div>
            <div className="text-[12px] hub-tx3">Online</div>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-3" style={{ background: 'var(--hub-bg)' }}>
          {messages.map((m) => (
            <div key={m.id} className={`max-w-[72%] ${m.from === 'me' ? 'self-end' : 'self-start'}`}>
              <div
                className={`px-3.5 py-2.5 rounded-2xl text-sm ${
                  m.from === 'me' ? 'hub-btn-primary' : 'hub-bg-card'
                }`}
                style={m.from === 'them' ? { boxShadow: 'inset 0 0 0 1px var(--hub-bd)' } : undefined}
              >
                {m.text}
              </div>
              <span className={`block mt-1 text-[11px] hub-tx3 ${m.from === 'me' ? 'text-right' : 'text-left'}`}>
                {m.time}
              </span>
            </div>
          ))}
        </div>
        <div className="flex gap-2 p-3.5 border-t hub-border">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') send();
            }}
            placeholder="Enviar mensagem…"
            className="flex-1 px-4.5 py-3 rounded-full border hub-border-strong text-sm outline-none"
            style={{ background: 'var(--hub-bg)', color: 'var(--hub-txt)' }}
          />
          <button onClick={send} className="px-5 py-3 rounded-full text-[13px] font-semibold hub-btn-primary">
            Enviar
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- mensagensPage.test.tsx`
Expected: PASS.

- [ ] **Step 5: Add the route**

In `apps/hub/src/router.tsx`, add after the `relatorios/:month` route (before the closing `]`  of the `children` array):

```tsx
      {
        path: 'mensagens',
        lazy: async () => ({ Component: (await import('./pages/MensagensPage')).MensagensPage }),
      },
```

- [ ] **Step 6: Run the router test**

Run: `npm run test -- router.test.tsx`
Expected: PASS (extend the existing router test file with one assertion that `/mensagens` resolves, matching how other lazy routes are already asserted there).

- [ ] **Step 7: Commit**

```bash
git add apps/hub/src/pages/MensagensPage.tsx apps/hub/src/pages/__tests__/mensagensPage.test.tsx apps/hub/src/router.tsx apps/hub/src/__tests__/router.test.tsx
git commit -m "feat(hub): add local-only Mensagens page and route"
```

---

### Task 7: `StatusPill` shared component

**Files:**
- Create: `apps/hub/src/components/StatusPill.tsx`
- Create: `apps/hub/src/components/__tests__/StatusPill.test.tsx`

**Interfaces:**
- Produces: `StatusPill({ tone: 'accent' | 'danger' | 'neutral', children }): JSX.Element`.
- Consumes: the `.hub-pill`/`.hub-pill-accent`/`.hub-pill-danger`/`.hub-pill-neutral` classes from Task 2.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/hub/src/components/__tests__/StatusPill.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusPill } from '../StatusPill';

describe('StatusPill', () => {
  it.each([
    ['accent', 'hub-pill-accent'],
    ['danger', 'hub-pill-danger'],
    ['neutral', 'hub-pill-neutral'],
  ] as const)('renders the %s tone with the %s class', (tone, expectedClass) => {
    render(<StatusPill tone={tone}>Label</StatusPill>);
    expect(screen.getByText('Label')).toHaveClass('hub-pill', expectedClass);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- StatusPill.test.tsx`
Expected: FAIL — `Cannot find module '../StatusPill'`.

- [ ] **Step 3: Implement**

```tsx
// apps/hub/src/components/StatusPill.tsx
import type { ReactNode } from 'react';

export type PillTone = 'accent' | 'danger' | 'neutral';

export function StatusPill({ tone, children }: { tone: PillTone; children: ReactNode }) {
  return <span className={`hub-pill hub-pill-${tone}`}>{children}</span>;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- StatusPill.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/hub/src/components/StatusPill.tsx apps/hub/src/components/__tests__/StatusPill.test.tsx
git commit -m "feat(hub): add shared StatusPill component"
```

---

### Task 8: `HomePage` rewrite — action-first cards layout

**Files:**
- Modify: `apps/hub/src/pages/HomePage.tsx`
- Test: `apps/hub/src/pages/__tests__/homePage.test.tsx` (new — no existing dedicated file per the earlier inventory; check `apps/hub/src/pages/__tests__/` first in case coverage was consolidated elsewhere before adding a new one)

**Interfaces:**
- Consumes: `fetchPosts` (existing), `StatusPill` (Task 7).
- Produces: no new exports; same `HomePage()` signature.

- [ ] **Step 1: Check for existing Home coverage before adding a new test file**

Run: `grep -rl "HomePage" apps/hub/src/pages/__tests__/`
If a file already renders `HomePage`, extend it instead of creating a new one; otherwise create `apps/hub/src/pages/__tests__/homePage.test.tsx`.

- [ ] **Step 2: Write the failing test**

```tsx
// apps/hub/src/pages/__tests__/homePage.test.tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { HomePage } from '../HomePage';
import { HubContext } from '../../HubContext';
import type { HubBootstrap } from '../../types';

vi.mock('../../api', () => ({
  fetchPosts: vi.fn().mockResolvedValue({
    posts: [
      {
        id: 1,
        titulo: 'Novo cardápio',
        tipo: 'reels',
        status: 'enviado_cliente',
        scheduled_at: new Date(Date.now() + 86400000).toISOString(),
        media: [],
        ordem: 0,
        workflow_id: 1,
        workflow_titulo: 'Maio',
        workflow_created_at: new Date().toISOString(),
      },
    ],
    postApprovals: [],
    instagramProfile: null,
  }),
}));

const BOOTSTRAP: HubBootstrap = {
  workspace: { name: 'Café da Manhã', logo_url: null, brand_color: '#171717' },
  cliente_nome: 'Débora Lima',
  is_active: true,
  cliente_id: 1,
};

function renderHome() {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/ws/hub/tok']}>
        <HubContext.Provider
          value={{ bootstrap: BOOTSTRAP, token: 'tok', workspace: 'ws', theme: 'light', toggleTheme: vi.fn() }}
        >
          <Routes>
            <Route path="/:workspace/hub/:token" element={<HomePage />} />
          </Routes>
        </HubContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('HomePage', () => {
  it('greets the client and shows a KPI grid with a clickable pending-approvals card', async () => {
    renderHome();
    expect(await screen.findByText(/Débora/)).toBeInTheDocument();
    expect(screen.getByText('Aprovações pendentes')).toBeInTheDocument();
    expect(screen.getByText('Posts este mês')).toBeInTheDocument();
    expect(screen.getByText('Taxa de aprovação')).toBeInTheDocument();
    expect(screen.getByText('Próximo post')).toBeInTheDocument();
  });

  it('does not render a fabricated "Na agência" team card', async () => {
    renderHome();
    await screen.findByText(/Débora/);
    expect(screen.queryByText('Na agência')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test -- homePage.test.tsx`
Expected: FAIL — KPI labels don't exist yet in the current markup.

- [ ] **Step 4: Rewrite `HomePage.tsx`**

```tsx
// apps/hub/src/pages/HomePage.tsx
import { useNavigate, useParams } from 'react-router-dom';
import {
  CheckSquare,
  Palette,
  FileText,
  BookOpen,
  Lightbulb,
  ChevronRight,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useHub } from '../HubContext';
import { fetchPosts } from '../api';
import { PostCalendar } from '../components/PostCalendar';
import { DashboardSection } from '../components/dashboard/DashboardSection';

const RESOURCE_LINKS = [
  { label: 'Marca', icon: Palette, path: '/marca' },
  { label: 'Páginas', icon: FileText, path: '/paginas' },
  { label: 'Briefing', icon: BookOpen, path: '/briefing' },
  { label: 'Ideias', icon: Lightbulb, path: '/ideias' },
];

const CALENDAR_STATUSES = new Set([
  'enviado_cliente',
  'aprovado_cliente',
  'correcao_cliente',
  'agendado',
  'publicado',
]);

function formatNextPost(scheduledAt: string): string {
  const date = new Date(scheduledAt);
  const weekday = date.toLocaleDateString('pt-BR', { weekday: 'short' });
  const time = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return `${weekday.replace('.', '')} ${time}`;
}

export function HomePage() {
  const { bootstrap, token } = useHub();
  const { workspace } = useParams<{ workspace: string }>();
  const navigate = useNavigate();
  const base = `/${workspace}/hub/${token}`;

  const { data, isLoading } = useQuery({
    queryKey: ['hub-posts', token],
    queryFn: () => fetchPosts(token),
  });

  const allPosts = data?.posts ?? [];
  const pendingCount = allPosts.filter((p) => p.status === 'enviado_cliente').length;
  const posts = allPosts.filter((p) => CALENDAR_STATUSES.has(p.status));

  const now = new Date();
  const thisMonthCount = allPosts.filter((p) => {
    if (!p.scheduled_at) return false;
    const d = new Date(p.scheduled_at);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  }).length;

  const decided = allPosts.filter(
    (p) => p.status === 'aprovado_cliente' || p.status === 'correcao_cliente',
  );
  const approvalRate =
    decided.length === 0
      ? '—'
      : `${Math.round((decided.filter((p) => p.status === 'aprovado_cliente').length / decided.length) * 100)}%`;

  const upcoming = allPosts
    .filter((p) => p.scheduled_at && new Date(p.scheduled_at) >= now)
    .sort((a, b) => (a.scheduled_at ?? '').localeCompare(b.scheduled_at ?? ''));
  const nextPost = upcoming[0];

  const firstName = bootstrap.cliente_nome.split(' ')[0];

  const kpis = [
    { label: 'Posts este mês', value: String(thisMonthCount), hint: 'Feed, Reels, Stories' },
    {
      label: 'Aprovações pendentes',
      value: String(pendingCount),
      hint: pendingCount ? `${pendingCount} para revisar` : 'Tudo em dia',
      onClick: () => navigate(`${base}/aprovacoes`),
    },
    { label: 'Taxa de aprovação', value: approvalRate, hint: 'Aprovados vs. correção' },
    {
      label: 'Próximo post',
      value: nextPost ? formatNextPost(nextPost.scheduled_at!) : '—',
      hint: nextPost?.titulo ?? 'Nada agendado',
    },
  ];

  return (
    <div className="hub-fade-up flex flex-col gap-6">
      <section>
        <p className="text-[13px] font-medium hub-tx3 mb-1.5">{bootstrap.workspace.name}</p>
        <h1 className="font-display font-medium text-[clamp(2rem,5vw,3rem)] leading-[1.04] tracking-tight hub-txt mb-1.5">
          Olá, <em className="italic font-normal">{firstName}</em> 👋
        </h1>
      </section>

      <section className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
        {kpis.map((k) => (
          <div
            key={k.label}
            onClick={k.onClick}
            className={`hub-card p-4 ${k.onClick ? 'hub-card-hover cursor-pointer' : ''}`}
          >
            <div className="text-[15px] font-semibold tracking-tight hub-txt">{k.label}</div>
            <div className="text-[12.5px] hub-tx3 mt-0.5 mb-3.5">{k.hint}</div>
            <div className="font-display text-[2.1rem] font-medium tracking-tight leading-none hub-txt">
              {k.value}
            </div>
          </div>
        ))}
      </section>

      <section className="grid gap-3.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
        <div className="hub-card p-5">
          <h3 className="font-semibold text-[16px] tracking-tight hub-txt">Calendário</h3>
          <div className="text-[12.5px] hub-tx3 mt-0.5 mb-2.5">Próximas publicações</div>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin h-5 w-5 rounded-full border-2 border-stone-300 border-t-stone-900" />
            </div>
          ) : (
            <PostCalendar posts={posts} />
          )}
        </div>
        <div className="hub-card p-5 flex flex-col gap-3">
          <div>
            <h3 className="font-semibold text-[16px] tracking-tight hub-txt">Recursos</h3>
            <div className="text-[12.5px] hub-tx3 mt-0.5">Acesso rápido</div>
          </div>
          <div className="flex flex-col">
            {RESOURCE_LINKS.map(({ label, icon: Icon, path }) => (
              <button
                key={path}
                onClick={() => navigate(`${base}${path}`)}
                className="flex items-center gap-3 py-2.5 border-t hub-border first:border-t-0 text-left group"
              >
                <span className="w-8 h-8 rounded-lg hub-bg-soft flex items-center justify-center hub-tx2 flex-shrink-0">
                  <Icon size={16} strokeWidth={1.75} />
                </span>
                <span className="flex-1 text-[14px] font-medium hub-txt">{label}</span>
                <ChevronRight size={16} className="hub-tx3 group-hover:translate-x-0.5 transition-transform" />
              </button>
            ))}
          </div>
        </div>
      </section>

      <DashboardSection />
    </div>
  );
}
```

`DashboardSection` (the existing Instagram follower/reach chart summary) is kept and rendered below the Calendário/Recursos grid — the design handoff's own "cards" home mock doesn't show an analytics section at all, but dropping it would silently remove a real, working feature, which contradicts this plan's "keep existing functionality" constraint. Its own visual retint is handled separately in Task 17.

Note: `CheckSquare` import stays unused if no pending banner is rendered above the KPI grid — remove it from the import list since ESLint's `no-unused-vars` will fail the build otherwise (the pending-approvals highlight is now expressed via the clickable KPI card, not a separate banner).

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -- homePage.test.tsx`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `npm run build:hub`
Expected: no TypeScript errors (in particular, confirm the unused `CheckSquare` import was actually removed).

- [ ] **Step 7: Commit**

```bash
git add apps/hub/src/pages/HomePage.tsx apps/hub/src/pages/__tests__/homePage.test.tsx
git commit -m "feat(hub): rewrite Home as an action-first KPI + resources layout"
```

---

### Task 9: Token-swap pass — `AprovacoesPage.tsx`, `PostagensPage.tsx`, `PostagemFocoPage.tsx`

**Files:**
- Modify: `apps/hub/src/pages/AprovacoesPage.tsx`, `apps/hub/src/pages/PostagensPage.tsx`, `apps/hub/src/pages/PostagemFocoPage.tsx`
- Test: run the existing `apps/hub/src/pages/__tests__/aprovacoesPostagensFeatures.test.tsx` and `postagemFocoPage.test.tsx` (no new tests needed — this is a pure class-swap, behavior is unchanged)

**Interfaces:**
- Consumes: the `.hub-*` classes from Task 2. `PostagensPage.tsx`'s `StatusTag`/`STATUS_COLORS`/`STATUS_LABELS` are explicitly UNCHANGED per Global Constraints.

- [ ] **Step 1: Run the existing tests first to get a green baseline**

Run: `npm run test -- aprovacoesPostagensFeatures.test.tsx postagemFocoPage.test.tsx`
Expected: PASS (confirms no accidental behavior change before starting).

- [ ] **Step 2: Apply the mapping table to `AprovacoesPage.tsx`**

| Old | New |
|---|---|
| `text-stone-500` (eyebrow label, line 68) | `hub-tx3` |
| `text-stone-900` (h2, line 73) | `hub-txt` |
| `text-stone-500` (subtitle, line 80) | `hub-tx2` |
| `text-stone-400` (hint text, line 90) | `hub-tx3` |
| `border-stone-200` (section divider, line 139/175) | `hub-border` |
| `text-stone-500` (section divider label, lines 141, 179) | `hub-tx3` |
| `text-stone-400` (per-card date label, lines 112, 150, 188) | `hub-tx3` |

Concretely, line 73 changes from:
```tsx
<h2 className="font-display text-[2rem] sm:text-[2.25rem] leading-[1.05] font-medium tracking-tight text-stone-900">
```
to:
```tsx
<h2 className="font-display text-[2rem] sm:text-[2.25rem] leading-[1.05] font-medium tracking-tight hub-txt">
```
Apply the same literal substitution pattern (replace the trailing `text-stone-NNN`/`border-stone-NNN` token with its mapped `hub-*` class, leaving every other class in the string untouched) at each of the other six sites listed above.

- [ ] **Step 3: Apply the mapping table to `PostagensPage.tsx`**

Same eyebrow/heading/hint pattern as `AprovacoesPage.tsx` (lines 189, 194, 205, 226, 249, 252, 256, 262 — eyebrow, h2, hint text, empty state, group title, group count, "clique para expandir" hint, chevron color) plus:

| Old | New |
|---|---|
| `bg-stone-300` (group-divider rule, line 248) | replace with `style={{ background: 'var(--hub-bd2)' }}` (this one is a 1px rule bar, not text/bg-surface — use the strong border variable directly since there's no `.hub-bg-border-strong` utility; simplest is an inline style since it's a single 1px decorative bar) |
| `text-stone-400` (ml-auto ChevronDown className, line 262) | `hub-tx3` |

Do NOT touch `STATUS_COLORS`, `STATUS_LABELS`, or the `StatusTag` component (lines 16–77) — these are semantic per Global Constraints.

- [ ] **Step 4: Apply the mapping table to `PostagemFocoPage.tsx`**

| Old | New |
|---|---|
| `text-stone-500` (back link, error text, "not available" text) | `hub-tx3` / `hub-tx2` as appropriate to preserve the existing visual hierarchy (back link → `hub-tx3`, error/not-available body copy → `hub-tx2`) |
| `hover:text-stone-900` (back link hover) | `hover:hub-txt` (Tailwind supports arbitrary custom classes in `hover:` variants only if they're utilities generated by Tailwind's engine — since `hub-txt` is a hand-written CSS class, not a Tailwind utility, `hover:hub-txt` will NOT work as a Tailwind variant. Instead wrap with a plain CSS rule: add `.hub-root a.hub-back-link:hover { color: var(--hub-txt); }` to `index.html` in this task, and give the back-link `<Link>`/`<button>` the class `hub-back-link` in addition to `hub-tx3`.) |
| `decoration-[#FFBF30]` (line 47, retry link) | `style={{ textDecorationColor: 'var(--hub-acc)' }}` added alongside the existing className (Tailwind arbitrary-value `decoration-[...]` cannot reference a hand-written CSS custom property class, but it CAN reference a raw `var()` directly: use `decoration-[var(--hub-acc)]` in the className instead of the style-prop workaround — confirm this compiles by running step 6 below) |

- [ ] **Step 5: Add the one supporting CSS rule from step 4**

In `apps/hub/index.html`, inside the `.hub-root` rule block added in Task 2, add:

```css
      .hub-root .hub-back-link:hover { color: var(--hub-txt); }
```

- [ ] **Step 6: Run the existing tests to verify no regression**

Run: `npm run test -- aprovacoesPostagensFeatures.test.tsx postagemFocoPage.test.tsx`
Expected: PASS (unchanged assertions, since these are pure class renames).

- [ ] **Step 7: Grep-verify no leftover old classes in the three files**

Run: `grep -n "text-stone-\|bg-stone-\|border-stone-\|#FFBF30" apps/hub/src/pages/AprovacoesPage.tsx apps/hub/src/pages/PostagensPage.tsx apps/hub/src/pages/PostagemFocoPage.tsx`
Expected: zero matches EXCEPT inside `PostagensPage.tsx`'s untouched `StatusTag`/`STATUS_COLORS` block and the loading-spinner `border-stone-300 border-t-stone-900` pattern (spinners are explicitly out of scope for this pass — see Task 15 for the one place spinners get centralized, if at all; otherwise leave spinner borders as literal stone, since a spinner border color is not user-facing brand chrome).

- [ ] **Step 8: Commit**

```bash
git add apps/hub/src/pages/AprovacoesPage.tsx apps/hub/src/pages/PostagensPage.tsx apps/hub/src/pages/PostagemFocoPage.tsx apps/hub/index.html
git commit -m "feat(hub): token-swap Aprovações/Postagens/PostagemFoco chrome"
```

---

### Task 10: Token-swap pass — `MarcaPage.tsx`, `PaginasPage.tsx`

**Files:**
- Modify: `apps/hub/src/pages/MarcaPage.tsx`, `apps/hub/src/pages/PaginasPage.tsx`
- Test: run existing `apps/hub/src/pages/__tests__/postApprovalBrandPages.test.tsx`, `contentPages.test.tsx`

- [ ] **Step 1: Run existing tests for a green baseline**

Run: `npm run test -- postApprovalBrandPages.test.tsx contentPages.test.tsx`
Expected: PASS.

- [ ] **Step 2: Apply the mapping table to `MarcaPage.tsx`**

| Old | New |
|---|---|
| `border-stone-200/80 bg-white` (ColorSwatch wrapper, line 10) | `hub-border hub-bg-card` |
| `text-stone-900` (ColorSwatch label, line 16) | `hub-txt` |
| `text-stone-500` (ColorSwatch hex, eyebrow labels, "Nenhum material..." empty state) | `hub-tx3` (eyebrow/hex) or `hub-tx2` (empty-state sentence — matches the existing weight difference between `-400`/`-500`) |
| `text-stone-900` (h2 headings ×2) | `hub-txt` |
| `divide-stone-200/80` (font-list divider, line 97) | replace `divide-stone-200/80` with a plain `[&>*+*]:border-t [&>*+*]:hub-border` compound-variant is unnecessarily complex for one file — instead add a dedicated helper class `.hub-divide > * + *` to `index.html` (`border-top: 1px solid var(--hub-bd);`) and swap `divide-stone-200/80` → `hub-divide` |
| `text-stone-500` (font labels) | `hub-tx3` |
| `text-stone-900` (font values) | `hub-txt` |
| `text-stone-900` (file name, line 127) | `hub-txt` |
| `text-stone-500 group-hover:text-stone-900` (download link) | `hub-tx3 group-hover:hub-txt` — same `hover:` caveat as Task 9 Step 4: since Tailwind's `group-hover:` variant also can't apply to a hand-written class name, add a scoped rule instead: `.hub-root .hub-download-link:hover .hub-download-hint { color: var(--hub-txt); }` and give the `<a>` element `className="hub-card hub-card-hover ... hub-download-link"` and the inner hint `<span>` an additional `hub-download-hint` class alongside `hub-tx3`. |

- [ ] **Step 3: Add the two new supporting CSS rules from step 2**

In `apps/hub/index.html`:

```css
      .hub-root .hub-divide > * + * { border-top: 1px solid var(--hub-bd); }
      .hub-root .hub-download-link:hover .hub-download-hint { color: var(--hub-txt); }
```

- [ ] **Step 4: Apply the mapping table to `PaginasPage.tsx`**

| Old | New |
|---|---|
| `text-stone-500` (eyebrow, empty state) | `hub-tx3` / `hub-tx2` |
| `text-stone-900` (h2, page-row title) | `hub-txt` |
| `bg-stone-100 text-stone-600 group-hover:bg-[#FFBF30]/20 group-hover:text-stone-900` (file icon circle, line 48) | `hub-bg-soft hub-tx2` — drop the `group-hover:` accent tint entirely for this icon (it's a minor decorative hover, and Tailwind `group-hover:` can't target a hand-written accent class here either; simplest correct fix is to just keep the icon static-colored, matching how the design handoff's own Páginas card icon has no hover-tint treatment) |
| `text-stone-400 group-hover:text-stone-900` (chevron, line 57) | `hub-tx3 group-hover:hub-txt` — same caveat: since this repeats the same "can't group-hover a custom class" limitation, add one more scoped rule: `.hub-root .hub-page-row:hover .hub-page-chevron { color: var(--hub-txt); }`, apply `hub-page-row` to the `<Link>` and `hub-page-chevron` to the `<ChevronRight>`'s wrapping element (or pass `className` directly to the icon since `lucide-react` icons accept `className`). |

- [ ] **Step 5: Add the one supporting CSS rule from step 4**

```css
      .hub-root .hub-page-row:hover .hub-page-chevron { color: var(--hub-txt); }
```

- [ ] **Step 6: Run existing tests to verify no regression**

Run: `npm run test -- postApprovalBrandPages.test.tsx contentPages.test.tsx`
Expected: PASS.

- [ ] **Step 7: Grep-verify no leftover old classes**

Run: `grep -n "text-stone-\|bg-stone-\|border-stone-\|divide-stone-\|#FFBF30" apps/hub/src/pages/MarcaPage.tsx apps/hub/src/pages/PaginasPage.tsx`
Expected: zero matches.

- [ ] **Step 8: Commit**

```bash
git add apps/hub/src/pages/MarcaPage.tsx apps/hub/src/pages/PaginasPage.tsx apps/hub/index.html
git commit -m "feat(hub): token-swap Marca/Páginas chrome"
```

---

### Task 11: Token-swap pass — `PaginaPage.tsx`

**Files:**
- Modify: `apps/hub/src/pages/PaginaPage.tsx`
- Test: run existing `apps/hub/src/pages/__tests__/contentPages.test.tsx`

**Interfaces:**
- Two rendering paths (`markdownComponents` map and `renderBlock()`) duplicate the `a`/heading/image styling character-for-character — both must be edited together or the two paths will visually diverge (flagged by the inventory agent).

- [ ] **Step 1: Run existing test for a green baseline**

Run: `npm run test -- contentPages.test.tsx`
Expected: PASS.

- [ ] **Step 2: Apply the mapping table (applies identically to both `markdownComponents` AND `renderBlock`)**

| Old | New |
|---|---|
| `text-stone-900` (h1/h2/h3, both paths) | `hub-txt` |
| `text-stone-700` (p/ul/ol/table) | `hub-tx2` |
| `text-stone-900 ... decoration-[#FFBF30] ... hover:decoration-stone-900` (the `a`/`link` styling — 2 literal duplicate sites, lines 39 and 149) | `hub-txt ... decoration-[var(--hub-acc)] ... hover:decoration-[var(--hub-txt)]` — change BOTH the `markdownComponents.a` (line 39) and `renderBlock`'s `link` case (line 149) identically |
| `border-stone-200/80` (img) | `hub-border` |
| `border-stone-300` (blockquote left border) | `hub-border-strong` |
| `text-stone-600` (blockquote text) | `hub-tx2` |
| `bg-stone-100 ... text-stone-800` (code/pre, 3 sites) | `hub-bg-soft ... hub-txt` |
| `border-stone-200` (hr, table/th/td borders) | `hub-border` |
| `bg-stone-50` (th background) | `hub-bg-soft` |
| `text-stone-900` (page H1, line 201) | `hub-txt` |
| `text-stone-500 hover:text-stone-900` (back link, line 197) | `hub-tx3` + the same `hub-back-link` hover-rule class added in Task 9 Step 5 |
| `border-stone-300 border-t-stone-900` (spinner) | unchanged (spinners out of scope, per Task 9 Step 7) |

- [ ] **Step 3: Run existing test to verify no regression**

Run: `npm run test -- contentPages.test.tsx`
Expected: PASS.

- [ ] **Step 4: Grep-verify both rendering paths were updated in lockstep**

Run: `grep -n "decoration-\[" apps/hub/src/pages/PaginaPage.tsx`
Expected: exactly 2 matches, both reading `decoration-[var(--hub-acc)]` (confirms the markdown `a` override and the `renderBlock` `link` case didn't drift apart).

Run: `grep -n "text-stone-\|bg-stone-\|border-stone-\|#FFBF30" apps/hub/src/pages/PaginaPage.tsx`
Expected: zero matches outside the untouched spinner line.

- [ ] **Step 5: Commit**

```bash
git add apps/hub/src/pages/PaginaPage.tsx
git commit -m "feat(hub): token-swap page-reader markdown and block renderer"
```

---

### Task 12: Token-swap pass — `BriefingPage.tsx`

**Files:**
- Modify: `apps/hub/src/pages/BriefingPage.tsx`
- Test: run existing briefing coverage (check `apps/hub/src/pages/__tests__/` for the file that covers Briefing; extend it, or add none if it's purely a visual pass with existing assertions unaffected)

- [ ] **Step 1: Run existing tests for a green baseline**

Run: `grep -rl "BriefingPage" apps/hub/src/pages/__tests__/` to find the covering test file, then run it.
Expected: PASS.

- [ ] **Step 2: Apply the mapping table**

| Old | New |
|---|---|
| `text-stone-500` (eyebrow, ×5 including tab-inactive states) | `hub-tx3` |
| `text-stone-900` (h2, tab-active states, ×4) | `hub-txt` |
| `border-stone-200/80` (tab-bar bottom border, ×3) | `hub-border` |
| `hover:text-stone-700` (inactive tab hover, ×2) | `hover:hub-tx2` — same Tailwind-variant caveat as before (`hover:` CANNOT target a hand-written class name); instead give the tab button a stable class `hub-tab-btn` and add `.hub-root .hub-tab-btn:hover { color: var(--hub-tx2); }` to `index.html`, applied only when the tab is inactive (keep the conditional in the `className` ternary, just swap the literal color tokens for the new scoped rule + `hub-tx3`/`hub-txt` base states) |
| `bg-[#FFBF30]` (briefing-tab active indicator, line 83) | `style={{ background: 'var(--hub-acc)' }}` (simplest: this is a single 2px absolutely-positioned bar, replace the Tailwind arbitrary-hex class with an inline style referencing the CSS var directly, since `bg-[var(--hub-acc)]` also works as a Tailwind arbitrary-value class if the installed Tailwind version supports var-based arbitrary backgrounds — prefer `className="... bg-[var(--hub-acc)]"` and fall back to inline `style` only if `npm run build:hub` in Step 5 reports it didn't compile) |
| `bg-stone-400` (section-tab active indicator — note this is intentionally NEUTRAL, not accent, per the inventory) | `style={{ background: 'var(--hub-bd2)' }}` or `bg-[var(--hub-bd2)]` |
| `text-stone-800` (question label) | `hub-txt` |
| `bg-stone-50/40` (textarea background) | `style={{ background: 'var(--hub-soft)' }}` inline (a `/40` opacity-modified soft background has no direct one-line Tailwind-arbitrary-var equivalent without `color-mix`; simplest is `bg-[color-mix(in_srgb,var(--hub-soft)_40%,transparent)]` as a Tailwind arbitrary class — use this exact string) |
| `border-stone-300 focus:border-stone-300` | `hub-border-strong` / keep the same class name applied to the `focus:` variant target (`focus:border-[var(--hub-bd2)]`) |
| `placeholder:text-stone-400` | `placeholder:text-[var(--hub-tx3)]` |
| `focus:ring-[#FFBF30]/15` | `focus:ring-[var(--hub-acc)]/15` |
| `text-stone-400` (bare, "Salvando…") | `hub-tx3` |
| `bg-stone-400` (autosave dot, if present) | `hub-tx3`-equivalent inline style if it's a background dot: `style={{ background: 'var(--hub-tx3)' }}` |
| `text-emerald-600` ("✓ Salvo") | unchanged (semantic success color, not part of the accent/neutral migration) |

- [ ] **Step 3: Add the one supporting CSS rule from step 2**

```css
      .hub-root .hub-tab-btn:hover { color: var(--hub-tx2); }
```

- [ ] **Step 4: Run existing tests to verify no regression**

Expected: PASS.

- [ ] **Step 5: Typecheck / build to confirm the `var()`-in-arbitrary-value Tailwind syntax compiles**

Run: `npm run build:hub`
Expected: no errors. If any `bg-[var(--hub-acc)]`-style class silently fails to produce a rule (check the built CSS output for the literal `--hub-acc` custom property reference), fall back to the inline-`style` alternative noted alongside each affected mapping-table row above.

- [ ] **Step 6: Grep-verify**

Run: `grep -n "text-stone-\|bg-stone-\|border-stone-\|#FFBF30" apps/hub/src/pages/BriefingPage.tsx`
Expected: zero matches.

- [ ] **Step 7: Commit**

```bash
git add apps/hub/src/pages/BriefingPage.tsx apps/hub/index.html
git commit -m "feat(hub): token-swap Briefing tabs and form chrome"
```

---

### Task 13: Token-swap pass — `IdeiasPage.tsx`

**Files:**
- Modify: `apps/hub/src/pages/IdeiasPage.tsx`
- Test: run existing `apps/hub/src/pages/__tests__/ideiasPage.test.tsx`

**Interfaces:**
- `STATUS_COLOR`'s `nova` entry is neutral (maps to `hub-*`); `em_analise`/`aprovada`/`descartada` stay semantic Tailwind yellow/green/red but gain explicit `dark:` variants to fix the pre-existing dark-mode contrast bug the inventory agent found (none of these three classes are in the deleted Task-2 override list, so they're currently unstyled in dark mode).

- [ ] **Step 1: Run existing test for a green baseline**

Run: `npm run test -- ideiasPage.test.tsx`
Expected: PASS.

- [ ] **Step 2: Fix the `STATUS_COLOR` map**

Find (lines 20–25):
```tsx
const STATUS_COLOR: Record<HubIdeia['status'], string> = {
  nova: 'bg-stone-100 text-stone-600',
  em_analise: 'bg-yellow-100 text-yellow-700',
  aprovada: 'bg-green-100 text-green-700',
  descartada: 'bg-red-100 text-red-600',
};
```

Replace with:
```tsx
const STATUS_COLOR: Record<HubIdeia['status'], string> = {
  nova: 'hub-bg-soft hub-tx2',
  em_analise: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-500/10 dark:text-yellow-400',
  aprovada: 'bg-green-100 text-green-700 dark:bg-green-500/10 dark:text-green-400',
  descartada: 'bg-red-100 text-red-600 dark:bg-red-500/10 dark:text-red-400',
};
```

- [ ] **Step 3: Apply the remaining mapping table**

| Old | New |
|---|---|
| `text-stone-500` (eyebrow, subhead, ×10 total) | `hub-tx3` (eyebrow) / `hub-tx2` (subhead, contextual — match existing weight) |
| `text-stone-900` (h1, modal title, ×3) | `hub-txt` |
| `text-stone-600` (card description, agency-comment body, ×8) | `hub-tx2` |
| `border-stone-200` (form input default border, ×5) | `hub-border` |
| `bg-stone-900 hover:bg-stone-800` (primary CTA — "Nova ideia", "Tentar novamente", "Adicionar ideia", modal submit — ×5/4) | `hub-btn-primary` (drop the `hover:bg-stone-800`, the shared class already defines its own hover) |
| `text-stone-400` (upload hint icon color, ×4) | `hub-tx3` |
| `hover:text-stone-800` / `hover:bg-stone-800` (upload trigger hover, ×4) | fold into the `hub-tx3`/`hub-btn-primary` treatments above — remove the separate hover utility since the shared classes already carry hover behavior |
| `hover:bg-stone-100` (edit icon button hover, ×3) | `hover:hub-bg-soft` — same Tailwind-can't-`hover:`-a-custom-class caveat: add `.hub-root .hub-icon-btn:hover { background: var(--hub-soft); }` to `index.html`, apply `hub-icon-btn` alongside the existing `p-1.5 rounded-md ... text-stone-500` classes (swap `text-stone-500` → `hub-tx3` too) |
| `focus:ring-stone-900/20` (×3, form inputs) | `focus:ring-[var(--hub-acc)]/20` — this makes `IdeiasPage`'s form focus ring consistent with `BriefingPage`'s accent-based ring instead of the previous stone-based one (an intentional, disclosed normalization, not a silent behavior change) |
| `border-red-400` (validation-error border, ×2) | unchanged — semantic danger color |
| `bg-white` (modal panel background, line ~470) | `hub-bg-card` |
| `border-stone-100` (agency-comment divider) | `hub-border` |
| `text-stone-400` (agency-comment eyebrow) | `hub-tx3` |
| `text-stone-700` (agency-comment body) | `hub-tx2` |
| `bg-stone-100` (reaction pill, thumbnail bg) | `hub-bg-soft` |
| `text-stone-600` (reaction count) | `hub-tx2` |
| `hover:bg-red-50 hover:text-red-600` (delete icon button) | unchanged — semantic danger hover |

Also delete the unused `ALLOWED_EMOJI` constant (line 11) flagged by the inventory agent as dead code with zero references — since it's directly in a file this task already touches:

```tsx
const ALLOWED_EMOJI = ['👍', '❤️', '🔥', '💡', '🎯'] as const;
```

Confirm via `grep -n "ALLOWED_EMOJI" apps/hub/src/pages/IdeiasPage.tsx` that it has zero remaining references before deleting, then remove the line.

- [ ] **Step 4: Add the one supporting CSS rule from step 3**

```css
      .hub-root .hub-icon-btn:hover { background: var(--hub-soft); }
```

- [ ] **Step 5: Run existing test to verify no regression**

Run: `npm run test -- ideiasPage.test.tsx`
Expected: PASS.

- [ ] **Step 6: Grep-verify**

Run: `grep -n "text-stone-\|bg-stone-9\|bg-white\b\|border-stone-2\|focus:ring-stone\|ALLOWED_EMOJI" apps/hub/src/pages/IdeiasPage.tsx`
Expected: zero matches (semantic `yellow`/`green`/`red` classes are expected to remain — only `stone`/plain `bg-white`/dead code should be gone).

- [ ] **Step 7: Commit**

```bash
git add apps/hub/src/pages/IdeiasPage.tsx apps/hub/index.html
git commit -m "feat(hub): token-swap Ideias chrome, fix dark-mode status badges, remove dead code"
```

---

### Task 14: Token-swap pass — `Relatorios.tsx`, `RelatorioView.tsx`

**Files:**
- Modify: `apps/hub/src/pages/Relatorios.tsx`, `apps/hub/src/pages/RelatorioView.tsx`

- [ ] **Step 1: Find and run existing coverage**

Run: `grep -rl "Relatorios\|RelatorioView" apps/hub/src/pages/__tests__/`, then run the matching test file(s).
Expected: PASS.

- [ ] **Step 2: Apply the mapping table to `Relatorios.tsx`**

| Old | New |
|---|---|
| `text-stone-500` (eyebrow, meta text, ×4) | `hub-tx3` / `hub-tx2` matching existing hierarchy |
| `bg-stone-100 hover:bg-stone-200` (action-link pill, ×2 identical strings — "Ver online"/"Baixar PDF") | `hub-bg-soft hover:hub-bg-soft` — since both states are the same token, simplify to a single `.hub-root .hub-action-pill { background: var(--hub-soft); } .hub-root .hub-action-pill:hover { background: var(--hub-bd); }` rule in `index.html`, apply `hub-action-pill` class in place of `bg-stone-100 hover:bg-stone-200` |
| `text-stone-900 text-stone-700 hover:text-stone-900` (card title, action-link text) | `hub-txt` / `hub-tx2` |
| `text-stone-400` (meta text) | `hub-tx3` |
| `border-t-stone-900 border-stone-300` (spinner) | unchanged, out of scope |
| `text-emerald-600 bg-emerald-50 border-emerald-100` ("Pronto" badge) | unchanged — semantic success color |

- [ ] **Step 3: Add the supporting CSS rule from step 2**

```css
      .hub-root .hub-action-pill { background: var(--hub-soft); }
      .hub-root .hub-action-pill:hover { background: var(--hub-bd2); }
```

- [ ] **Step 4: Apply the identical mapping to `RelatorioView.tsx`**

Same `text-stone-*` → `hub-tx3`/`hub-txt` swaps for the back-link/crumb/month-label/download-button (which reuses the exact `bg-stone-100 hover:bg-stone-200` string from `Relatorios.tsx` — apply the same `hub-action-pill` class here too). Leave the `<iframe srcDoc={html}>` and its two layout-only `style={{}}` blocks (`minHeight`, `width`/`flex`/`border`/`borderRadius`) completely untouched — the report HTML inside the iframe is server-rendered and out of scope.

- [ ] **Step 5: Run existing tests to verify no regression**

Expected: PASS.

- [ ] **Step 6: Grep-verify**

Run: `grep -n "text-stone-\|bg-stone-100\|hover:bg-stone-200" apps/hub/src/pages/Relatorios.tsx apps/hub/src/pages/RelatorioView.tsx`
Expected: zero matches.

- [ ] **Step 7: Commit**

```bash
git add apps/hub/src/pages/Relatorios.tsx apps/hub/src/pages/RelatorioView.tsx apps/hub/index.html
git commit -m "feat(hub): token-swap Relatórios list and report viewer chrome"
```

---

### Task 15: Token-swap pass — `PostCard.tsx`, `FeedPreviewButton.tsx`, `PostCalendar.tsx`

**Files:**
- Modify: `apps/hub/src/components/PostCard.tsx`, `apps/hub/src/components/FeedPreviewButton.tsx`, `apps/hub/src/components/PostCalendar.tsx`

**Interfaces:**
- Explicitly LEAVE UNCHANGED: `PropertyRow`'s `opt.color`-driven inline styles (DB-sourced per-workspace property colors) in `PostCard.tsx`, and `PostCalendar.tsx`'s `TIPO_COLOR` map values. Only the surrounding neutral/accent chrome is tokenized.

- [ ] **Step 1: Find and run existing coverage**

Run: `grep -rl "PostCard\b" apps/hub/src/components/__tests__/` and `grep -rl "PostCalendar\b" apps/hub/src/components/__tests__/`, run both.
Expected: PASS.

- [ ] **Step 2: Apply the mapping table to `PostCard.tsx`**

| Old | New |
|---|---|
| `text-stone-900` (×6: title, badge text, various) | `hub-txt` |
| `bg-stone-100` (×6: property fallback chip backgrounds) | `hub-bg-soft` |
| `text-stone-400` (×5: eyebrow labels) | `hub-tx3` |
| `border-stone-200/80` (×5) | `hub-border` |
| `text-stone-500` (×4) | `hub-tx2` |
| `bg-stone-900 hover:bg-stone-800` (primary "Aprovar" button, line 551) | `hub-btn-primary` |
| `border-stone-200/80 bg-white text-stone-800 hover:border-stone-300 hover:bg-stone-50` (secondary "Correção" button, line 559) | `hub-btn-secondary` |
| **Status pill dynamic map** (lines 264–271) — replace the whole ternary with `StatusPill` (Task 7):
```tsx
const statusStyles =
    post.status === 'correcao_cliente'
      ? 'bg-rose-50 text-rose-700 ring-1 ring-rose-200/60'
      : isPending
        ? 'bg-[#FFBF30]/18 text-stone-900 ring-1 ring-[#FFBF30]/50'
        : post.status === 'agendado'
          ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/60'
          : 'bg-stone-100 text-stone-700 ring-1 ring-stone-200/80';
```
Replace the badge's rendering (line 343, `<span className={...statusStyles}>`) with:
```tsx
<StatusPill tone={post.status === 'correcao_cliente' ? 'danger' : isPending ? 'accent' : 'neutral'}>
  {/* existing label expression, unchanged */}
</StatusPill>
```
Keep the `post.status === 'agendado'` (green/"scheduled") case as its own literal Tailwind classes (`bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/60`) rather than folding it into `StatusPill`'s three tones — it's a fourth, semantic (not accent) state; add a fourth branch directly in the JSX instead of extending `StatusPill`'s tone union (do not add a `'scheduled'` tone to the shared component just for this one call site). |
| `bg-[#FFBF30]/10 ring-1 ring-[#FFBF30]/25` (team comment bubble, line 485) | `style={{ background: 'color-mix(in srgb, var(--hub-acc) 10%, transparent)', boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--hub-acc) 25%, transparent)' }}` |
| `text-amber-900` (team-label text, paired with the bubble above) | `hub-acc-text` — normalizes it to reference the same accent variable as the bubble background it sits inside, fixing the inventory-flagged inconsistency |
| `focus:ring-[#FFBF30]/15` (×2: reply input, comentario textarea) | `focus:ring-[var(--hub-acc)]/15` |
| `opt.color + '22'` / `opt.color + '55'` (PropertyRow select/status/multiselect swatches) | **unchanged** — per-workspace DB-driven data, not a design-system token |

- [ ] **Step 3: Apply the mapping table to `FeedPreviewButton.tsx`**

Single change: `bg-stone-900 text-white hover:bg-stone-800` → `hub-btn-primary`.

- [ ] **Step 4: Apply the mapping table to `PostCalendar.tsx`**

| Old | New |
|---|---|
| `text-stone-500` (×5), `text-stone-900` (×4), `text-stone-600` (×2), `text-stone-400` (×2) | `hub-tx3`/`hub-txt`/`hub-tx2` matching existing hierarchy per usage site |
| `border-stone-200/80` (×2) | `hub-border` |
| `bg-stone-100` (month-nav pill background, ×2) | `hub-bg-soft` |
| `bg-stone-900 text-white` (today's-date circular badge) | `hub-btn-primary` |
| `bg-[#FFBF30]/12 ring-1 ring-[#FFBF30]/50` (selected-day cell, lines 152–156) | `style={{ background: 'color-mix(in srgb, var(--hub-acc) 12%, transparent)', boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--hub-acc) 50%, transparent)' }}` (replace the ternary's `isSelected` branch string with an inline `style` object instead of a className, since this exact opacity pair doesn't need a new shared class for one call site) |
| `TIPO_COLOR` map values (`#3b82f6`/`#8b5cf6`/`#f59e0b`/`#10b981`) and the `'#78716c'` fallback | **unchanged** — semantic per-post-type palette, not accent-tied. Leave the `${TIPO_COLOR[tipo] ?? '#78716c'}1c` opacity-suffix pattern exactly as-is. |

- [ ] **Step 5: Run existing tests to verify no regression**

Run the same test files from Step 1.
Expected: PASS.

- [ ] **Step 6: Grep-verify (scoped — exclude the intentionally-unchanged `opt.color`/`TIPO_COLOR` sites)**

Run: `grep -n "text-stone-\|bg-stone-\|border-stone-\|#FFBF30" apps/hub/src/components/PostCard.tsx apps/hub/src/components/FeedPreviewButton.tsx apps/hub/src/components/PostCalendar.tsx`
Expected: zero matches.

- [ ] **Step 7: Commit**

```bash
git add apps/hub/src/components/PostCard.tsx apps/hub/src/components/FeedPreviewButton.tsx apps/hub/src/components/PostCalendar.tsx
git commit -m "feat(hub): token-swap PostCard/FeedPreviewButton/PostCalendar chrome"
```

---

### Task 16: Token-swap pass — `InstagramPostCard.tsx`, `StoryPostCard.tsx`, `TextPostCard.tsx`, `InstagramGridPreview.tsx`

**Files:**
- Modify: `apps/hub/src/components/InstagramPostCard.tsx`, `apps/hub/src/components/StoryPostCard.tsx`, `apps/hub/src/components/TextPostCard.tsx`, `apps/hub/src/components/InstagramGridPreview.tsx`

**Interfaces:**
- Per Global Constraints: Instagram-brand chrome (`#262626`, `#0095f6`, `#efefef`, `#8e8e8e`, `#dbdbdb`, `#ed4956`, `#E1306C`, the `feda75→d62976→4f5bd5` gradient ring, carousel-dot colors) is explicitly OUT OF SCOPE in all four files. Only touch: approval-button chrome, `#FFBF30` references, focus rings, and the confirmed `--border-color`/`--text-light` undefined-variable bug.

- [ ] **Step 1: Find and run existing coverage**

Run: `npm run test -- InstagramPostCard.test.tsx StoryPostCard.test.tsx TextPostCard.test.tsx InstagramGridPreview.test.tsx`
Expected: PASS.

- [ ] **Step 2: Fix the confirmed bug in `InstagramPostCard.tsx`**

Both the "Agendado" banner (lines 583–618) and the "Postado" banner (lines 621–668) reference `var(--border-color)` and `var(--text-light)`, which are not defined anywhere in `apps/hub`. Replace:

```tsx
borderTop: '1px solid var(--border-color)',
```
with:
```tsx
borderTop: '1px solid var(--hub-bd)',
```
(both occurrences), and:
```tsx
{post.published_at && <div style={{ color: 'var(--text-light)', fontSize: '0.75rem' }}>{/* date */}</div>}
```
(and the equivalent line in the "Agendado" banner) — replace `'var(--text-light)'` with `'var(--hub-tx2)'` in both places.

Leave the banners' own semantic colors (`#3ecf8e` scheduled-green, `#eab308` published-gold, `#E1306C` Instagram-pink permalink) untouched — they're deliberately distinct from the Hub accent, matching the design's own status-color conventions and the Global Constraints scope boundary.

- [ ] **Step 3: Apply the mapping table to `InstagramPostCard.tsx`, `StoryPostCard.tsx`, `TextPostCard.tsx` (identical pattern across all three)**

| Old | New |
|---|---|
| `bg-stone-900 text-white ... hover:bg-stone-800` (primary "Aprovar" button, one occurrence per file) | `hub-btn-primary` (drop the explicit `rounded-[4px]`/`rounded`/`rounded-full` radius variance — keep whichever radius each file already used, just swap the color utilities) |
| `border-stone-200 dark:border-stone-700 bg-white dark:bg-transparent text-stone-700 dark:text-stone-300 ... hover:bg-stone-50 dark:hover:bg-stone-800` (secondary "Correção" button, one occurrence per file) | `hub-btn-secondary` |
| `focus:ring-[#FFBF30]/15` (`TextPostCard.tsx`, line 178) | `focus:ring-[var(--hub-acc)]/15` |
| `text-amber-600` (`TextPostCard.tsx`, line 78–80 — flat status-label color applied to EVERY status, a pre-existing display bug per the inventory) | Fix alongside the token swap: replace the flat `text-amber-600` with a lookup matching `StatusTag`'s semantics used elsewhere (`aprovado_cliente`→`text-emerald-600`, `correcao_cliente`→`text-rose-600`, `agendado`→`text-[#42c8f5]` (matches the existing calendar-blue used for "agendado" chips elsewhere), default→`hub-tx2`). Implement as a small local `const STATUS_TEXT_COLOR: Record<string, string> = {...}` in `TextPostCard.tsx` rather than importing `PostagensPage`'s map (keep the two files decoupled — they're not guaranteed to share every status key). |

Do NOT touch: the Instagram gradient ring (`InstagramPostCard.tsx`), the progress-bar segments (`StoryPostCard.tsx`), the `#262626`/`#f5f5f5` caption/username text colors, the `#0095f6` carousel-dot/checkbox/link colors, or any `dark:bg-[#1a1a1a]`/`dark:text-[#f5f5f5]` Instagram-chrome pairs in any of the three files.

- [ ] **Step 4: Apply the mapping table to `InstagramGridPreview.tsx`**

| Old | New |
|---|---|
| `bg-stone-900 hover:bg-stone-800 text-white` (Save button, line 686) | `hub-btn-primary` |
| `text-stone-500` (×2, minor chrome text outside the Instagram-mimicry dialog body) | `hub-tx3` |
| `bg-stone-50`, `bg-stone-200` (non-Instagram chrome backgrounds, if any outside the grid cells themselves) | `hub-bg-soft` |

Do NOT touch: `#262626`, `#efefef`, `#0095f6`, `#8e8e8e`, `#dbdbdb` (all Instagram-mimicry, including the drag-reorder grid cells, the legend, and the "Reordenável"/"Fixo"/"Publicado no Instagram" color key — these three colors must stay in sync with each other as a group, and none of them are in scope).

- [ ] **Step 5: Run existing tests to verify no regression**

Run the four test files from Step 1 again.
Expected: PASS.

- [ ] **Step 6: Grep-verify the scoped changes landed and the out-of-scope Instagram colors are untouched**

Run: `grep -n "var(--border-color)\|var(--text-light)" apps/hub/src/components/InstagramPostCard.tsx`
Expected: zero matches (bug fixed).

Run: `grep -n "#FFBF30\|bg-stone-900 text-white\|border-stone-200 dark:border-stone-700" apps/hub/src/components/InstagramPostCard.tsx apps/hub/src/components/StoryPostCard.tsx apps/hub/src/components/TextPostCard.tsx apps/hub/src/components/InstagramGridPreview.tsx`
Expected: zero matches.

Run: `grep -c "#0095f6" apps/hub/src/components/InstagramPostCard.tsx apps/hub/src/components/InstagramGridPreview.tsx`
Expected: same non-zero counts as before this task (confirms Instagram-brand blue was left untouched).

- [ ] **Step 7: Commit**

```bash
git add apps/hub/src/components/InstagramPostCard.tsx apps/hub/src/components/StoryPostCard.tsx apps/hub/src/components/TextPostCard.tsx apps/hub/src/components/InstagramGridPreview.tsx
git commit -m "feat(hub): token-swap approval buttons, fix undefined CSS var bug and status-color bug in IG-styled cards"
```

---

### Task 17: Token-swap pass — `DashboardSection.tsx` (skeletons and text only)

**Files:**
- Modify: `apps/hub/src/components/dashboard/DashboardSection.tsx`

**Interfaces:**
- Per Global Constraints, `FollowerChart.tsx`, `ReachChart.tsx`, and `PeriodSelector.tsx` are explicitly OUT OF SCOPE (Chart.js canvas gradients, `#eab308` accent) — this task touches ONLY `DashboardSection.tsx` itself.

- [ ] **Step 1: Find and run existing coverage**

Run: `grep -rl "DashboardSection" apps/hub/src/components/__tests__/`, run the matching file.
Expected: PASS.

- [ ] **Step 2: Apply the mapping table**

| Old | New |
|---|---|
| `bg-stone-200 dark:bg-white/[0.06]` (×5, skeleton loading blocks) | `hub-bg-soft` (a single token replaces both the light and dark literal, since `--hub-soft` already resolves correctly per theme — drop the `dark:` variant entirely) |
| `text-stone-900 dark:text-stone-100` (section H2) | `hub-txt` |
| `text-stone-500 dark:text-stone-400` (sub-heading eyebrow) | `hub-tx3` |
| `text-stone-400` (empty state) | `hub-tx3` |

- [ ] **Step 3: Run existing test to verify no regression**

Expected: PASS.

- [ ] **Step 4: Grep-verify**

Run: `grep -n "stone-\|dark:" apps/hub/src/components/dashboard/DashboardSection.tsx`
Expected: zero matches.

- [ ] **Step 5: Commit**

```bash
git add apps/hub/src/components/dashboard/DashboardSection.tsx
git commit -m "feat(hub): token-swap DashboardSection skeleton and text chrome"
```

---

### Task 18: Full verification sweep

**Files:** none (verification only).

- [ ] **Step 1: Repo-wide grep for leftover amber references in every file this plan touched**

Run:
```bash
grep -rn "#FFBF30" apps/hub/src --include="*.tsx" --include="*.ts"
```
Expected: zero matches anywhere in `apps/hub/src` (every `#FFBF30` site identified across all 11 inventoried files plus the four pages read directly has now been replaced).

- [ ] **Step 2: Confirm the deleted dark-mode override block is gone and no page still assumes it exists**

Run: `grep -n "data-theme=\"dark\"\]" apps/hub/index.html`
Expected: zero matches (the block was deleted in Task 2; dark-mode values now flow entirely through `--hub-*` variables recomputed by `resolveHubTheme()`).

- [ ] **Step 3: Typecheck and build**

Run: `npm run build:hub`
Expected: PASS, no TypeScript errors, no unused-import errors (particularly the `CheckSquare` removal from `HomePage.tsx` in Task 8, and the `HubNav` deletion in Task 5).

- [ ] **Step 4: Full frontend test suite**

Run: `npm run test`
Expected: PASS — no regressions in any Hub or CRM suite (CRM is untouched by this plan, so its tests should be unaffected; confirms no shared file was accidentally broken).

- [ ] **Step 5: Lint and format**

Run: `npm run lint && npm run format:check`
Expected: PASS. If `format:check` fails, run `npm run format` and re-review the diff before re-running `format:check`.

- [ ] **Step 6: Manual browser verification**

Start the Hub dev server (`npm run dev:hub`) and open a real Hub link (or the `:staging` variant against a workspace with a non-default `brand_color` set in Configuração, to confirm the accent actually changes). Check, at minimum:
- Desktop (≥900px): sidebar renders at 240px, all nine nav items present, active-item highlight uses `--hub-soft`, Aprovações badge matches the real pending count.
- Mobile (<720px, use the browser's device toolbar): hamburger button opens the right-side drawer, Escape closes it, focus returns to the trigger button.
- Toggle dark mode via the sidebar/drawer moon icon: confirm text/background/border colors flip correctly on Home, Aprovações, and at least one Instagram-styled post card (confirming the deleted override list wasn't hiding a real dependency).
- Open Mensagens, send a message, confirm it appends and the input clears; reload the page and confirm the seed fixture reappears (no persistence, as scoped).
- Confirm the "Na agência" team card, "Atualizações" notifications row, "Favoritos" shortcuts, account-switcher chevron, and "Configurações"/"Suporte" buttons are all absent (per Global Constraints).

- [ ] **Step 7: Final commit (only if manual verification in Step 6 surfaced fixes)**

```bash
git add -A
git commit -m "fix(hub): address issues found in whitelabel visual manual verification"
```

---

## Deferred follow-ups (explicitly out of scope for this plan)

- CRM "Personalizar hub" admin panel (agency name override, logo, font choice, nav-style/home-layout switcher, banner). The accent color already flows from the existing `brand_color` field/Configuração picker — no new panel is needed for that piece specifically.
- Mensagens persistence (a real messages table + edge function + realtime/polling) — today's page is a local-only UI demo, matching the design handoff's own reference implementation.
- Dashboard chart accent unification (`FollowerChart.tsx`, `ReachChart.tsx`, `PeriodSelector.tsx` keep `#eab308`) — needs `getComputedStyle`-based canvas-gradient plumbing per chart, a distinct technical task from CSS retinting.
- Alternate nav/home-layout variants (side-vs-top nav, tabs-vs-hamburger, cards/focus/agenda home layouts) beyond the one combination shipped here (sidebar + hamburger + cards).
