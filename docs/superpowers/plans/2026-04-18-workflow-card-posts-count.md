# WorkflowCard Posts Count Badge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display the total post count on each `WorkflowCard`'s "Posts" button in the Entregas Kanban board, wiring the already-built (but unused) `postsCount` prop end-to-end.

**Architecture:** Add a single bulk Supabase query (`getWorkflowPostsCounts`) that returns a `Map<workflowId, count>` for all active workflows. Expose it from the `useEntregasData` hook as a TanStack Query, thread the map through `EntregasPage → KanbanView → WorkflowCard`, and invalidate it from `WorkflowDrawer` on post add/delete so the badge stays fresh.

**Tech Stack:** React 19, TypeScript, Vite, Supabase JS client, TanStack Query v5, Vitest.

**Spec:** [docs/superpowers/specs/2026-04-18-workflow-card-posts-count-design.md](../specs/2026-04-18-workflow-card-posts-count-design.md)

---

## File Structure

**Modify:**
- `apps/crm/src/store.ts` — add `getWorkflowPostsCounts(workflowIds)` after the existing `getWorkflowPosts*` functions (around line 1231)
- `apps/crm/src/pages/entregas/hooks/useEntregasData.ts` — add a `useQuery` for post counts; expose `postsCounts`; invalidate in `refresh()`
- `apps/crm/src/pages/entregas/EntregasPage.tsx` — destructure `postsCounts` from the hook and pass to `<KanbanView>`
- `apps/crm/src/pages/entregas/views/KanbanView.tsx` — accept `postsCounts`, thread through `SortableCard`, apply to the `<WorkflowCard>` and `DragOverlay`
- `apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx` — invalidate `['workflow-posts-counts']` alongside the existing `['workflow-posts-with-props', workflowId]` invalidations

**Test:**
- `apps/crm/src/__tests__/store.workflows.test.ts` — add one test case for `getWorkflowPostsCounts` using the existing Supabase mock harness

**No changes required:**
- `apps/crm/src/pages/entregas/components/WorkflowCard.tsx` — already accepts and renders `postsCount`
- `apps/crm/style.css` — `.board-card-posts-badge` already defined
- No DB migrations

---

## Task 1: Add `getWorkflowPostsCounts` to `store.ts`

**Files:**
- Modify: `apps/crm/src/store.ts` (insert after line 1231, the close of `getWorkflowPostsWithProperties`)

- [ ] **Step 1: Add a failing test for the new store function**

Open `apps/crm/src/__tests__/store.workflows.test.ts` and add this `describe` block at the very end of the file, after the last closing `});`:

