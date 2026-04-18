# WorkflowCard Posts Count Badge — Design

**Date:** 2026-04-18
**Status:** Approved, ready for implementation plan

## Goal

Show the total number of posts on each workflow card's "Posts" button in the Entregas Kanban board, so users can see at a glance how many posts exist on a workflow without opening the drawer.

## Background

`WorkflowCard` already accepts a `postsCount?: number` prop and renders a `.board-card-posts-badge` on the Posts button when `postsCount > 0` (see `apps/crm/src/pages/entregas/components/WorkflowCard.tsx:427-429` and the CSS at `apps/crm/style.css:4540`). The prop is never passed by any parent, so the badge never appears. This spec completes the wiring.

## Scope

- Entregas Kanban view (`KanbanView`).
- Badge shows **total posts** on the workflow (all statuses, no filtering).
- No schema changes, no new UI; existing CSS is reused.

## Changes

### 1. `apps/crm/src/store.ts` — add bulk count fetch

Add a function that fetches post counts for multiple workflows in one round trip:

```ts
export async function getWorkflowPostsCounts(
  workflowIds: number[]
): Promise<Map<number, number>> {
  const counts = new Map<number, number>();
  if (workflowIds.length === 0) return counts;
  const { data, error } = await supabase
    .from('workflow_posts')
    .select('workflow_id')
    .in('workflow_id', workflowIds);
  if (error) throw error;
  for (const row of data ?? []) {
    counts.set(row.workflow_id, (counts.get(row.workflow_id) ?? 0) + 1);
  }
  return counts;
}
```

Counting client-side from a `select('workflow_id')` keeps the implementation simple and avoids an RPC. For typical board sizes (tens of workflows, a few hundred posts total) this is fine. If post volumes grow much larger, swap to a Postgres RPC that returns `(workflow_id, count)` pairs.

### 2. `apps/crm/src/pages/entregas/hooks/useEntregasData.ts` — expose counts

- Import `getWorkflowPostsCounts`.
- Add a `useQuery` keyed on `['workflow-posts-counts', activeWorkflowIds.join(',')]` calling `getWorkflowPostsCounts(activeWorkflowIds)`, gated by `activeWorkflowIds.length > 0`, mirroring the existing `workflow-covers` query at lines 133-137.
- Return `postsCounts: Map<number, number>` from the hook (default to an empty `Map` when data is undefined).
- Add `qc.invalidateQueries({ queryKey: ['workflow-posts-counts'] })` to `refresh()`.

### 3. `apps/crm/src/pages/entregas/EntregasPage.tsx` — thread prop

Destructure `postsCounts` from `useEntregasData()` and pass it to `<KanbanView postsCounts={postsCounts} ... />`.

### 4. `apps/crm/src/pages/entregas/views/KanbanView.tsx` — accept and apply

- Add `postsCounts: Map<number, number>` to `KanbanViewProps`.
- Thread it to the draggable-card wrapper component and into `<WorkflowCard postsCount={postsCounts.get(card.workflow.id!) ?? 0} ... />`.
- The `DragOverlay`'s `<WorkflowCard>` (KanbanView.tsx:347) should also receive the count for visual consistency while dragging.

### 5. `apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx` — invalidate on mutation

When posts are added or deleted inside the drawer, invalidate the counts query so the badge updates immediately. Add alongside the existing `['workflow-posts-with-props', workflowId]` invalidations:

```ts
qc.invalidateQueries({ queryKey: ['workflow-posts-counts'] });
```

## Non-changes

- `WorkflowCard.tsx` — no change (badge already rendered when `postsCount > 0`).
- `style.css` — no change (`.board-card-posts-badge` already defined).
- Database schema — no migration.

## Testing

**Manual:**
- Open the Entregas Kanban with a workflow that has posts → badge shows count on the Posts button.
- Open the drawer and add a post → badge increments after closing or on refresh.
- Delete a post → badge decrements.
- Workflow with 0 posts → no badge (existing `postsCount > 0` guard).
- Drag a card between columns → badge remains correct on the `DragOverlay`.

**Automated:**
- No new unit tests are required. Optionally extend `apps/crm/src/pages/entregas/hooks/__tests__/useEntregasData.test.ts` to assert `postsCounts` is returned as a `Map`.

## Rollout

Single PR. No feature flag. No migration. Safe to merge independently.
