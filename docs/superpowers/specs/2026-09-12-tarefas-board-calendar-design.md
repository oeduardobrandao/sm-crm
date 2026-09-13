# Tarefas: Date-Bucket Board View + Card Redesign

**Date:** 2026-09-12
**Status:** Approved

## Summary

Add a second mode to the Tarefas "Calendário" tab: a date-bucket kanban board (columns like "Em atraso", "Hoje", "Amanhã", ...) with drag-and-drop rescheduling, inspired by a reference screenshot from an external task app. The existing month grid stays as the other mode, toggled from the same tab. Alongside this, the shared task card (`TarefaCard`) gets a visual refresh and gains inline assignee reassignment — and since the card is shared via `boardShared.tsx`, the existing "Kanban" and "Por membro" tabs pick up both changes too.

No database schema changes. `Tarefa` has no priority/flag or attachment/link fields, so the reference screenshot's flag and paperclip icons are dropped — the redesigned card only surfaces data that already exists (title, tags, client, due date, assignee, subtask progress).

## Non-goals

- No per-member grouping (the reference screenshot groups columns under a "Marina Pinheiro" header; this stays a single flat board, filtered by the existing "Todos os membros" dropdown like today).
- No new `prioridade`/attachment fields on `tarefas`.
- No changes to the month-grid `CalendarView` itself beyond making it toggle-able with the new board.
- No changes to `CalendarView`'s `TarefaChip` (day-cell chip) — it stays as-is; the card redesign only touches `TarefaCard` (used by Kanban, Por membro, and the new board).

## Architecture

- New file `apps/crm/src/pages/tarefas/views/BoardView.tsx` — the date-bucket board. Structurally mirrors `boardShared.tsx`'s `TarefaBoard` (dnd-kit `DndContext`, `useDraggable`/`useDroppable`, no `SortableContext` since column membership is date-derived, not manually ordered).
- `TarefaCard` is currently rendered only through `boardShared.tsx`'s `TarefaBoard`, which powers **both** `StatusKanbanView.tsx` ("Kanban" tab) and `MembrosBoardView.tsx` ("Por membro" tab) — not just Kanban. The card redesign and its new `membros`/`onRefresh` props reach all three consumers (Kanban, Por membro, and the new Board) since they all go through the same `TarefaBoard` → `DraggableTarefaCard` → `TarefaCard` chain. See "Props change" under Card redesign below for the exact call sites this touches (it's more than one file).
- `CalendarView.tsx` currently has only 3 props (`tarefas`, `onTarefaClick`, `onRefresh`) and no `membros`. It gains a `membros: Membro[]` prop (passed from `TarefasPage.tsx`, same array already fetched there) plus a small internal toggle (segmented control, "Mês" / "Board") near its existing header controls. It renders either the current month-grid body or `<BoardView />`, passing through the same already-filtered task list, `membros`, and `onRefresh` — no changes to `TarefasPage.tsx`'s tab structure or the filters bar.
- Toggle state defaults to **Board** and persists across visits via `localStorage` (e.g. key `tarefas-calendario-modo`), since `CalendarView` unmounts on tab switch and would otherwise reset to the default every time. Read on mount, written on toggle.
- `apps/crm/src/pages/tarefas/components/TarefaCard.tsx` is redesigned in place (still the same component/props shape, extended with `membros`/`onRefresh`).

## Column definitions (Board mode)

`tarefasLogic.ts` already has `groupByDueBucket(tarefas, now)` — buckets `atrasadas | hoje | estaSemana | depois | semData`, built on existing date-only helpers (`parseDateOnly`, `startOfLocalDay`, `endOfCurrentWeek`, `isSameLocalDay`). It's the right foundation (reuse its date math, don't reinvent it), but it doesn't fit Board mode as-is for two reasons: (1) it unconditionally excludes ALL completed tasks (`if (t.status === 'concluida') continue`), which conflicts with this spec's completed-task rule below, and (2) its `estaSemana` bucket is coarser than Board mode needs — Board splits that span into "Amanhã" plus one column per remaining weekday.

