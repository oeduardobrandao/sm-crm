# Tarefas Board Calendar View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a date-bucket kanban "Board" mode to the Tarefas Calendário tab (Em atraso / Hoje / Amanhã / weekday columns / Mais tarde / Sem data, dnd-kit rescheduling, "+ Adicionar tarefa" pinned at the top of each column), and redesign the shared `TarefaCard` (client-color footer, inline assignee reassignment) so Kanban and Por membro pick up the same visual/behavioral upgrade.

**Architecture:** A new `BoardView.tsx` reuses the existing `TarefaBoard` component from `boardShared.tsx` (same shape as `StatusKanbanView`/`MembrosBoardView` — build `BoardColumn[]` + a drop handler, no new `DndContext`). `CalendarView.tsx` gets a small Mês/Board toggle (persisted per-conta via `localStorage`, mirroring `entregasPrefs.ts`'s existing convention) that swaps between the current month grid and `<BoardView/>`. `TarefaCard.tsx` is redesigned in place and gains `membros`/`onRefresh` props for an inline reassign dropdown (mirroring `WorkflowCard.tsx`'s existing pattern), threaded through `boardShared.tsx` to all three board-based views.

**Tech Stack:** React 19, TypeScript, `@dnd-kit/core` (already in use, no `@dnd-kit/sortable` needed here), shadcn `DropdownMenu` (Radix), `lucide-react`, Vitest + React Testing Library, Supabase (`clientes.cor` — already-exposed column, no migration).

## Global Constraints

