# Calendar Scheduled-Posts View — Design

**Date:** 2026-06-15
**Status:** Approved (pending implementation plan)
**Area:** CRM › Entregas › Calendário view

## Problem

The Entregas calendar (`apps/crm/src/pages/entregas/views/CalendarView.tsx`) currently
shows only **etapa deadlines** and **estimated workflow completion** per day, derived from
active-workflow board cards. There is no way to see, for a given day, which **individual
posts are scheduled to be published** across all clients, nor to act on them (confirm
scheduling / publish) without opening each workflow's drawer one at a time.

## Goal

Inside the existing **Calendário** tab, let the user switch to a **Publicações** mode that:

1. Shows, per day, how many posts are scheduled to publish that day (across all active
   workflows / all clients).
2. On selecting a day, lists each scheduled post (client · type · time · status).
3. Lets the user **confirm scheduling** (Agendar) and **publish** (Publicar agora) — plus
   Cancelar / Tentar novamente / Ver — directly from that panel, reusing existing logic.
4. Lets the user open the full workflow drawer (pre-expanded to that post) for deeper edits.

## Non-goals (v1, YAGNI)

- Publicações mode **ignores the etapa/workflow-oriented top filter bar** (status, etapa,
  member, template). It is a workspace-wide publish agenda. Client-scoped filtering is a
  cheap follow-up if wanted.
- **No new role gating.** Matches existing `ScheduleButton` behavior — any internal user who
  can open the drawer can schedule/publish.
- **Reuse `ScheduleButton` as-is** per row rather than building a compact variant. Minor
  vertical density is acceptable for v1.
- Etapa deadlines and post publish-dates are **not** merged into the same cells; the mode
  toggle keeps them separable.

## Key concepts & source of truth

A post's publish date is `workflow_posts.scheduled_at` (a `timestamptz`, stored UTC). A post's
lifecycle status is `workflow_posts.status`. **`status` is the single source of truth** for
how a post is bucketed and which actions appear, mirroring `ScheduleButton` exactly:

| Bucket            | status value(s)                                                            | Row actions (via `ScheduleButton`)         |
| ----------------- | -------------------------------------------------------------------------- | ------------------------------------------ |
| ready to publish  | `aprovado_cliente`                                                          | Agendar publicação / Publicar agora        |
| scheduled (locked)| `agendado`                                                                 | Agendado + Cancelar                        |
| failed            | `falha_publicacao`                                                         | Tentar novamente (+ `publish_error` shown) |
| posted            | `postado`                                                                  | none (live) — Ver permalink                |
| not ready         | `rascunho`, `revisao_interna`, `aprovado_interno`, `enviado_cliente`, `correcao_cliente` | none — status chip + `Abrir →`             |

- `publish_error` is surfaced **only** inside a `falha_publicacao` row (as `ScheduleButton`
  already does). A stray `publish_error` on a non-`falha` status does **not** count as failed,
  so the cell summary never disagrees with the row's available actions.

## Timezone / day bucketing

`scheduled_at` is UTC, but the rest of the post UI renders it in **browser-local** time
(`formatPostDate` uses `new Date(iso).getHours()`; the drawer `DateTimePicker` round-trips via
`toISOString()`). To stay consistent:

- **Day key** = local calendar day of `new Date(scheduled_at)` (`getFullYear/getMonth/getDate`).
  A post set to 11pm-local stays on its local day, matching what the user picked in the drawer.
- **Range bounds** are derived from local-midnight `Date`s converted to ISO:
  - `startISO = new Date(year, month, 1).toISOString()`
  - `endISO   = new Date(year, month + 1, 1).toISOString()`
  - Query filters `scheduled_at >= startISO AND scheduled_at < endISO`.

### Range vs. visible grid

