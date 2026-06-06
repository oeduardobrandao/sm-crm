# Per-post Audit Timeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-post lifecycle timeline (created → every status change, with who/when and client comments) reachable from a clock icon on each post row in the Entregas workflow drawer.

**Architecture:** A new `post_status_events` table is written by an `AFTER UPDATE` trigger on `workflow_posts` (best-effort; never blocks the status change). Status changes made by edge functions go through two `SECURITY DEFINER` RPCs that set transaction-local GUCs so the trigger captures the correct actor, source, and approval link. The CRM reads events via a thin store function, a pure builder merges them into ordered nodes, and a popover renders them with the existing `history-*` timeline styling.

**Tech Stack:** Supabase Postgres (SQL migration, plpgsql triggers/RPCs), React 19 + TanStack Query, Vitest + React Testing Library, Deno edge functions.

**Spec:** `docs/superpowers/specs/2026-06-05-post-audit-timeline-design.md`

**Before starting:** Per the project rule, work on a feature branch off `main` (e.g. `git switch -c feat/post-audit-timeline`), not directly on `main`. If using an isolated worktree, it was created via the using-git-worktrees skill.

---

## Task 1: Database migration (table, trigger, RPCs, RLS)

**Files:**
- Create: `supabase/migrations/20260606000001_post_status_events.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260606000001_post_status_events.sql` with exactly:

```sql
-- =====================================================================
-- 20260606000001_post_status_events.sql
-- Per-post status-transition audit log + capture trigger + two RPCs.
-- Trigger is best-effort (RAISE WARNING on failure, never rolls back the
-- status change). RPCs set transaction-local GUCs so the trigger records
-- the correct actor / source / approval link.
-- =====================================================================

-- ---------- Table -----------------------------------------------------
create table if not exists post_status_events (
  id               bigserial primary key,
  post_id          bigint not null references workflow_posts(id) on delete cascade,
  conta_id         uuid   not null,
  from_status      text,
  to_status        text   not null,
  source           text   not null
                   check (source in ('workspace_user', 'client', 'system')),
  actor_user_id    uuid,
  actor_name       text,
  post_approval_id bigint references post_approvals(id) on delete set null,
  created_at       timestamptz not null default now()
);

create index if not exists idx_post_status_events_post_created_at
  on post_status_events (post_id, created_at);

-- ---------- Capture trigger (single writer, best-effort) -------------
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

-- ---------- RPC: atomic status change + companion columns -----------
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

-- ---------- RPC: atomic client approval + status transition ---------
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

  perform set_config('app.event_source',     'client',         true);
  perform set_config('app.post_approval_id', v_approval::text, true);

  update workflow_posts set status = p_new_status where id = p_post_id;

  return v_approval;
end;
$$;

revoke all on function record_client_approval(bigint, text, text, text, boolean, text) from public;
grant execute on function record_client_approval(bigint, text, text, text, boolean, text) to service_role;

-- ---------- RLS -------------------------------------------------------
alter table post_status_events enable row level security;

drop policy if exists post_status_events_select on post_status_events;
create policy post_status_events_select on post_status_events
  for select using (conta_id in (select public.get_my_conta_id()));

-- No INSERT/UPDATE/DELETE policy: the SECURITY DEFINER trigger (owned by
-- postgres) and the service role are the only writers.

drop policy if exists service_role_bypass_post_status_events on post_status_events;
create policy service_role_bypass_post_status_events on post_status_events
  for all to service_role using (true) with check (true);
```

- [ ] **Step 2: Dry-run the migration against staging**

Run: `npx supabase db push --linked --dry-run`
Expected: the diff lists the new `post_status_events` table, the trigger, both functions, and the policies — and **only** those. (Per project rule, always dry-run first; `db push` applies ALL pending migrations.)

- [ ] **Step 3: Apply the migration to staging**

Run: `npx supabase db push --linked`
Expected: applies cleanly, no errors.

- [ ] **Step 4: Verify capture + attribution with SQL (this is the test)**

In the Supabase Studio SQL editor for the staging project, run (replace `<POST_ID>` with any real post id from `select id, conta_id, status from workflow_posts limit 5;`, and `<PROFILE_UUID>` with any `select id, nome from profiles limit 1;`):

