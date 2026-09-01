# Publicações Manual Order + Per-Column Sort Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Posts on the Publicações kanban get a persisted manual order (drag to any position, survives reloads) plus a small sort menu at the top of each column (Manual / Data agendada / Mais recentes / Mais antigos, per-column, remembered per workspace).

**Architecture:** A nullable `workflow_posts.board_ordem double precision` column carries the manual rank (Trello-style float midpoints, lazily materialized per column on the first positional drop), written through one conta-scoped SECURITY DEFINER RPC that updates N posts in a single call. All ordering/placement math is pure and lives in a new `postsBoardOrder.ts` module; `PostsKanbanView` swaps `useDraggable` for `useSortable` (mirroring the Fluxos `KanbanView`) so same-column reorder previews via dnd-kit transforms and cross-column drops open the slot at the pointer (manual columns) or at the true landing index (auto-sorted columns).

**Tech Stack:** Postgres (Supabase migration + plpgsql RPC + psql entitlement test), React 19, dnd-kit (`@dnd-kit/core` + `@dnd-kit/sortable`), TanStack Query, sonner, Vitest.

## Global Constraints

- NO em-dashes (—) in any user-facing copy (house rule; use period/colon/"·").
- All commands run from the worktree root: `/Users/eduardosouza/Projects/sm-crm/.claude/worktrees/independent-posts-outside-flows-7bf38b` (verify `pwd` and `git branch --show-current` = `claude/independent-posts-outside-flows-7bf38b` before any write).
- Do NOT run `npm ci`, `deno`, or any `supabase` CLI command (dev server running; the controller applies migrations).
- `npx tsc -p apps/crm/tsconfig.json --noEmit` has KNOWN false-positive TipTap errors in `ArtigoPage.tsx`, `PostEditor.tsx`, `ReadOnlyTipTap.tsx`, `TextBlockEditor.tsx`, `PostEditorBody.tsx` — ignore those files only.
- Prettier before every commit; commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Migration version prefix `20260901000020` is reserved for this plan (origin/main tail is `20260901000012`; this branch's tail is `20260831000010`). Never renumber.
- SQL RPCs follow the house pattern of `20260830000004_post_detach_attach_rpcs.sql`: SECURITY DEFINER, `set search_path = public, pg_temp`, `v_conta := public.get_my_conta_id()`, error style `raise exception 'code_name' using errcode = 'P0001'`, strong `REVOKE ALL ... FROM public, anon` + `GRANT EXECUTE ... TO authenticated, service_role`.

## Background for the implementer

- The board (`apps/crm/src/pages/entregas/views/PostsKanbanView.tsx`) groups `posts: ActivePost[]` into columns via `byStatus` (Map keyed by resolved `StatusKey`). Cards currently use `useDraggable`; columns `useDroppable` (`` `${COL_PREFIX}${option.key}` ``). Cross-column drops go through `resolvePostsKanbanDrop` and an undoable status write (`buildUndoableStatusMove` + `useUpdatePostStatus`); a live slot renders via `resolvePostsKanbanHover` (true landing index). `PostBoardColumn` and `PostBoardCard` are `React.memo`.
- The Fluxos board (`views/KanbanView.tsx`) is the wiring reference for `useSortable` + `SortableContext` per column + slot divs + `arrayMove`.
- `ActivePost` and `POST_CONTEXT_COLUMNS` live in `apps/crm/src/store/posts.ts`. All board queries (`getActivePosts` etc.) select `POST_CONTEXT_COLUMNS`, so the DB column MUST exist in both Supabase projects before the store task deploys; the controller applies the migration between Tasks 1 and 2 — never assume it from inside a task.
- `LOCKED_STATUSES` (agendado/postado/falha_publicacao) columns refuse drops; that does not change.
- `workflow_posts` triggers: the `post_a0_sync_cliente` guard raises only when `workflow_id`/`cliente_id` change; a `board_ordem`-only UPDATE passes. The updated_at touch trigger firing on reorders is accepted.
- localStorage prefs pattern: `apps/crm/src/pages/entregas/entregasPrefs.ts` (try/catch around storage, per-conta keys).

---

### Task 1: Migration `board_ordem` + RPC + psql suite

**Files:**
- Create: `supabase/migrations/20260901000020_workflow_posts_board_ordem.sql`
- Create: `supabase/tests/entitlements/71_board_ordem.sql`

**Interfaces:**
- Produces: column `workflow_posts.board_ordem double precision` (nullable, no default); RPC `public.reorder_board_posts(p_post_ids bigint[], p_ordens double precision[]) returns void` — pairwise update, all-or-nothing conta ownership, NULL elements in `p_ordens` allowed (clears the rank).

- [ ] **Step 1: Write the migration**

`supabase/migrations/20260901000020_workflow_posts_board_ordem.sql`:

```sql
-- Ordem manual do board de Publicacoes.
--
-- board_ordem e um rank fracionario (estilo Trello): NULL = post nunca
-- posicionado manualmente (cai na ordenacao automatica, scheduled_at asc
-- nulls last com desempate por id). O frontend escreve midpoints entre
-- vizinhos e re-materializa a coluna (multiplos de 1024) quando nao ha
-- espaco -- por isso a RPC recebe arrays e atualiza N posts numa chamada.
--
-- Nenhum trigger le esta coluna. O guard post_a0_sync_cliente so dispara
-- quando workflow_id/cliente_id mudam; um UPDATE apenas de board_ordem
-- passa direto. RLS (workspace_posts_all) continua cobrindo escrita direta,
-- mas a RPC e o caminho sancionado por ser atomica para o lote.

alter table workflow_posts add column board_ordem double precision;

create or replace function public.reorder_board_posts(
  p_post_ids bigint[],
  p_ordens double precision[]
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_conta uuid := public.get_my_conta_id();
  v_count int;
begin
  if v_conta is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  if p_post_ids is null or p_ordens is null
     or array_length(p_post_ids, 1) is null
     or array_length(p_post_ids, 1) is distinct from array_length(p_ordens, 1) then
    raise exception 'invalid_arguments' using errcode = 'P0001';
  end if;

  -- Lock em ordem estavel (padrao da casa: FOR UPDATE separado da agregacao).
  perform 1 from workflow_posts
   where id = any(p_post_ids) and conta_id = v_conta
   order by id
   for update;

  -- Posse all-or-nothing. Ids duplicados no array tambem caem aqui: o count
  -- de linhas nunca alcanca array_length com duplicatas.
  select count(*) into v_count
    from workflow_posts
   where id = any(p_post_ids) and conta_id = v_conta;
  if v_count is distinct from array_length(p_post_ids, 1) then
    raise exception 'post_not_found' using errcode = 'P0001';
  end if;

  update workflow_posts wp
     set board_ordem = u.ordem
    from unnest(p_post_ids, p_ordens) as u(id, ordem)
   where wp.id = u.id and wp.conta_id = v_conta;
end;
$$;

revoke all on function public.reorder_board_posts(bigint[], double precision[]) from public, anon;
grant execute on function public.reorder_board_posts(bigint[], double precision[]) to authenticated, service_role;
```

- [ ] **Step 2: Write the psql entitlement suite**

`supabase/tests/entitlements/71_board_ordem.sql` — follow the conventions of `70_workflow_posts_avulsos.sql` (read its helper usage first: `\i supabase/tests/entitlements/_helpers.sql`, how it creates contas/users/posts and switches roles). Cover, in this order:

1. Happy path: as tenant A's authenticated user, `select reorder_board_posts(array[<a1>,<a2>], array[2048, 1024]);` then assert both `board_ordem` values landed (`select board_ordem from workflow_posts where id = <a1>` = 2048, `<a2>` = 1024).
2. NULL element clears: `select reorder_board_posts(array[<a1>], array[null::double precision]);` then assert `board_ordem is null` for `<a1>`.
3. All-or-nothing cross-tenant: as tenant A, calling with `array[<a1>, <b1>]` (one post of tenant B) raises `post_not_found` and does NOT change `<a1>` (assert its board_ordem unchanged after the rollback).
4. Length mismatch raises `invalid_arguments`.
5. ACL pinned: `select has_function_privilege('authenticated', 'public.reorder_board_posts(bigint[], double precision[])', 'execute')` is true; same check for `anon` is false and for `public`... use the role name `'anon'` and the pseudo-role check the 70 suite already uses for its ACL asserts (copy that exact technique).

Use the same assert helper style the 70 file uses (its `do $$ ... assert ... $$` or select-based checks — mirror, don't invent).

- [ ] **Step 3: Sanity-check the SQL parses**

You cannot run a local database (no supabase CLI allowed). Instead run a syntax sanity pass: re-read both files checking for unbalanced `$$`, missing semicolons, and that every `raise exception` carries `using errcode = 'P0001'`. Note in your report that runtime verification is deferred to the controller's staging apply + CI's entitlement job.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260901000020_workflow_posts_board_ordem.sql supabase/tests/entitlements/71_board_ordem.sql
git commit -m "feat(entregas): board_ordem + RPC reorder_board_posts para ordem manual

Rank fracionario nullable em workflow_posts e RPC conta-scoped que grava
N pares (id, ordem) numa chamada, com posse all-or-nothing e ACL forte;
suite psql 71 cobre happy path, NULL, cross-tenant, aridade e ACL.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Store plumbing + pure ordering module

**Files:**
- Modify: `apps/crm/src/store/posts.ts`
- Create: `apps/crm/src/pages/entregas/postsBoardOrder.ts`
- Test: `apps/crm/src/__tests__/store.posts.test.ts` (extend)
- Test: `apps/crm/src/pages/entregas/__tests__/postsBoardOrder.test.ts` (new)

**Interfaces:**
- Consumes: `workflow_posts.board_ordem` (Task 1; the controller has applied it to both databases before this task runs).
- Produces:
  - `ActivePost.board_ordem: number | null` (type + selected column + mapped through).
  - `reorderBoardPosts(updates: { id: number; board_ordem: number | null }[]): Promise<void>` in the store.
  - `postsBoardOrder.ts` exports: `type BoardColumnSort = 'manual' | 'data' | 'recentes' | 'antigos'`, `BOARD_COLUMN_SORTS: BoardColumnSort[]`, `BOARD_COLUMN_SORT_LABELS: Record<BoardColumnSort, string>`, `BOARD_ORDEM_STEP = 1024`, `sortColumnPosts(posts, mode)`, `planBoardPlacement(columnPosts, insertIndex, draggedId)`.

- [ ] **Step 1: Store changes**

In `apps/crm/src/store/posts.ts`:

1a. Append `, board_ordem` to the `POST_CONTEXT_COLUMNS` string (line ~285).

1b. Add to the `ActivePost` interface (find it in the same file): `board_ordem: number | null;` and make sure `mapPostContextRow` carries it through (if the mapper picks fields explicitly, add `board_ordem: row.board_ordem ?? null`; if it spreads, just confirm and note in the report).

1c. Add the store function next to the other post functions:

```ts
/** Grava a ordem manual do board de Publicacoes em lote via RPC (posse
 *  all-or-nothing no servidor). board_ordem null limpa o rank. */
export async function reorderBoardPosts(
  updates: { id: number; board_ordem: number | null }[],
): Promise<void> {
  if (updates.length === 0) return;
  const { error } = await supabase.rpc('reorder_board_posts', {
    p_post_ids: updates.map((u) => u.id),
    p_ordens: updates.map((u) => u.board_ordem),
  });
  if (error) throw error;
}
```

1d. Extend `apps/crm/src/__tests__/store.posts.test.ts` (mirror the existing `__queueSupabaseRpc` usage in that file or in sibling store tests):

```ts
it('reorderBoardPosts calls the RPC with parallel arrays and skips the call for an empty list', async () => {
  mockedSupabase.__queueSupabaseRpc('reorder_board_posts', { data: null, error: null });

  await store.reorderBoardPosts([
    { id: 7, board_ordem: 1024 },
    { id: 9, board_ordem: null },
  ]);
  const call = getCalls('rpc:reorder_board_posts', 'rpc').at(-1)!;
  expect(call.payload).toEqual({ p_post_ids: [7, 9], p_ordens: [1024, null] });

  await store.reorderBoardPosts([]);
  expect(getCalls('rpc:reorder_board_posts', 'rpc')).toHaveLength(1);
});
```

Also update any test fixture in the repo that constructs a full `ActivePost` literal and now fails the type check (`makePost` in `apps/crm/src/pages/entregas/__tests__/postsKanbanDrop.test.ts` and any view-test fixture): add `board_ordem: null`.

- [ ] **Step 2: Write the failing tests for the pure module**

`apps/crm/src/pages/entregas/__tests__/postsBoardOrder.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { ActivePost } from '@/store';
import {
  BOARD_ORDEM_STEP,
  planBoardPlacement,
  sortColumnPosts,
} from '../postsBoardOrder';

function post(id: number, over: Partial<ActivePost> = {}): ActivePost {
  return {
    id,
    workflow_id: 10,
    cliente_id: 1,
    cliente_nome: 'Aurora',
    workflow_titulo: 'Fluxo',
    titulo: `Post ${id}`,
    tipo: 'feed',
    status: 'rascunho',
    custom_status_id: null,
    scheduled_at: null,
    published_at: null,
    ig_caption: null,
    instagram_permalink: null,
    publish_error: null,
    publish_error_code: null,
    ordem: 0,
    responsavel_id: null,
    platform: 'instagram',
    tiktok_publish_status: null,
    tiktok_publish_error: null,
    tiktok_post_url: null,
    instagram_media_id: null,
    ig_trial_strategy: null,
    board_ordem: null,
    ...over,
  };
}

describe('sortColumnPosts', () => {
  it('manual: ranked posts first by board_ordem, unranked tail keeps auto order', () => {
    const posts = [
      post(1),
      post(2, { board_ordem: 2048 }),
      post(3, { scheduled_at: '2026-09-01T10:00:00Z' }),
      post(4, { board_ordem: 1024 }),
    ];
    expect(sortColumnPosts(posts, 'manual').map((p) => p.id)).toEqual([4, 2, 3, 1]);
  });

  it('data: scheduled asc nulls last, tie by id', () => {
    const posts = [
      post(5),
      post(2, { scheduled_at: '2026-09-02T10:00:00Z' }),
      post(9, { scheduled_at: '2026-09-01T10:00:00Z' }),
      post(1),
    ];
    expect(sortColumnPosts(posts, 'data').map((p) => p.id)).toEqual([9, 2, 1, 5]);
  });

  it('recentes: id desc; antigos: id asc', () => {
    const posts = [post(2), post(9), post(5)];
    expect(sortColumnPosts(posts, 'recentes').map((p) => p.id)).toEqual([9, 5, 2]);
    expect(sortColumnPosts(posts, 'antigos').map((p) => p.id)).toEqual([2, 5, 9]);
  });

  it('does not mutate the input array', () => {
    const posts = [post(2), post(1)];
    sortColumnPosts(posts, 'antigos');
    expect(posts.map((p) => p.id)).toEqual([2, 1]);
  });
});

describe('planBoardPlacement', () => {
  it('empty column: single seed rank', () => {
    expect(planBoardPlacement([], 0, 7)).toEqual([{ id: 7, board_ordem: BOARD_ORDEM_STEP }]);
  });

  it('drop at top above a ranked head: rank head - STEP', () => {
    const col = [post(1, { board_ordem: 1024 }), post(2, { board_ordem: 2048 })];
    expect(planBoardPlacement(col, 0, 7)).toEqual([{ id: 7, board_ordem: 0 }]);
  });

  it('drop at bottom below a ranked tail: rank tail + STEP', () => {
    const col = [post(1, { board_ordem: 1024 })];
    expect(planBoardPlacement(col, 1, 7)).toEqual([{ id: 7, board_ordem: 1024 + BOARD_ORDEM_STEP }]);
  });

  it('drop between two ranked neighbors: midpoint', () => {
    const col = [post(1, { board_ordem: 1024 }), post(2, { board_ordem: 2048 })];
    expect(planBoardPlacement(col, 1, 7)).toEqual([{ id: 7, board_ordem: 1536 }]);
  });

  it('unranked neighbor: materializes the whole column with the dragged post inserted', () => {
    const col = [post(1, { board_ordem: 1024 }), post(2)];
    expect(planBoardPlacement(col, 1, 7)).toEqual([
      { id: 1, board_ordem: 1024 },
      { id: 7, board_ordem: 2048 },
      { id: 2, board_ordem: 3072 },
    ]);
  });

  it('exhausted midpoint (adjacent ranks): materializes', () => {
    const col = [post(1, { board_ordem: 1 }), post(2, { board_ordem: 2 })];
    const updates = planBoardPlacement(col, 1, 7);
    expect(updates.map((u) => u.id)).toEqual([1, 7, 2]);
    expect(updates.map((u) => u.board_ordem)).toEqual([1024, 2048, 3072]);
  });
});
```

Note the "drop between adjacent integer ranks" case: `(1 + 2) / 2 = 1.5` IS representable, so that test's premise needs ranks where the midpoint collides. Use `board_ordem: 1` and `board_ordem: 1 + Number.MIN_VALUE`? Too exotic — instead define materialization as triggered when `midpoint <= beforeRank || midpoint >= afterRank` OR when the two ranks are equal. Adjust the test to use equal ranks:

```ts
  it('equal neighbor ranks (degenerate): materializes', () => {
    const col = [post(1, { board_ordem: 5 }), post(2, { board_ordem: 5 })];
    const updates = planBoardPlacement(col, 1, 7);
    expect(updates.map((u) => u.id)).toEqual([1, 7, 2]);
    expect(updates.map((u) => u.board_ordem)).toEqual([1024, 2048, 3072]);
  });
```

(Drop the "exhausted midpoint (adjacent ranks)" variant with ranks 1 and 2 — its midpoint 1.5 is fine and would NOT materialize. Keep only the equal-ranks degenerate test.)

- [ ] **Step 3: Run the new tests to verify they fail**

Run: `npm run test -- --run apps/crm/src/pages/entregas/__tests__/postsBoardOrder.test.ts`
Expected: FAIL (module does not exist).

- [ ] **Step 4: Implement the pure module**

`apps/crm/src/pages/entregas/postsBoardOrder.ts`:

```ts
import type { ActivePost } from '@/store';

/** Sort modes a Publicações column header offers. 'manual' is the default:
 *  board_ordem asc with the never-positioned tail in automatic order. */
export type BoardColumnSort = 'manual' | 'data' | 'recentes' | 'antigos';

export const BOARD_COLUMN_SORTS: BoardColumnSort[] = ['manual', 'data', 'recentes', 'antigos'];

export const BOARD_COLUMN_SORT_LABELS: Record<BoardColumnSort, string> = {
  manual: 'Manual',
  data: 'Data agendada',
  recentes: 'Mais recentes',
  antigos: 'Mais antigos',
};

/** Spacing between materialized ranks; midpoints halve the gap ~50 times
 *  before a re-materialization is needed. */
export const BOARD_ORDEM_STEP = 1024;

/** scheduled_at asc nulls last, tie by id: the same automatic order the
 *  store's merge comparator produces. */
function byAuto(a: ActivePost, b: ActivePost): number {
  if (a.scheduled_at == null && b.scheduled_at == null) return a.id - b.id;
  if (a.scheduled_at == null) return 1;
  if (b.scheduled_at == null) return -1;
  if (a.scheduled_at < b.scheduled_at) return -1;
  if (a.scheduled_at > b.scheduled_at) return 1;
  return a.id - b.id;
}

export function sortColumnPosts(posts: ActivePost[], mode: BoardColumnSort): ActivePost[] {
  const arr = [...posts];
  switch (mode) {
    case 'manual':
      return arr.sort((a, b) => {
        if (a.board_ordem != null && b.board_ordem != null)
          return a.board_ordem - b.board_ordem || byAuto(a, b);
        if (a.board_ordem != null) return -1;
        if (b.board_ordem != null) return 1;
        return byAuto(a, b);
      });
    case 'data':
      return arr.sort(byAuto);
    case 'recentes':
      return arr.sort((a, b) => b.id - a.id);
    case 'antigos':
      return arr.sort((a, b) => a.id - b.id);
  }
}

export interface BoardPlacementUpdate {
  id: number;
  board_ordem: number;
}

/**
 * Ranks to persist so `draggedId` lands at `insertIndex` of a manual column.
 * `columnPosts` is the target column AS RENDERED (manual sort), WITHOUT the
 * dragged post. Single midpoint write when the neighbors allow it; otherwise
 * the whole column re-materializes on a fresh STEP grid (one RPC either way).
 */
export function planBoardPlacement(
  columnPosts: ActivePost[],
  insertIndex: number,
  draggedId: number,
): BoardPlacementUpdate[] {
  if (columnPosts.length === 0) return [{ id: draggedId, board_ordem: BOARD_ORDEM_STEP }];

  const clamped = Math.max(0, Math.min(insertIndex, columnPosts.length));
  const beforeRank = clamped > 0 ? columnPosts[clamped - 1].board_ordem : null;
  const afterRank = clamped < columnPosts.length ? columnPosts[clamped].board_ordem : null;

  if (clamped === 0 && afterRank != null) return [{ id: draggedId, board_ordem: afterRank - BOARD_ORDEM_STEP }];
  if (clamped === columnPosts.length && beforeRank != null)
    return [{ id: draggedId, board_ordem: beforeRank + BOARD_ORDEM_STEP }];
  if (beforeRank != null && afterRank != null) {
    const mid = (beforeRank + afterRank) / 2;
    if (mid > beforeRank && mid < afterRank) return [{ id: draggedId, board_ordem: mid }];
  }

  const ids = columnPosts.map((p) => p.id);
  ids.splice(clamped, 0, draggedId);
  return ids.map((id, i) => ({ id, board_ordem: (i + 1) * BOARD_ORDEM_STEP }));
}
```

- [ ] **Step 5: Run all the new/affected suites**

Run: `npm run test -- --run apps/crm/src/pages/entregas/__tests__/postsBoardOrder.test.ts apps/crm/src/__tests__/store.posts.test.ts apps/crm/src/pages/entregas/__tests__/postsKanbanDrop.test.ts apps/crm/src/pages/entregas/views/__tests__/PostsKanbanView.test.tsx`
Expected: PASS.

- [ ] **Step 6: Gates and commit**

Run prettier/eslint on the touched files and the filtered tsc check (per Global Constraints). Then:

```bash
git add apps/crm/src/store/posts.ts apps/crm/src/pages/entregas/postsBoardOrder.ts apps/crm/src/__tests__/store.posts.test.ts apps/crm/src/pages/entregas/__tests__/postsBoardOrder.test.ts apps/crm/src/pages/entregas/__tests__/postsKanbanDrop.test.ts
git commit -m "feat(entregas): store de board_ordem e modulo puro de ordenacao do board

board_ordem entra no tipo/select/mapper de ActivePost, reorderBoardPosts
chama a RPC em lote, e postsBoardOrder.ts concentra os sorts por coluna
(manual/data/recentes/antigos) e o plano de posicionamento por midpoint
com re-materializacao da coluna quando os ranks esgotam.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

(Include the view fixture files in the `git add` if Step 1d touched more of them.)

---

### Task 3: Sortable cards, pointer slot and persisted placement in PostsKanbanView

**Files:**
- Modify: `apps/crm/src/pages/entregas/views/PostsKanbanView.tsx`
- Modify: `apps/crm/src/pages/entregas/postsKanbanDrop.ts`
- Test: `apps/crm/src/pages/entregas/views/__tests__/PostsKanbanView.test.tsx` (extend)
- Test: `apps/crm/src/pages/entregas/__tests__/postsKanbanDrop.test.ts` (extend)

**Interfaces:**
- Consumes: `sortColumnPosts`, `planBoardPlacement`, `BoardColumnSort` (Task 2); `reorderBoardPosts` from the store; `ACTIVE_POSTS_KEY` from `hooks/useUpdatePostStatus`.
- Produces: `PostsKanbanView` accepts a new optional prop `columnSorts?: Partial<Record<StatusKey, BoardColumnSort>>` — NOT used yet (Task 4 wires the menu); this task keeps every column in `'manual'` by default via an internal state placeholder `columnSortFor(key)` that returns `columnSorts?.[key] ?? 'manual'`. Also extends `UndoableStatusMove` with `previousBoardOrdem: number | null`.

- [ ] **Step 1: Column rendering uses the sorted order**

In `PostsKanbanView`, replace the direct `byStatus.get(option.key) ?? []` per column with a memoized sorted map:

```ts
const sortedByStatus = useMemo(() => {
  const map = new Map<StatusKey, ActivePost[]>();
  for (const [key, list] of byStatus) map.set(key, sortColumnPosts(list, columnSortFor(key)));
  return map;
}, [byStatus, columnSorts]);
```

with `const columnSortFor = (key: StatusKey): BoardColumnSort => columnSorts?.[key] ?? 'manual';` and the new prop `columnSorts` in `PostsKanbanViewProps` (optional). Columns render `sortedByStatus.get(option.key) ?? []`.

- [ ] **Step 2: Cards become sortable (mirror KanbanView)**

In `PostBoardCard`, replace `useDraggable` with `useSortable` (import from `'@dnd-kit/sortable'`), keeping `disabled: locked`, and apply transform/transition like `KanbanView`'s `SortableCard`:

```ts
const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({
  id: String(post.id),
  disabled: locked,
});
```

and on the card div style: `transform: CSS.Transform.toString(transform), transition,` (import `CSS` from `'@dnd-kit/utilities'`), keeping the existing cursor/opacity logic. Wrap each column's cards in a `SortableContext` (import `SortableContext, verticalListSortingStrategy` from `'@dnd-kit/sortable'`) inside `PostBoardColumn`'s body:

```tsx
<SortableContext items={posts.map((p) => String(p.id))} strategy={verticalListSortingStrategy}>
  {/* existing posts.map with Fragment + slot divs stays inside */}
</SortableContext>
```

- [ ] **Step 3: Generalize the hover resolver**

In `postsKanbanDrop.ts`, extend `resolvePostsKanbanHover` so callers can resolve card targets and pointer placement. Replace the current function with:

```ts
export function resolvePostsKanbanHover({
  post,
  posts,
  overId,
  registry,
  columnOf,
  pointer,
}: {
  post: ActivePost | undefined;
  posts: ActivePost[];
  overId: string | undefined;
  registry: StatusRegistry;
  /** Resolves a card id to its column key (sorted view), for over-card hovers. */
  columnOf?: (postId: number) => StatusKey | undefined;
  /** Present when the target column is manually sorted: the pointer-derived
   *  insert index inside that column (computed by the view from rects). */
  pointer?: { index: number };
}): PostsKanbanHoverSlot | null {
  if (!post || !overId) return null;

  const currentOpt = registry.resolve(post);
  if (LOCKED_STATUSES.has(currentOpt.canonical)) return null;

  let targetKey: StatusKey | undefined;
  if (overId.startsWith(COL_PREFIX)) {
    targetKey = overId.slice(COL_PREFIX.length) as StatusKey;
  } else {
    const overPostId = Number(overId);
    targetKey = Number.isNaN(overPostId) ? undefined : columnOf?.(overPostId);
  }
  if (!targetKey || targetKey === currentOpt.key) return null;

  const targetOpt = registry.byKey.get(targetKey);
  if (!targetOpt || LOCKED_STATUSES.has(targetOpt.canonical)) return null;

  if (pointer) return { key: targetKey, index: Math.max(0, pointer.index) };

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

Existing hover tests keep passing (new params optional). Add tests: over-card id resolves the column via `columnOf`; `pointer.index` wins over the landing computation; over-card id with no `columnOf` returns null.

- [ ] **Step 4: View drag handlers**

In `PostsKanbanView`:

4a. Build the lookup maps next to `sortedByStatus`:

```ts
const columnKeyByPostId = useMemo(() => {
  const map = new Map<number, StatusKey>();
  for (const [key, list] of sortedByStatus) for (const p of list) map.set(p.id, key);
  return map;
}, [sortedByStatus]);
```

4b. `handleDragOver` becomes: resolve the target column first; if it equals the source column, `setDropSlot(null)` and return (same-column preview is dnd-kit's sortable transform). For a cross-column target whose sort mode is `'manual'`, compute the pointer index from rects (same math as `KanbanView`'s `handleDragOver`): over a card, before/after by vertical midpoint (`active.rect.current?.translated` top vs `over.rect.top + over.rect.height / 2`), over the column body, `targetList.length`; pass it as `pointer`. For auto-sorted target columns, omit `pointer` (true landing index). The dragged post must be EXCLUDED when computing the over-card index (filter it from the target list first — it never renders there anyway since it is in another column).

```ts
const handleDragOver = (event: DragOverEvent) => {
  const { active, over } = event;
  const draggedId = Number(active.id);
  const dragged = posts.find((p) => p.id === draggedId);
  const overId = over ? String(over.id) : undefined;
  if (!dragged || !overId) {
    setDropSlot(null);
    return;
  }
  const sourceKey = columnKeyByPostId.get(draggedId);
  const targetKey = overId.startsWith(COL_PREFIX)
    ? (overId.slice(COL_PREFIX.length) as StatusKey)
    : columnKeyByPostId.get(Number(overId));
  if (!targetKey || targetKey === sourceKey) {
    setDropSlot(null);
    return;
  }

  let pointer: { index: number } | undefined;
  if (columnSortFor(targetKey) === 'manual') {
    const targetList = (sortedByStatus.get(targetKey) ?? []).filter((p) => p.id !== draggedId);
    let index = targetList.length;
    if (!overId.startsWith(COL_PREFIX)) {
      const overIdx = targetList.findIndex((p) => String(p.id) === overId);
      if (overIdx !== -1) {
        const activeRect = active.rect.current?.translated;
        const after = activeRect != null && over != null && activeRect.top > over.rect.top + over.rect.height / 2;
        index = after ? overIdx + 1 : overIdx;
      }
    }
    pointer = { index };
  }

  const slot = resolvePostsKanbanHover({
    post: dragged,
    posts,
    overId,
    registry,
    columnOf: (id) => columnKeyByPostId.get(id),
    pointer,
  });
  setDropSlot((prev) =>
    prev && slot && prev.key === slot.key && prev.index === slot.index ? prev : slot,
  );
};
```

4c. `handleDragEnd` gains placement. Structure:

```ts
const handleDragEnd = (event: DragEndEvent) => {
  const slotAtDrop = dropSlot;
  setActiveId(null);
  setDropSlot(null);
  const { active, over } = event;
  const draggedId = Number(active.id);
  const dragged = posts.find((p) => p.id === draggedId);
  if (!dragged || !over) return;
  const overId = String(over.id);
  const sourceKey = columnKeyByPostId.get(draggedId);
  const targetKey = overId.startsWith(COL_PREFIX)
    ? (overId.slice(COL_PREFIX.length) as StatusKey)
    : columnKeyByPostId.get(Number(overId));
  if (!targetKey || !sourceKey) return;

  // Same-column drop: pure manual reorder, no status change, no undo toast.
  if (targetKey === sourceKey) {
    if (columnSortFor(sourceKey) !== 'manual') return;
    const list = sortedByStatus.get(sourceKey) ?? [];
    const from = list.findIndex((p) => p.id === draggedId);
    const to = overId.startsWith(COL_PREFIX)
      ? list.length - 1
      : list.findIndex((p) => String(p.id) === overId);
    if (from === -1 || to === -1 || from === to) return;
    const without = list.filter((p) => p.id !== draggedId);
    persistPlacement(planBoardPlacement(without, to > from ? to : to, draggedId));
    return;
  }

  // Cross-column: existing status-change flow, then placement if manual.
  const result = resolvePostsKanbanDrop({ post: dragged, overId: `${COL_PREFIX}${targetKey}`, registry });
  const placeAfter = () => {
    if (columnSortFor(targetKey) !== 'manual') return;
    const targetList = (sortedByStatus.get(targetKey) ?? []).filter((p) => p.id !== draggedId);
    const index = slotAtDrop?.key === targetKey ? slotAtDrop.index : targetList.length;
    persistPlacement(planBoardPlacement(targetList, index, draggedId));
  };
  switch (result.kind) {
    case 'noop':
    case 'invalid':
      return;
    case 'locked-column':
      toast.error(result.message);
      return;
    case 'confirm':
      setPendingConfirm({ post: dragged, key: result.key, place: placeAfter });
      return;
    case 'write':
      applyStatusChange(dragged, result.key, placeAfter);
      return;
  }
};
```

Notes for the same-column `to` computation: when dropping ON a card, dnd-kit sortable semantics land the dragged card at that card's index (arrayMove style); compute `to` as the over card's index in the FULL list, then plan placement against the `without` list at index `to` (clamp inside `planBoardPlacement` handles the tail). Do not over-polish: exact-index parity with dnd-kit's preview is acceptable within one position.

4d. Placement persistence helper (inside the component):

```ts
const persistPlacement = (updates: BoardPlacementUpdate[]) => {
  if (updates.length === 0) return;
  // Otimista: a ordem nova aparece imediatamente no cache que alimenta o board.
  qc.setQueryData<ActivePost[]>(ACTIVE_POSTS_KEY, (old) => {
    if (!old) return old;
    const byId = new Map(updates.map((u) => [u.id, u.board_ordem]));
    return old.map((p) => (byId.has(p.id) ? { ...p, board_ordem: byId.get(p.id)! } : p));
  });
  reorderBoardPosts(updates).catch(() => {
    toast.error('Erro ao salvar a ordem');
    qc.invalidateQueries({ queryKey: ACTIVE_POSTS_KEY });
  });
};
```

(`qc` already exists from the undo guard; import `reorderBoardPosts` from `'@/store'` — confirm it is re-exported by the store barrel like the other post functions, and add it to the barrel if not.)

4e. `pendingConfirm` state type gains the optional `place` callback: `{ post: ActivePost; key: StatusKey; place?: () => void }`; `handleConfirmStatusChange` calls `applyStatusChange(post, key, place)` after closing.

4f. `applyStatusChange(post, key, place?: () => void)` runs the existing undoable flow and then `place?.()`. The undo must ALSO restore the previous rank: extend `UndoableStatusMove` in `postsKanbanDrop.ts` with `previousBoardOrdem: number | null` (set from `post.board_ordem` in `buildUndoableStatusMove`), and in the undo `onClick` (fresh-guard branch), after `updateStatus.mutate(move.backward)`, also call `persistPlacement`-style restore: `qc.setQueryData` patch + `reorderBoardPosts([{ id: move.forward.id, board_ordem: move.previousBoardOrdem }])` (fire-and-forget with the same catch/toast). Update the `buildUndoableStatusMove` tests for the new field.

- [ ] **Step 5: Tests**

Extend `PostsKanbanView.test.tsx` (drive `dndHandlers` like the existing drag tests; mock `reorderBoardPosts` via the store mock the file already uses for other store calls — follow its existing `vi.mock('@/store', ...)` or spy pattern):

1. Cross-column drop into a manual column calls the status mutation AND `reorderBoardPosts` with the placement from the slot index (drag over the column body of an empty `revisao_interna`: expect `[{ id: <dragged>, board_ordem: 1024 }]`).
2. Same-column drop (over another card) calls ONLY `reorderBoardPosts` (no status mutation, no undo toast).
3. Undo restores `board_ordem`: after a cross-column drop and clicking Desfazer (fresh cache), `reorderBoardPosts` receives `[{ id, board_ordem: null }]` when the post had no prior rank.

Extend `postsKanbanDrop.test.ts` for the resolver changes (over-card id + columnOf, pointer override, null without columnOf) and the `previousBoardOrdem` field.

- [ ] **Step 6: Run suites, gates, commit**

Run: `npm run test -- --run apps/crm/src/pages/entregas/views/__tests__/PostsKanbanView.test.tsx apps/crm/src/pages/entregas/__tests__/postsKanbanDrop.test.ts apps/crm/src/pages/entregas/__tests__/postsBoardOrder.test.ts`
Expected: PASS. Then prettier/eslint/tsc-filtered, and:

```bash
git add -A apps/crm/src/pages/entregas apps/crm/src/store
git commit -m "feat(entregas): ordem manual persistida no kanban de Publicacoes

Cards viram useSortable (preview de reordenacao na propria coluna),
drop cruzado posiciona no indice do ponteiro em colunas manuais (slot
segue o mouse) e persiste via reorder_board_posts com escrita otimista;
Desfazer restaura tambem o rank anterior. Colunas em sort automatico
mantem o slot no pouso real.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Per-column sort menu + persisted preference

**Files:**
- Modify: `apps/crm/src/pages/entregas/entregasPrefs.ts`
- Modify: `apps/crm/src/pages/entregas/views/PostsKanbanView.tsx`
- Modify: `apps/crm/src/pages/entregas/EntregasPage.tsx`
- Test: `apps/crm/src/pages/entregas/__tests__/entregasPrefs.test.ts` (extend if it exists, else create)
- Test: `apps/crm/src/pages/entregas/views/__tests__/PostsKanbanView.test.tsx` (extend)

**Interfaces:**
- Consumes: `BoardColumnSort`, `BOARD_COLUMN_SORTS`, `BOARD_COLUMN_SORT_LABELS` (Task 2); the `columnSorts` prop (Task 3).
- Produces: `loadBoardColumnSorts(contaId): Partial<Record<string, BoardColumnSort>>` and `persistBoardColumnSort(contaId, columnKey, sort)` in entregasPrefs; the header menu UI.

- [ ] **Step 1: Prefs (TDD)**

Failing tests first (in `entregasPrefs.test.ts`, mirroring any existing tests there):

```ts
import { describe, expect, it, beforeEach } from 'vitest';
import { loadBoardColumnSorts, persistBoardColumnSort } from '../entregasPrefs';

describe('board column sort prefs', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips per conta and column', () => {
    persistBoardColumnSort('conta-1', 'rascunho', 'recentes');
    persistBoardColumnSort('conta-1', 'custom:abc', 'data');
    expect(loadBoardColumnSorts('conta-1')).toEqual({ rascunho: 'recentes', 'custom:abc': 'data' });
    expect(loadBoardColumnSorts('conta-2')).toEqual({});
  });

  it('drops junk values on load', () => {
    localStorage.setItem('entregas_board_sorts_conta-1', '{"rascunho":"whatever","x":3}');
    expect(loadBoardColumnSorts('conta-1')).toEqual({});
  });

  it('survives storage failures silently', () => {
    // jsdom: force a throw
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error('full');
    };
    expect(() => persistBoardColumnSort('conta-1', 'rascunho', 'manual')).not.toThrow();
    Storage.prototype.setItem = orig;
  });
});
```

Implementation in `entregasPrefs.ts` (one JSON blob per conta, key `entregas_board_sorts_${contaId}`; validate each value against `BOARD_COLUMN_SORTS`, import them from `./postsBoardOrder`):

```ts
import { BOARD_COLUMN_SORTS, type BoardColumnSort } from './postsBoardOrder';