- No database schema/migration changes (spec Non-goal). `clientes.cor` is already a granted, selected column elsewhere — this plan only adds it to one more `.select()` embed.
- No new npm dependencies — everything needed (dnd-kit, shadcn dropdown-menu, lucide-react icons, sonner) is already installed and used elsewhere in this codebase.
- Portuguese UI copy throughout (`"Em atraso"`, `"Adicionar tarefa"`, etc.) — match the existing casing convention seen in `STATUS_LABELS`/`VIEW_TABS` (sentence-case-ish, not Title Case).
- `data_limite` is always a bare `'YYYY-MM-DD'` string — never parse it with naive `new Date(...)`; always go through `parseDateOnly`/`toDateOnlyString` from `tarefasLogic.ts`.
- Every task that touches a `.ts`/`.tsx` file must type-check clean: `npx tsc -p apps/crm/tsconfig.json --noEmit`.
- Run the relevant Vitest file(s) after every code change (`npm run test -- <path>` or `npx vitest run <path>`), not just at the end.
- No comments explaining *what* code does — only the sparse *why* comments this codebase already uses (see `tarefasLogic.ts`'s date-helper header comment for the house style).
- Full spec: `docs/superpowers/specs/2026-09-12-tarefas-board-calendar-design.md`.

---

## Task 1: Client color on tasks (`cliente_cor`)

Adds the client's real color (`clientes.cor`) to every task, so the card redesign in Task 6 has real data instead of a hash. `cor` is already a granted/selected column on `clientes` elsewhere in the app — this only projects it through one more embed.

**Files:**
- Modify: `apps/crm/src/store/tarefas.ts` (the `TarefaRow`/`TarefaWithRelations` types and `getTarefas()`)
- Modify: `apps/crm/src/pages/tarefas/__tests__/tarefasLogic.test.ts:17-34` (the `makeTarefa` fixture helper, so it keeps compiling against the now-required new field)

**Interfaces:**
- Produces: `TarefaWithRelations.cliente_cor: string | null` — consumed by Task 6's `TarefaCard` redesign.

- [ ] **Step 1: Add `cliente_cor` to the type and the query**

In `apps/crm/src/store/tarefas.ts`, update `TarefaWithRelations` (around line 46-51):

```ts
export interface TarefaWithRelations extends Tarefa {
  tags: TarefaTag[];
  subtarefas_total: number;
  subtarefas_concluidas: number;
  cliente_nome: string | null;
  cliente_cor: string | null;
}
```

Update `TarefaRow` (around line 53-57):

```ts
interface TarefaRow extends Tarefa {
  clientes: { nome: string; cor: string } | null;
  tarefa_tag_links: { tarefa_tags: TarefaTag | null }[] | null;
  subtarefas: { id: number; concluida: boolean }[] | null;
}
```

Update `getTarefas()` (around line 59-77) — change the select string and the mapped return:

```ts
export async function getTarefas(): Promise<TarefaWithRelations[]> {
  const { data, error } = await supabase
    .from('tarefas')
    .select(
      '*, clientes(nome, cor), tarefa_tag_links(tarefa_tags(id, nome, cor)), subtarefas(id, concluida)',
    )
    .order('created_at', { ascending: false });
  if (error) throw error;
  return ((data as TarefaRow[]) || []).map((row) => {
    const { clientes, tarefa_tag_links, subtarefas, ...tarefa } = row;
    const subs = subtarefas || [];
    return {
      ...tarefa,
      tags: (tarefa_tag_links || [])
        .map((l) => l.tarefa_tags)
        .filter((t): t is TarefaTag => t != null),
      subtarefas_total: subs.length,
      subtarefas_concluidas: subs.filter((s) => s.concluida).length,
      cliente_nome: clientes?.nome ?? null,
      cliente_cor: clientes?.cor ?? null,
    };
  });
}
```

- [ ] **Step 2: Update the test fixture helper so the suite still compiles**

In `apps/crm/src/pages/tarefas/__tests__/tarefasLogic.test.ts`, add `cliente_cor: null` to `makeTarefa`'s returned object (it has an explicit `TarefaWithRelations` return type, so it needs every required field):

```ts
function makeTarefa(overrides: Partial<TarefaWithRelations> = {}): TarefaWithRelations {
  seq++;
  return {
    id: seq,
    titulo: `Tarefa ${seq}`,
    status: 'pendente',
    responsavel_id: null,
    cliente_id: null,
    data_limite: null,
    concluida_em: null,
    created_at: `2026-07-01T10:00:${String(seq % 60).padStart(2, '0')}`,
    tags: [],
    subtarefas_total: 0,
    subtarefas_concluidas: 0,
    cliente_nome: null,
    cliente_cor: null,
    ...overrides,
  };
}
```

- [ ] **Step 3: Type-check and run the existing suite**

Run:

```bash
npx tsc -p apps/crm/tsconfig.json --noEmit
npx vitest run apps/crm/src/pages/tarefas/__tests__/tarefasLogic.test.ts
```

Expected: both succeed with no errors (this is a pure type/shape addition — no behavior changed yet).

- [ ] **Step 4: Commit**

```bash
git add apps/crm/src/store/tarefas.ts apps/crm/src/pages/tarefas/__tests__/tarefasLogic.test.ts
git commit -m "feat(tarefas): add cliente_cor to TarefaWithRelations

Projects the already-exposed clientes.cor column through getTarefas()'s
embed, for the upcoming card redesign's client-color footer dot."
```

---

## Task 2: Board-mode date bucketing (`groupByBoardColumn`)

The pure logic that turns a task list into the Board view's columns (Em atraso / Hoje / Amanhã / one column per remaining weekday / Mais tarde / Sem data). This is the highest-risk logic in the whole feature (week-boundary edge cases), so it gets thorough unit tests before anything renders it.

**Files:**
- Modify: `apps/crm/src/pages/tarefas/tarefasLogic.ts` (add after the existing `groupByDueBucket` block, i.e. after line 95)
- Test: `apps/crm/src/pages/tarefas/__tests__/tarefasLogic.test.ts` (add a new `describe('groupByBoardColumn', ...)` block)

**Interfaces:**
- Consumes: `parseDateOnly`, `toDateOnlyString`, `sortTarefas` (already exported), plus the file-local `startOfLocalDay`/`isSameLocalDay`/`endOfCurrentWeek` helpers already defined in this same file.
- Produces: `export interface BoardBucket { key: string; label: string; date: string | null; droppable: boolean; tarefas: TarefaWithRelations[] }` and `export function groupByBoardColumn(tarefas: TarefaWithRelations[], now: Date): BoardBucket[]` — consumed by Task 8 (`BoardView.tsx`).

- [ ] **Step 1: Write the failing tests**

Add to `apps/crm/src/pages/tarefas/__tests__/tarefasLogic.test.ts` (add `groupByBoardColumn` to the existing import list at the top of the file, alongside `groupByDueBucket`):

```ts
describe('groupByBoardColumn', () => {
  it('buckets atrasado/hoje/amanha/weekday/depois/semData for a normal weekday', () => {
    const atrasada = makeTarefa({ data_limite: '2026-07-28' });
    const hoje = makeTarefa({ data_limite: '2026-07-29' });
    const amanha = makeTarefa({ data_limite: '2026-07-30' });
    const sexta = makeTarefa({ data_limite: '2026-07-31' });
    const domingo = makeTarefa({ data_limite: '2026-08-02' });
    const depois = makeTarefa({ data_limite: '2026-08-03' });
    const semData = makeTarefa({ data_limite: null });

    const buckets = groupByBoardColumn(
      [depois, semData, domingo, sexta, amanha, hoje, atrasada],
      NOW,
    );
    expect(buckets.map((b) => b.key)).toEqual([
      'atrasado',
      'hoje',
      'amanha',
      'dia:2026-07-31',
      'dia:2026-08-01',
      'dia:2026-08-02',
      'depois',
      'semData',
    ]);
    expect(buckets.map((b) => b.label)).toEqual([
      'Em atraso',
      'Hoje',
      'Amanhã',
      'Sexta',
      'Sábado',
      'Domingo',
      'Mais tarde',
      'Sem data',
    ]);
    expect(buckets.find((b) => b.key === 'atrasado')!.tarefas).toEqual([atrasada]);
    expect(buckets.find((b) => b.key === 'hoje')!.tarefas).toEqual([hoje]);
    expect(buckets.find((b) => b.key === 'amanha')!.tarefas).toEqual([amanha]);
    expect(buckets.find((b) => b.key === 'dia:2026-07-31')!.tarefas).toEqual([sexta]);
    expect(buckets.find((b) => b.key === 'dia:2026-08-01')!.tarefas).toEqual([]);
    expect(buckets.find((b) => b.key === 'dia:2026-08-02')!.tarefas).toEqual([domingo]);
    expect(buckets.find((b) => b.key === 'depois')!.tarefas).toEqual([depois]);
    expect(buckets.find((b) => b.key === 'semData')!.tarefas).toEqual([semData]);
  });

  it('marks atrasado, depois and semData droppability correctly', () => {
    const buckets = groupByBoardColumn([], NOW);
    const droppableByKey = Object.fromEntries(buckets.map((b) => [b.key, b.droppable]));
    expect(droppableByKey.atrasado).toBe(false);
    expect(droppableByKey.depois).toBe(false);
    expect(droppableByKey.hoje).toBe(true);
    expect(droppableByKey.amanha).toBe(true);
    expect(droppableByKey['dia:2026-07-31']).toBe(true);
    expect(droppableByKey.semData).toBe(true);
  });

  it('produces zero weekday columns when today is Saturday, and "amanhã" still lands on Sunday', () => {
    const NOW_SAT = new Date('2026-08-01T10:00:00'); // Saturday; week ends Sunday 2026-08-02
    const buckets = groupByBoardColumn([], NOW_SAT);
    expect(buckets.map((b) => b.key)).toEqual(['atrasado', 'hoje', 'amanha', 'depois', 'semData']);
    expect(buckets.find((b) => b.key === 'amanha')!.date).toBe('2026-08-02');
  });

  it('produces zero weekday columns when today is Sunday, and "amanhã" is next Monday', () => {
    const NOW_SUN = new Date('2026-08-02T10:00:00'); // Sunday; week ends Sunday 2026-08-02 (today)
    const buckets = groupByBoardColumn([], NOW_SUN);
    expect(buckets.map((b) => b.key)).toEqual(['atrasado', 'hoje', 'amanha', 'depois', 'semData']);
    expect(buckets.find((b) => b.key === 'amanha')!.date).toBe('2026-08-03');
  });

  it('keeps a completed task with a due date in its date bucket, but drops a completed undated task', () => {
    const doneOverdue = makeTarefa({ data_limite: '2026-07-28', status: 'concluida' });
    const doneNoDate = makeTarefa({ data_limite: null, status: 'concluida' });
    const buckets = groupByBoardColumn([doneOverdue, doneNoDate], NOW);
    expect(buckets.find((b) => b.key === 'atrasado')!.tarefas).toEqual([doneOverdue]);
    expect(buckets.find((b) => b.key === 'semData')!.tarefas).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run apps/crm/src/pages/tarefas/__tests__/tarefasLogic.test.ts`
Expected: FAIL — `groupByBoardColumn is not a function` (or a TS import error, since it doesn't exist yet).

- [ ] **Step 3: Implement `groupByBoardColumn`**

Add to `apps/crm/src/pages/tarefas/tarefasLogic.ts`, right after the closing brace of `groupByDueBucket` (after line 95):

```ts
// ---- Board view (date-bucket kanban) -----------------------------------------

export interface BoardBucket {
  /** Stable key: 'atrasado' | 'hoje' | 'amanha' | `dia:YYYY-MM-DD` | 'depois' | 'semData'. */
  key: string;
  label: string;
  /** Exact date this bucket maps to when a card is dropped on it. Null for
   * 'atrasado'/'depois' (no single unambiguous date), and also null for
   * 'semData' -- there it means "clear the due date" on drop. */
  date: string | null;
  droppable: boolean;
  tarefas: TarefaWithRelations[];
}

const WEEKDAY_LABELS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

/**
 * Buckets tasks for the Tarefas "Board" view: Em atraso, Hoje, Amanhã, one
 * column per remaining weekday through the end of the current week, Mais
 * tarde, and Sem data. Unlike `groupByDueBucket` (coarser, Lista-view-only,
 * and drops ALL completed tasks), a completed task WITH a due date still
 * appears in its date's bucket -- same as the month grid -- so the Mês/Board
 * toggle shows a consistent set of tasks either way. Only a completed task
 * with NO due date is dropped.
 */
export function groupByBoardColumn(tarefas: TarefaWithRelations[], now: Date): BoardBucket[] {
  const today = startOfLocalDay(now);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const weekEnd = endOfCurrentWeek(now);

  const atrasado: TarefaWithRelations[] = [];
  const hoje: TarefaWithRelations[] = [];
  const amanha: TarefaWithRelations[] = [];
  const depois: TarefaWithRelations[] = [];
  const semData: TarefaWithRelations[] = [];
  const porDia = new Map<string, TarefaWithRelations[]>();

  for (const t of tarefas) {
    if (!t.data_limite) {
      if (t.status !== 'concluida') semData.push(t);
      continue;
    }
    const due = parseDateOnly(t.data_limite);
    if (due < today) atrasado.push(t);
    else if (isSameLocalDay(due, today)) hoje.push(t);
    else if (isSameLocalDay(due, tomorrow)) amanha.push(t);
    else if (due <= weekEnd) {
      const list = porDia.get(t.data_limite) ?? [];
      list.push(t);
      porDia.set(t.data_limite, list);
    } else depois.push(t);
  }

  const buckets: BoardBucket[] = [
    {
      key: 'atrasado',
      label: 'Em atraso',
      date: null,
      droppable: false,
      tarefas: atrasado.sort(sortTarefas),
    },
    {
      key: 'hoje',
      label: 'Hoje',
      date: toDateOnlyString(today),
      droppable: true,
      tarefas: hoje.sort(sortTarefas),
    },
    {
      key: 'amanha',
      label: 'Amanhã',
      date: toDateOnlyString(tomorrow),
      droppable: true,
      tarefas: amanha.sort(sortTarefas),
    },
  ];

  const cursor = new Date(tomorrow);
  cursor.setDate(cursor.getDate() + 1);
  while (cursor <= weekEnd) {
    const dateStr = toDateOnlyString(cursor);
    buckets.push({
      key: `dia:${dateStr}`,
      label: WEEKDAY_LABELS[cursor.getDay()],
      date: dateStr,
      droppable: true,
      tarefas: (porDia.get(dateStr) ?? []).sort(sortTarefas),
    });
    cursor.setDate(cursor.getDate() + 1);
  }

  buckets.push({
    key: 'depois',
    label: 'Mais tarde',
    date: null,
    droppable: false,
    tarefas: depois.sort(sortTarefas),
  });
  buckets.push({
    key: 'semData',
    label: 'Sem data',
    date: null,
    droppable: true,
    tarefas: semData.sort(sortTarefas),
  });

  return buckets;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run apps/crm/src/pages/tarefas/__tests__/tarefasLogic.test.ts`
Expected: PASS, all `groupByBoardColumn` cases green, and every pre-existing test in the file still passes.

- [ ] **Step 5: Type-check**

Run: `npx tsc -p apps/crm/tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/crm/src/pages/tarefas/tarefasLogic.ts apps/crm/src/pages/tarefas/__tests__/tarefasLogic.test.ts
git commit -m "feat(tarefas): add groupByBoardColumn date-bucketing for the Board view

Em atraso / Hoje / Amanhã / per-weekday / Mais tarde / Sem data, evaluated
in a fixed priority order so week-boundary days (today = Sat/Sun) resolve
unambiguously. Completed+dated tasks stay visible (matches the month grid);
completed+undated tasks are dropped, same as CalendarView's semData rule."
```

---

## Task 3: Mês/Board toggle persistence (`tarefasPrefs.ts`)

A tiny per-conta localStorage-backed preference, mirroring `apps/crm/src/pages/entregas/entregasPrefs.ts`'s existing `loadLastMode`/`persistLastMode` pair exactly.

**Files:**
- Create: `apps/crm/src/pages/tarefas/tarefasPrefs.ts`
- Test: `apps/crm/src/pages/tarefas/__tests__/tarefasPrefs.test.ts`

**Interfaces:**
- Produces: `export type TarefasCalendarioModo = 'mes' | 'board'`, `export function loadTarefasCalendarioModo(contaId: string): TarefasCalendarioModo`, `export function persistTarefasCalendarioModo(contaId: string, modo: TarefasCalendarioModo): void` — consumed by Task 9 (`CalendarView.tsx`).

- [ ] **Step 1: Write the failing tests**

Create `apps/crm/src/pages/tarefas/__tests__/tarefasPrefs.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadTarefasCalendarioModo, persistTarefasCalendarioModo } from '../tarefasPrefs';

describe('tarefasPrefs', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults to board when the key is unset', () => {
    expect(loadTarefasCalendarioModo('conta-1')).toBe('board');
  });

  it('persists and reloads mes', () => {
    persistTarefasCalendarioModo('conta-1', 'mes');
    expect(loadTarefasCalendarioModo('conta-1')).toBe('mes');
    expect(localStorage.getItem('tarefas_calendario_modo_conta-1')).toBe('mes');
  });

  it('keys the preference per conta', () => {
    persistTarefasCalendarioModo('conta-1', 'mes');
    expect(loadTarefasCalendarioModo('conta-2')).toBe('board');
  });

  it('falls back to board for a malformed stored value', () => {
    localStorage.setItem('tarefas_calendario_modo_conta-1', 'garbage');
    expect(loadTarefasCalendarioModo('conta-1')).toBe('board');
  });

  it('does not throw when localStorage.getItem fails', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(loadTarefasCalendarioModo('conta-1')).toBe('board');
    spy.mockRestore();
  });

  it('does not throw when localStorage.setItem fails', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    expect(() => persistTarefasCalendarioModo('conta-1', 'mes')).not.toThrow();
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run apps/crm/src/pages/tarefas/__tests__/tarefasPrefs.test.ts`
Expected: FAIL — cannot find module `'../tarefasPrefs'`.

- [ ] **Step 3: Implement `tarefasPrefs.ts`**

Create `apps/crm/src/pages/tarefas/tarefasPrefs.ts`:

```ts
export type TarefasCalendarioModo = 'mes' | 'board';

const calendarioModoKey = (contaId: string) => `tarefas_calendario_modo_${contaId}`;

/** Last Mês/Board mode the user left the Tarefas Calendário tab in, per
 *  conta. Falls back to 'board' on a missing key or any storage failure. */
export function loadTarefasCalendarioModo(contaId: string): TarefasCalendarioModo {
  try {
    return localStorage.getItem(calendarioModoKey(contaId)) === 'mes' ? 'mes' : 'board';
  } catch {
    return 'board';
  }
}

export function persistTarefasCalendarioModo(contaId: string, modo: TarefasCalendarioModo): void {
  try {
    localStorage.setItem(calendarioModoKey(contaId), modo);
  } catch {
    // Private browsing / storage full -- the preference just doesn't survive a reload.
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run apps/crm/src/pages/tarefas/__tests__/tarefasPrefs.test.ts`
Expected: PASS, all 6 cases green.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/tarefas/tarefasPrefs.ts apps/crm/src/pages/tarefas/__tests__/tarefasPrefs.test.ts
git commit -m "feat(tarefas): add per-conta Mês/Board mode persistence

Mirrors entregasPrefs.ts's loadLastMode/persistLastMode shape exactly."
```

---

## Task 4: `boardShared.tsx` — droppable opt-out, add-button slot, `onRefresh` threading

Three additions to the shared board component, all additive (existing callers `StatusKanbanView`/`MembrosBoardView` are unaffected by the new optional fields, but DO need the new required `onRefresh` prop — that's Task 5).

**Files:**
- Modify: `apps/crm/src/pages/tarefas/views/boardShared.tsx`

**Interfaces:**
- Consumes: nothing new (same `Membro`/`TarefaWithRelations` imports).
- Produces: `BoardColumn` gains `droppable?: boolean` (default true) and `onAddClick?: () => void`. `TarefaBoardProps` gains `onRefresh: () => void`. Consumed by Task 5 (existing views), Task 8 (`BoardView.tsx`).

This task has no isolated unit test of its own (dnd-kit's `useDroppable` registration isn't observable through a DOM attribute RTL can assert on, and this codebase has zero existing tests for `boardShared.tsx` for exactly that reason — see the spec's Testing section). Correctness here is verified by: (a) the type-check in Step 3, (b) Task 6's `TarefaCard` tests exercising the new props end-to-end, and (c) the manual browser verification in Task 11.

- [ ] **Step 1: Add the new `BoardColumn` fields and `TarefaBoardProps.onRefresh`**

In `apps/crm/src/pages/tarefas/views/boardShared.tsx`, update the `BoardColumn` interface (lines 17-23):

```ts
export interface BoardColumn {
  /** Namespaced droppable id from buildDropId. */
  dropId: string;
  title: string;
  tarefas: TarefaWithRelations[];
  hideAssignee?: boolean;
  /** When false, this column's body doesn't register as a drop target (e.g.
   * "Em atraso"/"Mais tarde" have no single unambiguous date to assign).
   * Defaults to true. */
  droppable?: boolean;
  /** Renders a "+ Adicionar tarefa" button pinned at the top of the column
   * when provided. */
  onAddClick?: () => void;
}
```

Update `TarefaBoardProps` (lines 25-33):

```ts
interface TarefaBoardProps {
  columns: BoardColumn[];
  membros: Membro[];
  now: Date;
  onCardClick: (tarefa: TarefaWithRelations) => void;
  /** Fired with the dragged task and the RESOLVED column dropId (card-over-card
   * drops resolve to the hovered card's column). */
  onDropCard: (tarefa: TarefaWithRelations, dropId: string) => void;
  onRefresh: () => void;
}
```

- [ ] **Step 2: Split `DroppableColumnBody` so non-droppable columns skip `useDroppable`**

Replace the existing `DroppableColumnBody` function (lines 74-85) with:

```tsx
// Registers the column body as a drop target so empty columns can receive
// drops. `droppable: false` columns render a plain div instead -- calling
// useDroppable conditionally would break the rules of hooks, so this is
// split into two components rather than an early return inside one.
function DroppableColumnBody({
  id,
  children,
  droppable = true,
}: {
  id: string;
  children: React.ReactNode;
  droppable?: boolean;
}) {
  if (!droppable) {
    return (
      <div className="board-column-body" style={{ minHeight: 60 }}>
        {children}
      </div>
    );
  }
  return <DroppableColumnBodyRegistered id={id}>{children}</DroppableColumnBodyRegistered>;
}

function DroppableColumnBodyRegistered({
  id,
  children,
}: {
  id: string;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className="board-column-body"
      style={{ minHeight: 60, ...(isOver ? { background: 'var(--surface-hover)' } : {}) }}
    >
      {children}
    </div>
  );
}
```

- [ ] **Step 3: Thread `onRefresh` into `DraggableTarefaCard` and the `DragOverlay`, add the add-button and `droppable` prop to the column render**

Update the `DraggableTarefaCard` function (lines 35-71) to accept and forward `membros`/`onRefresh`:

```tsx
function DraggableTarefaCard({
  tarefa,
  membro,
  now,
  onClick,
  membros,
  onRefresh,
  hideAssignee,
}: {
  tarefa: TarefaWithRelations;
  membro: Membro | null;
  now: Date;
  onClick: () => void;
  membros: Membro[];
  onRefresh: () => void;
  hideAssignee?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: String(tarefa.id),
  });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{
        transform: CSS.Translate.toString(transform),
        opacity: isDragging ? 0.4 : 1,
        touchAction: 'none',
      }}
    >
      <TarefaCard
        tarefa={tarefa}
        membro={membro}
        now={now}
        onClick={onClick}
        membros={membros}
        onRefresh={onRefresh}
        hideAssignee={hideAssignee}
      />
    </div>
  );
}
```

Update `TarefaBoard`'s signature and JSX (lines 89-166). Add the `Plus` import at the top of the file (alongside the existing `@dnd-kit`/`store`/`TarefaCard` imports):

```ts
import { Plus } from 'lucide-react';
```

Then:

```tsx
export function TarefaBoard({
  columns,
  membros,
  now,
  onCardClick,
  onDropCard,
  onRefresh,
}: TarefaBoardProps) {
  const [activeTarefa, setActiveTarefa] = useState<TarefaWithRelations | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const allTarefas = columns.flatMap((c) => c.tarefas);
  const findTarefa = (id: string) => allTarefas.find((t) => String(t.id) === id);
  const columnOfTarefa = (id: string) =>
    columns.find((c) => c.tarefas.some((t) => String(t.id) === id));

  const handleDragStart = (event: DragStartEvent) => {
    setActiveTarefa(findTarefa(String(event.active.id)) ?? null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveTarefa(null);
    const { active, over } = event;
    if (!over) return;
    const tarefa = findTarefa(String(active.id));
    if (!tarefa) return;

    const overId = String(over.id);
    const targetColumn = columns.find((c) => c.dropId === overId) ?? columnOfTarefa(overId);
    if (!targetColumn) return;
    onDropCard(tarefa, targetColumn.dropId);
  };

  const membroById = new Map(membros.filter((m) => m.id != null).map((m) => [m.id!, m]));

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="board-rows-wrapper animate-up">
        <div className="board-container">
          {columns.map((col) => (
            <div key={col.dropId} className="board-column">
              <div className="board-column-header">
                <span className="board-column-title">{col.title}</span>
                <span className="board-column-count">{col.tarefas.length}</span>
              </div>
              <DroppableColumnBody id={col.dropId} droppable={col.droppable}>
                {col.onAddClick && (
                  <button type="button" className="board-add-card" onClick={col.onAddClick}>
                    <Plus className="h-3.5 w-3.5" /> Adicionar tarefa
                  </button>
                )}
                {col.tarefas.length === 0 ? (
                  <div className="board-empty">Nenhuma tarefa</div>
                ) : (
                  col.tarefas.map((t) => (
                    <DraggableTarefaCard
                      key={t.id}
                      tarefa={t}
                      membro={
                        t.responsavel_id != null ? (membroById.get(t.responsavel_id) ?? null) : null
                      }
                      now={now}
                      onClick={() => onCardClick(t)}
                      membros={membros}
                      onRefresh={onRefresh}
                      hideAssignee={col.hideAssignee}
                    />
                  ))
                )}
              </DroppableColumnBody>
            </div>
          ))}
        </div>
      </div>
      <DragOverlay>
        {activeTarefa && (
          <TarefaCard
            tarefa={activeTarefa}
            membro={
              activeTarefa.responsavel_id != null
                ? (membroById.get(activeTarefa.responsavel_id) ?? null)
                : null
            }
            now={now}
            onClick={() => {}}
            membros={[]}
            onRefresh={() => {}}
          />
        )}
      </DragOverlay>
    </DndContext>
  );
}
```

(The `DragOverlay` copy gets `membros={[]}` so its reassign dropdown is inert — reassigning the ghost card mid-drag makes no sense.)

- [ ] **Step 4: Type-check**

Run: `npx tsc -p apps/crm/tsconfig.json --noEmit`
Expected: errors in `StatusKanbanView.tsx` and `MembrosBoardView.tsx` (missing `onRefresh` prop on `<TarefaBoard>`) and in `TarefaCard.tsx` (doesn't accept `membros`/`onRefresh` yet) — **this is expected**, both get fixed in Task 5 and Task 6. Confirm there are no OTHER errors beyond those two files.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/tarefas/views/boardShared.tsx
git commit -m "feat(tarefas): add droppable opt-out, add-button slot, onRefresh to TarefaBoard

BoardColumn gains droppable (default true) and onAddClick; TarefaBoardProps
gains onRefresh, threaded into DraggableTarefaCard and the drag overlay.
Existing StatusKanbanView/MembrosBoardView call sites are fixed in the next
commit -- this one intentionally leaves them red."
```

