# Fase 1: Entregas "Visão geral" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Entregas "Gráfico" donut view with an operational cockpit ("Visão geral") where every element click-filters the board, and fix the etapas N+1/pagination in the data hook.

**Architecture:** Pure frontend. New shared modules `lib/chartTheme.ts` (theme-aware Chart.js colors) and `pages/entregas/deadlineStatus.ts` (canonical deadline classification) feed a rebuilt `views/ChartView.tsx` (kept filename and view id `'chart'`, label renamed "Visão geral"). Data stays in `useEntregasData`, which switches from N per-workflow fetches to one paginated `getAllActiveEtapas()` call. Design spec: `docs/superpowers/specs/2026-09-02-entregas-analytics-revamp-design.md`; approved mockup: `docs/superpowers/specs/assets/2026-09-02-mockup-visao-geral.html`.

**Tech Stack:** React 19, TypeScript, TanStack Query, Chart.js v4 via react-chartjs-2, vitest + @testing-library/react (jsdom), shadcn/ui, hand-written CSS in `apps/crm/style.css`.

## Global Constraints

- All UI copy in pt-BR. NEVER use em-dashes ("—") in user-facing copy; use period, colon or "·".
- Charting: Chart.js v4 + react-chartjs-2 only. No new chart/library dependencies.
- No hex color literal in any chart config or new component outside `apps/crm/src/lib/chartTheme.ts`. Semantic colors come from CSS tokens `--success` / `--warning` / `--danger` (values `#3ecf8e` / `#f5a342` / `#f55a42` in `apps/crm/style.css`).
- The view id `'chart'` (type `ActiveView` in `apps/crm/src/pages/entregas/viewQuery.ts`) MUST NOT change; only the visible label changes to "Visão geral". Saved views and URLs keep working.
- `BoardCard` shape (`apps/crm/src/pages/entregas/hooks/useEntregasData.ts:27-39`) must not change, and `useEntregasData`'s return contract must not change (fields may be added, none removed/renamed).
- Tests colocated under `__tests__/` next to the code, vitest style of the existing suite. Every task runs `npx vitest run <its test files>` before committing.
- Path alias `@/` maps to `apps/crm/src/` inside the CRM app. Icons: `lucide-react` only.
- Commit after each task with a conventional message (`feat(entregas): ...`, `refactor(store): ...`).

---

### Task 1: `deadlineStatus.ts` — canonical deadline classification

**Files:**
- Create: `apps/crm/src/pages/entregas/deadlineStatus.ts`
- Create: `apps/crm/src/pages/entregas/__tests__/deadlineStatus.test.ts`
- Modify: `apps/crm/src/pages/entregas/etapaPrazo.ts` (formatEtapaPrazo colors → CSS vars)
- Modify: `apps/crm/src/pages/entregas/components/EntregasFilters.tsx` (STATUS_OPTIONS colors, lines 83-87)

**Interfaces:**
- Consumes: `BoardCard['deadline']` = `{ diasRestantes: number; horasRestantes: number; estourado: boolean; urgente: boolean }` from `hooks/useEntregasData`.
- Produces (used by Tasks 5-6): `DeadlineStatus`, `classifyDeadline`, `DEADLINE_STATUS`, `computeDeadlineStats`.

- [ ] **Step 1: Write the failing test**

`apps/crm/src/pages/entregas/__tests__/deadlineStatus.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  classifyDeadline,
  computeDeadlineStats,
  DEADLINE_STATUS,
  DEADLINE_STATUS_ORDER,
} from '../deadlineStatus';
import type { BoardCard } from '../hooks/useEntregasData';

function card(deadline: Partial<BoardCard['deadline']>): BoardCard {
  return {
    deadline: { diasRestantes: 3, horasRestantes: 0, estourado: false, urgente: false, ...deadline },
  } as BoardCard;
}

describe('classifyDeadline', () => {
  it('estourado wins over urgente', () => {
    expect(classifyDeadline({ diasRestantes: -2, horasRestantes: 0, estourado: true, urgente: true })).toBe('atrasado');
  });
  it('urgente when not estourado', () => {
    expect(classifyDeadline({ diasRestantes: 0, horasRestantes: 5, estourado: false, urgente: true })).toBe('urgente');
  });
  it('em_dia otherwise', () => {
    expect(classifyDeadline({ diasRestantes: 4, horasRestantes: 0, estourado: false, urgente: false })).toBe('em_dia');
  });
});

describe('computeDeadlineStats', () => {
  it('counts each bucket and totals match input length', () => {
    const cards = [
      card({ estourado: true }),
      card({ estourado: true, urgente: true }),
      card({ urgente: true }),
      card({}),
    ];
    const stats = computeDeadlineStats(cards);
    expect(stats).toEqual({ atrasado: 2, urgente: 1, em_dia: 1 });
  });
  it('empty input yields zeros', () => {
    expect(computeDeadlineStats([])).toEqual({ atrasado: 0, urgente: 0, em_dia: 0 });
  });
});

describe('DEADLINE_STATUS', () => {
  it('maps every status to a label and CSS var, in display order', () => {
    expect(DEADLINE_STATUS_ORDER).toEqual(['em_dia', 'urgente', 'atrasado']);
    expect(DEADLINE_STATUS.em_dia).toEqual({ label: 'Em dia', cssVar: '--success', fallback: '#3ecf8e' });
    expect(DEADLINE_STATUS.urgente).toEqual({ label: 'Urgente', cssVar: '--warning', fallback: '#f5a342' });
    expect(DEADLINE_STATUS.atrasado).toEqual({ label: 'Atrasado', cssVar: '--danger', fallback: '#f55a42' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/crm/src/pages/entregas/__tests__/deadlineStatus.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the implementation**

`apps/crm/src/pages/entregas/deadlineStatus.ts`:

```ts
import type { BoardCard } from './hooks/useEntregasData';