const boardSortsKey = (contaId: string) => `entregas_board_sorts_${contaId}`;

/** Sort escolhido por coluna do board de Publicacoes, por conta. Valores
 *  desconhecidos (versoes antigas, lixo) sao descartados no load. */
export function loadBoardColumnSorts(contaId: string): Partial<Record<string, BoardColumnSort>> {
  try {
    const raw = localStorage.getItem(boardSortsKey(contaId));
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed == null || typeof parsed !== 'object') return {};
    const out: Partial<Record<string, BoardColumnSort>> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string' && (BOARD_COLUMN_SORTS as string[]).includes(value)) {
        out[key] = value as BoardColumnSort;
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function persistBoardColumnSort(
  contaId: string,
  columnKey: string,
  sort: BoardColumnSort,
): void {
  try {
    const current = loadBoardColumnSorts(contaId);
    current[columnKey] = sort;
    localStorage.setItem(boardSortsKey(contaId), JSON.stringify(current));
  } catch {
    // Best effort: a preferencia so nao sobrevive ao reload.
  }
}
```

- [ ] **Step 2: Wire state through EntregasPage**

`EntregasPage` owns the state (it has `contaId`):

```ts
const [boardColumnSorts, setBoardColumnSorts] = useState<Partial<Record<string, BoardColumnSort>>>(
  () => loadBoardColumnSorts(contaId),
);
const handleBoardColumnSortChange = useCallback(
  (columnKey: string, sort: BoardColumnSort) => {
    setBoardColumnSorts((prev) => ({ ...prev, [columnKey]: sort }));
    persistBoardColumnSort(contaId, columnKey, sort);
  },
  [contaId],
);
```

Pass `columnSorts={boardColumnSorts}` and `onColumnSortChange={handleBoardColumnSortChange}` to `<PostsKanbanView />`. Check `EntregasPage.test.tsx`'s PostsKanbanView mock: if it destructures props strictly, extend the mock signature.

- [ ] **Step 3: Header menu in PostBoardColumn**

New prop pair on `PostsKanbanView` (`onColumnSortChange?: (columnKey: string, sort: BoardColumnSort) => void`) plumbed into `PostBoardColumn` as `sort: BoardColumnSort` and `onSortChange: (sort: BoardColumnSort) => void`. In the column header, between the title and the count pill, add a compact menu (lucide `ArrowUpDown`, shadcn `DropdownMenu` — already imported patterns exist in the codebase; use `DropdownMenuItem` rows with the always-visible checkbox style OR a simple check for the active one):

```tsx
<DropdownMenu>
  <DropdownMenuTrigger asChild>
    <button
      type="button"
      aria-label={`Ordenar coluna ${option.label}`}
      className="board-column-sort"
      style={tint ? { color: tint } : undefined}
    >
      <ArrowUpDown size={12} aria-hidden="true" />
    </button>
  </DropdownMenuTrigger>
  <DropdownMenuContent align="start" className="min-w-[170px]">
    {BOARD_COLUMN_SORTS.map((mode) => (
      <DropdownMenuItem
        key={mode}
        className="gap-2 text-xs"
        onSelect={() => onSortChange(mode)}
      >
        <Check
          className="h-3.5 w-3.5"
          style={{ visibility: sort === mode ? 'visible' : 'hidden' }}
        />
        {BOARD_COLUMN_SORT_LABELS[mode]}
      </DropdownMenuItem>
    ))}
  </DropdownMenuContent>
</DropdownMenu>
```

Add the small CSS class to `apps/crm/style.css` next to the other `.board-column-*` rules:

```css
.board-column-sort {
  display: inline-flex;
  align-items: center;
  border: none;
  background: none;
  cursor: pointer;
  padding: 0.15rem;
  border-radius: 6px;
  opacity: 0.55;
}

.board-column-sort:hover {
  opacity: 1;
  background: rgba(0, 0, 0, 0.06);
}
```

`memo` note: `onSortChange` must be referentially stable per column or the memo dies — build it in the parent map callback via `useCallback`-stable `onColumnSortChange` and pass `onSortChange={(s) => onColumnSortChange?.(option.key, s)}`... an inline arrow breaks memo on every parent render. Instead pass the stable `onColumnSortChange` itself plus `option` (already a prop) and call `onColumnSortChange(option.key, mode)` inside the column. Add `onColumnSortChange?: (columnKey: string, sort: BoardColumnSort) => void` to the column's props and use it directly in `onSelect`.

- [ ] **Step 4: View tests**

Extend `PostsKanbanView.test.tsx`:

1. Renders the sort trigger per column (`getAllByLabelText(/Ordenar coluna/)` length equals the column count).
2. With `columnSorts={{ rascunho: 'recentes' }}`, the rascunho column renders posts id-desc (query the column's card titles order).
3. Selecting "Mais antigos" in a column menu calls `onColumnSortChange('rascunho', 'antigos')`.

- [ ] **Step 5: Run suites, gates, commit**

Run: `npm run test -- --run apps/crm/src/pages/entregas` (the whole subtree).
Expected: PASS. Then prettier/eslint/tsc-filtered, and:

```bash
git add -A apps/crm/src/pages/entregas apps/crm/style.css
git commit -m "feat(entregas): menu de ordenacao no topo de cada coluna do board

Manual (padrao), Data agendada, Mais recentes e Mais antigos, por
coluna, lembrado por workspace em localStorage; colunas em modo
automatico continuam recusando posicionamento e mostrando o slot no
pouso real.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Deploy order (controller runs these, not the tasks)

1. After Task 1: apply `20260901000020` to STAGING and PROD (`supabase/.temp/project-ref` flip check; `npx supabase db push --linked`). The column is additive/nullable and the RPC is new — zero behavior change for the live frontend.
2. Tasks 2-4 then land in the frontend (HMR picks them up; the column already exists).
3. No edge function touches `board_ordem`; no redeploys needed.

## Self-review notes

- Spec coverage: manual persisted order (Tasks 1-3), sort menu per column top (Task 4), avulso/fluxo equality (inherits the interleaved fallback; manual rank is kind-agnostic).
- Type consistency: `BoardPlacementUpdate { id, board_ordem: number }` vs store `reorderBoardPosts({ id, board_ordem: number | null }[])` — placement never sends null; undo restore does. Compatible (widening).
- `resolvePostsKanbanHover` keeps its existing call signature valid (new fields optional), so Task 1's tests from the previous plan stay green.
- The locked-column rule is enforced in both resolvers already; sort menu on locked columns is allowed (view-only) and drops stay refused.