---

## Task 5: Wire `onRefresh` through the existing Kanban and Por membro views

Fixes the type errors left by Task 4. Both views already receive an `onRefresh`/`refresh` callback from `TarefasPage.tsx` — they just weren't passing it into `TarefaBoard` yet.

**Files:**
- Modify: `apps/crm/src/pages/tarefas/views/StatusKanbanView.tsx:53-61`
- Modify: `apps/crm/src/pages/tarefas/views/MembrosBoardView.tsx:58-66`

**Interfaces:**
- Consumes: `TarefaBoardProps.onRefresh` from Task 4.

- [ ] **Step 1: Pass `onRefresh` through in `StatusKanbanView.tsx`**

Change the `<TarefaBoard>` render (lines 53-61) from:

```tsx
    <TarefaBoard
      columns={columns}
      membros={membros}
      now={now}
      onCardClick={onTarefaClick}
      onDropCard={handleDrop}
    />
```

to:

```tsx
    <TarefaBoard
      columns={columns}
      membros={membros}
      now={now}
      onCardClick={onTarefaClick}
      onDropCard={handleDrop}
      onRefresh={onRefresh}
    />
```

- [ ] **Step 2: Pass `onRefresh` through in `MembrosBoardView.tsx`**

Same one-line addition to its `<TarefaBoard>` render (lines 58-66):

