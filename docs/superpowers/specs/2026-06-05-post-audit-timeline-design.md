# Per-post audit timeline in the workflow drawer

**Date:** 2026-06-05
**Status:** Approved (design) — ready for implementation plan
**Area:** CRM › Entregas › WorkflowDrawer + Supabase

## Summary

Each post row in the active `WorkflowDrawer` gets a **clock icon** that opens a
**popover** showing that post's lifecycle as a vertical timeline — the same visual
language as the finalized-section timeline in `HistoryDrawer`. Nodes, top → bottom:
**Criado**, then every **status change** (em revisão → aprovado interno → enviado →
aprovado cliente / correção → agendado → postado / falha), each with **who** made the
change and **when**. Client-driven transitions (approval / correction) link to the exact
client comment.

This requires a small amount of event-tracking infrastructure, because today only a
post's *current* status is stored — status **transitions are not recorded anywhere**.

## Goals

- A glanceable, auditable per-post timeline reachable in one click from the post row.
- Capture status transitions reliably (best-effort; see "Audit reliability") regardless of
  which code path makes them (CRM app, edge functions, publish cron, portal/hub approvals).
- Correct, **durable** actor attribution: workspace user (by name, snapshotted), "Cliente",
  or "Sistema" — driven by an explicit stored `source`, never inferred from the status.
- Precise linkage from client approval/correction nodes to the client's comment.
- Reuse the existing `history-*` timeline CSS so it matches the finalized section.

## Non-goals (YAGNI)

- No finer-grained nodes than status milestones (no per-comment, per-edit, per-reorder
  nodes). Client *messages* (`action='mensagem'`) and edit-suggestions are **not** nodes.
- No per-status SLA/deadline badges (deadlines are etapa-level, not post-level).
- No backfill of transitions that happened before this ships (the data never existed).
- The timeline is added to `WorkflowDrawer` only. `HistoryDrawer` may reuse the component
  later but is out of scope here.

## Decisions (from brainstorming + design review)

1. **Full audit trail** — add event tracking for status transitions (not derive-only).
2. **Placement** — a clock icon on each post row opens a popover with the timeline.
3. **Granularity** — status milestones only; client comment shown on its transition node.
4. **Comment linkage** — precise, via a `post_approval_id` column on the event row.
5. **Audit reliability** — **best-effort**: a failed event write never blocks the status
   change; failures are logged via `RAISE WARNING` to Postgres logs.
6. **Attribution** — an explicit `source` column (`workspace_user` | `client` | `system`)
   plus a snapshotted `actor_name`; no inference from `to_status`, durable across
   membership changes.
7. **Atomicity** — status changes and their companion writes (publish columns; the client
   approval insert) happen inside one transaction via RPCs.

## Key constraint discovered during design

`workflow_posts.status` is a single column with an `updated_at` trigger; there is **no**
status history. The `audit_log` table is owner/admin-only via RLS and written by only one
edge function — unusable as a timeline source for all roles. Status changes are made from
many places, several as **service role**, so a naïve trigger reading `auth.uid()` would
mis-attribute user-initiated edge-function changes:

- `instagram-publish/handler.ts` reads via `userDb` (line 52) but writes status via
  `svcDb`, co-writing companion columns: `cancel` → status + `instagram_container_id`,
  `publish_processing_at`, `publish_error` (83-88); `retry` → status + those + 
  `publish_retry_count` (96-102); `postado` → status + `instagram_media_id`,
  `published_at`, `publish_processing_at`, `publish_error`, `publish_retry_count`
  (192-199); `falha_publicacao` → status + `publish_error`, `publish_processing_at`
  (211-215). These are **user** actions sent with the user JWT (`instagram.ts:141-168`).
- `portal-approve/index.ts` and `hub-approve/handler.ts` insert the approval, then update
  status in a **separate** statement — so a trigger cannot see the approval id, and a
  failure between the two would orphan the comment.

The design below makes each of these one atomic, correctly-attributed transaction.

## Architecture

### 1. Database

New migration `supabase/migrations/<timestamp>_post_status_events.sql`.

#### Table

