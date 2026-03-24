# Entregas Kanban Enhancement — Design Spec

**Date:** 2026-03-24
**Status:** Approved

## Overview

Enhance the Entregas page to be a fully functional kanban board with drag-and-drop, and add three additional visualization modes: Chart, Calendar, and List. The existing `EntregasPage.tsx` (~600 lines) is split into focused, single-responsibility files.

---

## File Structure

```
src/pages/entregas/
  EntregasPage.tsx              — shell: view switcher, filter bar, modal state, sort state
  views/
    KanbanView.tsx              — @dnd-kit drag-and-drop board
    ChartView.tsx               — chart.js deadline status chart
    CalendarView.tsx            — custom monthly calendar grid
    ListView.tsx                — sortable flat table
  components/
    WorkflowCard.tsx            — card shared by kanban and list views
    EntregasFilters.tsx         — filter bar (client, member, status)
    WorkflowModals.tsx          — extracted modals: NewWorkflowModal, EditWorkflowModal,
                                  DeleteWorkflowModal, RecurringWorkflowDialog
  hooks/
    useEntregasData.ts          — data fetching + BoardCard building logic (read-only)
```

---

## Database Migration

Two steps:

**Step 1 — Add column:**
```sql
ALTER TABLE workflows ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
```

**Step 2 — Backfill distinct positions:**
```sql
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY template_id, etapa_atual
           ORDER BY id
         ) - 1 AS new_position
  FROM workflows
  WHERE status = 'ativo'
)
UPDATE workflows
SET position = ranked.new_position
FROM ranked
WHERE workflows.id = ranked.id;
```

A new store function handles batch position updates after reorder:

```ts
updateWorkflowPositions(updates: { id: number; position: number }[]): Promise<void>
```

The batch update is best-effort (not atomic). On any error — including partial failure — the entire operation is treated as failed: local optimistic state reverts and an error toast is shown. No partial rollback of individual rows is attempted.

---

## View Switcher

Icon + label tab group (pill-style) at the top of the page, above the filter bar. Four tabs: **⊞ Kanban**, **📊 Gráfico**, **📅 Calendário**, **☰ Lista**. Active tab highlighted with accent color. View selection is local state in `EntregasPage`.

---

## Shared State in EntregasPage

`EntregasPage` owns and passes as props:
- `activeView: 'kanban' | 'chart' | 'calendar' | 'list'`
- Filter state: `filterCliente`, `filterMembro`, `filterStatus`
- `listSort: { column: string; direction: 'asc' | 'desc' }` — preserved across view switches

---

## Filters

Extracted to `EntregasFilters.tsx`. The same filter bar (client, member, status) applies across all four views. Filter state lives in `EntregasPage` and is passed as props to each view.

---

## Kanban View

**Library:** `@dnd-kit/core` + `@dnd-kit/sortable`

**Layout:** Same as current — workflows grouped by template, columns = etapa names, cards sorted ascending by `position`.

### Drag-and-Drop Behavior

- `DndContext` wraps the board; each column is a `SortableContext`
- Each card is a draggable `SortableItem` with a visible drag handle
- `DragOverlay` renders a ghost card during drag: the same `WorkflowCard` component at 80% opacity, so the ghost matches the real card exactly
- Optimistic state (current card positions + column assignments) lives inside `KanbanView`. `useEntregasData` remains read-only (no write state).

**Between-column drop — constraint:**
Only adjacent-column drops are allowed, where adjacency is defined by the etapa's `ordem` field (not visual column position). A card may only be dropped into a column whose etapa `ordem` differs by exactly 1 from the card's current etapa `ordem`. Non-adjacent drops snap back with no action.

**Between-column drop — adjacent forward (left → right):**
Calls `completeEtapa(workflowId, etapaId)`. On success, card moves to the next column. On error, card snaps back and an error toast is shown.

**Between-column drop — adjacent backward (right → left):**
Drag ends; an `AlertDialog` (existing shadcn component) appears asking the user to confirm reverting the etapa. On confirm, calls `revertEtapa(workflowId, etapaId)`. On cancel or error, card snaps back. The `AlertDialog` is state-driven and triggered after the drag settles — never mid-drag — to avoid blocking the dnd-kit animation thread.

