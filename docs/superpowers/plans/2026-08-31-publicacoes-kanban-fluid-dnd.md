# Publicações Kanban Fluid DnD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Publicações kanban drag-and-drop as fluid as the Fluxos one: while dragging, the hovered column opens a live drop slot at the exact spot the card will land, and after a cross-column drop a temporary "Desfazer" toast reverts the move.

**Architecture:** Two pure resolvers in `postsKanbanDrop.ts` (hover slot + undoable move plan) keep all branching testable without pointer events, mirroring the existing `resolvePostsKanbanDrop`. `PostsKanbanView` wires them into dnd-kit's `onDragOver`/`onDragEnd` and renders the existing `.board-drop-slot` placeholder (same visual as the Fluxos board). The undo path re-uses `useUpdatePostStatus` verbatim, calling it with a captured "backward" vars object via a sonner action toast.

**Tech Stack:** React 19, dnd-kit (`@dnd-kit/core`), TanStack Query, sonner, Vitest.

## Global Constraints

- NO em-dashes (—) in any user-facing copy (house rule; use period/colon/"·").
- All commands run from the worktree root: `/Users/eduardosouza/Projects/sm-crm/.claude/worktrees/independent-posts-outside-flows-7bf38b` (verify with `pwd` and `git branch --show-current` = `claude/independent-posts-outside-flows-7bf38b` before any write).
- Do NOT run `npm ci` or `deno` commands (a dev server is running; node_modules must stay clean).
- `npx tsc -p apps/crm/tsconfig.json --noEmit` currently reports KNOWN false-positive TipTap errors in `ArtigoPage.tsx`, `PostEditor.tsx`, `ReadOnlyTipTap.tsx`, `TextBlockEditor.tsx`, `PostEditorBody.tsx` (node_modules/.deno pollution). Ignore those files only; any other error is real.
- Prettier is enforced: run `npx prettier --write <changed files>` before each commit.
- Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## Background for the implementer

- The Publicações board (`apps/crm/src/pages/entregas/views/PostsKanbanView.tsx`) groups `posts: ActivePost[]` into columns by status via `byStatus` (a `Map<StatusKey, ActivePost[]>` built in input order; the query orders `scheduled_at` asc, nulls last). Cards use `useDraggable`, columns use `useDroppable` with id `` `${COL_PREFIX}${option.key}` ``. Drop handling goes through the pure `resolvePostsKanbanDrop` in `apps/crm/src/pages/entregas/postsKanbanDrop.ts`.
- The Fluxos board (`views/KanbanView.tsx`) is the fluidity reference: it keeps `dropSlot` + `dragHeight` state, computes the slot in `onDragOver`, and renders `<div className="board-drop-slot" style={{ height: dragHeight }} aria-hidden="true" />` inside the column body. The `.board-drop-slot` CSS (style.css:11760) already exists with an entrance animation. Reuse it; do not add CSS.
- Slot position: unlike Fluxos (pointer-following index), the Publicações column has no manual ordering; after a drop the card lands at its query-order position. The slot therefore opens at the TRUE landing index (count of target-column posts that precede the dragged post in the `posts` array), so the card never jumps when the drop settles.
- `LOCKED_STATUSES` columns (agendado/postado/falha_publicacao) never open a slot: the drop would be refused with a toast, so opening space would lie.
- `statusChangeNeedsConfirm` fires only when a post LEAVES `aprovado_interno`/`aprovado_cliente`. The undo path deliberately bypasses the resolver (direct mutate), so undoing back INTO an approved status never re-asks.

---

### Task 1: Live hover slot in the Publicações board

**Files:**
- Modify: `apps/crm/src/pages/entregas/postsKanbanDrop.ts`
- Modify: `apps/crm/src/pages/entregas/views/PostsKanbanView.tsx`
- Test: `apps/crm/src/pages/entregas/__tests__/postsKanbanDrop.test.ts`

**Interfaces:**
- Consumes: `COL_PREFIX`, `StatusRegistry` (`registry.resolve`, `registry.byKey`), `LOCKED_STATUSES`.
- Produces: `resolvePostsKanbanHover({ post, posts, overId, registry }): PostsKanbanHoverSlot | null` with `interface PostsKanbanHoverSlot { key: StatusKey; index: number }` (Task 2 does not depend on it, but the view keeps it wired).