```sql
create table if not exists post_status_events (
  id               bigserial primary key,
  post_id          bigint not null references workflow_posts(id) on delete cascade,
  conta_id         uuid   not null,
  from_status      text,
  to_status        text   not null,
  source           text   not null
                   check (source in ('workspace_user', 'client', 'system')),
  actor_user_id    uuid,                 -- set when source = 'workspace_user'
  actor_name       text,                 -- snapshot of the actor's display name
  post_approval_id bigint references post_approvals(id) on delete set null,
  created_at       timestamptz not null default now()
);

create index if not exists idx_post_status_events_post_created_at
  on post_status_events (post_id, created_at);
```

- `conta_id` is denormalized so RLS needs no join (mirrors `post_approvals`).
- `source` makes "Cliente"/"Sistema"/workspace-user explicit; the UI never infers actor
  type from `to_status`, so new statuses can't be mislabeled.
- `actor_name` is snapshotted at write time, so a departed workspace member still shows by
  name in historical entries. `actor_user_id` is kept for linking.
- `post_approval_id` is set only for client transitions (precise comment linkage).
- No CHECK on `to_status` — validity of the status is enforced by the existing
  `workflow_posts.status` CHECK on UPDATE.

#### Capture trigger (single writer, best-effort)

```sql
create or replace function record_post_status_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor      uuid;
  v_source     text;
  v_actor_name text;
  v_approval   bigint;
begin
  begin
    v_actor := coalesce(nullif(current_setting('app.actor_id', true), '')::uuid, auth.uid());
    v_source := coalesce(
      nullif(current_setting('app.event_source', true), ''),
      case when v_actor is not null then 'workspace_user' else 'system' end
    );
    v_approval := nullif(current_setting('app.post_approval_id', true), '')::bigint;

    if v_actor is not null then
      select nome into v_actor_name from profiles where id = v_actor;
    end if;

    insert into post_status_events
      (post_id, conta_id, from_status, to_status, source,
       actor_user_id, actor_name, post_approval_id)
    values
      (new.id, new.conta_id, old.status, new.status, v_source,
       v_actor, v_actor_name, v_approval);
  exception when others then
    -- best-effort: never roll back the status change; surface the failure in logs
    raise warning 'record_post_status_event failed for post %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists workflow_posts_status_event on workflow_posts;
create trigger workflow_posts_status_event
  after update of status on workflow_posts
  for each row
  when (new.status is distinct from old.status)
  execute function record_post_status_event();
```

- The trigger is the **only** writer of event rows.
- Actor: explicit `app.actor_id` GUC wins; else `auth.uid()` (correct for CRM-app direct
  updates carrying the user JWT through PostgREST); else null.
- Source: explicit `app.event_source` GUC wins; else `workspace_user` when an actor is
  present, else `system`. So CRM-app updates → `workspace_user`; cron → `system`.
- `app.*` GUCs are read with `missing_ok = true` and only ever set transaction-local (see
  RPCs), so they never leak across pooled connections.
- Best-effort per Decision 5: an insert failure logs a `WARNING` and the status change
  still commits. Consequence: one event per transition on a best-effort basis — not a hard
  guarantee.

#### RPC — atomic status change + companion columns (edge functions / cron)

```sql
create or replace function record_post_status_change(
  p_post_id     bigint,
  p_new_status  text,
  p_source      text   default 'system',
  p_actor       uuid   default null,
  p_approval_id bigint default null,
  p_fields      jsonb  default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_source not in ('workspace_user', 'client', 'system') then
    raise exception 'record_post_status_change: invalid source %', p_source;
  end if;

  perform set_config('app.actor_id',         coalesce(p_actor::text, ''),       true);
  perform set_config('app.event_source',     coalesce(p_source, ''),            true);
  perform set_config('app.post_approval_id', coalesce(p_approval_id::text, ''), true);

  update workflow_posts set
    status = p_new_status,
    instagram_container_id = case when p_fields ? 'instagram_container_id'
      then (p_fields->>'instagram_container_id') else instagram_container_id end,
    instagram_media_id = case when p_fields ? 'instagram_media_id'
      then (p_fields->>'instagram_media_id') else instagram_media_id end,
    instagram_permalink = case when p_fields ? 'instagram_permalink'
      then (p_fields->>'instagram_permalink') else instagram_permalink end,
    published_at = case when p_fields ? 'published_at'
      then (p_fields->>'published_at')::timestamptz else published_at end,
    scheduled_at = case when p_fields ? 'scheduled_at'
      then (p_fields->>'scheduled_at')::timestamptz else scheduled_at end,
    publish_processing_at = case when p_fields ? 'publish_processing_at'
      then (p_fields->>'publish_processing_at')::timestamptz else publish_processing_at end,
    publish_error = case when p_fields ? 'publish_error'
      then (p_fields->>'publish_error') else publish_error end,
    publish_retry_count = case when p_fields ? 'publish_retry_count'
      then (p_fields->>'publish_retry_count')::int else publish_retry_count end
  where id = p_post_id;
end;
$$;

revoke all on function record_post_status_change(bigint, text, text, uuid, bigint, jsonb) from public;
grant execute on function record_post_status_change(bigint, text, text, uuid, bigint, jsonb) to service_role;
```

