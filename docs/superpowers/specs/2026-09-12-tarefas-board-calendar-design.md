# Tarefas: Date-Bucket Board View + Card Redesign

**Date:** 2026-09-12
**Status:** Approved

## Summary

Add a second mode to the Tarefas "Calendário" tab: a date-bucket kanban board (columns like "Em atraso", "Hoje", "Amanhã", ...) with drag-and-drop rescheduling, inspired by a reference screenshot from an external task app. The existing month grid stays as the other mode, toggled from the same tab. Alongside this, the shared task card (`TarefaCard`) gets a visual refresh and gains inline assignee reassignment — and since the card is shared, the existing Kanban tab picks up both changes too.

No database schema changes. `Tarefa` has no priority/flag or attachment/link fields, so the reference screenshot's flag and paperclip icons are dropped — the redesigned card only surfaces data that already exists (title, tags, client, due date, assignee, subtask progress).

## Non-goals

- No per-member grouping (the reference screenshot groups columns under a "Marina Pinheiro" header; this stays a single flat board, filtered by the existing "Todos os membros" dropdown like today).
- No new `prioridade`/attachment fields on `tarefas`.
- No changes to the month-grid `CalendarView` itself beyond making it toggle-able with the new board.
- No changes to `CalendarView`'s `TarefaChip` (day-cell chip) — it stays as-is; the card redesign only touches `TarefaCard` (used by Kanban + the new board).

## Architecture

- New file `apps/crm/src/pages/tarefas/views/BoardView.tsx` — the date-bucket board. Structurally mirrors `boardShared.tsx`'s `TarefaBoard` (dnd-kit `DndContext`, `useDraggable`/`useDroppable`, no `SortableContext` since column membership is date-derived, not manually ordered).
- `TarefaCard` is currently rendered only through `boardShared.tsx`'s `TarefaBoard`, which powers **both** `StatusKanbanView.tsx` ("Kanban" tab) and `MembrosBoardView.tsx` ("Por membro" tab) — not just Kanban. The card redesign and its new `membros`/`onRefresh` props reach all three consumers (Kanban, Por membro, and the new Board) since they all go through the same `TarefaBoard` → `DraggableTarefaCard` → `TarefaCard` chain. `StatusKanbanView` and `MembrosBoardView` already receive `membros` and `onRefresh`-equivalent (`refresh`) from `TarefasPage.tsx` today, so no new prop-threading is needed for them — only `TarefaBoard`/`DraggableTarefaCard` need to pass `membros`/`onRefresh` down into `TarefaCard`, which they don't today.
- `CalendarView.tsx` currently has only 3 props (`tarefas`, `onTarefaClick`, `onRefresh`) and no `membros`. It gains a `membros: Membro[]` prop (passed from `TarefasPage.tsx`, same array already fetched there) plus a small internal toggle (segmented control, "Mês" / "Board") near its existing header controls. It renders either the current month-grid body or `<BoardView />`, passing through the same already-filtered task list, `membros`, and `onRefresh` — no changes to `TarefasPage.tsx`'s tab structure or the filters bar.
- `apps/crm/src/pages/tarefas/components/TarefaCard.tsx` is redesigned in place (still the same component/props shape, extended with `membros`/`onRefresh`).

## Column definitions (Board mode)

Bucketing must use date-only string comparison (`toDateOnlyString`, the existing helper in `tarefasLogic.ts`), never naive `new Date(data_limite)` parsing — the same convention `CalendarView.tsx` already follows via its `byDay` string-keyed map, to avoid Brazilian-timezone day-shift bugs.

Given `data_limite` (a `YYYY-MM-DD` string or `null`) and `today` (also a date-only string), each task is assigned to **exactly one** bucket by evaluating these rules **in this order** (not the visual left-to-right order below) and taking the first match:

| # | Column | Rule |
|---|---|---|
| 1 | Sem data | `data_limite === null` |
| 2 | Em atraso | `data_limite < today` |
| 3 | Hoje | `data_limite === today` |
| 4 | Amanhã | `data_limite === today + 1 day` |
| 5 | *(named weekday)* | `data_limite <= endOfWeek(today)` (Mon-start week, so "endOfWeek" is that week's Sunday) — one column per matching date, labeled by its Portuguese weekday name |
| 6 | Mais tarde | anything else (i.e. `data_limite > endOfWeek(today)`) |

This ordering resolves the ambiguous cases explicitly:
- **Amanhã is always "tomorrow"**, independent of week boundaries — if today is Sunday, "Amanhã" is next Monday and is still its own column (rule 4 matches before rule 5/6 are even evaluated).
- **If today is Saturday or Sunday**, rule 5 produces **zero** named-weekday columns for that day, since every remaining date in the current week is already claimed by rules 1-4 (e.g. today=Sunday: nothing is left between "tomorrow" and "end of this week" — they're the same boundary). The board simply renders `Em atraso | Hoje | Amanhã | Mais tarde | Sem data` that day, with no weekday columns in between.
- **No task can match two buckets** — each rule's range is disjoint from the ones before it since they're evaluated in order and the first match wins.

The rule table above is evaluation order (for the bucketing function), not visual order. Columns are rendered left-to-right as: Em atraso, Hoje, Amanhã, named-weekday column(s), Mais tarde, Sem data — "Sem data" stays the **rightmost** column, replacing today's separate side rail in month mode (Board mode has no separate rail, it's just the last regular column).

**Completed tasks:** to keep the Mês/Board toggle showing a consistent set of tasks, Board mode reuses `CalendarView`'s existing rule verbatim: a completed task (`status === 'concluida'`) **with** a `data_limite` still appears in its date's bucket (rendered struck-through/dimmed, same as today, even if that bucket is "Em atraso"), while a completed task **without** a `data_limite` is dropped entirely from "Sem data" (not shown), exactly like the month grid's `semData` filter today. This intentionally differs from `MembrosBoardView` (hides all completed tasks) and `StatusKanbanView` (shows all completed tasks in a dedicated column) — those two views are unaffected by this spec.

## Drag and drop rules

- **Droppable columns** (exact target date, sets `data_limite`): Hoje, Amanhã, and each named weekday column. **Em atraso and Mais tarde must not call `useDroppable` at all** — they are structurally not drop targets, not "droppable-but-rejected". Registering them as droppable (even if the drop handler later no-ops) would make dnd-kit show valid-hover styling while dragging over them, which is misleading; the column body for these two must render as a plain non-droppable `<div>`, the same way `TarefaBoard`'s status columns already skip `useDroppable` for whichever bucket doesn't accept drops.
- **Sem data** is droppable and clears `data_limite` (sets `null`) on drop.
- Rescheduling must follow the exact same pattern `CalendarView.tsx`'s `handleDragEnd` already uses — this is **not** a plain fire-and-forget `updateTarefa` call: apply an optimistic override via `useOptimisticTarefas`'s `applyOverride(tarefa.id!, { data_limite: target })` synchronously, then `await updateTarefa(...)`, `onRefresh()` and a success toast on success, or `clearOverride(tarefa.id!)` plus an error toast on failure. `BoardView` reuses the same `useOptimisticTarefas` hook so cards move instantly instead of waiting for the refetch.

## "+ Adicionar tarefa" per column

`TarefaFormDialog` is owned exclusively by `TarefasPage.tsx` (open/editing state lives there; no view renders its own copy), and its current `initialValues` prop type — `{ titulo?, descricao?, cliente_id? }` — has no due-date field. To support per-column prefill:

- Extend `TarefaFormDialog`'s `initialValues` type to add `data_limite?: string | null`, and extend its create-mode reset effect (`TarefaFormDialog.tsx` around lines 121-142) to seed the due-date field from it, same as the existing `titulo`/`descricao`/`cliente_id` handling.
- `TarefasPage.tsx` adds a callback, `handleCreateForDate(date: string | null)`, that sets `editing = null` and opens the dialog with `initialValues={{ data_limite: date }}` — analogous to how the page-level "Nova tarefa" button already opens it today, just with a prefilled date.
- This callback threads down as a new prop (`onCreateTask: (date: string | null) => void`) through `CalendarView` → `BoardView` → each column's add-button. Clicking "+ Adicionar tarefa" in a column calls `onCreateTask(columnDate)`:
  - Hoje / Amanhã / named-weekday columns: pass that column's concrete date.
  - Em atraso / Mais tarde / Sem data: pass `null` (no unambiguous default).
- Add-button placement: pinned at the **top** of every column (per explicit request — differs from the reference screenshot, which puts it at the bottom; matches the existing visual pattern in `apps/crm/src/pages/entregas/views/KanbanView.tsx:834-849`, though that button opens a different flow — this one wires into `TarefaFormDialog` via the callback above, not a workflow-specific dialog).

## Card redesign (`TarefaCard`)

Layout, top to bottom:

1. Tag pills row (unchanged from today, only if `tags.length > 0`).
2. Header row: title (bold, strikethrough+dimmed when `concluida`) on the left, assignee avatar (or a "?" placeholder when unassigned) at the top-right — now clickable.
3. Metadata row: due-date badge (colored per urgency, now with a small calendar icon) and, if any, subtask progress (`CheckSquare` icon + `concluidas/total`).
4. Footer row (new): a small colored dot (reusing the same per-member/id color hash as the avatar, `avatarColorClass`) plus the client name (`cliente_nome`), replacing today's plain grey text under the title. Omitted when `cliente_nome` is null, same as today.

### Inline assignee reassignment

Same interaction as `WorkflowCard.tsx`'s assignee chip (`apps/crm/src/pages/entregas/components/WorkflowCard.tsx:332-450`):

- Click the avatar → shadcn `DropdownMenu` (Radix) lists all `membros`.
- Picking one: optimistic local state update (`setLocalMembro`), `e.stopPropagation()` so it doesn't also open the task's edit view, then `await updateTarefa(tarefa.id, { responsavel_id: m.id })`.
- Success: `sonner` toast + call `onRefresh()` (already-existing `refresh()` from `useTarefasData`, invalidates the `['tarefas']` query).
- Failure: roll back local state to `undefined`, error toast.
- No permission gating — matches the existing Entregas pattern (any user who can see the board can reassign).
- Known limitation, inherited as-is from `WorkflowCard`'s existing pattern (not something this spec fixes): two rapid reassigns on the same card (A→B succeeds, then B→C fails before refetch) can roll back to a stale value rather than the last-confirmed one. This mirrors an existing gap in the Entregas card today; fixing it generally is out of scope here.

### Props change

`TarefaCard` gains two new required props: `membros: Membro[]` and `onRefresh: () => void`. Both `DraggableTarefaCard` and `TarefaBoard` in `boardShared.tsx` already receive `membros`/an equivalent refresh callback from their callers (`StatusKanbanView`, `MembrosBoardView`) today — they just don't forward them into the card yet, so this is purely plumbing inside `boardShared.tsx`, not new prop-threading at the `TarefasPage.tsx` level for those two views. The new `BoardView.tsx` follows the same shape, receiving `membros`/`onRefresh` from `CalendarView.tsx` (which in turn gets `membros` newly from `TarefasPage.tsx`, per the Architecture section above).

## Testing

Note: no test file currently targets `CalendarView.tsx`, `StatusKanbanView.tsx`, `MembrosBoardView.tsx`, or `boardShared.tsx` — existing Tarefas tests only cover `TarefasPage.test.tsx`, `TarefaFormDialog.test.tsx`, and pure-logic `tarefasLogic.test.ts`. There is nothing to "update" for the new props; this needs new test coverage:

- Unit tests (in `tarefasLogic.test.ts` or a new file alongside it) for the new column-bucketing function (date → column key), covering: week-boundary edges where today is Saturday/Sunday (zero named-weekday columns), the Sunday→Monday "Amanhã" case, and null due dates.
- A test for `TarefaFormDialog`'s extended `initialValues.data_limite` prefill (create mode).
- A rendering/integration test for `BoardView` (or `TarefasPage` with the board toggled on) covering: Em atraso/Mais tarde columns render without registering as drop targets, dropping on a named-weekday column updates `data_limite`, and the per-column add-button calls `onCreateTask` with the expected date (or `null`).
- Manual verification in the browser: toggle Mês/Board, drag a card between droppable columns, confirm Em atraso/Mais tarde reject drops, reassign via the avatar dropdown, add-task dialog opens pre-filled with the right date per column.