- [ ] **Step 1: Write the failing tests**

Append to `apps/crm/src/pages/entregas/__tests__/postsKanbanDrop.test.ts` (reuse the existing `def`, `makePost`, `buildStatusRegistry`, `customKey`, `COL_PREFIX`, `UUID` helpers already defined at the top of that file; add `resolvePostsKanbanHover` to the existing import from `'../postsKanbanDrop'`):

```ts
describe('resolvePostsKanbanHover', () => {
  const registry = buildStatusRegistry([]);

  it('returns null without a post, without an over target, or over a non-column id', () => {
    const posts = [makePost()];
    expect(
      resolvePostsKanbanHover({ post: undefined, posts, overId: `${COL_PREFIX}revisao_interna`, registry }),
    ).toBeNull();
    expect(resolvePostsKanbanHover({ post: posts[0], posts, overId: undefined, registry })).toBeNull();
    expect(resolvePostsKanbanHover({ post: posts[0], posts, overId: '42', registry })).toBeNull();
  });

  it('returns null over the post’s own column and over unknown or locked columns', () => {
    const post = makePost();
    const posts = [post];
    expect(
      resolvePostsKanbanHover({ post, posts, overId: `${COL_PREFIX}rascunho`, registry }),
    ).toBeNull();
    expect(
      resolvePostsKanbanHover({ post, posts, overId: `${COL_PREFIX}nao_existe`, registry }),
    ).toBeNull();
    expect(
      resolvePostsKanbanHover({ post, posts, overId: `${COL_PREFIX}agendado`, registry }),
    ).toBeNull();
    expect(
      resolvePostsKanbanHover({ post, posts, overId: `${COL_PREFIX}postado`, registry }),
    ).toBeNull();
  });

  it('returns null when the dragged post itself sits in a locked status', () => {
    const post = makePost({ status: 'postado' });
    expect(
      resolvePostsKanbanHover({
        post,
        posts: [post],
        overId: `${COL_PREFIX}rascunho`,
        registry,
      }),
    ).toBeNull();
  });

  it('opens the slot at the true landing index of the target column', () => {
    // Board order: r1, r2 (revisao_interna), dragged (rascunho), r3 (revisao_interna).
    // Landing index in revisao_interna = 2 (r1 and r2 precede the dragged post).
    const dragged = makePost({ id: 10 });
    const posts = [
      makePost({ id: 1, status: 'revisao_interna' }),
      makePost({ id: 2, status: 'revisao_interna' }),
      dragged,
      makePost({ id: 3, status: 'revisao_interna' }),
    ];
    expect(
      resolvePostsKanbanHover({
        post: dragged,
        posts,
        overId: `${COL_PREFIX}revisao_interna`,
        registry,
      }),
    ).toEqual({ key: 'revisao_interna', index: 2 });
  });

  it('opens the slot at index 0 for an empty target column', () => {
    const dragged = makePost({ id: 10 });
    expect(
      resolvePostsKanbanHover({
        post: dragged,
        posts: [dragged],
        overId: `${COL_PREFIX}enviado_cliente`,
        registry,
      }),
    ).toEqual({ key: 'enviado_cliente', index: 0 });
  });

  it('groups by resolved key, so custom-status posts count in their own column, not the canonical one', () => {
    const customRegistry = buildStatusRegistry([def()]);
    const key = customKey(UUID);
    const dragged = makePost({ id: 10, status: 'revisao_interna' });
    const posts = [
      // Custom "Em design" behaves as rascunho but lives in its own column.
      makePost({ id: 1, custom_status_id: UUID, status: 'rascunho' }),
      makePost({ id: 2, status: 'rascunho' }),
      dragged,
    ];
    // Hovering the plain rascunho column: only post 2 belongs to it.
    expect(
      resolvePostsKanbanHover({
        post: dragged,
        posts,
        overId: `${COL_PREFIX}rascunho`,
        registry: customRegistry,
      }),
    ).toEqual({ key: 'rascunho', index: 1 });
    // Hovering the custom column: only post 1 belongs to it.
    expect(
      resolvePostsKanbanHover({
        post: dragged,
        posts,
        overId: `${COL_PREFIX}${key}`,
        registry: customRegistry,
      }),
    ).toEqual({ key, index: 1 });
  });
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `npm run test -- --run apps/crm/src/pages/entregas/__tests__/postsKanbanDrop.test.ts`
Expected: FAIL with `resolvePostsKanbanHover` not exported.

- [ ] **Step 3: Implement the resolver**

Append to `apps/crm/src/pages/entregas/postsKanbanDrop.ts`:

```ts
export interface PostsKanbanHoverSlot {
  key: StatusKey;
  index: number;
}