So this adds a **new, sibling function** in `tarefasLogic.ts` (not a parallel reimplementation of the date math — it calls the same `parseDateOnly`/`startOfLocalDay`/`endOfCurrentWeek`/`isSameLocalDay` helpers `groupByDueBucket` already uses) rather than modifying `groupByDueBucket` itself, since `groupByDueBucket` is also used elsewhere (the Lista view's "ATRASADAS" grouping) with its existing completed-task behavior intentionally intact.

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

- **Droppable columns** (exact target date, sets `data_limite`): Hoje, Amanhã, and each named weekday column, plus Sem data (clears `data_limite`). **Em atraso and Mais tarde must not register as drop targets.** Today, `boardShared.tsx`'s `DroppableColumnBody` calls `useDroppable` unconditionally for every column (`boardShared.tsx:74-85`, no opt-out exists) — this spec requires adding one: extend `BoardColumn` with a `droppable?: boolean` flag (default `true`, so `StatusKanbanView`/`MembrosBoardView` are unaffected), and make `DroppableColumnBody` render a plain non-droppable `<div className="board-column-body">` (skipping `useDroppable` entirely) when `droppable === false`. This is new capability, not something already conditional in the shared component.
- Rescheduling must follow the exact same pattern `CalendarView.tsx`'s `handleDragEnd` already uses — this is **not** a plain fire-and-forget `updateTarefa` call: apply an optimistic override via `useOptimisticTarefas`'s `applyOverride(tarefa.id!, { data_limite: target })` synchronously, then `await updateTarefa(...)`, `onRefresh()` and a success toast on success, or `clearOverride(tarefa.id!)` plus an error toast on failure. `BoardView` reuses the same `useOptimisticTarefas` hook so cards move instantly instead of waiting for the refetch.
- Drop targets reuse the existing `DropTarget`/`buildDropId`/`parseDropId` machinery as-is (`tarefasLogic.ts:178-210`) — its `{ kind: 'day', date: string | null }` case already round-trips `date: null` (encoded `"day:none"`) for "Sem data", and is already unit-tested. No new drop-id kind or encoding is needed.

### Click vs. drag on the reassign avatar (verify during implementation)

`DraggableTarefaCard` spreads dnd-kit's `{...listeners}` over the **entire** card (`boardShared.tsx:54-55`), and the only click/drag disambiguation is `PointerSensor`'s `activationConstraint: { distance: 5 }` (`boardShared.tsx:91`, same 5px threshold `KanbanView.tsx` uses). This differs from how `WorkflowCard.tsx` avoids the conflict — it never puts `listeners` on the whole card, only on a dedicated drag-handle icon (`KanbanView.tsx:194-210`, `dragHandle={<GripVertical {...listeners} />}`), so its assignee dropdown never competes with drag activation at all.

Since `TarefaCard`'s new assignee dropdown sits inside a card whose whole surface is a drag source, this needs explicit verification once built — click the avatar in the real browser (not just visually) and confirm the `DropdownMenu` opens reliably and doesn't intermittently start a drag instead. If it doesn't work cleanly, the fallback is to give the avatar's `DropdownMenuTrigger` its own `onPointerDown` handler that calls `e.stopPropagation()` before dnd-kit's listener sees it (`WorkflowCard`'s chip already does `stopPropagation` on click for the same reason, `WorkflowCard.tsx:340-360`, though it doesn't need to fight a whole-card drag listener like this case does).

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
4. Footer row (new): a small colored dot plus the client name (`cliente_nome`), replacing today's plain grey text under the title. The dot's color hashes on `cliente_id` (via the same `avatarColorClass` hash function `TarefaCard` already uses for avatars, just keyed by client instead of member — so it's stable per client, not per assignee). Omitted when `cliente_nome`/`cliente_id` is null, same as today.

### Inline assignee reassignment

Same interaction as `WorkflowCard.tsx`'s assignee chip (`apps/crm/src/pages/entregas/components/WorkflowCard.tsx:332-450`):

- Click the avatar → shadcn `DropdownMenu` (Radix) lists all `membros`.
- Picking one: optimistic local state update (`setLocalMembro`), `e.stopPropagation()` so it doesn't also open the task's edit view, then `await updateTarefa(tarefa.id, { responsavel_id: m.id })`.
- Success: `sonner` toast + call `onRefresh()` (already-existing `refresh()` from `useTarefasData`, invalidates the `['tarefas']` query).
- Failure: roll back local state to `undefined`, error toast.
- No permission gating — matches the existing Entregas pattern (any user who can see the board can reassign).
- Known limitation, inherited as-is from `WorkflowCard`'s existing pattern (not something this spec fixes): two rapid reassigns on the same card (A→B succeeds, then B→C fails before refetch) can roll back to a stale value rather than the last-confirmed one. This mirrors an existing gap in the Entregas card today; fixing it generally is out of scope here.

### Props change

`TarefaCard` gains two new required props: `membros: Membro[]` and `onRefresh: () => void`. `TarefaBoardProps` (`boardShared.tsx:25-33`) has `membros` already but **no** refresh-shaped prop at all today — this needs to be added there, and threaded through at three call sites, all of which need explicit edits (not "purely plumbing" in one place):

1. `TarefaBoard`'s own signature gains `onRefresh: () => void` and forwards it (plus `membros`, already present) into `DraggableTarefaCard`.
2. The `DragOverlay`'s inline `TarefaCard` render (`boardShared.tsx:150-163`) currently passes only `tarefa`, `membro`, `now`, `onClick` — it also needs `membros`/`onRefresh` (or the assignee dropdown should be suppressed on the overlay copy specifically, since reassigning the ghost card mid-drag makes no sense; simplest is to pass a no-op `onRefresh` and empty `membros` there so the overlay renders read-only).
3. `StatusKanbanView.tsx` and `MembrosBoardView.tsx` both already receive a `refresh` callback from `TarefasPage.tsx` (used for their own `onDropCard` handling) — they just need to also pass it through as `TarefaBoard`'s new `onRefresh` prop.

`hideAssignee` note: `MembrosBoardView.tsx` sets `hideAssignee: true` on its per-member columns since the column itself already communicates the assignee — the new reassign dropdown must respect this and stay hidden there too (dragging a card between member columns is already the reassign action in that view; the avatar dropdown would be redundant/confusing there).

The new `BoardView.tsx` follows the same shape, receiving `membros`/`onRefresh` from `CalendarView.tsx` (which in turn gets `membros` newly from `TarefasPage.tsx`, per the Architecture section above).

## Testing

Note: no test file currently targets `CalendarView.tsx`, `StatusKanbanView.tsx`, `MembrosBoardView.tsx`, or `boardShared.tsx` — existing Tarefas tests only cover `TarefasPage.test.tsx`, `TarefaFormDialog.test.tsx`, and pure-logic `tarefasLogic.test.ts`. There is nothing to "update" for the new props; this needs new test coverage:

- Unit tests (in `tarefasLogic.test.ts` or a new file alongside it) for the new column-bucketing function (date → column key), covering: week-boundary edges where today is Saturday/Sunday (zero named-weekday columns), the Sunday→Monday "Amanhã" case, and null due dates.
- A test for `TarefaFormDialog`'s extended `initialValues.data_limite` prefill (create mode).
- A rendering/integration test for `BoardView` (or `TarefasPage` with the board toggled on) covering: Em atraso/Mais tarde columns render without registering as drop targets, dropping on a named-weekday column updates `data_limite`, and the per-column add-button calls `onCreateTask` with the expected date (or `null`).
- Manual verification in the browser: toggle Mês/Board (and confirm the choice persists after navigating away and back), drag a card between droppable columns, confirm Em atraso/Mais tarde never show hover/valid-target styling and reject drops, click the avatar to reassign on a card that's part of a draggable column and confirm it opens the dropdown rather than starting a drag, add-task dialog opens pre-filled with the right date per column.