```ts
describe('getWorkflowPostsCounts', () => {
  beforeEach(() => {
    mockedSupabase.__resetSupabaseMock();
    mockedSupabase.__setCurrentProfile({
      id: 'user-1',
      nome: 'Eduardo Souza',
      role: 'owner',
      conta_id: 'conta-1',
    });
  });

  it('returns an empty Map when given no workflow ids (no DB round-trip)', async () => {
    const result = await store.getWorkflowPostsCounts([]);
    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(0);
    expect(getCalls('workflow_posts', 'select')).toHaveLength(0);
  });

  it('aggregates rows into a Map keyed by workflow_id', async () => {
    mockedSupabase.__queueSupabaseResult('workflow_posts', 'select', {
      data: [
        { workflow_id: 10 },
        { workflow_id: 10 },
        { workflow_id: 10 },
        { workflow_id: 20 },
      ],
      error: null,
    });

    const result = await store.getWorkflowPostsCounts([10, 20, 30]);

    expect(result.get(10)).toBe(3);
    expect(result.get(20)).toBe(1);
    expect(result.get(30)).toBeUndefined();

    const calls = getCalls('workflow_posts', 'select');
    expect(calls).toHaveLength(1);
    expect(calls[0].modifiers).toEqual(
      expect.arrayContaining([
        { method: 'select', args: ['workflow_id'] },
        { method: 'in', args: ['workflow_id', [10, 20, 30]] },
      ]),
    );
  });

  it('throws when Supabase returns an error', async () => {
    mockedSupabase.__queueSupabaseResult('workflow_posts', 'select', {
      data: null,
      error: { message: 'boom' },
    });
    await expect(store.getWorkflowPostsCounts([1])).rejects.toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the failing test**

Run: `npx vitest run apps/crm/src/__tests__/store.workflows.test.ts -t "getWorkflowPostsCounts"`
Expected: FAIL with `TypeError: store.getWorkflowPostsCounts is not a function`.

- [ ] **Step 3: Implement `getWorkflowPostsCounts` in `store.ts`**

Insert this function immediately after line 1231 (the closing `}` of `getWorkflowPostsWithProperties`) and before `export async function addWorkflowPost(` on line 1233:

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
  for (const row of (data ?? []) as { workflow_id: number }[]) {
    counts.set(row.workflow_id, (counts.get(row.workflow_id) ?? 0) + 1);
  }
  return counts;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run apps/crm/src/__tests__/store.workflows.test.ts -t "getWorkflowPostsCounts"`
Expected: PASS for all three cases.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/store.ts apps/crm/src/__tests__/store.workflows.test.ts
git commit -m "feat(store): add getWorkflowPostsCounts bulk query"
```

---

## Task 2: Expose `postsCounts` from `useEntregasData`

**Files:**
- Modify: `apps/crm/src/pages/entregas/hooks/useEntregasData.ts`

- [ ] **Step 1: Import the new store function**

In `apps/crm/src/pages/entregas/hooks/useEntregasData.ts`, update the named import on lines 2–7 by adding `getWorkflowPostsCounts` to the list:

Change this:
```ts
import {
  getWorkflows, getClientes, getMembros, getWorkflowTemplates, getWorkflowEtapas,
  getPortalApprovals, getDeadlineInfo,
  type Workflow, type WorkflowEtapa, type Cliente, type Membro,
  type WorkflowTemplate, type PortalApproval, type PostMedia,
} from '../../../store';
```

To this:
```ts
import {
  getWorkflows, getClientes, getMembros, getWorkflowTemplates, getWorkflowEtapas,
  getPortalApprovals, getDeadlineInfo, getWorkflowPostsCounts,
  type Workflow, type WorkflowEtapa, type Cliente, type Membro,
  type WorkflowTemplate, type PortalApproval, type PostMedia,
} from '../../../store';
```

- [ ] **Step 2: Add the `workflow-posts-counts` query**

Locate the `workflow-covers` query at lines 132–137 of `useEntregasData.ts`:

```ts
  const activeWorkflowIds = activeWorkflows.map(w => w.id!).filter(Boolean);
  const { data: covers } = useQuery({
    queryKey: ['workflow-covers', activeWorkflowIds.join(',')],
    queryFn: () => getWorkflowCovers(activeWorkflowIds),
    enabled: activeWorkflowIds.length > 0,
  });
```

Immediately after line 137 (the closing `});` of the `covers` query) insert:

```ts
  const { data: postsCountsData } = useQuery({
    queryKey: ['workflow-posts-counts', activeWorkflowIds.join(',')],
    queryFn: () => getWorkflowPostsCounts(activeWorkflowIds),
    enabled: activeWorkflowIds.length > 0,
  });
  const postsCounts: Map<number, number> = postsCountsData ?? new Map();
```

- [ ] **Step 3: Invalidate the query inside `refresh()`**

Locate the `refresh` function at lines 166–172:

```ts
  function refresh() {
    qc.invalidateQueries({ queryKey: ['workflows'] });
    qc.invalidateQueries({ queryKey: ['workflow-templates'] });
    qc.invalidateQueries({ queryKey: ['all-active-etapas'] });
    qc.invalidateQueries({ queryKey: ['portal-approvals'] });
    qc.invalidateQueries({ queryKey: ['workflow-covers'] });
  }
```

Add one more invalidation as the last line inside the function body:

```ts
  function refresh() {
    qc.invalidateQueries({ queryKey: ['workflows'] });
    qc.invalidateQueries({ queryKey: ['workflow-templates'] });
    qc.invalidateQueries({ queryKey: ['all-active-etapas'] });
    qc.invalidateQueries({ queryKey: ['portal-approvals'] });
    qc.invalidateQueries({ queryKey: ['workflow-covers'] });
    qc.invalidateQueries({ queryKey: ['workflow-posts-counts'] });
  }
```

- [ ] **Step 4: Add `postsCounts` to the hook's return value**

Locate the return statement at lines 176–187 and add `postsCounts` to the returned object, right after `cards`:

```ts
  return {
    workflows,
    activeWorkflows,
    clientes,
    membros,
    templates,
    etapasMap,
    cards,
    postsCounts,
    portalApprovals,
    isLoading,
    refresh,
  };