```tsx
    <TarefaBoard
      columns={columns}
      membros={membros}
      now={now}
      onCardClick={onTarefaClick}
      onDropCard={handleDrop}
      onRefresh={onRefresh}
    />
```

- [ ] **Step 3: Type-check**

Run: `npx tsc -p apps/crm/tsconfig.json --noEmit`
Expected: no more errors from these two files (the remaining `TarefaCard` prop errors are resolved in Task 6).

- [ ] **Step 4: Commit**

```bash
git add apps/crm/src/pages/tarefas/views/StatusKanbanView.tsx apps/crm/src/pages/tarefas/views/MembrosBoardView.tsx
git commit -m "fix(tarefas): thread onRefresh into TarefaBoard from Kanban and Por membro"
```

---

## Task 6: `TarefaCard` redesign — client color footer + inline assignee reassignment

The visual and behavioral core of the card redesign. Both Kanban and Por membro pick this up automatically once it lands (they already render `TarefaCard` via `boardShared.tsx`).

**Files:**
- Modify: `apps/crm/src/pages/tarefas/components/TarefaCard.tsx`
- Test: `apps/crm/src/pages/tarefas/__tests__/TarefaCard.test.tsx` (flat `__tests__/`, matching where `TarefaFormDialog.test.tsx` already lives — not a nested `components/__tests__/`)

**Interfaces:**
- Consumes: `updateTarefa` from `'../../../store'`, `dueBadge` from `../tarefasLogic`, `avatarColorClass` from `@/lib/avatarColor`, `DropdownMenu`/`DropdownMenuContent`/`DropdownMenuItem`/`DropdownMenuTrigger` from `@/components/ui/dropdown-menu` (same imports `WorkflowCard.tsx` already uses for this exact pattern).
- Produces: `TarefaCardProps` gains `membros: Membro[]` and `onRefresh: () => void` (both required) — consumed by Task 4's `boardShared.tsx` (already wired) and Task 8's `BoardView.tsx`.

- [ ] **Step 1: Write the failing tests**

