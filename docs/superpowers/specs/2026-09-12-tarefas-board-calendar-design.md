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
- `apps/crm/src/pages/tarefas/views/CalendarView.tsx` gains a small internal toggle (segmented control, "Mês" / "Board") near its existing header controls. It renders either the current month-grid body or `<BoardView />`, passing through the same already-filtered task list, `membros`, and `refresh` callback it already receives — no changes to `TarefasPage.tsx`'s tab structure or the filters bar.
- `apps/crm/src/pages/tarefas/components/TarefaCard.tsx` is redesigned in place (still the same component/props shape, extended with `membros`/`onRefresh`) and consumed by both `boardShared.tsx` (existing Kanban tab) and the new `BoardView.tsx`.

## Column definitions (Board mode)

Computed from `data_limite` relative to "today":

| Column | Rule |
|---|---|
| Em atraso | `data_limite < today` |
| Hoje | `data_limite == today` |
| Amanhã | `data_limite == today + 1` |
| *(named weekday)* | one column per remaining day through the end of the current week (Mon-start), e.g. Sábado, Domingo — omitted once passed |
| Mais tarde | `data_limite > end of current week` |
| Sem data | `data_limite == null` |

Columns are always rendered in this fixed left-to-right order; "Sem data" is the rightmost column (replacing today's separate side rail in month mode — Board mode has no separate rail, it's just the last column).

## Drag and drop rules

- **Droppable columns** (exact target date, sets `data_limite`): Hoje, Amanhã, and each named weekday column. Same rescheduling mechanism the month grid already uses (`useDroppable` id encodes the target date).
- **Sem data** is droppable and clears `data_limite` (sets `null`) on drop.
- **Em atraso** and **Mais tarde** are not droppable — there is no single unambiguous date to assign. Cards can be dragged *out* of them into any droppable column, but dropping *into* them is a no-op (card snaps back), consistent with how invalid drop targets already behave elsewhere in the app.
- Dropping is still a plain `updateTarefa(id, { data_limite })` call, same as the existing month-view drag handler.

## "+ Adicionar tarefa" per column

Every column gets an add-button pinned at the **top** (per explicit request — differs from the reference screenshot, which puts it at the bottom; matches the existing pattern in `apps/crm/src/pages/entregas/views/KanbanView.tsx:834-849`). Clicking it opens the existing `TarefaFormDialog`:

- Hoje / Amanhã / named-weekday columns: pre-fills `data_limite` with that column's date.
- Em atraso / Mais tarde / Sem data: opens with no due date pre-filled (no unambiguous default).

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

### Props change

`TarefaCard` (and its `DraggableTarefaCard` wrapper in `boardShared.tsx`, and the new board's wrapper) gains two new required props: `membros: Membro[]` and `onRefresh: () => void`, threaded down from `TarefasPage.tsx` → `StatusKanbanView`/`BoardView` → the card, mirroring how `WorkflowCard` already receives them in Entregas.

## Testing

- Unit tests for the new column-bucketing function (date → column key), covering week-boundary edges (Sunday, Monday) and null due dates.
- Existing Kanban/CalendarView tests updated for the new `TarefaCard` props (`membros`, `onRefresh`) rather than new test files.
- Manual verification in the browser: toggle Mês/Board, drag a card between droppable columns, confirm Em atraso/Mais tarde reject drops, reassign via the avatar dropdown, add-task pre-fill per column.