```sql
-- (a) A plain UPDATE with no JWT/GUC → source 'system', no actor.
update workflow_posts set status = 'revisao_interna'
  where id = <POST_ID> and status <> 'revisao_interna';

select to_status, source, actor_user_id, actor_name
  from post_status_events where post_id = <POST_ID>
  order by created_at desc limit 1;
-- Expected: to_status='revisao_interna', source='system', actor_user_id=null, actor_name=null

-- (b) The RPC with an explicit actor → source 'workspace_user', name snapshotted.
select record_post_status_change(<POST_ID>, 'aprovado_interno', 'workspace_user', '<PROFILE_UUID>'::uuid);

select to_status, source, actor_user_id, actor_name
  from post_status_events where post_id = <POST_ID>
  order by created_at desc limit 1;
-- Expected: to_status='aprovado_interno', source='workspace_user',
--           actor_user_id='<PROFILE_UUID>', actor_name=<that profile's nome>

-- (c) Invalid source fails loudly (does NOT write or change status).
select record_post_status_change(<POST_ID>, 'rascunho', 'oops');
-- Expected: ERROR: record_post_status_change: invalid source oops
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260606000001_post_status_events.sql
git commit -m "feat(db): post_status_events table, capture trigger, and status-change RPCs"
```

---

## Task 2: Store layer — `PostStatusEvent` type + `getPostStatusEvents`

**Files:**
- Modify: `apps/crm/src/store/posts.ts`
- Test: `apps/crm/src/__tests__/store.posts.test.ts`

- [ ] **Step 1: Write the failing test**

Append this `describe` block to the end of `apps/crm/src/__tests__/store.posts.test.ts` (the file already sets up `mockedSupabase`, `getCalls`, and `beforeEach`):

```ts
describe('getPostStatusEvents', () => {
  it('queries post_status_events for the given post ids, ordered by created_at', async () => {
    mockedSupabase.__queueSupabaseResult('post_status_events', 'select', {
      data: [
        {
          id: 1,
          post_id: 10,
          from_status: 'rascunho',
          to_status: 'revisao_interna',
          source: 'workspace_user',
          actor_user_id: 'user-1',
          actor_name: 'Eduardo Souza',
          post_approval_id: null,
          created_at: '2026-06-01T10:00:00Z',
        },
      ],
      error: null,
    });

    const result = await store.getPostStatusEvents([10, 11]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ post_id: 10, source: 'workspace_user' });

    const call = getCalls('post_status_events', 'select').at(-1)!;
    expect(call.modifiers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: 'in', args: ['post_id', [10, 11]] }),
        expect.objectContaining({ method: 'order', args: ['created_at', { ascending: true }] }),
      ]),
    );
  });

  it('returns [] without querying when no post ids are given', async () => {
    const result = await store.getPostStatusEvents([]);
    expect(result).toEqual([]);
    expect(getCalls('post_status_events')).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- store.posts`
Expected: FAIL — `store.getPostStatusEvents is not a function`.

- [ ] **Step 3: Implement the type and function**

In `apps/crm/src/store/posts.ts`, add the interface immediately after the `PostApproval` interface (after its closing `}` near line 103):

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
```

Then add the query function immediately after the existing `getPostApprovals` function (after its closing `}` near line 467):

```ts
export async function getPostStatusEvents(postIds: number[]): Promise<PostStatusEvent[]> {
  if (postIds.length === 0) return [];
  const { data, error } = await supabase
    .from('post_status_events')
    .select(
      'id, post_id, from_status, to_status, source, actor_user_id, actor_name, post_approval_id, created_at',
    )
    .in('post_id', postIds)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}
```

(The store barrel `apps/crm/src/store/index.ts` re-exports `./posts`, so no extra export wiring is needed — confirm by grepping `export * from './posts'`.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- store.posts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/store/posts.ts apps/crm/src/__tests__/store.posts.test.ts
git commit -m "feat(store): getPostStatusEvents + PostStatusEvent type"
```

---

## Task 3: Pure timeline builder