- Status + every companion column are set in **one** UPDATE → no transient/permanent split
  state, and the trigger fires once on an already-consistent row.
- `p_fields` is a fixed **whitelist** by construction (only the listed columns can be set);
  a key present sets the column (including to `null` for cleanup), a key absent leaves it.
- `p_source` is validated against the allowed set and raises *before* any write, so an
  implementation typo fails loudly here rather than being swallowed by the best-effort
  trigger (which would otherwise commit the status change with no event row).
- EXECUTE is granted to **service_role only**, so the `SECURITY DEFINER` RLS bypass cannot
  be abused by authenticated users to mutate posts in another workspace. Authenticated CRM
  code never calls it (it uses RLS-checked direct updates).

#### RPC — atomic client approval + status transition (portal / hub)

```sql
create or replace function record_client_approval(
  p_post_id           bigint,
  p_token             text,
  p_action            text,
  p_comentario        text,
  p_is_workspace_user boolean,
  p_new_status        text
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_approval bigint;
begin
  insert into post_approvals (post_id, token, action, comentario, is_workspace_user)
  values (p_post_id, p_token, p_action, p_comentario, p_is_workspace_user)
  returning id into v_approval;

  perform set_config('app.event_source',     'client',           true);
  perform set_config('app.post_approval_id', v_approval::text,   true);
  -- actor stays null → display shows "Cliente" from source

  update workflow_posts set status = p_new_status where id = p_post_id;

  return v_approval;
end;
$$;

revoke all on function record_client_approval(bigint, text, text, text, boolean, text) from public;
grant execute on function record_client_approval(bigint, text, text, text, boolean, text) to service_role;
```

- Insert + status update in one transaction → the comment **cannot be orphaned** by a
  failure between the insert and the status update. (Event creation itself remains
  best-effort per Decision 5: if the trigger fails, the approval + status still commit, just
  without an event row — logged as a `WARNING`.) Returns the approval id for any follow-up
  the caller needs.
- Used only for the **status-changing** client actions (`aprovado` → `aprovado_cliente`,
  `correcao` → `correcao_cliente`). A message-only action (`mensagem`) does not change
  status and keeps the plain `post_approvals` insert.
- The caller **must guard that the approval actually transitions the post** (post status in
  `enviado_cliente` / `correcao_cliente`) so a status-changing approval always fires the
  trigger. `portal-approve` already does this (`index.ts:104`); **`hub-approve` must add the
  same guard** — today it falls back to `post.status` (`handler.ts:60`), so re-approving an
  already-approved post would insert a duplicate approval with no transition and no event.
  Reject the no-op at the endpoint rather than silently recording a duplicate.

#### RLS + grants (notifications precedent)

```sql
alter table post_status_events enable row level security;

drop policy if exists post_status_events_select on post_status_events;
create policy post_status_events_select on post_status_events
  for select using (conta_id in (select public.get_my_conta_id()));

-- No INSERT/UPDATE/DELETE policy: the SECURITY DEFINER trigger (owned by postgres)
-- and the service role are the only writers.

drop policy if exists service_role_bypass_post_status_events on post_status_events;
create policy service_role_bypass_post_status_events on post_status_events
  for all to service_role using (true) with check (true);
```