`MonthGrid` (`components/ui/month-grid.tsx`) emits leading/trailing spillover days, but both
the existing `renderCell` and the new one return an **empty cell** for `!isCurrentMonth`, so
spillover cells never display post counts. Therefore `[monthStart, nextMonthStart)` (the
current month only) is the correct range. **Assumption to preserve:** if spillover cells are
ever made live, this range must widen to the full visible grid.

## Data layer

### `getScheduledPosts(startISO, endISO)` — `store/posts.ts`

Selects from `workflow_posts` joined `workflows!inner(titulo, cliente_id, status)` and
`clientes(nome)`, filtered to `workflows.status = 'ativo'` and `scheduled_at` in
`[startISO, endISO)`, ordered by `scheduled_at` asc. RLS enforces `conta_id` (matches
`getClientePosts`, which does not filter `conta_id` explicitly).

Selects **only** the columns the row UI + `ScheduleButton` need — explicitly **not**
`conteudo` (the TipTap JSON) — to keep the month payload light:

```
id, workflow_id, titulo, tipo, status, scheduled_at, published_at,
ig_caption, instagram_permalink, publish_error, ordem, responsavel_id
```

Return type:

```ts
export interface ScheduledPost {
  id: number;
  workflow_id: number;
  cliente_id: number | null;
  cliente_nome: string;
  workflow_titulo: string;
  titulo: string;
  tipo: WorkflowPost['tipo'];
  status: WorkflowPost['status'];
  scheduled_at: string;            // non-null (filtered)
  published_at: string | null;
  ig_caption: string | null;
  instagram_permalink: string | null;
  publish_error: string | null;
  ordem: number;
  responsavel_id: number | null;
}
```

`ScheduledPost` is shaped so a `WorkflowPost`-compatible object for `ScheduleButton` can be
built without the heavy fields (fill `conteudo: null`, `conteudo_plain: ''`).

### Workspace IG-status query (dependent, scoped)

After `getScheduledPosts` resolves, derive `clientIds = unique(posts.map(cliente_id))` and
fetch `instagram_accounts` for **only those ids**:

```
select client_id, authorization_status, token_expires_at, permissions
from instagram_accounts where client_id in (clientIds)
```

Map to `Map<cliente_id, { revoked, expired, canPublish }>` using the same derivation as
`WorkflowDrawer.igAccountStatus`:

- `revoked` = `authorization_status === 'revoked'`
- `expired` = `authorization_status === 'expired'` or `token_expires_at < now`
- `canPublish` = `permissions` includes `'instagram_business_content_publish'`

Dependent query: `enabled: !postsLoading && clientIds.length > 0`. Lazy and scoped to the
loaded range, avoiding a full workspace scan.

## Components

### `hooks/useScheduledPosts.ts`

`useScheduledPosts(month: Date)` →
`{ byDay: Map<string, ScheduledPost[]>, igStatuses, isLoading }`.

- Computes `startISO`/`endISO` from `month` (local-midnight, above).
- `useQuery({ queryKey: ['scheduled-posts', startISO, endISO], queryFn: () => getScheduledPosts(startISO, endISO), enabled })`.
- `byDay` keyed by local day string (`` `${y}-${m}-${d}` ``).
- Dependent IG-status query as above.
- `enabled` only when the parent is in Publicações mode (the hook is only mounted/active from
  CalendarView, which itself only mounts in the Calendar tab).

### `views/CalendarView.tsx` (modified)

- New `mode: 'entregas' | 'publicacoes'` state + a small toggle rendered above the
  `MonthGrid` (left of / near the month nav).
- Owns shared `currentDate` / `selectedDay`; the `MonthGrid` instance is shared.
- `renderCell` branches by mode:
  - `entregas`: unchanged (etapa pill + conclusão pill).
  - `publicacoes`: empty for `!isCurrentMonth`; otherwise a primary `📷 N` pill (total posts
    scheduled that day) plus sub-indicators `✓ N` (postado, green) and `⚠ N` (falha, red).
- Side panel branches by mode: `entregas` keeps the current list; `publicacoes` renders
  `PublicacoesPanel`.