**Files:**
- Create: `apps/crm/src/pages/entregas/components/postTimeline.ts`
- Test: `apps/crm/src/pages/entregas/components/__tests__/postTimeline.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/crm/src/pages/entregas/components/__tests__/postTimeline.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildPostTimeline } from '../postTimeline';
import type { PostStatusEvent, PostApproval } from '../../../../store';

const post = { created_at: '2026-06-01T10:00:00Z' };

function ev(partial: Partial<PostStatusEvent>): PostStatusEvent {
  return {
    id: 1,
    post_id: 10,
    from_status: null,
    to_status: 'revisao_interna',
    source: 'workspace_user',
    actor_user_id: null,
    actor_name: null,
    post_approval_id: null,
    created_at: '2026-06-02T10:00:00Z',
    ...partial,
  };
}

describe('buildPostTimeline', () => {
  it('always starts with a "Criado" node from created_at, even with no events', () => {
    const nodes = buildPostTimeline(post, [], []);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ kind: 'created', label: 'Criado', at: post.created_at, tone: 'neutral' });
  });

  it('orders nodes by time, mapping status labels and tones', () => {
    const nodes = buildPostTimeline(post, [
      ev({ id: 2, to_status: 'postado', created_at: '2026-06-05T10:00:00Z' }),
      ev({ id: 1, to_status: 'revisao_interna', created_at: '2026-06-02T10:00:00Z' }),
    ], []);
    expect(nodes.map((n) => n.label)).toEqual(['Criado', 'Em revisão', 'Postado']);
    expect(nodes[2].tone).toBe('published');
  });

  it('labels the actor from source (workspace name, Cliente, Sistema, or —)', () => {
    const [, wsNamed] = buildPostTimeline(post, [ev({ source: 'workspace_user', actor_name: 'Bruno' })], []);
    expect(wsNamed.actorLabel).toBe('Bruno');
    const [, wsNoName] = buildPostTimeline(post, [ev({ source: 'workspace_user', actor_name: null })], []);
    expect(wsNoName.actorLabel).toBe('—');
    const [, client] = buildPostTimeline(post, [ev({ source: 'client', to_status: 'aprovado_cliente' })], []);
    expect(client.actorLabel).toBe('Cliente');
    const [, system] = buildPostTimeline(post, [ev({ source: 'system', to_status: 'postado' })], []);
    expect(system.actorLabel).toBe('Sistema');
  });

  it('attaches the client comment via post_approval_id', () => {
    const approvals = [
      { id: 99, post_id: 10, token: 't', action: 'correcao', comentario: 'Ajuste o título', is_workspace_user: false, created_at: '2026-06-03T10:00:00Z' },
    ] as PostApproval[];
    const [, node] = buildPostTimeline(post, [
      ev({ to_status: 'correcao_cliente', source: 'client', post_approval_id: 99, created_at: '2026-06-03T10:00:00Z' }),
    ], approvals);
    expect(node.label).toBe('Correção solicitada');
    expect(node.tone).toBe('correction');
    expect(node.comment).toBe('Ajuste o título');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- postTimeline`
Expected: FAIL — cannot resolve `../postTimeline`.

- [ ] **Step 3: Implement the builder**

Create `apps/crm/src/pages/entregas/components/postTimeline.ts`:

```ts
import type { WorkflowPost, PostApproval, PostStatusEvent } from '../../../store';

export type TimelineTone = 'neutral' | 'approved' | 'correction' | 'published' | 'failed';

export interface TimelineNode {
  key: string;
  kind: 'created' | 'status';
  label: string;
  at: string;
  actorLabel: string;
  comment: string | null;
  tone: TimelineTone;
}

const STATUS_LABELS: Record<WorkflowPost['status'], string> = {
  rascunho: 'Rascunho',
  revisao_interna: 'Em revisão',
  aprovado_interno: 'Aprovado internamente',
  enviado_cliente: 'Enviado ao cliente',
  aprovado_cliente: 'Aprovado pelo cliente',
  correcao_cliente: 'Correção solicitada',
  agendado: 'Agendado',
  postado: 'Postado',
  falha_publicacao: 'Falha na publicação',
};

const TONE_BY_STATUS: Partial<Record<WorkflowPost['status'], TimelineTone>> = {
  aprovado_interno: 'approved',
  aprovado_cliente: 'approved',
  correcao_cliente: 'correction',
  postado: 'published',
  falha_publicacao: 'failed',
};

function actorLabelFor(ev: PostStatusEvent): string {
  if (ev.source === 'client') return 'Cliente';
  if (ev.source === 'system') return 'Sistema';
  return ev.actor_name ?? '—';
}

export function buildPostTimeline(
  post: Pick<WorkflowPost, 'created_at'>,
  events: PostStatusEvent[],
  approvals: PostApproval[],
): TimelineNode[] {
  const nodes: TimelineNode[] = [];

  if (post.created_at) {
    nodes.push({
      key: 'created',
      kind: 'created',
      label: 'Criado',
      at: post.created_at,
      actorLabel: '—',
      comment: null,
      tone: 'neutral',
    });
  }

  const approvalById = new Map(approvals.map((a) => [a.id, a]));

  for (const ev of events) {
    const comment =
      ev.post_approval_id != null
        ? (approvalById.get(ev.post_approval_id)?.comentario ?? null)
        : null;
    nodes.push({
      key: `event-${ev.id}`,
      kind: 'status',
      label: STATUS_LABELS[ev.to_status] ?? ev.to_status,
      at: ev.created_at,
      actorLabel: actorLabelFor(ev),
      comment,
      tone: TONE_BY_STATUS[ev.to_status] ?? 'neutral',
    });
  }

  return nodes.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- postTimeline`