**Within-column drop:**
- Optimistic UI update (instant visual reorder in local state)
- Calls `updateWorkflowPositions` to persist new order to DB
- On error: local state reverts to pre-drag order and an error toast is shown

---

## Chart View

**Library:** Existing `chart.js ^4.5.1` + `react-chartjs-2 ^5` (compatible, peer dep satisfied)

**Data source:** The existing `getDeadlineInfo(etapa)` function returns `{ estourado, urgente }`. Cards are classified as:
- **Atrasado** — `estourado === true`
- **Urgente** — `urgente === true && !estourado`
- **Em dia** — `!estourado && !urgente`

**Content:**
- Doughnut chart showing Em dia / Urgente / Atrasado counts from the filtered card set
- Color coding: green (em dia), yellow (urgente), red (atrasado)
- Three summary stat cards below the chart with large count numbers and labels

All active filters apply.

---

## Calendar View

**No new dependencies** — custom monthly grid.

### Deadline Computation

Deadlines are computed (not stored). `useEntregasData` exports a helper `computeDeadlineDate(iniciado_em: string, prazo_dias: number, tipo_prazo: 'corridos' | 'uteis'): Date` that returns the absolute deadline date:

- **`corridos`:** `new Date(iniciado_em) + prazo_dias * 24h`
- **`uteis`:** Advance from `iniciado_em` by counting only Mon–Fri days (no public holiday exclusions — same rule as the existing `getDeadlineInfo`)

**Etapa deadline (🔵 blue badge):** `computeDeadlineDate(etapa.iniciado_em, etapa.prazo_dias, etapa.tipo_prazo)` for the currently active etapa. If `iniciado_em` is null, not shown.

**Workflow deadline (🟠 orange badge):** Estimated by chaining etapas from the active one through the last. Start from the active etapa's `iniciado_em`, apply `computeDeadlineDate` to get its end date, use that as the start for the next etapa, and so on through the last etapa. If the active etapa's `iniciado_em` is null, workflow deadline is not shown.

A card may appear on two different days in the same month if both deadlines are different dates.

### Features

- Month navigation: previous/next arrows + current month/year label; no minimum or maximum bounds
- Each day cell lists cards with deadlines on that day, with colored dot badges indicating type
- Clicking a card opens the existing edit modal
- All filters apply

---

## List View

Sortable table with columns: **Título**, **Cliente**, **Etapa atual**, **Responsável**, **Prazo**, **Status**.

- Click column header to toggle sort ascending/descending; sort state is lifted to `EntregasPage` so it persists across view switches
- Status column shows a color-coded badge (em dia / urgente / atrasado) using `getDeadlineInfo`
- Row click opens the edit modal
- New workflow button remains accessible
- All filters apply

---

## New Workflow Button

The "New Workflow" button is visible in **all four views** — Kanban, Gráfico, Calendário, and Lista — positioned consistently in the page header alongside the view switcher tabs.

## Loading & Empty States

All four views share the same behavior:
- **Loading:** Show the existing `Spinner` component centered in the content area while data is fetching
- **Empty (no workflows match filters):** Show a centered message "Nenhuma entrega encontrada" with a secondary hint to adjust the filters

## Error Handling

- Failed between-column (forward) drag: card snaps back to original column, error toast shown
- Failed between-column (backward) drag: card snaps back; user must re-initiate if they want to retry
- Failed within-column reorder: local state reverts to pre-drag order, error toast shown
- Revert confirmation canceled: card snaps back silently

---

## Dependencies to Add

| Package | Version | Purpose |
|---|---|---|
| `@dnd-kit/core` | latest | Drag-and-drop primitives |
| `@dnd-kit/sortable` | latest | Sortable list/column utilities |
| `@dnd-kit/utilities` | latest | CSS transform helpers |
| `react-chartjs-2` | `^5` | React wrapper for existing chart.js |