Create `apps/crm/src/pages/tarefas/__tests__/TarefaCard.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { TarefaWithRelations } from '../../../store';

const { updateTarefaMock, toastErrorMock, toastSuccessMock } = vi.hoisted(() => ({
  updateTarefaMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
}));

vi.mock('../../../store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../store')>();
  return { ...actual, updateTarefa: updateTarefaMock };
});
vi.mock('sonner', () => ({
  toast: { success: toastSuccessMock, error: toastErrorMock },
}));

import { TarefaCard } from '../components/TarefaCard';

const NOW = new Date('2026-07-29T15:00:00');
const MEMBROS = [
  { id: 1, nome: 'Ana Silva' },
  { id: 2, nome: 'Bruno Costa' },
] as never[];

function makeTarefa(overrides: Partial<TarefaWithRelations> = {}): TarefaWithRelations {
  return {
    id: 42,
    titulo: 'Editar vídeo',
    status: 'pendente',
    responsavel_id: null,
    cliente_id: null,
    data_limite: null,
    concluida_em: null,
    created_at: '2026-07-01T10:00:00',
    tags: [],
    subtarefas_total: 0,
    subtarefas_concluidas: 0,
    cliente_nome: null,
    cliente_cor: null,
    ...overrides,
  };
}

describe('TarefaCard', () => {
  it('shows the client footer dot using cliente_cor, with a fallback when unset', () => {
    const { rerender } = render(
      <TarefaCard
        tarefa={makeTarefa({ cliente_nome: 'Studio Bem-Estar', cliente_cor: '#ff00aa' })}
        membro={null}
        now={NOW}
        onClick={() => {}}
        membros={[]}
        onRefresh={() => {}}
      />,
    );
    const name = screen.getByText('Studio Bem-Estar');
    const dot = name.previousElementSibling as HTMLElement;
    expect(dot.style.background).toBe('rgb(255, 0, 170)');

    rerender(
      <TarefaCard
        tarefa={makeTarefa({ cliente_nome: 'Studio Bem-Estar', cliente_cor: null })}
        membro={null}
        now={NOW}
        onClick={() => {}}
        membros={[]}
        onRefresh={() => {}}
      />,
    );
    const dotFallback = screen.getByText('Studio Bem-Estar')
      .previousElementSibling as HTMLElement;
    expect(dotFallback.style.background).toBe('var(--text-muted)');
  });

  it('omits the client footer entirely when there is no client', () => {
    render(
      <TarefaCard
        tarefa={makeTarefa({ cliente_nome: null })}
        membro={null}
        now={NOW}
        onClick={() => {}}
        membros={[]}
        onRefresh={() => {}}
      />,
    );
    expect(screen.queryByText(/studio/i)).not.toBeInTheDocument();
  });

  it('opens a reassign dropdown on avatar click without triggering the card onClick', async () => {
    const onClick = vi.fn();
    render(
      <TarefaCard
        tarefa={makeTarefa()}
        membro={{ id: 1, nome: 'Ana Silva' } as never}
        now={NOW}
        onClick={onClick}
        membros={MEMBROS}
        onRefresh={() => {}}
      />,
    );
    fireEvent.click(screen.getByTitle('Ana Silva'));
    expect(await screen.findByText('Bruno Costa')).toBeInTheDocument();
    expect(onClick).not.toHaveBeenCalled();
  });

  it('reassigns on selecting a member: calls updateTarefa, shows a toast, and refreshes', async () => {
    updateTarefaMock.mockResolvedValueOnce({});
    const onRefresh = vi.fn();
    render(
      <TarefaCard
        tarefa={makeTarefa({ id: 42 })}
        membro={{ id: 1, nome: 'Ana Silva' } as never}
        now={NOW}
        onClick={() => {}}
        membros={MEMBROS}
        onRefresh={onRefresh}
      />,
    );
    fireEvent.click(screen.getByTitle('Ana Silva'));
    fireEvent.click(await screen.findByText('Bruno Costa'));

    await waitFor(() => expect(updateTarefaMock).toHaveBeenCalledWith(42, { responsavel_id: 2 }));
    expect(toastSuccessMock).toHaveBeenCalledWith('Responsável atualizado!');
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('rolls back to the original assignee and shows an error toast when the update fails', async () => {
    updateTarefaMock.mockRejectedValueOnce(new Error('network down'));
    render(
      <TarefaCard
        tarefa={makeTarefa({ id: 42 })}
        membro={{ id: 1, nome: 'Ana Silva' } as never}
        now={NOW}
        onClick={() => {}}
        membros={MEMBROS}
        onRefresh={() => {}}
      />,
    );
    fireEvent.click(screen.getByTitle('Ana Silva'));
    fireEvent.click(await screen.findByText('Bruno Costa'));

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith('Erro ao atualizar responsável'));
    // Rolled back: the original assignee's avatar is showing again, not Bruno's.
    expect(screen.getByTitle('Ana Silva')).toBeInTheDocument();
  });

  it('hides the whole assignee block when hideAssignee is set', () => {
    render(
      <TarefaCard
        tarefa={makeTarefa()}
        membro={{ id: 1, nome: 'Ana Silva' } as never}
        now={NOW}
        onClick={() => {}}
        membros={MEMBROS}
        onRefresh={() => {}}
        hideAssignee
      />,
    );
    expect(screen.queryByTitle('Ana Silva')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run apps/crm/src/pages/tarefas/__tests__/TarefaCard.test.tsx`
Expected: FAIL — `TarefaCard` doesn't accept `membros`/`onRefresh` yet (TS error) and the footer/dropdown markup doesn't exist yet.

- [ ] **Step 3: Redesign `TarefaCard.tsx`**

Replace the full contents of `apps/crm/src/pages/tarefas/components/TarefaCard.tsx`:

```tsx
import { useState } from 'react';
import { Calendar as CalendarIcon, CheckSquare, User2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { avatarColorClass } from '@/lib/avatarColor';
import { getInitials, updateTarefa, type Membro, type TarefaWithRelations } from '../../../store';
import { dueBadge } from '../tarefasLogic';
import { TagPill } from './TagPicker';

interface TarefaCardProps {
  tarefa: TarefaWithRelations;
  membro: Membro | null;
  now: Date;
  onClick: () => void;
  membros: Membro[];
  onRefresh: () => void;
  /** Hides the assignee chip (redundant inside a member column). */
  hideAssignee?: boolean;
}

/** Presentational task card for the board views. Drag wrappers live in the views. */
export function TarefaCard({
  tarefa,
  membro,
  now,
  onClick,
  membros,
  onRefresh,
  hideAssignee,
}: TarefaCardProps) {
  const badge = dueBadge(tarefa, now);
  const [assignOpen, setAssignOpen] = useState(false);
  const [localMembro, setLocalMembro] = useState<Membro | null | undefined>(undefined);
  const displayMembro = localMembro !== undefined ? localMembro : membro;

  return (
    <div
      className="board-card"
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      style={{ cursor: 'pointer' }}
    >
      {tarefa.tags.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem', marginBottom: '0.35rem' }}>
          {tarefa.tags.map((tag) => (
            <TagPill key={tag.id} tag={tag} small />
          ))}
        </div>
      )}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: '0.5rem',
        }}
      >
        <div
          style={{
            fontSize: '0.82rem',
            fontWeight: 600,
            color: 'var(--text-main)',
            lineHeight: 1.35,
            textDecoration: tarefa.status === 'concluida' ? 'line-through' : undefined,
            opacity: tarefa.status === 'concluida' ? 0.6 : 1,
          }}
        >
          {tarefa.titulo}
        </div>
        {!hideAssignee && (
          <DropdownMenu
            open={assignOpen}
            onOpenChange={(open) => {
              if (membros.length > 0) setAssignOpen(open);
            }}
          >
            <DropdownMenuTrigger asChild>
              <span
                style={{ flexShrink: 0, cursor: membros.length > 0 ? 'pointer' : 'default' }}
                onClick={(e) => {
                  if (membros.length === 0) return;
                  e.stopPropagation();
                }}
              >
                {displayMembro ? (
                  <span
                    className={`avatar ${avatarColorClass(displayMembro.id ?? displayMembro.nome)}`}
                    style={{ width: 20, height: 20, fontSize: '0.55rem', fontWeight: 800 }}
                    title={displayMembro.nome}
                  >
                    {getInitials(displayMembro.nome)}
                  </span>
                ) : (
                  <span
                    title="Sem responsável"
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: '50%',
                      background: 'var(--surface-hover)',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--text-muted)',
                    }}
                  >
                    <User2 className="h-3 w-3" />
                  </span>
                )}
              </span>
            </DropdownMenuTrigger>
            {membros.length > 0 && (
              <DropdownMenuContent align="end" style={{ zIndex: 99999, minWidth: '160px' }}>
                {membros.map((m) => (
                  <DropdownMenuItem
                    key={m.id}
                    onClick={async (e) => {
                      e.stopPropagation();
                      setAssignOpen(false);
                      setLocalMembro(m);
                      try {
                        await updateTarefa(tarefa.id!, { responsavel_id: m.id ?? null });
                        toast.success('Responsável atualizado!');
                        onRefresh();
                      } catch {
                        setLocalMembro(undefined);
                        toast.error('Erro ao atualizar responsável');
                      }
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      cursor: 'pointer',
                      fontSize: '0.75rem',
                    }}
                  >
                    <span
                      className={`avatar ${avatarColorClass(m.id ?? m.nome)}`}
                      style={{ width: 16, height: 16, fontSize: '0.5rem' }}
                    >
                      {getInitials(m.nome)}
                    </span>
                    {m.nome}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            )}
          </DropdownMenu>
        )}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          marginTop: '0.5rem',
          flexWrap: 'wrap',
        }}
      >
        {badge && (
          <span
            className={`board-card-deadline ${badge.className}`}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
          >
            <CalendarIcon className="h-3 w-3" />
            {badge.label}
          </span>
        )}
        {tarefa.subtarefas_total > 0 && (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.25rem',
              fontSize: '0.68rem',
              color:
                tarefa.subtarefas_concluidas === tarefa.subtarefas_total
                  ? 'var(--success)'
                  : 'var(--text-muted)',
            }}
          >
            <CheckSquare className="h-3 w-3" />
            {tarefa.subtarefas_concluidas}/{tarefa.subtarefas_total}
          </span>
        )}
      </div>
      {tarefa.cliente_nome && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.35rem',
            marginTop: '0.5rem',
            paddingTop: '0.4rem',
            borderTop: '1px solid var(--border-color)',
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: tarefa.cliente_cor || 'var(--text-muted)',
              flexShrink: 0,
            }}
          />
          <span style={{ fontSize: '0.7rem', fontWeight: 500, color: 'var(--text-muted)' }}>
            {tarefa.cliente_nome}
          </span>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run apps/crm/src/pages/tarefas/__tests__/TarefaCard.test.tsx`