/** Matches StatusFilter in components/EntregasFilters.tsx — same string values. */
export type DeadlineStatus = 'atrasado' | 'urgente' | 'em_dia';

export const DEADLINE_STATUS_ORDER: DeadlineStatus[] = ['em_dia', 'urgente', 'atrasado'];

/**
 * Canonical presentation of the three deadline buckets. cssVar points at the
 * theme token; fallback is the token's light/dark-invariant hex, used only
 * where CSS variables cannot reach (canvas charts, jsdom).
 */
export const DEADLINE_STATUS: Record<
  DeadlineStatus,
  { label: string; cssVar: string; fallback: string }
> = {
  em_dia: { label: 'Em dia', cssVar: '--success', fallback: '#3ecf8e' },
  urgente: { label: 'Urgente', cssVar: '--warning', fallback: '#f5a342' },
  atrasado: { label: 'Atrasado', cssVar: '--danger', fallback: '#f55a42' },
};

/** Single source of the estourado/urgente precedence rule. */
export function classifyDeadline(deadline: BoardCard['deadline']): DeadlineStatus {
  if (deadline.estourado) return 'atrasado';
  if (deadline.urgente) return 'urgente';
  return 'em_dia';
}

export function computeDeadlineStats(cards: BoardCard[]): Record<DeadlineStatus, number> {
  const stats: Record<DeadlineStatus, number> = { atrasado: 0, urgente: 0, em_dia: 0 };
  for (const card of cards) stats[classifyDeadline(card.deadline)]++;
  return stats;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/crm/src/pages/entregas/__tests__/deadlineStatus.test.ts`
Expected: PASS.

- [ ] **Step 5: Kill the color drift in the two existing spots**

In `apps/crm/src/pages/entregas/etapaPrazo.ts`, `formatEtapaPrazo` (lines 124-143) returns hexes `#ef4444` / `#eab308`. These colors land in inline `style` props (CSS var strings are valid there — one branch already returns `'var(--text-muted)'`). Replace:
- `color: '#ef4444'` → `color: 'var(--danger)'`
- both `color: '#eab308'` and `deadline.urgente ? '#eab308'` → `'var(--warning)'`

In `apps/crm/src/pages/entregas/components/EntregasFilters.tsx` `STATUS_OPTIONS` (lines 83-87), replace `#ef4444` → `var(--danger)`, `#ea580c` → `var(--warning)`, `#3ecf8e` → `var(--success)`. Check how `color` is consumed inside this file first: if any consumer needs a raw hex (it does not today — they are inline-style dots), keep the change; otherwise report BLOCKED.

- [ ] **Step 6: Run the page test suites that cover these files**

Run: `npx vitest run apps/crm/src/pages/entregas`
Expected: PASS (existing tests asserting `#eab308`/`#ef4444` strings, if any, must be updated to the var() strings — search first: `grep -rn "eab308\|ef4444\|ea580c" apps/crm/src/pages/entregas`).

- [ ] **Step 7: Commit**

```bash
git add apps/crm/src/pages/entregas
git commit -m "feat(entregas): classificação canônica de prazo em deadlineStatus.ts"
```

---

### Task 2: `chartTheme.ts` — theme-aware Chart.js colors

**Files:**
- Create: `apps/crm/src/lib/chartTheme.ts`
- Create: `apps/crm/src/lib/__tests__/chartTheme.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks (reads CSS tokens from the DOM directly).
- Produces (used by Task 5): `useIsDark(): boolean`; `resolveCssColor(cssVar: string, fallback: string): string`; `getChartTheme(isDark: boolean): ChartTheme` where

```ts
export interface ChartTheme {
  text: string;        // axis tick color
  grid: string;        // gridline color
  font: { family: string; size: number };
  semantic: { success: string; warning: string; danger: string }; // resolved to real hex/rgb (canvas cannot read var())
  tooltip: {
    backgroundColor: string; titleColor: string; bodyColor: string;
    borderColor: string; borderWidth: number; padding: number;
  };
}
```

**Background you need:** the app toggles theme by setting `data-theme="dark"` on `document.documentElement` imperatively (see `apps/crm/src/components/layout/Sidebar.tsx`, the `data-theme` set near line 66). There is no theme context. The existing per-page pattern is `apps/crm/src/pages/analytics-conta/AnalyticsContaPage.tsx:485-487` (`isDark` + ternary colors) — this module centralizes it. jsdom returns `''` from `getComputedStyle(...).getPropertyValue()`, hence the fallback argument.

- [ ] **Step 1: Write the failing test**

`apps/crm/src/lib/__tests__/chartTheme.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useIsDark, resolveCssColor, getChartTheme } from '../chartTheme';