- Calls `useScheduledPosts(currentDate)` (active only in `publicacoes` mode).

### `components/PublicacoesPanel.tsx` (new)

Props: `posts: ScheduledPost[]` (selected day), `igStatuses`, `openableWorkflowIds: Set<number>`,
`onPostClick(workflowId, postId)`, `onStatusChange()`.

- Header: `"<day> de <month>"` + count.
- Each row: client name · tipo badge · local time · status chip. The compact time/date
  formatter currently lives **privately** in `WorkflowDrawer.tsx` (`formatPostDate`); extract
  it to a shared util (e.g. `utils/postDate.ts`) and import in both places rather than
  duplicating.
- Builds a `WorkflowPost`-shaped object and renders `ScheduleButton` per row
  (`hasInstagramAccount` = client present in `igStatuses`; `igAccountStatus` from the map;
  `onStatusChange` bubbles up).
- Row click → `onPostClick(workflow_id, id)` **only if** `openableWorkflowIds.has(workflow_id)`;
  otherwise the row is non-clickable and the `Abrir →`/`Ver` affordance is hidden (not a
  dead-looking clickable row).

## Row click → drawer

- `WorkflowDrawer` gets an optional `initialPostId?: number` prop that seeds
  `expandedId` (`useState<number | null>(initialPostId ?? null)`). The drawer is mounted fresh
  each time `drawerCard` is set, so initial state applies; defaults to `null` from Kanban/List.
- `EntregasPage`:
  - Memoizes `cardsByWorkflowId = useMemo(() => new Map(cards.map(c => [c.workflow.id!, c])), [cards])`
    and `openableWorkflowIds = useMemo(() => new Set(cards.map(c => c.workflow.id!)), [cards])`.
  - `handlePostClick(workflowId, postId)`: O(1) lookup; `setDrawerCard(card)` +
    `setDrawerInitialPostId(postId)`.
  - Passes `openableWorkflowIds` + `handlePostClick` down through CalendarView to
    PublicacoesPanel. CalendarView never holds the full `cards` array for this.

## Refresh / invalidation

`ScheduleButton.onStatusChange` (per row) → invalidate by **prefix**:

- `['scheduled-posts']` — refreshes cell counts + the open day's rows.
- `['workflow-posts-counts']` — existing kanban/board counts.
- `['workflow-posts-with-props']` — drawer post-list, so an already-open or later-opened
  drawer reflects the inline action.

## Files touched

| File | Change |
| ---- | ------ |
| `store/posts.ts` | add `ScheduledPost` + `getScheduledPosts(startISO, endISO)` |
| `pages/entregas/hooks/useScheduledPosts.ts` | **new** — month query + byDay + IG statuses |
| `pages/entregas/views/CalendarView.tsx` | mode toggle, branch renderCell + side panel |
| `pages/entregas/components/PublicacoesPanel.tsx` | **new** — day list + per-row ScheduleButton |
| `pages/entregas/components/WorkflowDrawer.tsx` | optional `initialPostId` prop; extract `formatPostDate` to shared util |
| `utils/postDate.ts` | **new** — extracted compact post-date/time formatter (shared) |
| `pages/entregas/EntregasPage.tsx` | memoized maps, `handlePostClick`, wire props |
| `style.css` (or existing calendar styles) | toggle + Publicações pill/row styles |

## Testing

- `store.posts` unit test for `getScheduledPosts`: range filter, active-workflow join,
  shape mapping (reuse the existing supabase mock harness in `__tests__/store.posts.test.ts`).
- Hook-level: `byDay` bucketing keys posts by **local** day (including a near-midnight case),
  query key stability across re-renders.
- Manual: toggle modes; counts match; Agendar/Publicar/Cancelar/Retry act and refresh cells +
  rows; non-`aprovado_cliente` rows show no action buttons; missing-IG-account row disables
  publish with the right warning; row without an active card is non-clickable.
- `npm run build` (tsc) and `npm run test` green.