```

- [ ] **Step 5: Typecheck**

Run: `npm run build`
Expected: Build succeeds with no TypeScript errors. (`npm run build` runs `tsc` first, then Vite.)

- [ ] **Step 6: Commit**

```bash
git add apps/crm/src/pages/entregas/hooks/useEntregasData.ts
git commit -m "feat(entregas): expose postsCounts from useEntregasData"
```

---

## Task 3: Thread `postsCounts` through `EntregasPage` → `KanbanView`

**Files:**
- Modify: `apps/crm/src/pages/entregas/EntregasPage.tsx`
- Modify: `apps/crm/src/pages/entregas/views/KanbanView.tsx`

- [ ] **Step 1: Destructure `postsCounts` in `EntregasPage`**

In `apps/crm/src/pages/entregas/EntregasPage.tsx` at line 42:

Change this:
```ts
  const { clientes, membros, templates, cards, activeWorkflows, isLoading, refresh } = useEntregasData();
```

To this:
```ts
  const { clientes, membros, templates, cards, activeWorkflows, isLoading, refresh, postsCounts } = useEntregasData();
```

- [ ] **Step 2: Pass `postsCounts` to `<KanbanView>`**

In `EntregasPage.tsx` at the `<KanbanView>` JSX (lines 143–153):

Change this:
```tsx
      {activeView === 'kanban' && (
        <KanbanView
          cards={filteredCards}
          onCardClick={setEditCard}
          onPostsClick={setDrawerCard}
          onRefresh={refresh}
          onRecurring={setRecurringWfId}
          membros={membros}
          templates={templates}
        />
      )}
```

To this:
```tsx
      {activeView === 'kanban' && (
        <KanbanView
          cards={filteredCards}
          onCardClick={setEditCard}
          onPostsClick={setDrawerCard}
          onRefresh={refresh}
          onRecurring={setRecurringWfId}
          membros={membros}
          templates={templates}
          postsCounts={postsCounts}
        />
      )}