afterEach(() => {
  document.documentElement.removeAttribute('data-theme');
});

describe('useIsDark', () => {
  it('is false without data-theme and true with data-theme=dark', async () => {
    const { result } = renderHook(() => useIsDark());
    expect(result.current).toBe(false);
    await act(async () => {
      document.documentElement.setAttribute('data-theme', 'dark');
      // MutationObserver delivers asynchronously
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(result.current).toBe(true);
  });
});

describe('resolveCssColor', () => {
  it('falls back when the CSS var is not defined (jsdom)', () => {
    expect(resolveCssColor('--success', '#3ecf8e')).toBe('#3ecf8e');
  });
});

describe('getChartTheme', () => {
  it('returns dark and light gridlines and resolved semantic colors', () => {
    const dark = getChartTheme(true);
    const light = getChartTheme(false);
    expect(dark.grid).toBe('rgba(255,255,255,0.06)');
    expect(light.grid).toBe('rgba(0,0,0,0.06)');
    expect(dark.semantic.success).toBe('#3ecf8e'); // jsdom fallback path
    expect(dark.font.family).toContain('SF Pro Text');
    expect(dark.tooltip.borderWidth).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/crm/src/lib/__tests__/chartTheme.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the implementation**

`apps/crm/src/lib/chartTheme.ts`:

```ts
import { useSyncExternalStore } from 'react';

/**
 * Theme-aware colors for Chart.js configs. This module is the ONLY place that
 * may hold chart color literals: canvas cannot read CSS variables, so tokens
 * are resolved here at render time and re-resolved when the theme flips.
 */

function subscribe(callback: () => void): () => void {
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });
  return () => observer.disconnect();
}

function getSnapshot(): boolean {
  return document.documentElement.getAttribute('data-theme') === 'dark';
}

/** True while <html data-theme="dark">. Re-renders on theme toggle. */
export function useIsDark(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

/** Reads a CSS custom property off :root; falls back where vars are absent (jsdom). */
export function resolveCssColor(cssVar: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim();
  return value || fallback;
}

export interface ChartTheme {
  text: string;
  grid: string;
  font: { family: string; size: number };
  semantic: { success: string; warning: string; danger: string };
  tooltip: {
    backgroundColor: string;
    titleColor: string;
    bodyColor: string;
    borderColor: string;
    borderWidth: number;
    padding: number;
  };
}

export function getChartTheme(isDark: boolean): ChartTheme {
  return {
    text: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.55)',
    grid: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
    font: { family: "'SF Pro Text', -apple-system, sans-serif", size: 11 },
    semantic: {
      success: resolveCssColor('--success', '#3ecf8e'),
      warning: resolveCssColor('--warning', '#f5a342'),
      danger: resolveCssColor('--danger', '#f55a42'),
    },
    tooltip: {
      backgroundColor: resolveCssColor('--card-bg', isDark ? '#12151a' : '#ffffff'),
      titleColor: resolveCssColor('--text-main', isDark ? '#e8eaf0' : '#12151a'),
      bodyColor: resolveCssColor('--text-muted', isDark ? '#9ca3af' : '#374151'),
      borderColor: resolveCssColor('--border-color', isDark ? '#1e2430' : 'rgba(30,36,48,.102)'),
      borderWidth: 1,
      padding: 10,
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/crm/src/lib/__tests__/chartTheme.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/lib/chartTheme.ts apps/crm/src/lib/__tests__/chartTheme.test.ts
git commit -m "feat(crm): helper de tema para charts (chartTheme.ts)"
```

---

### Task 3: StatCard `onClick`, `active`, `invertDelta`

**Files:**
- Modify: `apps/crm/src/components/StatCard.tsx`
- Modify: `apps/crm/style.css` (append after the `.kpi-delta[data-direction='stable']` block, near line 1300)
- Create or extend: `apps/crm/src/components/__tests__/StatCard.test.tsx` (check whether a StatCard test already exists; extend it if so)

**Interfaces:**
- Produces (used by Tasks 5-6): three new optional props on `StatCardProps`:

```ts
onClick?: () => void;      // renders the card as <button type="button">, adds .kpi-card--clickable
active?: boolean;          // data-active="true" ring, meaning "this card's filter is applied"
invertDelta?: boolean;     // flips which direction is GOOD (a falling "tempo médio" is good)
```

- Existing props/behavior unchanged for all current call sites (they pass none of the new props).

**Delta color rule:** the arrow icon keeps showing the REAL direction. Only the color flips. Compute goodness in JS and expose it as `data-good` on the `.kpi-delta` span: `good = delta.direction === 'stable' ? undefined : (delta.direction === 'up') !== Boolean(invertDelta)`. CSS keys color off `data-good` when present; the existing `data-direction` rules remain as fallback for anything not setting it.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StatCard } from '../StatCard';

describe('StatCard onClick', () => {
  it('renders a button with active state and fires onClick', () => {
    const onClick = vi.fn();
    render(<StatCard label="Atrasadas" value={5} onClick={onClick} active />);
    const btn = screen.getByRole('button', { name: /Atrasadas/ });
    expect(btn).toHaveAttribute('data-active', 'true');
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
  it('renders a plain div without onClick', () => {
    render(<StatCard label="Em dia" value={2} />);
    expect(screen.queryByRole('button', { name: /Em dia/ })).toBeNull();
  });
});

describe('StatCard invertDelta', () => {
  it('marks a down delta as good when inverted', () => {
    render(
      <StatCard
        label="Tempo médio"
        value="5d"
        delta={{ direction: 'down', percent: 12, caption: 'vs período anterior' }}
        invertDelta
      />,
    );
    const delta = document.querySelector('.kpi-delta')!;
    expect(delta.getAttribute('data-direction')).toBe('down'); // arrow keeps real direction
    expect(delta.getAttribute('data-good')).toBe('true');      // color reads good
  });
  it('marks an up delta as good by default', () => {
    render(<StatCard label="Concluídos" value={4} delta={{ direction: 'up', percent: 33 }} />);
    expect(document.querySelector('.kpi-delta')!.getAttribute('data-good')).toBe('true');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/crm/src/components/__tests__/StatCard.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `StatCard.tsx`: add the three props; compute `good` as above; render the root as `<button type="button" className="kpi-card kpi-card--clickable" data-active={active || undefined} onClick={onClick}>` when `onClick` is set, else the current `<div className="kpi-card">`. Set `data-good={good === undefined ? undefined : String(good)}` on the `.kpi-delta` span. Do not change any existing class names.

Append to `apps/crm/style.css` (after the `.kpi-delta[data-direction=...]` rules — read them first and reuse their exact green/red color values for `data-good`):

```css
/* Clickable KPI cards (Visão geral cockpit) */
button.kpi-card--clickable {
  cursor: pointer;
  text-align: inherit;
  font: inherit;
  transition: background 0.15s ease;
}
button.kpi-card--clickable:hover {
  background: var(--surface-hover);
}
button.kpi-card--clickable:focus-visible {
  outline: 2px solid hsl(var(--ring));
  outline-offset: -2px;
}
.kpi-card[data-active='true'] {
  box-shadow: inset 0 0 0 2px var(--primary-color);
}
/* data-good overrides direction-based delta colors (invertDelta support) */
.kpi-delta[data-good='true'] { color: <SAME GREEN AS data-direction='up' RULE>; }
.kpi-delta[data-good='false'] { color: <SAME RED AS data-direction='down' RULE>; }
```

Replace the two placeholders with the literal color values you read from the existing `data-direction` rules at style.css:1294-1300 (this is the one CSS-literal exception; it copies values already in the file).

- [ ] **Step 4: Run tests**

Run: `npx vitest run apps/crm/src/components`
Expected: PASS (including any pre-existing StatCard consumers' tests).

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/components/StatCard.tsx apps/crm/src/components/__tests__/StatCard.test.tsx apps/crm/style.css
git commit -m "feat(crm): StatCard clicável com estado ativo e invertDelta"
```

---

### Task 4: kill the etapas N+1 — paginated single fetch

**Files:**
- Create: `apps/crm/src/store/paging.ts`
- Create: `apps/crm/src/store/__tests__/paging.test.ts`
- Modify: `apps/crm/src/store/workflows.ts` (`getAllActiveEtapas`, lines 265-281)
- Modify: `apps/crm/src/pages/entregas/hooks/useEntregasData.ts` (etapas query, lines 207-222; refresh unchanged)

**Interfaces:**
- Consumes: `getAllActiveEtapas()` existing signature (returns all etapas of ACTIVE workflows, every etapa status, ordered by `ordem`, plus joined `workflow_titulo`/`cliente_nome`/`cliente_id`). Existing consumers `apps/crm/src/pages/dashboard/useTodayAgenda.ts:110` and `apps/crm/src/pages/dashboard/components/AgentPendingSection.tsx:150` must keep working unchanged.
- Produces: `fetchAllPaged<T>(fetchPage: (from: number, to: number) => Promise<T[]>, pageSize?: number): Promise<T[]>`; `useEntregasData` keeps its exact return shape (`etapasMap: Map<number, WorkflowEtapa[]>` etc.), with queryKey `['all-active-etapas']` (stable, no id list).

**Why:** today the hook fires one `getWorkflowEtapas(id)` request per active workflow (135+ requests) and its queryKey changes whenever any workflow is created/concluded, invalidating everything. Separately, any unpaginated PostgREST select silently truncates at 1000 rows.

- [ ] **Step 1: Write the failing test for fetchAllPaged**

`apps/crm/src/store/__tests__/paging.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { fetchAllPaged } from '../paging';

describe('fetchAllPaged', () => {
  it('concatenates pages until a short page arrives', async () => {
    const page1 = Array.from({ length: 3 }, (_, i) => i);
    const page2 = [3, 4];
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce(page1)
      .mockResolvedValueOnce(page2);
    const all = await fetchAllPaged(fetchPage, 3);
    expect(all).toEqual([0, 1, 2, 3, 4]);
    expect(fetchPage).toHaveBeenNthCalledWith(1, 0, 2);
    expect(fetchPage).toHaveBeenNthCalledWith(2, 3, 5);
  });
  it('stops after one call when the first page is short', async () => {
    const fetchPage = vi.fn().mockResolvedValue([1]);
    await expect(fetchAllPaged(fetchPage, 1000)).resolves.toEqual([1]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });
  it('returns empty for an empty first page', async () => {
    const fetchPage = vi.fn().mockResolvedValue([]);
    await expect(fetchAllPaged(fetchPage, 10)).resolves.toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails, then implement**

`apps/crm/src/store/paging.ts`:

```ts
/**
 * Drains a PostgREST-style paginated query. Supabase caps any single select at
 * the server's max-rows (1000 by default) SILENTLY, so unbounded reads must
 * page with .range(from, to) until a short page signals the end.
 */
export async function fetchAllPaged<T>(
  fetchPage: (from: number, to: number) => Promise<T[]>,
  pageSize = 1000,
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const page = await fetchPage(from, from + pageSize - 1);
    all.push(...page);
    if (page.length < pageSize) return all;
  }
}
```

Run: `npx vitest run apps/crm/src/store/__tests__/paging.test.ts` — PASS.

- [ ] **Step 3: Paginate getAllActiveEtapas**

Rewrite the body of `getAllActiveEtapas` (workflows.ts:265-281) to page via `fetchAllPaged`, keeping the mapping identical:

```ts
export async function getAllActiveEtapas(): Promise<
  (WorkflowEtapa & { workflow_titulo?: string; cliente_nome?: string; cliente_id?: number })[]
> {
  const rows = await fetchAllPaged(async (from, to) => {
    const { data, error } = await supabase
      .from('workflow_etapas')
      .select('*, workflows!inner(titulo, cliente_id, status, clientes!inner(nome))')
      .eq('workflows.status', 'ativo')
      .order('ordem', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to);
    if (error) throw error;
    return data || [];
  });
  return rows.map((row: any) => ({ ...row, /* same mapping as today */ }));
}
```

The added `.order('id')` tiebreaker is REQUIRED: `.order('ordem')` alone is not a total order across workflows, and pagination over a non-deterministic order can skip or duplicate rows between pages. Import `fetchAllPaged` from `./paging`.

- [ ] **Step 4: Switch useEntregasData to the single fetch**

Replace the etapas query at `useEntregasData.ts:207-220` with:

```ts
const etapasQuery = useQuery({
  queryKey: ['all-active-etapas'],
  queryFn: async () => {
    const rows = await getAllActiveEtapas();
    const map = new Map<number, WorkflowEtapa[]>();
    for (const row of rows) {
      const list = map.get(row.workflow_id);
      if (list) list.push(row);
      else map.set(row.workflow_id, [row]);
    }
    return map;
  },
});
```

Notes: rows arrive ordered by `ordem` globally, so each per-workflow list is already in `ordem` order. Drop the `enabled: !loadingWf` (no longer needed). Update imports (remove `getWorkflowEtapas` if now unused in this file; add `getAllActiveEtapas`). The `refresh()` invalidation of `['all-active-etapas']` at line 341 keeps working (prefix match).

- [ ] **Step 5: Fix affected tests and run the suites**

Existing tests mock the store: `grep -rn "getWorkflowEtapas\|all-active-etapas" apps/crm/src/pages/entregas/__tests__ apps/crm/src/pages/entregas` and update mocks to provide `getAllActiveEtapas` returning flat rows (with `workflow_id`) where they previously mocked per-workflow `getWorkflowEtapas`.

Run: `npx vitest run apps/crm/src/pages/entregas apps/crm/src/store apps/crm/src/pages/dashboard`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/crm/src/store apps/crm/src/pages/entregas
git commit -m "refactor(entregas): fetch único paginado de etapas ativas (mata N+1 e cap de 1000 linhas)"
```

---

### Task 5: the cockpit — `chartViewData.ts` + rebuilt `ChartView.tsx`

**Files:**
- Create: `apps/crm/src/pages/entregas/views/chartViewData.ts` (pure data builders)
- Rewrite: `apps/crm/src/pages/entregas/views/ChartView.tsx`
- Create: `apps/crm/src/pages/entregas/views/__tests__/chartViewData.test.ts`
- Create: `apps/crm/src/pages/entregas/views/__tests__/ChartView.test.tsx`

**Interfaces:**
- Consumes: `classifyDeadline`, `computeDeadlineStats`, `DEADLINE_STATUS`, `DEADLINE_STATUS_ORDER` (Task 1); `useIsDark`, `getChartTheme`, `resolveCssColor` (Task 2); `StatCard` with `onClick`/`active` (Task 3); `etapaDeadlineDate`, `dayNum` from `../etapaPrazo`; `FilterState`, `EMPTY_FILTERS` from `../components/EntregasFilters`.
- Produces: the new ChartView prop contract (Task 6 wires it):

```ts
export interface ChartViewProps {
  cards: BoardCard[];                 // FILTERED cards (same as today)
  totalCards: number;                 // unfiltered card count, for "de N fluxos" captions
  filters: FilterState;
  onFiltersChange: (filters: FilterState) => void;
  onCardClick: (card: BoardCard) => void;          // opens the workflow drawer
  onGoToView: (view: 'kanban' | 'list') => void;   // switches the active view tab
}
```

**Visual reference (binding for hierarchy/content):** `docs/superpowers/specs/assets/2026-09-02-mockup-visao-geral.html`. Open it in a browser if useful. Layout container: `display:flex; flex-direction:column; gap:1.5rem`, sections in `.card` wrappers with `animate-up`, two-column rows via `display:grid; grid-template-columns:repeat(auto-fit, minmax(340px, 1fr)); gap:1.5rem`.

#### 5a. Pure builders (`chartViewData.ts`) — write tests first

All builders take `cards: BoardCard[]` and return plain data; NO Chart.js, NO DOM. Signatures:

```ts
export type UpcomingTab = 'hoje' | 'semana' | 'atrasadas';

export interface StackedRow {
  key: string;            // clienteId / membroId / etapa nome ('' for "sem responsável")
  label: string;
  counts: Record<DeadlineStatus, number>;
  total: number;
  clickable: boolean;     // false only for the "Sem responsável" row
}

export function buildClienteRows(cards: BoardCard[]): StackedRow[];
// key = String(cliente_id); label = cliente?.nome ?? 'Sem cliente'; sorted by
// counts.atrasado desc, then total desc; capped at 10 rows.

export function buildResponsavelRows(cards: BoardCard[]): StackedRow[];
// key = String(responsavel_id) or '' when card.membro is undefined;
// '' row gets label 'Sem responsável', clickable: false; same sort+cap.

export function buildEtapaRows(cards: BoardCard[]): StackedRow[];
// key = label = card.etapa.nome; sorted by total desc; capped at 10.

export interface AgingBucket {
  label: string;                       // '1 dia' | '2 a 3' | '4 a 7' | '8 a 14' | '15+'
  count: number;
  fromDaysAgo: number | null;          // for the filterPrazoFrom date (null = open)
  toDaysAgo: number;                   // for the filterPrazoTo date
}
export function buildAgingBuckets(cards: BoardCard[]): AgingBucket[];
// Only cards with deadline.estourado. Age = Math.max(1, Math.abs(deadline.diasRestantes)).
// Buckets: age<=1 → '1 dia' (from 1, to 1); 2-3 (from 3, to 2); 4-7 (from 7, to 4);
// 8-14 (from 14, to 8); >=15 → '15+' (from null, to 15). Always returns all 5 buckets
// in this order, zero counts included.

export function selectUpcoming(cards: BoardCard[], tab: UpcomingTab, now?: Date): BoardCard[];
// 'hoje': !estourado && deadline date is today (dayNum equality via etapaDeadlineDate).
// 'semana': !estourado && deadline within today..today+6 days.
// 'atrasadas': estourado, sorted most-overdue first (diasRestantes ascending).
// 'hoje'/'semana' sorted by deadline ascending. Cards without a deadline date are excluded
// from 'hoje'/'semana'.

export function aguardandoClienteCount(cards: BoardCard[]): number;
// cards whose ACTIVE etapa has tipo === 'aprovacao_cliente'.

export function aguardandoClienteEtapaNames(cards: BoardCard[]): string[];
// distinct etapa.nome of those cards (used for the KPI's filterEtapas patch).
```

Test cases to write (build minimal `BoardCard` fixtures with a helper like Task 1's `card()`, extended with `cliente`, `membro`, `etapa`, `workflow` fields as needed):
- `buildClienteRows`: groups two cards of the same cliente; sorts a cliente with 2 atrasados above one with 3 em dia; caps at 10 (feed 12 clientes); a card with `cliente: undefined` lands in a 'Sem cliente' row.
- `buildResponsavelRows`: cards with `membro: undefined` go to the `''` row with `clickable: false`.
- `buildAgingBuckets`: `diasRestantes: -1` → bucket '1 dia'; `-3` → '2 a 3'; `-20` → '15+'; non-estourado cards ignored; all five buckets always present.
- `selectUpcoming('hoje')`: uses a fixed `now`; a card whose etapa has `data_limite` today matches; an estourada card does not; 'atrasadas' returns most overdue first.
- `aguardandoClienteCount` / `...EtapaNames`: counts only `tipo === 'aprovacao_cliente'`, dedupes names.

Run the test (FAIL), implement, run again (PASS), then commit the pair before starting 5b:

```bash
git add apps/crm/src/pages/entregas/views/chartViewData.ts apps/crm/src/pages/entregas/views/__tests__/chartViewData.test.ts
git commit -m "feat(entregas): builders puros da Visão geral (chartViewData.ts)"
```

#### 5b. The component (`ChartView.tsx`)

Structure (top to bottom), all deriving from `props.cards`:

1. **KPI strip** — `StatCardGrid maxCols={5}` with 5 clickable `StatCard`s:

| label | value | tone / icon (lucide) | onClick patch (toggle) | active when |
|---|---|---|---|---|
| `Atrasadas` | stats.atrasado | red / `AlertTriangle` | `filterStatus: ['atrasado']` | `filters.filterStatus` equals `['atrasado']` |
| `Urgentes (24h)` | stats.urgente | amber / `Clock` | `filterStatus: ['urgente']` | equals `['urgente']` |
| `Em dia` | stats.em_dia | green / `CheckCircle2` | `filterStatus: ['em_dia']` | equals `['em_dia']` |
| `Vencem hoje` | selectUpcoming(cards,'hoje').length | amber / `CalendarClock` | `filterPrazo: ['hoje']` | `filters.filterPrazo` equals `['hoje']` |
| `Aguardando cliente` | aguardandoClienteCount(cards) | blue / `UserCheck` | `filterEtapas: aguardandoClienteEtapaNames(cards)` | `filters.filterEtapas` non-empty and set-equal to those names |

Toggle semantics: clicking an ACTIVE card clears only the fields it set (back to `[]`). Patch = `onFiltersChange({ ...filters, <field>: <value> })`. Each card gets `sub` = `de ${totalCards} fluxos`.

2. **"Próximos vencimentos"** — `.card` with an inline tab toggle (`Hoje | Esta semana | Atrasadas`, local `useState<UpcomingTab>('hoje')`, plain buttons with `role="tab"`/`aria-selected` inside a `role="tablist"`). Body: horizontal scroll row (`display:flex; gap:0.75rem; overflow-x:auto`, className includes `no-scrollbar`) of chip buttons for `selectUpcoming(cards, tab)` capped at 12, plus a trailing `+N · ver na lista` button when more exist, which calls `onFiltersChange` with the tab's prazo filter (`hoje` → `filterPrazo:['hoje']`; `semana` → `filterPrazo:['proximos7']`; `atrasadas` → `filterStatus:['atrasado']`) and then `onGoToView('list')`. Chip content: cliente avatar (img from `card.clienteAvatarUrl` fallback to a colored initials circle from `card.cliente?.nome`), workflow title (ellipsis), etapa name muted, deadline badge via `formatEtapaPrazo(card.deadline).shortLabel` colored by its returned `color`. Chip click → `onCardClick(card)`. Empty states (single muted line): hoje → `Nada vence hoje. Bom sinal.`; semana → `Semana livre de vencimentos.`; atrasadas → `Nenhuma entrega atrasada.`

3. **Row: "Situação por cliente" + "Carga por responsável"** — two `.card`s in the 2-col grid, each a horizontal stacked `Bar` from react-chartjs-2:

```ts
import { Bar, getElementAtEvent } from 'react-chartjs-2';
// datasets: DEADLINE_STATUS_ORDER.map(status => ({
//   label: DEADLINE_STATUS[status].label,
//   data: rows.map(r => r.counts[status]),
//   backgroundColor: theme.semantic[{em_dia:'success',urgente:'warning',atrasado:'danger'}[status]],
//   borderWidth: 0, maxBarThickness: 18,
// }))
// options: indexAxis:'y', responsive:true, maintainAspectRatio:false,
//   scales: { x: { stacked:true, ticks:{color:theme.text,font:theme.font,precision:0}, grid:{color:theme.grid} },
//             y: { stacked:true, ticks:{color:theme.text,font:theme.font}, grid:{display:false} } },
//   plugins: { legend:{position:'bottom', labels:{color:theme.text, font:theme.font, boxWidth:10}}, tooltip: theme.tooltip }
```

Canvas wrapper: `<div style={{ position:'relative', height: Math.max(200, rows.length * 34) }}>`. Click handler on the `<Bar ref={chartRef} onClick={...}>`: use `getElementAtEvent(chartRef.current!, event)`; from `[{ datasetIndex, index }]` derive the row and status, then `onFiltersChange({ ...filters, filterClientes:[Number(row.key)], filterStatus:[status] })` (cliente chart) or `filterMembros` (responsável chart, skipping rows with `clickable: false`). Canvas gets `role="img"` and `aria-label` (`Gráfico de barras: situação das entregas por cliente`). Empty (`rows.length === 0`): muted line `Nenhuma entrega encontrada. Ajuste os filtros.`

4. **Row: "Fluxos por etapa" + "Idade dos atrasos"** — same stacked-bar recipe for etapas (click → `filterEtapas:[row.key]`). Idade dos atrasos: vertical `Bar`, single dataset `theme.semantic.danger`, labels from `buildAgingBuckets`; click on bucket → `onFiltersChange({ ...filters, filterStatus:['atrasado'], filterPrazoFrom: bucket.fromDaysAgo == null ? '' : isoDaysAgo(bucket.fromDaysAgo), filterPrazoTo: isoDaysAgo(bucket.toDaysAgo) })` where `isoDaysAgo(n)` formats `today - n days` as `YYYY-MM-DD` (local date). When there are zero atrasadas, replace the canvas with the celebratory empty state: `CheckCircle2` icon in `var(--success)` + `Nenhuma entrega atrasada`.

Every section header is an `h3` (`fontSize: '0.9rem', fontWeight: 600`) with a one-line muted caption. Register Chart.js parts once at module level: `ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend)`. Get `const isDark = useIsDark();` and `const theme = useMemo(() => getChartTheme(isDark), [isDark]);` — datasets/options in `useMemo` keyed on `[cards, theme]`.

#### 5c. Component test (`ChartView.test.tsx`)

Mock react-chartjs-2 (jsdom has no canvas):

```tsx
vi.mock('react-chartjs-2', () => ({
  Bar: ({ data, ...rest }: any) => (
    <div data-testid="bar-chart" data-labels={JSON.stringify(data.labels)} />
  ),
  getElementAtEvent: () => [],
}));
```

Assert: (1) the 5 KPI cards render with correct counts from a small fixture set; (2) clicking "Atrasadas" calls `onFiltersChange` with `filterStatus: ['atrasado']` and clicking it again (render with `filters` already set) clears it; (3) the upcoming tab switch renders the fixture card chip and clicking the chip calls `onCardClick`; (4) with zero estourado cards the text `Nenhuma entrega atrasada` appears; (5) chart labels come from the fixture clientes.

Run: `npx vitest run apps/crm/src/pages/entregas/views` — PASS.

- [ ] **Final step: Commit**

```bash
git add apps/crm/src/pages/entregas/views
git commit -m "feat(entregas): vista Visão geral substitui o donut (cockpit operacional)"
```

---

### Task 6: wire it into EntregasPage

**Files:**
- Modify: `apps/crm/src/pages/entregas/EntregasPage.tsx`
- Modify: `apps/crm/src/pages/entregas/__tests__/EntregasPage.test.tsx` (ChartView mock lines ~181-183 and any label assertions)

**Interfaces:**
- Consumes: `ChartViewProps` from Task 5.

- [ ] **Step 1: Update the failing page test first**

In `EntregasPage.test.tsx`, update the ChartView mock to the new props and add assertions: the tab renders with label `Visão geral`; the view switcher container has `role="tablist"` and the active tab `aria-selected="true"`; `document.title` becomes `Entregas | Mesaas` after render. Run: FAIL.

- [ ] **Step 2: Implement the wiring**

1. `VIEW_TABS` (line 76): label `'Gráfico'` → `'Visão geral'` (id stays `'chart'`, icon stays `BarChart2`).
2. Line 826: `{activeView === 'chart' && <ChartView cards={filteredCards} totalCards={cards.length} filters={filters} onFiltersChange={setFilters} onCardClick={handleCardClick} onGoToView={setActiveView} />}`.
3. View switcher a11y (lines 731-767): wrap div gets `role="tablist"` + `aria-label="Modos de visualização"`; each button gets `role="tab"` and `aria-selected={activeView === tab.id}`.
4. Doc title: `useEffect(() => { document.title = 'Entregas | Mesaas'; }, []);` (check `apps/crm/src/pages/NotFoundPage.tsx` for the house pattern first and mirror it, including any cleanup it does).
5. Header stats `<p>` (line 662): add `data-tooltip="Totais gerais, sem filtros"` and `data-tooltip-dir="right"`.

- [ ] **Step 2b: Make the prazo filter real for workflow cards (review finding, REQUIRED)**

Today `filterPrazo`/`filterPrazoFrom`/`filterPrazoTo` are serialized to the URL and rendered as UI, but the entregas-mode card pipeline (`filteredCards`, EntregasPage.tsx:557-595) never applies them — they only filter posts. Without this step the cockpit's "Vencem hoje" KPI and "Idade dos atrasos" clicks change state with no visible effect.

1. In the `filteredCards` pipeline, after the `filterStatus` block, add:

```ts
if (filters.filterPrazo.length || filters.filterPrazoFrom || filters.filterPrazoTo)
  filteredCards = filteredCards.filter((c) =>
    matchesEtapaPrazo(c, filters.filterPrazo, filters.filterPrazoFrom, filters.filterPrazoTo),
  );
```

(`matchesEtapaPrazo` is already imported in this file.)

2. In `apps/crm/src/pages/entregas/components/EntregasFilters.tsx`, the "Prazo da etapa" filter section and its active-filter chip currently render only in posts mode. Expose the SAME existing prazo section (presets + custom range + its chip + its "clear" handling) in the entregas-mode "Mais filtros" popover, and make sure `countActiveFilters` counts prazo in entregas mode too (line ~109 gates it today). Reuse the existing components/markup; do not build a second implementation.

3. Add a page test: with `filters.filterPrazo = ['hoje']` (drive via the URL query param `?prazo=hoje` or by clicking the mocked ChartView's patch), a fixture card whose etapa deadline is today stays visible and one due next week disappears from the rendered view.

- [ ] **Step 3: Run the page suite**

Run: `npx vitest run apps/crm/src/pages/entregas`
Expected: PASS.

- [ ] **Step 4: Full verification gate**

```bash
npm run lint
npm run format:check   # run `npm run format` first if it flags the new files
npx tsc -p apps/crm/tsconfig.json --noEmit
npx tsc -p apps/hub/tsconfig.json --noEmit
npx tsc -p apps/admin/tsconfig.json --noEmit
npx tsc -p tsconfig.scripts.json
npm run test
```
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/entregas
git commit -m "feat(entregas): aba Visão geral no lugar de Gráfico, a11y do seletor e título da página"
```