Expected: PASS, all 6 cases green.

- [ ] **Step 5: Type-check the whole CRM project**

Run: `npx tsc -p apps/crm/tsconfig.json --noEmit`
Expected: no errors anywhere now (Task 4's deferred `TarefaCard` errors are resolved).

- [ ] **Step 6: Run the full Tarefas test suite so far**

Run: `npx vitest run apps/crm/src/pages/tarefas`
Expected: PASS (this also re-runs `TarefasPage.test.tsx`, `TarefaFormDialog.test.tsx`, `tarefasLogic.test.ts`, `tarefasPrefs.test.ts` — confirm none regressed).

- [ ] **Step 7: Commit**

```bash
git add apps/crm/src/pages/tarefas/components/TarefaCard.tsx apps/crm/src/pages/tarefas/__tests__/TarefaCard.test.tsx
git commit -m "feat(tarefas): redesign TarefaCard with client-color footer and inline reassign

Assignee avatar moves to the header (top-right) and becomes a click target
for reassignment via a DropdownMenu, mirroring WorkflowCard's existing
pattern (optimistic update, toast, rollback on failure). The client name
gets its own footer row with a dot colored from clientes.cor instead of
plain grey text. Kanban and Por membro inherit this for free since they
already render TarefaCard through boardShared.tsx."
```

---

## Task 7: `TarefaFormDialog` — due-date prefill for per-column task creation

Extends the existing create-mode prefill mechanism (today only used by a "convert solicitação" flow) with an optional due date, needed by the Board view's per-column "+ Adicionar tarefa" button.

**Files:**
- Modify: `apps/crm/src/pages/tarefas/components/TarefaFormDialog.tsx`
- Test: `apps/crm/src/pages/tarefas/__tests__/TarefaFormDialog.test.tsx`

**Interfaces:**
- Produces: `initialValues` gains `data_limite?: string | null` — consumed by Task 10 (`TarefasPage.tsx`).

- [ ] **Step 1: Write the failing test**

Add to `apps/crm/src/pages/tarefas/__tests__/TarefaFormDialog.test.tsx`, a new `describe` block (the file already has `TarefaFormDialog convert mode` and `TarefaFormDialog error handling` — add this as a third one, and add `DatePicker`-friendly imports if not already present; `screen`/`render` are already imported at the top of the file):

```tsx
describe('TarefaFormDialog due-date prefill', () => {
  it('prefills the Prazo field from initialValues.data_limite in create mode', () => {
    renderDialog(
      <TarefaFormDialog
        open
        onClose={() => {}}
        editing={null}
        membros={[]}
        clientes={CLIENTES}
        tags={[]}
        onSaved={() => {}}
        onTagCreated={() => {}}
        initialValues={{ data_limite: '2026-08-15' }}
      />,
    );
    expect(screen.getByDisplayValue('15/08/2026')).toBeInTheDocument();
  });

  it('leaves the Prazo field empty when initialValues.data_limite is null', () => {
    renderDialog(
      <TarefaFormDialog
        open
        onClose={() => {}}
        editing={null}
        membros={[]}
        clientes={CLIENTES}
        tags={[]}
        onSaved={() => {}}
        onTagCreated={() => {}}
        initialValues={{ data_limite: null }}
      />,
    );
    expect(screen.getByPlaceholderText('Sem prazo')).toBeInTheDocument();
  });
});
```

> If `DatePicker`'s rendered value isn't a plain `<input>` `displayValue` (check `@/components/ui/date-picker`'s implementation if this assertion doesn't match what it renders), assert on the visible formatted date text instead, e.g. `screen.getByText('15/08/2026')` — the point of the test is "the date picker shows 15/08/2026", however that's exposed in the DOM.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run apps/crm/src/pages/tarefas/__tests__/TarefaFormDialog.test.tsx`
Expected: FAIL — TS error (`data_limite` not assignable to `initialValues`) and/or the date field stays empty.

- [ ] **Step 3: Extend `initialValues` and the reset effect**

In `apps/crm/src/pages/tarefas/components/TarefaFormDialog.tsx`, update the `initialValues` field on `TarefaFormDialogProps` (around line 86):

```ts
  /** Create-mode prefill (conversao de solicitacao; also used by the Board
   *  view's per-column "+ Adicionar tarefa"). */
  initialValues?: {
    titulo?: string;
    descricao?: string;
    cliente_id?: number | null;
    data_limite?: string | null;
  };
```

Update the destructure block (around lines 117-119) to add:

```ts
  const initialDataLimite = initialValues?.data_limite;
```

Update the `useEffect` (around lines 121-142) — add `data_limite` to the create-mode `form.reset` call and to the dependency array:

```ts
  useEffect(() => {
    if (!open) return;
    if (editing) {
      form.reset({
        titulo: editing.titulo,
        descricao: editing.descricao ?? '',
        responsavel_id: editing.responsavel_id != null ? String(editing.responsavel_id) : 'none',
        cliente_id: editing.cliente_id != null ? String(editing.cliente_id) : 'none',
        data_limite: editing.data_limite ? parseDateOnly(editing.data_limite) : undefined,
        status: editing.status,
      });
      setTagIds(editing.tags.map((t) => t.id!).filter((id) => id != null));
    } else {
      form.reset({
        ...BLANK,
        titulo: initialTitulo ?? '',
        descricao: initialDescricao ?? '',
        cliente_id: initialClienteId != null ? String(initialClienteId) : 'none',
        data_limite: initialDataLimite ? parseDateOnly(initialDataLimite) : undefined,
      });
      setTagIds([]);
    }
  }, [open, editing, initialTitulo, initialDescricao, initialClienteId, initialDataLimite, form]);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run apps/crm/src/pages/tarefas/__tests__/TarefaFormDialog.test.tsx`
Expected: PASS, including the two new cases and the two pre-existing ones (convert mode, error handling).

- [ ] **Step 5: Type-check**

Run: `npx tsc -p apps/crm/tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/crm/src/pages/tarefas/components/TarefaFormDialog.tsx apps/crm/src/pages/tarefas/__tests__/TarefaFormDialog.test.tsx
git commit -m "feat(tarefas): support data_limite prefill in TarefaFormDialog's create mode

Needed by the Board view's per-column \"+ Adicionar tarefa\" (Task 10) --
extends the same initialValues mechanism already used by the convert-
solicitação flow, wired up in the next task."
```

---

## Task 8: `BoardView.tsx` — the date-bucket board

Ties `groupByBoardColumn` (Task 2) to `TarefaBoard` (Task 4), following the exact same shape as `StatusKanbanView`/`MembrosBoardView`.

**Files:**
- Create: `apps/crm/src/pages/tarefas/views/BoardView.tsx`

**Interfaces:**
- Consumes: `groupByBoardColumn`, `buildDropId`, `parseDropId` from `../tarefasLogic`; `useOptimisticTarefas` from `../hooks/useOptimisticTarefas`; `TarefaBoard`, `type BoardColumn` from `./boardShared`; `updateTarefa` from `'../../../store'`.
- Produces: `export function BoardView(props: { tarefas: TarefaWithRelations[]; membros: Membro[]; onTarefaClick: (t: TarefaWithRelations) => void; onRefresh: () => void; onCreateTask: (date: string | null) => void })` — consumed by Task 9 (`CalendarView.tsx`).

No dedicated automated test for this file: it's pure composition (bucketing already covered by Task 2's unit tests; `TarefaBoard`'s rendering has no test precedent anywhere in this codebase, per the spec's Testing section, since dnd-kit interactions aren't practical to assert on through RTL here). It's covered by Task 11's manual browser verification.

- [ ] **Step 1: Create `BoardView.tsx`**

```tsx
import { toast } from 'sonner';
import type { Membro, TarefaWithRelations } from '../../../store';
import { updateTarefa } from '../../../store';
import { buildDropId, groupByBoardColumn, parseDropId } from '../tarefasLogic';
import { useOptimisticTarefas } from '../hooks/useOptimisticTarefas';
import { TarefaBoard, type BoardColumn } from './boardShared';

interface BoardViewProps {
  tarefas: TarefaWithRelations[];
  membros: Membro[];
  onTarefaClick: (tarefa: TarefaWithRelations) => void;
  onRefresh: () => void;
  onCreateTask: (date: string | null) => void;
}

/** Date-bucket kanban: Em atraso / Hoje / Amanhã / weekday columns / Mais
 *  tarde / Sem data. Drag a card onto a droppable column to reschedule it;
 *  Em atraso and Mais tarde have no single unambiguous date, so they're
 *  read-only drop targets (see groupByBoardColumn's `droppable` flag). */
export function BoardView({
  tarefas,
  membros,
  onTarefaClick,
  onRefresh,
  onCreateTask,
}: BoardViewProps) {
  const { merged, applyOverride, clearOverride } = useOptimisticTarefas(tarefas);
  const now = new Date();

  const buckets = groupByBoardColumn(merged, now);
  const columns: BoardColumn[] = buckets.map((b) => ({
    dropId: b.droppable ? buildDropId({ kind: 'day', date: b.date }) : b.key,
    title: b.label,
    tarefas: b.tarefas,
    droppable: b.droppable,
    onAddClick: () => onCreateTask(b.date),
  }));

  const handleDrop = async (tarefa: TarefaWithRelations, dropId: string) => {
    const target = parseDropId(dropId);
    if (!target || target.kind !== 'day') return;
    if (tarefa.data_limite === target.date) return;
    applyOverride(tarefa.id!, { data_limite: target.date });
    try {
      await updateTarefa(tarefa.id!, { data_limite: target.date });
      toast.success(target.date ? 'Prazo atualizado!' : 'Prazo removido!');
      onRefresh();
    } catch {
      clearOverride(tarefa.id!);
      toast.error('Erro ao atualizar prazo');
    }
  };

  return (
    <TarefaBoard
      columns={columns}
      membros={membros}
      now={now}
      onCardClick={onTarefaClick}
      onDropCard={handleDrop}
      onRefresh={onRefresh}
    />
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc -p apps/crm/tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/crm/src/pages/tarefas/views/BoardView.tsx
git commit -m "feat(tarefas): add BoardView, the date-bucket kanban for the Calendário tab

Same shape as StatusKanbanView/MembrosBoardView: builds BoardColumn[] from
groupByBoardColumn and reuses the existing TarefaBoard/dnd-kit wiring
instead of duplicating a DndContext."
```

---

## Task 9: `CalendarView.tsx` — Mês/Board toggle

Wires `BoardView` into the existing Calendário tab behind a small persisted toggle.

**Files:**
- Modify: `apps/crm/src/pages/tarefas/views/CalendarView.tsx`

**Interfaces:**
- Consumes: `loadTarefasCalendarioModo`/`persistTarefasCalendarioModo` (Task 3), `BoardView` (Task 8), `useAuth` from `@/context/AuthContext`.
- Produces: `CalendarViewProps` gains `membros: Membro[]` and `onCreateTask: (date: string | null) => void` — consumed by Task 10 (`TarefasPage.tsx`).

- [ ] **Step 1: Add the new imports and props**

In `apps/crm/src/pages/tarefas/views/CalendarView.tsx`, add to the existing import block (after the `useOptimisticTarefas` import, line 18):

```ts
import { useAuth } from '@/context/AuthContext';
import type { Membro } from '../../../store';
import { loadTarefasCalendarioModo, persistTarefasCalendarioModo } from '../tarefasPrefs';
import { BoardView } from './BoardView';
```

Update `CalendarViewProps` (lines 20-24):

```ts
interface CalendarViewProps {
  tarefas: TarefaWithRelations[];
  membros: Membro[];
  onTarefaClick: (tarefa: TarefaWithRelations) => void;
  onRefresh: () => void;
  onCreateTask: (date: string | null) => void;
}
```

- [ ] **Step 2: Add the toggle state and a small segmented control**

Update the `CalendarView` function signature and its top (lines 189-195):

```tsx
export function CalendarView({
  tarefas,
  membros,
  onTarefaClick,
  onRefresh,
  onCreateTask,
}: CalendarViewProps) {
  const { profile } = useAuth();
  const contaId = profile?.conta_id ?? 'unknown';
  const [modo, setModo] = useState<'mes' | 'board'>(() => loadTarefasCalendarioModo(contaId));
  const handleModoChange = (next: 'mes' | 'board') => {
    setModo(next);
    persistTarefasCalendarioModo(contaId, next);
  };
  const { merged, applyOverride, clearOverride } = useOptimisticTarefas(tarefas);
  const [currentMonth, setCurrentMonth] = useState(() => new Date());
  const [activeTarefa, setActiveTarefa] = useState<TarefaWithRelations | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const now = new Date();
  const todayStr = toDateOnlyString(now);
```

(The rest of the existing body — `byDay`/`semData` computation, `handleDragStart`/`handleDragEnd` — stays exactly as-is; they're only used by the `'mes'` branch below, but computing them unconditionally is fine and keeps every hook called on every render.)

- [ ] **Step 3: Add the segmented-control JSX and branch the return**

Replace the final `return (...)` block (lines 235-262) with:

```tsx
  const toggle = (
    <div
      style={{
        display: 'inline-flex',
        gap: '0.25rem',
        background: 'var(--surface-2)',
        padding: '0.2rem',
        borderRadius: '8px',
        width: 'fit-content',
      }}
    >
      {(['board', 'mes'] as const).map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => handleModoChange(option)}
          style={{
            padding: '0.3rem 0.7rem',
            borderRadius: '6px',
            border: 'none',
            background: modo === option ? '#000' : 'transparent',
            color: modo === option ? '#fff' : 'var(--text-secondary)',
            fontSize: '0.75rem',
            fontWeight: modo === option ? 600 : 400,
            cursor: 'pointer',
          }}
        >
          {option === 'board' ? 'Board' : 'Mês'}
        </button>
      ))}
    </div>
  );

  if (modo === 'board') {
    return (
      <div className="animate-up" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {toggle}
        <BoardView
          tarefas={tarefas}
          membros={membros}
          onTarefaClick={onTarefaClick}
          onRefresh={onRefresh}
          onCreateTask={onCreateTask}
        />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {toggle}
      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div
          className="animate-up"
          style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start', flexWrap: 'wrap' }}
        >
          <div className="card" style={{ flex: '1 1 560px', borderRadius: '12px', padding: '1rem' }}>
            <MonthGrid
              currentMonth={currentMonth}
              onMonthChange={setCurrentMonth}
              renderCell={(date, isCurrentMonth) => (
                <DayCell
                  date={date}
                  isCurrentMonth={isCurrentMonth}
                  isToday={toDateOnlyString(date) === todayStr}
                  tarefas={byDay.get(toDateOnlyString(date)) ?? []}
                  onTarefaClick={onTarefaClick}
                />
              )}
            />
          </div>
          <div style={{ flex: '0 1 240px', minWidth: 200 }}>
            <SemDataRail tarefas={semData} onTarefaClick={onTarefaClick} />
          </div>
        </div>
        <DragOverlay>{activeTarefa && <TarefaChip tarefa={activeTarefa} overlay />}</DragOverlay>
      </DndContext>
    </div>
  );
}
```

> Note `--text-secondary` here matches `TarefasPage.tsx`'s existing `VIEW_TABS` segmented control (`apps/crm/src/pages/tarefas/TarefasPage.tsx:144`), which already uses that exact token for its inactive-tab color — so this stays visually consistent with the page's own tab row.

- [ ] **Step 4: Type-check**

Run: `npx tsc -p apps/crm/tsconfig.json --noEmit`
Expected: errors only in `TarefasPage.tsx` (missing new required `CalendarView` props) — fixed in Task 10.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/tarefas/views/CalendarView.tsx
git commit -m "feat(tarefas): add Mês/Board toggle to CalendarView

Persisted per-conta via tarefasPrefs (defaults to Board). TarefasPage.tsx
wiring for the two new required props (membros, onCreateTask) is the next
commit -- this one intentionally leaves it red."
```

---

## Task 10: `TarefasPage.tsx` — wire it all together

The last piece: `TarefasPage` needs to pass `membros` into `CalendarView`, provide the `onCreateTask` callback, and support prefilling `TarefaFormDialog`'s due date from it.

**Files:**
- Modify: `apps/crm/src/pages/tarefas/TarefasPage.tsx`

**Interfaces:**
- Consumes: `CalendarViewProps` (Task 9), `TarefaFormDialogProps.initialValues.data_limite` (Task 7).

- [ ] **Step 1: Add `createDataLimite` state and a `handleCreateForDate` callback**

In `apps/crm/src/pages/tarefas/TarefasPage.tsx`, update the state block (lines 33-37):

```tsx
  const [activeView, setActiveView] = useState<ActiveView>('lista');
  const [filters, setFilters] = useState<TarefaFilterState>(EMPTY_TAREFA_FILTERS);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<TarefaWithRelations | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [createDataLimite, setCreateDataLimite] = useState<string | null | undefined>(undefined);
```

Update `openForm` (lines 74-77) and add `handleCreateForDate` right after it:

```tsx
  const openForm = (tarefa: TarefaWithRelations | null) => {
    setEditing(tarefa);
    setCreateDataLimite(undefined);
    setFormOpen(true);
  };

  const handleCreateForDate = (date: string | null) => {
    setEditing(null);
    setCreateDataLimite(date);
    setFormOpen(true);
  };
```

- [ ] **Step 2: Pass the new props to `CalendarView` and `TarefaFormDialog`**

Update the `CalendarView` render (lines 208-214):

```tsx
          {activeView === 'calendario' && (
            <CalendarView
              tarefas={filteredTarefas}
              membros={membros}
              onTarefaClick={(t) => setSelectedId(t.id!)}
              onRefresh={refresh}
              onCreateTask={handleCreateForDate}
            />
          )}
```

Update the `TarefaFormDialog` render (lines 218-227):

```tsx
      <TarefaFormDialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        editing={editing}
        membros={membros}
        clientes={clientes}
        tags={tags}
        onSaved={refresh}
        onTagCreated={refresh}
        initialValues={{ data_limite: createDataLimite }}
      />
```

- [ ] **Step 3: Type-check**

Run: `npx tsc -p apps/crm/tsconfig.json --noEmit`
Expected: no errors anywhere in the project now.

- [ ] **Step 4: Run the full frontend test suite**

Run: `npm run test`
Expected: PASS — no regressions anywhere (this is the point where a stale prop assumption in `TarefasPage.test.tsx`, if any, would surface).

- [ ] **Step 5: Run lint and format checks**

Run:

```bash
npm run lint
npm run format:check
```

Expected: both clean. If `format:check` fails, run `npm run format` and re-check the diff only touches files this plan modified.

- [ ] **Step 6: Commit**

```bash
git add apps/crm/src/pages/tarefas/TarefasPage.tsx
git commit -m "feat(tarefas): wire membros and per-column task creation into CalendarView

Completes the Board view integration: TarefasPage now passes membros to
CalendarView and provides handleCreateForDate, which prefills
TarefaFormDialog's due date when a column's \"+ Adicionar tarefa\" is
clicked."
```

---

## Task 11: Manual browser verification

Everything above is type-checked and unit-tested, but drag-and-drop, the click-vs-drag conflict on the new reassign avatar, and real client colors can only be confirmed in a running browser (this codebase has zero automated DnD-interaction tests anywhere, by established precedent — see the spec's Testing section).

**Files:** none (verification only).

- [ ] **Step 1: Start the CRM dev server and log in**

```bash
npm run dev
```

Open `/tarefas` in a real browser, logged in to a workspace with at least a few tasks across different due dates, at least one client with a `cor` set, and at least two team members.

- [ ] **Step 2: Verify the Board view renders and defaults correctly**

Click the "Calendário" tab. Confirm it opens on **Board** mode by default (per the approved decision) with columns `Em atraso | Hoje | Amanhã | <weekday columns for the rest of this week> | Mais tarde | Sem data`. Toggle to "Mês" and back to "Board" — confirm the month grid still works exactly as before, and toggling is instant (no data reload).

- [ ] **Step 3: Verify persistence**

With Board mode selected, navigate to another Tarefas tab (e.g. "Lista") and back to "Calendário" — confirm it re-opens on Board (not reset to Mês). Refresh the whole page — confirm the mode is still remembered (localStorage).

- [ ] **Step 4: Verify drag-and-drop rules**

Drag a card from "Hoje" onto "Amanhã" (or another named weekday column) — confirm it moves and its due date updates (check by reopening the task). Try dragging a card onto "Em atraso" and onto "Mais tarde" — confirm neither shows a hover/valid-drop highlight and the card is not accepted (it returns to its original column). Drag a card onto "Sem data" — confirm its due date is cleared.

- [ ] **Step 5: Verify per-column task creation**

Click "+ Adicionar tarefa" in the "Amanhã" column — confirm the task dialog opens with tomorrow's date pre-filled in "Prazo". Click it in "Em atraso" or "Sem data" — confirm the dialog opens with no due date pre-filled. Create a task from a column and confirm it appears in the right column after the dialog closes.

- [ ] **Step 6: Verify the reassign avatar (the flagged click-vs-drag risk)**

In the Board view, Kanban view, and Por membro view, click a card's assignee avatar (top-right of the card). Confirm: (a) a dropdown of team members opens, (b) it does **not** start a drag, and (c) selecting a different member updates the card's avatar immediately and shows a success toast.

If clicking the avatar sometimes starts a drag instead of opening the dropdown, that's the risk flagged in the spec (`DraggableTarefaCard` spreads dnd-kit's pointer listeners over the whole card, unlike `WorkflowCard`'s dedicated drag-handle approach). Fix by adding an explicit early stop in `TarefaCard.tsx`'s trigger `<span>` (from Task 6): change its `onClick` handler to also handle `onPointerDownCapture`, so the stop happens before dnd-kit's own pointer-down listener sees the event:

```tsx
<span
  style={{ flexShrink: 0, cursor: membros.length > 0 ? 'pointer' : 'default' }}
  onPointerDownCapture={(e) => {
    if (membros.length > 0) e.stopPropagation();
  }}
  onClick={(e) => {
    if (membros.length === 0) return;
    e.stopPropagation();
  }}
>
```

Re-verify after this change if it was needed.

- [ ] **Step 7: Verify horizontal scroll on a wide board**

Resize the browser window narrow enough that all Board columns don't fit (or check on a day with many weekday columns, e.g. a Monday). Confirm the column row scrolls horizontally within `.board-container` (it already has `overflow-x: auto`) rather than the whole page overflowing.

- [ ] **Step 8: Verify Kanban and Por membro still work**

Open the "Kanban" and "Por membro" tabs. Confirm cards show the redesigned layout (client-color dot in the footer, avatar top-right) and that drag-to-change-status / drag-to-reassign still work as before. In "Por membro" specifically, confirm cards do **not** show the reassign dropdown (since `hideAssignee` is set there) — dragging between member columns remains the only way to reassign in that view.

- [ ] **Step 9: Final full check before wrapping up**

```bash
npx tsc -p apps/crm/tsconfig.json --noEmit
npx tsc -p apps/crm/tsconfig.scripts.json --noEmit 2>/dev/null || true
npm run test
npm run lint
npm run format:check
```

(The `hub`/`admin`/`scripts` tsc projects and `test:functions` are unaffected by this change — nothing here touches those apps or edge functions — but running the CRM ones plus the full Vitest/lint/format suite is the right bar before considering this done, per this repo's CI.)