```

- [ ] **Step 3: Add `postsCounts` to `KanbanViewProps`**

In `apps/crm/src/pages/entregas/views/KanbanView.tsx` at lines 16–24:

Change this:
```ts
interface KanbanViewProps {
  cards: BoardCard[];
  onCardClick: (card: BoardCard) => void;
  onPostsClick: (card: BoardCard) => void;
  onRefresh: () => void;
  onRecurring: (workflowId: number) => void;
  membros: Membro[];
  templates: WorkflowTemplate[];
}
```

To this:
```ts
interface KanbanViewProps {
  cards: BoardCard[];
  onCardClick: (card: BoardCard) => void;
  onPostsClick: (card: BoardCard) => void;
  onRefresh: () => void;
  onRecurring: (workflowId: number) => void;
  membros: Membro[];
  templates: WorkflowTemplate[];
  postsCounts: Map<number, number>;
}
```

- [ ] **Step 4: Thread `postsCount` into `SortableCard`**

In `KanbanView.tsx` update `SortableCard` (lines 78–102). Add `postsCount` to its props and pass it to `<WorkflowCard>`:

Change this:
```tsx
function SortableCard({ card, onCardClick, onPostsClick, membros, onRefresh, onRevertClick, onForwardClick }: { card: BoardCard; onCardClick: (c: BoardCard) => void; onPostsClick: (c: BoardCard) => void; membros: Membro[]; onRefresh: () => void; onRevertClick: () => void; onForwardClick: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: String(card.workflow.id),
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
    position: 'relative' as const,
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      <WorkflowCard
        card={card}
        onClick={() => onCardClick(card)}
        onPostsClick={() => onPostsClick(card)}
        dragHandle={<GripVertical className="h-4 w-4" {...listeners} />}
        membros={membros}
        onRefresh={onRefresh}
        onRevertClick={onRevertClick}
        onForwardClick={onForwardClick}
      />
    </div>
  );
}
```

To this:
```tsx
function SortableCard({ card, onCardClick, onPostsClick, membros, onRefresh, onRevertClick, onForwardClick, postsCount }: { card: BoardCard; onCardClick: (c: BoardCard) => void; onPostsClick: (c: BoardCard) => void; membros: Membro[]; onRefresh: () => void; onRevertClick: () => void; onForwardClick: () => void; postsCount: number }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: String(card.workflow.id),
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
    position: 'relative' as const,
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      <WorkflowCard
        card={card}
        onClick={() => onCardClick(card)}
        onPostsClick={() => onPostsClick(card)}
        dragHandle={<GripVertical className="h-4 w-4" {...listeners} />}
        membros={membros}
        onRefresh={onRefresh}
        onRevertClick={onRevertClick}
        onForwardClick={onForwardClick}
        postsCount={postsCount}
      />
    </div>
  );
}
```

- [ ] **Step 5: Destructure `postsCounts` in the `KanbanView` function signature**

In `KanbanView.tsx` at line 107:

Change this:
```tsx
export function KanbanView({ cards, onCardClick, onPostsClick, onRefresh, onRecurring, membros, templates }: KanbanViewProps) {
```

To this:
```tsx
export function KanbanView({ cards, onCardClick, onPostsClick, onRefresh, onRecurring, membros, templates, postsCounts }: KanbanViewProps) {
```

- [ ] **Step 6: Pass `postsCount` to each `<SortableCard>`**

In `KanbanView.tsx` update the `<SortableCard>` rendered inside the column loop (lines 325–335):

Change this:
```tsx
                          : stepCards.map(card => (
                            <SortableCard
                              key={card.workflow.id}
                              card={card}
                              onCardClick={onCardClick}
                              onPostsClick={onPostsClick}
                              membros={membros}
                              onRefresh={onRefresh}
                              onRevertClick={() => setRevertTarget({ workflowId: card.workflow.id!, title: card.workflow.titulo })}
                              onForwardClick={() => handleForwardCard(card)}
                            />
                          ))
```

To this:
```tsx
                          : stepCards.map(card => (
                            <SortableCard
                              key={card.workflow.id}
                              card={card}
                              onCardClick={onCardClick}
                              onPostsClick={onPostsClick}
                              membros={membros}
                              onRefresh={onRefresh}
                              onRevertClick={() => setRevertTarget({ workflowId: card.workflow.id!, title: card.workflow.titulo })}
                              onForwardClick={() => handleForwardCard(card)}
                              postsCount={postsCounts.get(card.workflow.id!) ?? 0}
                            />
                          ))
```

- [ ] **Step 7: Pass `postsCount` to the `<DragOverlay>`'s `WorkflowCard`**

In `KanbanView.tsx` at line 347:

Change this:
```tsx
        <DragOverlay>
          {activeCard && <WorkflowCard card={activeCard} isDragOverlay />}
        </DragOverlay>
```

To this:
```tsx
        <DragOverlay>
          {activeCard && (
            <WorkflowCard
              card={activeCard}
              isDragOverlay
              postsCount={postsCounts.get(activeCard.workflow.id!) ?? 0}
            />
          )}
        </DragOverlay>
```

- [ ] **Step 8: Typecheck**

Run: `npm run build`
Expected: Build succeeds with no TypeScript errors.

- [ ] **Step 9: Commit**

```bash
git add apps/crm/src/pages/entregas/EntregasPage.tsx apps/crm/src/pages/entregas/views/KanbanView.tsx
git commit -m "feat(entregas): thread postsCount into KanbanView cards"
```

---

## Task 4: Invalidate `workflow-posts-counts` from `WorkflowDrawer`

**Files:**
- Modify: `apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx`

Context: The drawer already invalidates `['workflow-posts-with-props', workflowId]` in its `refresh()` callback (line 107–111) and after a drag-and-drop reorder (line 127). Post add/delete go through `refresh()`, so only the `refresh()` callback needs the new invalidation — the reorder path doesn't change counts.

- [ ] **Step 1: Add the invalidation to `refresh()`**

In `apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx` at lines 107–111:

Change this:
```ts
  const refresh = useCallback(() => {
    setLocalOrder(null);
    qc.invalidateQueries({ queryKey: ['workflow-posts-with-props', workflowId] });
    qc.invalidateQueries({ queryKey: ['post-approvals'] });
  }, [qc, workflowId]);
```

To this:
```ts
  const refresh = useCallback(() => {
    setLocalOrder(null);
    qc.invalidateQueries({ queryKey: ['workflow-posts-with-props', workflowId] });
    qc.invalidateQueries({ queryKey: ['post-approvals'] });
    qc.invalidateQueries({ queryKey: ['workflow-posts-counts'] });
  }, [qc, workflowId]);
```

- [ ] **Step 2: Typecheck**

Run: `npm run build`
Expected: Build succeeds with no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx
git commit -m "feat(entregas): invalidate posts-counts from drawer mutations"
```

---

## Task 5: Manual verification

No code changes — this task confirms the feature works end-to-end before opening the PR. Use the `sm-crm-staging` project against staging data (or local Supabase with seeded posts).

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`
Expected: CRM boots on http://localhost:5173 with no console errors.

- [ ] **Step 2: Navigate to Entregas Kanban**

In the browser, log in and go to `/entregas`. Confirm the Kanban view is selected by default.

- [ ] **Step 3: Verify badges render on workflows with posts**

Expected: Every workflow card whose workflow has ≥ 1 post shows a small yellow circular badge on the upper-right of the "Posts" button with the correct count. Workflows with 0 posts show no badge (existing `postsCount > 0` guard in [WorkflowCard.tsx:427-429](../../../apps/crm/src/pages/entregas/components/WorkflowCard.tsx#L427-L429)).

- [ ] **Step 4: Verify live update on post add**

Click a workflow's "Posts" button to open the drawer. Click "Novo Post". Close the drawer.
Expected: The badge on the card updates to the new total (+1) within a second. No full page reload.

- [ ] **Step 5: Verify live update on post delete**

Open the drawer again. Delete a post (trash icon + confirm). Close the drawer.
Expected: The badge count decreases by 1.

- [ ] **Step 6: Verify drag-and-drop preserves the badge**

Drag a card to an adjacent column (forward). During the drag, confirm the `DragOverlay` card still shows the badge. After the drop completes and the board refreshes, confirm the badge count remains correct on the moved card.

- [ ] **Step 7: Verify network cost**

Open DevTools → Network tab, filter by `workflow_posts`. Reload `/entregas`.
Expected: Exactly ONE request per page load that selects from `workflow_posts` with the `in=(...)` filter carrying all active workflow IDs, not one per card.

- [ ] **Step 8: No commit required**

This is a verification-only task.

---

## Task 6: Optional — extend `useEntregasData.test.ts` with a `postsCounts` shape assertion

The spec says automated tests are optional. Skip this task if Task 5 passes — the function is already covered by Task 1's unit tests and by the manual check in Task 5.

If you still want the extra safety net:

**Files:**
- Modify: `apps/crm/src/pages/entregas/hooks/__tests__/useEntregasData.test.ts`

- [ ] **Step 1: (Optional) Add a type-level export assertion**

This file only tests pure helpers (no React rendering, no query client). A lightweight check that `postsCounts` is part of the hook's return type is enough:

Append this at the very end of the file:

```ts
describe('useEntregasData return shape', () => {
  it('typechecks postsCounts as Map<number, number>', () => {
    // Compile-time-only assertion: if the hook's return type ever loses
    // `postsCounts: Map<number, number>`, this line will fail to typecheck
    // during `npm run build`.
    type Hook = ReturnType<typeof import('../useEntregasData').useEntregasData>;
    const _check: Map<number, number> | undefined = undefined as unknown as Hook['postsCounts'];
    expect(_check).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run apps/crm/src/pages/entregas/hooks/__tests__/useEntregasData.test.ts`
Expected: All existing tests still pass; the new one passes.

- [ ] **Step 3: Commit (only if you did Step 1)**

```bash
git add apps/crm/src/pages/entregas/hooks/__tests__/useEntregasData.test.ts
git commit -m "test(entregas): assert useEntregasData exposes postsCounts"
```

---

## Task 7: Open the PR

- [ ] **Step 1: Push the branch**

```bash
git push -u origin HEAD
```

- [ ] **Step 2: Create the PR**

Run:
```bash
gh pr create --title "feat(entregas): show posts count on workflow cards" --body "$(cat <<'EOF'
## Summary
- Wire the `postsCount` prop on `WorkflowCard` end-to-end so the Entregas Kanban shows the total post count on each card's "Posts" button.
- Add bulk `getWorkflowPostsCounts` store function (one DB round-trip for all active workflows) and invalidate it from `WorkflowDrawer` on post add/delete.

## Test plan
- [ ] `/entregas` Kanban: workflows with ≥ 1 post show a badge; 0-post workflows show none.
- [ ] Adding/deleting a post in the drawer updates the badge count without a page reload.
- [ ] Drag-and-drop: the `DragOverlay` card and the final resting card both show the badge.
- [ ] Network tab: exactly one `workflow_posts` select per page load.
- [ ] `npm run build` passes; `npx vitest run` passes.

Spec: `docs/superpowers/specs/2026-04-18-workflow-card-posts-count-design.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed. Share it with the team for review.