### 2. Store layer — `apps/crm/src/store/posts.ts`

```ts
export interface PostStatusEvent {
  id: number;
  post_id: number;
  from_status: WorkflowPost['status'] | null;
  to_status: WorkflowPost['status'];
  source: 'workspace_user' | 'client' | 'system';
  actor_user_id: string | null;
  actor_name: string | null;
  post_approval_id: number | null;
  created_at: string;
}

export async function getPostStatusEvents(postIds: number[]): Promise<PostStatusEvent[]> {
  if (postIds.length === 0) return [];
  const { data, error } = await supabase
    .from('post_status_events')
    .select('id, post_id, from_status, to_status, source, actor_user_id, actor_name, post_approval_id, created_at')
    .in('post_id', postIds)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}
```

### 3. Pure timeline builder — `apps/crm/src/pages/entregas/components/postTimeline.ts`

```ts
export type TimelineTone = 'neutral' | 'approved' | 'correction' | 'published' | 'failed';

export interface TimelineNode {
  key: string;
  kind: 'created' | 'status';
  label: string;        // STATUS_LABELS[to_status], or "Criado"
  at: string;           // ISO
  actorLabel: string;   // actor_name | "Cliente" | "Sistema" | "—"
  comment: string | null;
  tone: TimelineTone;
}

export function buildPostTimeline(
  post: Pick<WorkflowPost, 'created_at'>,
  events: PostStatusEvent[],
  approvals: PostApproval[],
): TimelineNode[];
```

Rules:

- First node: `{ kind: 'created', label: 'Criado', at: post.created_at, actorLabel: '—',
  tone: 'neutral' }` — always present, so old posts are never blank. (No `created_by`
  column exists, so creation has no actor.)
- One node per event (already sorted ascending), label from the shared `STATUS_LABELS`.
- Tone: `aprovado_interno|aprovado_cliente → approved`; `correcao_cliente → correction`;
  `postado → published`; `falha_publicacao → failed`; otherwise `neutral`.
- Actor label from **source** (no status inference):
  - `source === 'client'` → `"Cliente"`
  - `source === 'system'` → `"Sistema"`
  - `source === 'workspace_user'` → `actor_name ?? "—"`
- Comment: if `post_approval_id` is set, use
  `approvals.find(a => a.id === post_approval_id)?.comentario`.
- Final ordering: by `at` ascending (Created is earliest); stable for equal timestamps.

Pure function → unit-tested like `__tests__/store.posts.test.ts`. Note it no longer needs
`workspaceUsers`/a `resolveActor` — the name comes from the event's snapshot.

### 4. UI — `apps/crm/src/pages/entregas/components/PostTimelinePopover.tsx`

- shadcn `Popover` (`components/ui/popover.tsx`, present) triggered by a `Clock` (lucide)
  icon button in `drawer-post-trigger-right`, next to the date / status chip in
  `SortablePostItem`.
- Renders nodes with the existing `history-timeline` / `history-step` classes so it matches
  the finalized section. Icon per tone: `Check` (approved), `RotateCcw` (correction),
  `Send`/`CheckCircle` (published), `AlertTriangle` (failed), dot (neutral).
- Each node shows label, actor, short date, full datetime on hover, and a comment bubble
  when present. Empty/old post → just the "Criado" node.
- Small popover-scoped CSS only if needed; otherwise reuse `history-*`.

### 5. Wiring — `apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx`

- Add a query:
  ```ts
  const { data: statusEvents = [] } = useQuery({
    queryKey: ['post-status-events', postIds.join(',')],
    queryFn: () => getPostStatusEvents(postIds),
    enabled: postIds.length > 0,
  });
  ```
- Pass `statusEvents.filter(e => e.post_id === post.id)` and the post's `approvals` (already
  loaded) into `SortablePostItem`, which renders the clock icon + `PostTimelinePopover`.
  No `resolveActor`/`workspaceUsers` needed for the timeline.
- Add `['post-status-events']` to the invalidations in `refresh()` so the timeline updates
  immediately after a status change.

### 6. Edge-function changes (atomic + attributed)