Expected: PASS (all 4 cases).

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/entregas/components/postTimeline.ts apps/crm/src/pages/entregas/components/__tests__/postTimeline.test.ts
git commit -m "feat(entregas): pure post-timeline builder"
```

---

## Task 4: Timeline popover component + CSS

**Files:**
- Create: `apps/crm/src/pages/entregas/components/PostTimelinePopover.tsx`
- Modify: `apps/crm/style.css` (append near the `history-*` block, around line 6381)
- Test: `apps/crm/src/pages/entregas/components/__tests__/PostTimelinePopover.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/crm/src/pages/entregas/components/__tests__/PostTimelinePopover.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { PostTimelineList } from '../PostTimelinePopover';
import type { TimelineNode } from '../postTimeline';

describe('PostTimelineList', () => {
  it('renders one row per node with label, actor, and comment', () => {
    const nodes: TimelineNode[] = [
      { key: 'created', kind: 'created', label: 'Criado', at: '2026-06-01T10:00:00Z', actorLabel: '—', comment: null, tone: 'neutral' },
      { key: 'e1', kind: 'status', label: 'Aprovado pelo cliente', at: '2026-06-03T12:00:00Z', actorLabel: 'Cliente', comment: 'Perfeito!', tone: 'approved' },
    ];
    render(<PostTimelineList nodes={nodes} />);
    expect(screen.getByText('Criado')).toBeInTheDocument();
    expect(screen.getByText('Aprovado pelo cliente')).toBeInTheDocument();
    expect(screen.getByText('Cliente')).toBeInTheDocument();
    expect(screen.getByText('Perfeito!')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- PostTimelinePopover`
Expected: FAIL — cannot resolve `../PostTimelinePopover`.

- [ ] **Step 3: Implement the component**

Create `apps/crm/src/pages/entregas/components/PostTimelinePopover.tsx`:

```tsx
import { Clock, Check, RotateCcw, Send, AlertTriangle } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import type { WorkflowPost, PostApproval, PostStatusEvent } from '../../../store';
import { buildPostTimeline, type TimelineNode, type TimelineTone } from './postTimeline';

function formatNodeDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

function formatNodeDateFull(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function ToneIcon({ tone }: { tone: TimelineTone }) {
  if (tone === 'approved') return <Check className="h-3 w-3" />;
  if (tone === 'correction') return <RotateCcw className="h-3 w-3" />;
  if (tone === 'published') return <Send className="h-3 w-3" />;
  if (tone === 'failed') return <AlertTriangle className="h-3 w-3" />;
  return null; // neutral: the gray circle itself is the marker
}

export function PostTimelineList({ nodes }: { nodes: TimelineNode[] }) {
  return (
    <div className="history-timeline">
      {nodes.map((node, i) => (
        <div key={node.key} className="history-step">
          <div className="history-step-track">
            <div className={`history-step-icon history-step-icon--${node.tone}`}>
              <ToneIcon tone={node.tone} />
            </div>
            {i < nodes.length - 1 && (
              <div className={`history-step-line history-step-line--${node.tone}`} />
            )}
          </div>
          <div className="history-step-body">
            <div className="history-step-name">{node.label}</div>
            <div className="history-step-detail">
              <span className="post-timeline-actor">{node.actorLabel}</span>
              {' · '}
              <span title={formatNodeDateFull(node.at)}>{formatNodeDate(node.at)}</span>
            </div>
            {node.comment && <div className="post-timeline-comment">{node.comment}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

interface PostTimelinePopoverProps {
  post: Pick<WorkflowPost, 'created_at'>;
  events: PostStatusEvent[];
  approvals: PostApproval[];
}

export function PostTimelinePopover({ post, events, approvals }: PostTimelinePopoverProps) {
  const nodes = buildPostTimeline(post, events, approvals);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="drawer-post-history-btn"
          title="Histórico do post"
          onClick={(e) => e.stopPropagation()}
        >
          <Clock className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="post-timeline-popover"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="post-timeline-title">Histórico</div>
        <PostTimelineList nodes={nodes} />
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 4: Add the CSS**

In `apps/crm/style.css`, immediately after the `.history-final-node { ... }` rule (ends near line 6380), append:

```css
/* Per-post timeline popover (WorkflowDrawer) */
.history-step-icon--approved { background: var(--success, #3ecf8e); }
.history-step-icon--correction { background: var(--warning, #f5a342); }
.history-step-icon--published { background: var(--teal, #42c8f5); }
.history-step-icon--failed { background: var(--danger, #f55a42); }
.history-step-icon--neutral { background: var(--text-muted, #9ca3af); }

.history-step-line--approved { background: var(--success, #3ecf8e); }
.history-step-line--correction { background: var(--warning, #f5a342); }
.history-step-line--published { background: var(--teal, #42c8f5); }
.history-step-line--failed { background: var(--danger, #f55a42); }

.post-timeline-popover {
  width: 18rem;
  max-height: 22rem;
  overflow-y: auto;
}

.post-timeline-title {
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--text-muted, #718096);
}

.post-timeline-popover .history-timeline {
  padding: 0.5rem 0 0;
}

.post-timeline-actor {
  font-weight: 500;
  color: var(--text-main, #12151a);
}

.post-timeline-comment {
  margin-top: 0.35rem;
  padding: 0.4rem 0.6rem;
  background: var(--surface-hover, #f8fafc);
  border-radius: 8px;
  font-size: 0.75rem;
  color: var(--text-main, #12151a);
  white-space: pre-wrap;
  word-break: break-word;
}

.drawer-post-history-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  border: none;
  background: transparent;
  color: var(--text-muted, #718096);
  cursor: pointer;
  transition: var(--transition, 0.2s);
}

.drawer-post-history-btn:hover {
  background: var(--surface-hover, #f1f5f9);
  color: var(--text-main, #12151a);
}
```

(The `.history-step-line--neutral` rule already exists in this file, so it is not redefined.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test -- PostTimelinePopover`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/crm/src/pages/entregas/components/PostTimelinePopover.tsx apps/crm/src/pages/entregas/components/__tests__/PostTimelinePopover.test.tsx apps/crm/style.css
git commit -m "feat(entregas): post timeline popover + styling"
```

---

## Task 5: Wire the popover into the workflow drawer

**Files:**
- Modify: `apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx`

- [ ] **Step 1: Import the store function, type, and component**

In `WorkflowDrawer.tsx`, in the big import block from `'../../../store'` (lines ~42-69): add `getPostStatusEvents,` right after the `getPostApprovals,` line, and add `type PostStatusEvent,` right after the `type PostApproval,` line.

Then, right after the existing `import PostCommentSummary from './PostCommentSummary';` line (~73), add:

```tsx
import { PostTimelinePopover } from './PostTimelinePopover';
```

- [ ] **Step 2: Add the status-events query**

Immediately after the `approvals` query block (the `useQuery` for `['post-approvals', ...]`, ends ~line 225), add:

```tsx
  const { data: statusEvents = [] } = useQuery({
    queryKey: ['post-status-events', postIds.join(',')],
    queryFn: () => getPostStatusEvents(postIds),
    enabled: postIds.length > 0,
  });
```

- [ ] **Step 3: Invalidate the query on refresh**

In the `refresh` callback (~lines 272-279), add this line alongside the other `qc.invalidateQueries` calls:

```tsx
    qc.invalidateQueries({ queryKey: ['post-status-events'] });
```

- [ ] **Step 4: Pass events into each post item**

In the `orderedPosts.map(...)` render of `<SortablePostItem ... />` (~lines 689-731), add this prop (next to the `approvals={...}` prop):

```tsx
                          statusEvents={statusEvents.filter((e) => e.post_id === post.id)}
```

- [ ] **Step 5: Add the prop to the component's interface and signature**

In `interface SortablePostItemProps` (~lines 836-870), add after the `approvals: PostApproval[];` line:

```tsx
  statusEvents: PostStatusEvent[];
```

In the `function SortablePostItem({ ... })` destructuring (~lines 872-906), add `statusEvents,` after `approvals,`.

- [ ] **Step 6: Render the clock icon in the row**

In `SortablePostItem`, inside `<div className="drawer-post-trigger-right" ...>` (~line 1054), add the popover right after the saving indicator line:

```tsx
          {isSaving && <span className="drawer-saving-indicator">Salvando…</span>}
          <PostTimelinePopover post={post} events={statusEvents} approvals={approvals} />
```

(Leave the existing `{publishIso ? (...) : (...)}` date block and status chip as they are, immediately below.)

- [ ] **Step 7: Typecheck and run the suite**

Run: `npm run build`
Expected: `tsc` passes (no type errors) and the Vite build completes.

Run: `npm run test`
Expected: full suite green (existing entregas tests + the new builder/component tests).

- [ ] **Step 8: Commit**

```bash
git add apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx
git commit -m "feat(entregas): show per-post timeline popover in workflow drawer"
```

---

## Task 6: Edge function — `instagram-publish` (actor + atomic RPC)

**Files:**
- Modify: `supabase/functions/instagram-publish/handler.ts`

- [ ] **Step 1: Extend the `DbClient` type**

Replace the `type DbClient = { from: (table: string) => any };` line (~line 17) with:

```ts
type DbClient = {
  from: (table: string) => any;
  rpc: (fn: string, params: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
  auth: { getUser: (jwt: string) => Promise<{ data: { user: { id: string } | null }; error: unknown }> };
};
```

- [ ] **Step 2: Resolve the actor once**

Immediately after `const svcDb = deps.createServiceDb();` (~line 49), add:

```ts
    const { data: { user: actorUser } } = await svcDb.auth.getUser(jwt);
    const actorId = actorUser?.id ?? null;
```

- [ ] **Step 3: Convert the `schedule` status write**

Replace (in the `schedule` branch, ~lines 73-75):

```ts
      await svcDb.from("workflow_posts")
        .update({ status: "agendado" })
        .eq("id", postId);
```

with:

```ts
      await svcDb.rpc("record_post_status_change", {
        p_post_id: postId,
        p_new_status: "agendado",
        p_source: "workspace_user",
        p_actor: actorId,
      });
```

- [ ] **Step 4: Convert the `cancel` status write**

Replace (the `cancel` branch, ~lines 83-88):

```ts
      await svcDb.from("workflow_posts").update({
        status: "aprovado_cliente",
        instagram_container_id: null,
        publish_processing_at: null,
        publish_error: null,
      }).eq("id", postId);
```

with:

```ts
      await svcDb.rpc("record_post_status_change", {
        p_post_id: postId,
        p_new_status: "aprovado_cliente",
        p_source: "workspace_user",
        p_actor: actorId,
        p_fields: {
          instagram_container_id: null,
          publish_processing_at: null,
          publish_error: null,
        },
      });
```

- [ ] **Step 5: Convert the `retry` status write**

Replace (the `retry` branch, ~lines 96-102):

```ts
      await svcDb.from("workflow_posts").update({
        status: "agendado",
        publish_retry_count: 0,
        publish_error: null,
        instagram_container_id: null,
        publish_processing_at: null,
      }).eq("id", postId);
```

with:

```ts
      await svcDb.rpc("record_post_status_change", {
        p_post_id: postId,
        p_new_status: "agendado",
        p_source: "workspace_user",
        p_actor: actorId,
        p_fields: {
          publish_retry_count: 0,
          publish_error: null,
          instagram_container_id: null,
          publish_processing_at: null,
        },
      });
```

- [ ] **Step 6: Convert the publish-now "processing" status write**

Replace (the `publish-now` branch, ~lines 122-125):

```ts
      await svcDb.from("workflow_posts").update({
        status: "agendado",
        publish_processing_at: new Date().toISOString(),
      }).eq("id", postId);
```

with:

```ts
      await svcDb.rpc("record_post_status_change", {
        p_post_id: postId,
        p_new_status: "agendado",
        p_source: "workspace_user",
        p_actor: actorId,
        p_fields: { publish_processing_at: new Date().toISOString() },
      });
```

- [ ] **Step 7: Convert the `postado` (success) status write**

Replace (~lines 192-199):

```ts
        await svcDb.from("workflow_posts").update({
          instagram_media_id: result.id,
          status: "postado",
          published_at: new Date().toISOString(),
          publish_processing_at: null,
          publish_error: null,
          publish_retry_count: 0,
        }).eq("id", postId);
```

with:

```ts
        await svcDb.rpc("record_post_status_change", {
          p_post_id: postId,
          p_new_status: "postado",
          p_source: "workspace_user",
          p_actor: actorId,
          p_fields: {
            instagram_media_id: result.id,
            published_at: new Date().toISOString(),
            publish_processing_at: null,
            publish_error: null,
            publish_retry_count: 0,
          },
        });
```

- [ ] **Step 8: Convert the `falha_publicacao` (failure) status write**

Replace (~lines 211-215):

```ts
        await svcDb.from("workflow_posts").update({
          status: "falha_publicacao",
          publish_error: (err.message ?? "Unknown error").slice(0, 500),
          publish_processing_at: null,
        }).eq("id", postId);
```

with:

```ts
        await svcDb.rpc("record_post_status_change", {
          p_post_id: postId,
          p_new_status: "falha_publicacao",
          p_source: "workspace_user",
          p_actor: actorId,
          p_fields: {
            publish_error: (err.message ?? "Unknown error").slice(0, 500),
            publish_processing_at: null,
          },
        });
```

(Leave the two **non-status** writes unchanged: `instagram_container_id` at ~line 169-171, and `instagram_permalink` at ~line 205. The `IN_PROGRESS` write at ~lines 179-182 sets `scheduled_at`/`publish_processing_at` but **not** `status`, so it also stays as a plain `svcDb` update.)

- [ ] **Step 9: Typecheck the function**

Run: `deno check supabase/functions/instagram-publish/handler.ts`
Expected: no type errors.

- [ ] **Step 10: Run the edge-function test suite**

Run: `deno test supabase/functions/`
Expected: passes (no tests reference these call sites, so nothing should break).

- [ ] **Step 11: Commit**

```bash
git add supabase/functions/instagram-publish/handler.ts
git commit -m "feat(instagram-publish): record status changes via RPC with actor attribution"
```

---

## Task 7: Edge functions — `portal-approve` & `hub-approve` (atomic approval RPC)

**Files:**
- Modify: `supabase/functions/portal-approve/index.ts`
- Modify: `supabase/functions/hub-approve/handler.ts`

- [ ] **Step 1: Convert `portal-approve` insert+update to the RPC**

In `supabase/functions/portal-approve/index.ts`, replace the "Record approval" + "Update post status" block (~lines 108-119):

```ts
      // Record approval
      await db.from("post_approvals").insert({
        post_id,
        token,
        action,
        comentario: comentario?.trim() || null,
        is_workspace_user: false,
      });

      // Update post status
      const newStatus = action === "aprovado" ? "aprovado_cliente" : "correcao_cliente";
      await db.from("workflow_posts").update({ status: newStatus }).eq("id", post_id);
```

with:

```ts
      // Record approval + status transition atomically (links the comment to the event)
      const newStatus = action === "aprovado" ? "aprovado_cliente" : "correcao_cliente";
      const { error: approvalErr } = await db.rpc("record_client_approval", {
        p_post_id: post_id,
        p_token: token,
        p_action: action,
        p_comentario: comentario?.trim() || null,
        p_is_workspace_user: false,
        p_new_status: newStatus,
      });
      if (approvalErr) {
        return json({ error: "Failed to record approval" }, 500);
      }
```

(The existing status guard at ~line 104 stays. The `insertAuditLog` and auto-complete-etapa logic below stays unchanged.)

- [ ] **Step 2: Rework `hub-approve` — add guard + atomic RPC + system auto-publish**

In `supabase/functions/hub-approve/handler.ts`, replace the insert + status-update block (~lines 51-61):

```ts
    const { error: insertError } = await db.from("post_approvals").insert({
      post_id,
      token,
      action,
      comentario: comentario ?? null,
      is_workspace_user: false,
    });
    if (insertError) return json({ error: insertError.message }, 500);

    const newStatus = action === "aprovado" ? "aprovado_cliente" : action === "correcao" ? "correcao_cliente" : post.status;
    await db.from("workflow_posts").update({ status: newStatus }).eq("id", post_id);
```

with:

```ts
    if (action === "mensagem") {
      // Message-only: no status change, keep the plain insert.
      const { error: insertError } = await db.from("post_approvals").insert({
        post_id,
        token,
        action,
        comentario: comentario ?? null,
        is_workspace_user: false,
      });
      if (insertError) return json({ error: insertError.message }, 500);
    } else {
      // aprovado | correcao must actually transition the post.
      if (!["enviado_cliente", "correcao_cliente"].includes(post.status)) {
        return json({ error: "Post não está aguardando revisão do cliente." }, 400);
      }
      const newStatus = action === "aprovado" ? "aprovado_cliente" : "correcao_cliente";
      const { error: approvalErr } = await db.rpc("record_client_approval", {
        p_post_id: post_id,
        p_token: token,
        p_action: action,
        p_comentario: comentario ?? null,
        p_is_workspace_user: false,
        p_new_status: newStatus,
      });
      if (approvalErr) return json({ error: "Erro ao registrar aprovação." }, 500);
    }
```

- [ ] **Step 3: Route the `hub-approve` auto-publish through the RPC (source 'system')**

In the same file, replace the auto-publish status write (~lines 74-76):

```ts
          await db.from("workflow_posts")
            .update({ status: "agendado" })
            .eq("id", post_id);
```

with:

```ts
          await db.rpc("record_post_status_change", {
            p_post_id: post_id,
            p_new_status: "agendado",
            p_source: "system",
          });
```

- [ ] **Step 4: Typecheck both functions**

Run: `deno check supabase/functions/portal-approve/index.ts supabase/functions/hub-approve/handler.ts`
Expected: no type errors. (`hub-approve`'s `DbClient` type already includes `rpc`; `portal-approve`'s `db` is a full `createClient`, which has `rpc`.)

- [ ] **Step 5: Run the edge-function test suite**

Run: `deno test supabase/functions/`
Expected: passes.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/portal-approve/index.ts supabase/functions/hub-approve/handler.ts
git commit -m "feat(approvals): atomic client-approval RPC + hub-approve status guard"
```

---

## Task 8: Deploy edge functions + end-to-end verification

**Files:** none (deploy + manual verification)

- [ ] **Step 1: Deploy the changed edge functions to staging**

These functions handle their own auth, so they deploy with `--no-verify-jwt`:

```bash
npx supabase functions deploy instagram-publish --no-verify-jwt
npx supabase functions deploy portal-approve --no-verify-jwt
npx supabase functions deploy hub-approve --no-verify-jwt
```

Expected: each deploy succeeds.

- [ ] **Step 2: Manual smoke test against staging (CRM pointed at staging: `npm run dev:staging`)**

Verify each of these and confirm the post row's clock-icon popover updates after each action:
- Open a workflow drawer → expand a post → the clock icon shows at least a **Criado** node.
- Change a post's status via the CRM status dropdown → a new node appears with **source = your name** (workspace user). Confirm in SQL: `select to_status, source, actor_name from post_status_events order by created_at desc limit 1;`
- Schedule or publish-now via the drawer → node attributed to **your name**, not "Sistema".
- Approve a post from the client portal/hub → node labeled **"Cliente"**, `post_approval_id` populated, and the client comment shows on the node.
- Re-approve an already-approved post via hub → rejected with "Post não está aguardando revisão do cliente." (no duplicate approval row).

- [ ] **Step 3: Promote to production (after sign-off)**

```bash
npx supabase db push --linked --dry-run   # against the prod project ref; review the diff
npx supabase db push --linked              # apply migration
npx supabase functions deploy instagram-publish --no-verify-jwt
npx supabase functions deploy portal-approve --no-verify-jwt
npx supabase functions deploy hub-approve --no-verify-jwt
```

(Switch the linked project to prod first; see `reference_supabase_project_refs` — prod=`skjzpekeqefvlojenfsw`, staging=`wlyzhyfondykzpsiqsce`. Always dry-run first.)

---

## Notes / known limitations (from the spec)

- **Best-effort logging:** if the trigger insert ever fails it logs a `WARNING` and the status change still commits — so "one event per transition" is best-effort, not guaranteed.
- **No backfill:** transitions that happened before the migration were never recorded; old posts show only "Criado" plus transitions that occur after launch.
- **publish-now** intentionally produces two nodes (`agendado` then `postado`) — a faithful record of the actual transitions.
- The **publish cron** (`instagram-publish-cron`) is intentionally unchanged; cron-driven `postado`/`falha` attribute to "Sistema".
