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
  member, template). It is a workspace-wide publish agenda. To avoid showing dead controls,
  `EntregasPage` **hides** the `EntregasFilters` bar while in Publicações mode (this is why the
  mode state is owned by `EntregasPage`, not `CalendarView` — see below). Client-scoped
  filtering is a cheap follow-up if wanted.
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

`workflow_posts` has **only** `workflow_id` as an FK (`migrations/20260402_workflow_posts.sql:14`)
— there is no direct `clientes` FK — so the client name must be reached **through** `workflows`
with a nested join, mirroring `getAllActiveEtapas` (`store/workflows.ts:248`). A sibling
`clientes(nome)` on `workflow_posts` is invalid.

Select (own columns explicitly exclude `conteudo`, the TipTap JSON, to keep the month payload
light), plus the nested workflow/client columns:

```
id, workflow_id, titulo, tipo, status, scheduled_at, published_at,
ig_caption, instagram_permalink, publish_error, ordem, responsavel_id,
workflows!inner(titulo, cliente_id, status, clientes!inner(nome))
```

Filter to `workflows.status = 'ativo'` and `scheduled_at` in `[startISO, endISO)`, order by
`scheduled_at` asc. RLS enforces `conta_id` (matches `getClientePosts` / `getAllActiveEtapas`,
which do not filter `conta_id` explicitly).

Mapping:
- `workflow_titulo = row.workflows.titulo`
- `cliente_id      = row.workflows.cliente_id`
- `cliente_nome    = row.workflows.clientes.nome`

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

`useScheduledPosts(month: Date, enabled: boolean)` →
`{ byDay: Map<string, ScheduledPost[]>, igStatuses, isLoading }`.

- An explicit `enabled` flag is **required**: `CalendarView` is mounted for the whole Calendar
  tab regardless of its internal mode, so mounting alone does not gate the fetch. The caller
  passes `enabled = mode === 'publicacoes'`. Both the posts query and the dependent IG-status
  query AND with this flag.
- Computes `startISO`/`endISO` from `month` (local-midnight, above).
- `useQuery({ queryKey: ['scheduled-posts', startISO, endISO], queryFn: () => getScheduledPosts(startISO, endISO), enabled })`.
- `byDay` keyed by local day string (`` `${y}-${m}-${d}` ``).
- Dependent IG-status query (`enabled: enabled && !postsLoading && clientIds.length > 0`).

### `views/CalendarView.tsx` (modified)

- Receives `mode` + `onModeChange` as **props** (state lifted to `EntregasPage` so the page can
  hide the filter bar — see below). Renders the `Entregas / Publicações` toggle above the
  `MonthGrid` (left of / near the month nav) and calls `onModeChange`.
- Owns shared `currentDate` / `selectedDay`; the `MonthGrid` instance is shared.
- `renderCell` branches by mode:
  - `entregas`: unchanged (etapa pill + conclusão pill), using the existing `filteredCards`.
  - `publicacoes`: empty for `!isCurrentMonth`; otherwise a primary `📷 N` pill (total posts
    scheduled that day) plus sub-indicators `✓ N` (postado, green) and `⚠ N` (falha, red).
- Side panel branches by mode: `entregas` keeps the current list; `publicacoes` renders
  `PublicacoesPanel`.
- Calls `useScheduledPosts(currentDate, mode === 'publicacoes')`.

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
  `onStatusChange` bubbles up). **When the client has no IG account**, `ScheduleButton` already
  returns `null` (`ScheduleButton.tsx:49`) — so the row shows **no** schedule/publish actions,
  just its status chip + `Abrir →`. No `ScheduleButton` change in v1; if inline publish for
  not-yet-connected clients is ever wanted, that's a separate `ScheduleButton` change.
- Row click → `onPostClick(workflow_id, id)` **only if** `openableWorkflowIds.has(workflow_id)`;
  otherwise the row is non-clickable and the `Abrir →`/`Ver` affordance is hidden (not a
  dead-looking clickable row).

## Row click → drawer

- `WorkflowDrawer` gets an optional `initialPostId?: number` prop that seeds `expandedId`
  (`useState<number | null>(initialPostId ?? null)`). **`useState` only reads its initial
  value once**: when `drawerCard` changes from one card to another while the drawer stays
  mounted, the initial value is *not* re-read and the wrong (or no) post would expand. Two
  acceptable mechanisms — pick one in the plan:
  1. **Key the element**: `<WorkflowDrawer key={`${drawerCard.workflow.id}:${drawerInitialPostId ?? ''}`} … />`
     in `EntregasPage`, forcing a remount on target change. Simplest; also resets any
     in-progress drawer state (acceptable since it's a different target).
  2. **Sync effect** in the drawer: `useEffect(() => { if (initialPostId != null) setExpandedId(initialPostId); }, [initialPostId])`.
     Preserves drawer state across unrelated re-renders.
  Default to (1) (key) for least surprise. Either way, do not rely on "mounted fresh".
- `EntregasPage`:
  - Owns the lifted `calendarMode: 'entregas' | 'publicacoes'` state (passed to `CalendarView`
    as `mode` + `onModeChange`), and **hides** `EntregasFilters` when
    `activeView === 'calendar' && calendarMode === 'publicacoes'`.
  - Memoizes from the **unfiltered** `cards` (not `filteredCards`):
    `cardsByWorkflowId = useMemo(() => new Map(cards.map(c => [c.workflow.id!, c])), [cards])`
    and `openableWorkflowIds = useMemo(() => new Set(cards.map(c => c.workflow.id!)), [cards])`.
    (Etapa events still use `filteredCards`; only drawer resolution / clickability uses the
    unfiltered set, so a filtered-out workflow's post is still openable.)
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
- Manual, per status (must match the bucket table):
  - `aprovado_cliente` → Agendar + Publicar agora (gated by `scheduled_at` + caption + account).
  - `agendado` → Agendado + Cancelar.
  - `falha_publicacao` → Tentar novamente, with `publish_error` shown.
  - `postado` → no action buttons, Ver permalink.
  - `not ready` statuses (`rascunho`/`revisao_interna`/`aprovado_interno`/`enviado_cliente`/`correcao_cliente`)
    → no action buttons, status chip + `Abrir →`.
  - Client with **no IG account** → no schedule/publish actions (ScheduleButton renders nothing).
  - Row whose `workflow_id` is not in `openableWorkflowIds` → non-clickable, `Abrir →` hidden.
- Manual: toggling modes hides/shows the filter bar; cell counts match the day's rows; an
  action refreshes both cell counts and the open day's rows; opening a row expands the correct
  post even when a drawer was opened immediately before (key/effect works).
- `npm run build` (tsc) and `npm run test` green.