- **`supabase/functions/instagram-publish/handler.ts`** — derive the actor once
  (`const { data: { user } } = await svcDb.auth.getUser(jwt)` — service-role client + token,
  per the repo's documented verification convention). Replace each status-changing
  `svcDb.from('workflow_posts').update({...})` with
  `svcDb.rpc('record_post_status_change', { p_post_id: postId, p_new_status, p_source: 'workspace_user', p_actor: user?.id ?? null, p_fields })`,
  where `p_fields` carries exactly the companion columns that update set today
  (e.g. publish-now success → `{ instagram_media_id, published_at, publish_processing_at: null, publish_error: null, publish_retry_count: 0 }`).
  The non-status writes (container id at 169, permalink at 205) stay as plain `svcDb`
  updates. Note: publish-now passes through `agendado` (122) then `postado` (192), so it
  produces two nodes — a faithful record of what happened.
- **`supabase/functions/portal-approve/index.ts`** — replace the insert-then-update pair for
  `aprovado`/`correcao` with
  `db.rpc('record_client_approval', { p_post_id, p_token: token, p_action: action, p_comentario, p_is_workspace_user: false, p_new_status: newStatus })`.
  Audit-log and auto-complete-etapa logic stays. The `mensagem` path keeps its plain insert.
- **`supabase/functions/hub-approve/handler.ts`** — same `record_client_approval` change for
  `aprovado`/`correcao`, **plus add the missing status guard** (reject unless `post.status`
  is `enviado_cliente`/`correcao_cliente`, matching `portal-approve`) so re-approving an
  already-approved post can't record a duplicate no-op approval. The auto-publish-on-approval
  follow-up to `agendado` routes through `record_post_status_change(..., p_source: 'system')`
  so it's attributed to "Sistema".
- **Publish cron** (`instagram-publish-cron`) — left unchanged: its plain `svcDb` status
  updates still fire the trigger and attribute to "Sistema" (no actor, no source GUC).

## Behavior for existing (pre-migration) posts

The "Criado" node always renders from `created_at`. Transitions before this ships were never
recorded and cannot be reconstructed, so old posts show only "Criado" plus transitions that
occur after launch. Acceptable and called out to the user.

## Testing

- **Unit** — `postTimeline.test.ts`: created node always present; ordering; tone mapping;
  actor label by `source` (workspace_user→`actor_name`, client→"Cliente", system→"Sistema",
  missing name→"—"); comment linkage via `post_approval_id`; old-post (no events) case.
- **Typecheck + suite** — `npm run build` then `npm run test`.
- **Manual / staging** (DB trigger/RPCs can't be covered by Vitest): push the migration, then
  (a) change a status in the CRM → event with correct `source='workspace_user'` + `actor_name`;
  (b) schedule/publish-now via the drawer → attributed to the user, not "Sistema";
  (c) approve via portal/hub → event with `post_approval_id` set, `source='client'`, comment
  shown; (d) confirm a forced trigger failure logs a WARNING and does **not** block the
  status change.

## Files

**New**
- `supabase/migrations/<timestamp>_post_status_events.sql` — table, trigger, two RPCs, RLS, index, grants
- `apps/crm/src/pages/entregas/components/postTimeline.ts` — pure builder + types
- `apps/crm/src/pages/entregas/components/PostTimelinePopover.tsx` — popover UI
- `apps/crm/src/pages/entregas/components/__tests__/postTimeline.test.ts` — unit tests

**Edit**
- `apps/crm/src/store/posts.ts` — `PostStatusEvent` + `getPostStatusEvents`
- `apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx` — query, wiring, icon/popover
- `supabase/functions/instagram-publish/handler.ts` — status writes via `record_post_status_change` + actor
- `supabase/functions/portal-approve/index.ts` — `record_client_approval`
- `supabase/functions/hub-approve/handler.ts` — `record_client_approval` + system auto-publish

**Reuse**
- `apps/crm/style.css` `history-*` classes (small popover-scoped tweaks only if needed)
- `components/ui/popover.tsx`, `components/ui/tooltip.tsx`

## Rollout notes

- Edge functions that handle their own auth deploy with `--no-verify-jwt`
  (`instagram-publish`, `portal-approve`, `hub-approve`).
- Apply the migration to staging first (`npx supabase db push --linked`), verify, then prod.
- No data migration / backfill step.