/**
 * Decides whether the hovered column should open a live drop slot during a
 * drag, and at which index. Pure, like resolvePostsKanbanDrop above.
 *
 * The index is the spot the card will REALLY land at after the drop: the
 * byStatus grouping preserves the order of `posts` (scheduled_at asc, nulls
 * last from the query), so the landing index is the number of target-column
 * posts that precede the dragged post in that same order. Anchoring the slot
 * to the true landing spot, instead of the pointer, means the card never
 * jumps when the optimistic move settles.
 */
export function resolvePostsKanbanHover({
  post,
  posts,
  overId,
  registry,
}: {
  post: ActivePost | undefined;
  /** Full board list, in the exact order the byStatus grouping consumes. */
  posts: ActivePost[];
  overId: string | undefined;
  registry: StatusRegistry;
}): PostsKanbanHoverSlot | null {
  if (!post || !overId || !overId.startsWith(COL_PREFIX)) return null;

  const currentOpt = registry.resolve(post);
  if (LOCKED_STATUSES.has(currentOpt.canonical)) return null;

  const targetKey = overId.slice(COL_PREFIX.length) as StatusKey;
  if (targetKey === currentOpt.key) return null;

  const targetOpt = registry.byKey.get(targetKey);
  // Locked targets refuse the drop with a toast, so opening space would lie.
  if (!targetOpt || LOCKED_STATUSES.has(targetOpt.canonical)) return null;

  const draggedAt = posts.findIndex((p) => p.id === post.id);
  const before = draggedAt === -1 ? posts.length : draggedAt;
  let index = 0;
  for (let i = 0; i < before; i++) {
    const p = posts[i];
    if (p.id !== post.id && registry.resolve(p).key === targetKey) index++;
  }
  return { key: targetKey, index };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -- --run apps/crm/src/pages/entregas/__tests__/postsKanbanDrop.test.ts`
Expected: PASS (all, including the pre-existing `resolvePostsKanbanDrop` suite).

- [ ] **Step 5: Wire the slot into PostsKanbanView**

In `apps/crm/src/pages/entregas/views/PostsKanbanView.tsx`:

5a. Extend the dnd-kit type import (top of file) with `DragOverEvent`:

```ts
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
```

5b. Extend the resolver import:

```ts
import {
  COL_PREFIX,
  resolvePostsKanbanDrop,
  resolvePostsKanbanHover,
  type PostsKanbanHoverSlot,
} from '../postsKanbanDrop';
```

5c. In the `PostsKanbanView` component body, next to the existing `activeId` state, add:

```ts
const [dropSlot, setDropSlot] = useState<PostsKanbanHoverSlot | null>(null);
const [dragHeight, setDragHeight] = useState(120);
```

5d. Replace `handleDragStart` and add `handleDragOver`; clear the slot in `handleDragEnd` and in the existing inline `onDragCancel`:

```ts
const handleDragStart = (event: DragStartEvent) => {
  setActiveId(Number(event.active.id));
  setDragHeight(event.active.rect.current?.initial?.height ?? 120);
};

const handleDragOver = (event: DragOverEvent) => {
  const { active, over } = event;
  const slot = resolvePostsKanbanHover({
    post: posts.find((p) => p.id === Number(active.id)),
    posts,
    overId: over ? String(over.id) : undefined,
    registry,
  });
  // Identity-stable update so hovering in place never re-renders the board.
  setDropSlot((prev) =>
    prev && slot && prev.key === slot.key && prev.index === slot.index ? prev : slot,
  );
};
```

In `handleDragEnd`, add `setDropSlot(null);` right after `setActiveId(null);`. Change the `DndContext` props:

```tsx
<DndContext
  sensors={sensors}
  onDragStart={handleDragStart}
  onDragOver={handleDragOver}
  onDragEnd={handleDragEnd}
  onDragCancel={() => {
    setActiveId(null);
    setDropSlot(null);
  }}
>
```

5e. Pass the slot down to each column (inside the `registry.options.map`):

```tsx
<PostBoardColumn
  key={option.key}
  option={option}
  posts={byStatus.get(option.key) ?? []}
  registry={registry}
  openableWorkflowIds={openableWorkflowIds}
  onPostClick={onPostClick}
  cardsByWorkflowId={cardsByWorkflowId}
  isDragActive={activeId != null}
  dropSlot={dropSlot?.key === option.key ? dropSlot : null}
  dragHeight={dragHeight}
/>
```

5f. In `PostBoardColumn`, add the two props to the signature and type:

```ts
function PostBoardColumn({
  option,
  posts,
  registry,
  openableWorkflowIds,
  onPostClick,
  cardsByWorkflowId,
  isDragActive,
  dropSlot,
  dragHeight,
}: {
  option: StatusOption;
  posts: ActivePost[];
  registry: StatusRegistry;
  openableWorkflowIds: Set<number>;
  onPostClick: (post: ActivePost) => void;
  cardsByWorkflowId: Map<number, BoardCard>;
  isDragActive: boolean;
  /** Slot for THIS column only; null when the drag hovers elsewhere. */
  dropSlot: PostsKanbanHoverSlot | null;
  dragHeight: number;
}) {
```

5g. Replace the column body contents (the `posts.length === 0 ? ... : posts.map(...)` block) with a slot-aware render. Keep the existing `PostBoardCard` element EXACTLY as it is today; only the wrapping changes:

```tsx
<div
  ref={setNodeRef}
  className="board-column-body"
  style={tint ? { background: `${tint}0a` } : undefined}
>
  {posts.length === 0 && dropSlot == null ? (
    <div className="board-empty">Nenhum post</div>
  ) : (
    <>
      {posts.map((p, idx) => (
        <Fragment key={p.id}>
          {dropSlot != null && dropSlot.index === idx && (
            <div className="board-drop-slot" style={{ height: dragHeight }} aria-hidden="true" />
          )}
          <PostBoardCard
            post={p}
            registry={registry}
            card={p.workflow_id != null ? cardsByWorkflowId.get(p.workflow_id) : undefined}
            openable={isPostOpenable(p, openableWorkflowIds)}
            onPostClick={onPostClick}
          />
        </Fragment>
      ))}
      {dropSlot != null && dropSlot.index >= posts.length && (
        <div className="board-drop-slot" style={{ height: dragHeight }} aria-hidden="true" />
      )}
    </>
  )}
</div>
```

Note: `PostBoardCard` previously used `key={p.id}` on itself; the key moves to the `Fragment`. Add `Fragment` to the React import at the top of the file: `import { Fragment, useMemo, useState } from 'react';`

- [ ] **Step 6: Run the full related suites and gates**

Run: `npm run test -- --run apps/crm/src/pages/entregas/views/__tests__/PostsKanbanView.test.tsx apps/crm/src/pages/entregas/__tests__/postsKanbanDrop.test.ts`
Expected: PASS.

Run: `npx prettier --write apps/crm/src/pages/entregas/postsKanbanDrop.ts apps/crm/src/pages/entregas/views/PostsKanbanView.tsx apps/crm/src/pages/entregas/__tests__/postsKanbanDrop.test.ts && npx eslint apps/crm/src/pages/entregas/postsKanbanDrop.ts apps/crm/src/pages/entregas/views/PostsKanbanView.tsx --quiet && npx tsc -p apps/crm/tsconfig.json --noEmit 2>&1 | grep -E "error TS" | grep -v -E "ArtigoPage|PostEditor\.tsx|ReadOnlyTipTap|TextBlockEditor|PostEditorBody"; true`
Expected: prettier and eslint clean; the tsc grep prints nothing.

- [ ] **Step 7: Commit**

```bash
git add apps/crm/src/pages/entregas/postsKanbanDrop.ts apps/crm/src/pages/entregas/views/PostsKanbanView.tsx apps/crm/src/pages/entregas/__tests__/postsKanbanDrop.test.ts
git commit -m "feat(entregas): slot de drop ao vivo no kanban de Publicacoes

Ao arrastar um card sobre outra coluna valida, ela abre um espaco na
posicao REAL de pouso (ordem da query preservada pelo byStatus), com a
altura do card arrastado; colunas travadas e a coluna atual nao abrem.
Resolver puro resolvePostsKanbanHover testado sem eventos de pointer.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Temporary "Desfazer" after a drag move

**Files:**
- Modify: `apps/crm/src/pages/entregas/postsKanbanDrop.ts`
- Modify: `apps/crm/src/pages/entregas/views/PostsKanbanView.tsx`
- Test: `apps/crm/src/pages/entregas/__tests__/postsKanbanDrop.test.ts`

**Interfaces:**
- Consumes: `UpdatePostStatusVars` from `apps/crm/src/pages/entregas/hooks/useUpdatePostStatus.ts` (type-only import), `StatusRegistry`.
- Produces: `buildUndoableStatusMove({ post, key, registry }): UndoableStatusMove | null` with `interface UndoableStatusMove { forward: UpdatePostStatusVars; backward: UpdatePostStatusVars; targetLabel: string }`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/crm/src/pages/entregas/__tests__/postsKanbanDrop.test.ts` (add `buildUndoableStatusMove` to the import from `'../postsKanbanDrop'`):

```ts
describe('buildUndoableStatusMove', () => {
  const registry = buildStatusRegistry([]);

  it('captures forward and backward vars for a canonical-to-canonical move', () => {
    const post = makePost({ id: 7, workflow_id: 33, status: 'rascunho' });
    expect(buildUndoableStatusMove({ post, key: 'revisao_interna', registry })).toEqual({
      forward: { id: 7, workflowId: 33, key: 'revisao_interna', canonical: 'revisao_interna' },
      backward: { id: 7, workflowId: 33, key: 'rascunho', canonical: 'rascunho' },
      targetLabel: 'Em revisão',
    });
  });

  it('round-trips a custom status: backward restores the custom pointer, not the canonical', () => {
    const customRegistry = buildStatusRegistry([def()]);
    const key = customKey(UUID);
    const post = makePost({ id: 7, workflow_id: null, custom_status_id: UUID, status: 'rascunho' });
    const move = buildUndoableStatusMove({ post, key: 'enviado_cliente', registry: customRegistry });
    expect(move).toEqual({
      forward: { id: 7, workflowId: null, key: 'enviado_cliente', canonical: 'enviado_cliente' },
      backward: { id: 7, workflowId: null, key, canonical: 'rascunho' },
      targetLabel: 'Enviado ao cliente',
    });
  });

  it('targets a custom column with its behaves_as canonical in the forward patch', () => {
    const customRegistry = buildStatusRegistry([def()]);
    const key = customKey(UUID);
    const post = makePost({ id: 7, status: 'revisao_interna' });
    const move = buildUndoableStatusMove({ post, key, registry: customRegistry });
    expect(move?.forward).toEqual({ id: 7, workflowId: 10, key, canonical: 'rascunho' });
    expect(move?.targetLabel).toBe('Em design');
  });

  it('returns null for an unknown target key', () => {
    expect(
      buildUndoableStatusMove({ post: makePost(), key: 'custom:nope' as never, registry }),
    ).toBeNull();
  });
});
```

Note for the test expectations: check the real registry labels first (`registry.byKey.get('revisao_interna')?.label` etc. in `statusRegistry.ts`). If the canonical labels differ from `'Em revisão'` / `'Enviado ao cliente'`, use the registry's actual strings in the assertions; the label plumbs straight through.

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `npm run test -- --run apps/crm/src/pages/entregas/__tests__/postsKanbanDrop.test.ts`
Expected: FAIL with `buildUndoableStatusMove` not exported.

- [ ] **Step 3: Implement the move builder**

Append to `apps/crm/src/pages/entregas/postsKanbanDrop.ts` (type-only import at the top of the file):

```ts
import type { UpdatePostStatusVars } from './hooks/useUpdatePostStatus';
```

```ts
export interface UndoableStatusMove {
  forward: UpdatePostStatusVars;
  backward: UpdatePostStatusVars;
  targetLabel: string;
}

/**
 * Snapshots a drag-initiated status change as a forward/backward pair, so the
 * caller can offer a temporary undo. backward restores the RESOLVED current
 * key (custom pointer included), and by design skips resolvePostsKanbanDrop:
 * undoing back into an approved status must not re-open the confirm dialog.
 */
export function buildUndoableStatusMove({
  post,
  key,
  registry,
}: {
  post: ActivePost;
  key: StatusKey;
  registry: StatusRegistry;
}): UndoableStatusMove | null {
  const target = registry.byKey.get(key);
  if (!target) return null;
  const prev = registry.resolve(post);
  return {
    forward: { id: post.id, workflowId: post.workflow_id, key, canonical: target.canonical },
    backward: {
      id: post.id,
      workflowId: post.workflow_id,
      key: prev.key,
      canonical: prev.canonical,
    },
    targetLabel: target.label,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -- --run apps/crm/src/pages/entregas/__tests__/postsKanbanDrop.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the undo toast into PostsKanbanView**

In `apps/crm/src/pages/entregas/views/PostsKanbanView.tsx`, add `buildUndoableStatusMove` to the import from `'../postsKanbanDrop'`, then replace the existing `applyStatusChange` helper with:

```ts
/** Drag-initiated status change with a temporary undo. The backward mutate
 *  deliberately skips the drop resolver: restoring an approved status must
 *  not re-open the confirm dialog. */
const applyStatusChange = (post: ActivePost, key: StatusKey) => {
  const move = buildUndoableStatusMove({ post, key, registry });
  if (!move) return;
  updateStatus.mutate(move.forward);
  toast(`Post movido para "${move.targetLabel}".`, {
    duration: 6000,
    action: {
      label: 'Desfazer',
      onClick: () => updateStatus.mutate(move.backward),
    },
  });
};
```

Keep the call sites (`handleDragEnd`'s `'write'` branch and `handleConfirmStatusChange`) untouched; they already call `applyStatusChange`.

Known, accepted race (do not "fix"): if the forward write fails, `useUpdatePostStatus` already rolls back and toasts the error; the undo toast may still be visible, and clicking Desfazer then writes the post's current status back onto itself, a harmless no-op write.

- [ ] **Step 6: Run the related suites and gates**

Run: `npm run test -- --run apps/crm/src/pages/entregas/views/__tests__/PostsKanbanView.test.tsx apps/crm/src/pages/entregas/__tests__/postsKanbanDrop.test.ts`
Expected: PASS. If a PostsKanbanView test asserts on toast calls after a confirmed status change, update it to the new copy `Post movido para "..."` rather than deleting the assertion.

Run: `npx prettier --write apps/crm/src/pages/entregas/postsKanbanDrop.ts apps/crm/src/pages/entregas/views/PostsKanbanView.tsx apps/crm/src/pages/entregas/__tests__/postsKanbanDrop.test.ts && npx eslint apps/crm/src/pages/entregas/postsKanbanDrop.ts apps/crm/src/pages/entregas/views/PostsKanbanView.tsx --quiet && npx tsc -p apps/crm/tsconfig.json --noEmit 2>&1 | grep -E "error TS" | grep -v -E "ArtigoPage|PostEditor\.tsx|ReadOnlyTipTap|TextBlockEditor|PostEditorBody"; true`
Expected: prettier and eslint clean; the tsc grep prints nothing.

- [ ] **Step 7: Commit**

```bash
git add apps/crm/src/pages/entregas/postsKanbanDrop.ts apps/crm/src/pages/entregas/views/PostsKanbanView.tsx apps/crm/src/pages/entregas/__tests__/postsKanbanDrop.test.ts
git commit -m "feat(entregas): Desfazer temporario apos mover post no kanban

Todo drop que muda status mostra um toast de 6s com acao Desfazer, que
restaura o status anterior (ponteiro custom incluido) sem reabrir o
dialogo de confirmacao; buildUndoableStatusMove captura o par
forward/backward de forma pura e testavel.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Self-review notes

- Spec coverage: live column reaction = Task 1 (slot at true landing index, locked columns excluded); instant/optimistic feel already exists via `useUpdatePostStatus`; temporary undo = Task 2.
- Type consistency: `PostsKanbanHoverSlot` produced in Task 1 and consumed only inside the view; `UndoableStatusMove.forward/backward` match `UpdatePostStatusVars` exactly (`id`, `workflowId`, `key`, `canonical`).
- The `.board-drop-slot` class and its animation already exist in style.css; no CSS task needed.
