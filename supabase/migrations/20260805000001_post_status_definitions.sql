-- =====================================================================
-- 20260805000001_post_status_definitions.sql
-- Custom post statuses (layered "behaves-as" model).
--
-- A custom status is workspace-defined vocabulary that maps onto one of
-- the six non-machine canonical statuses. The canonical
-- workflow_posts.status column stays the single source of truth for all
-- behavior (hub visibility, publish crons, approval RPCs, counts); a
-- post carrying custom_status_id merely displays differently in the CRM.
-- Invariant, enforced by the z1 trigger below on every write path:
--   custom_status_id IS NOT NULL  =>  status = definition.behaves_as
-- The machine statuses (agendado/postado/falha_publicacao) can never
-- have custom stand-ins: any transition into them clears the pointer.
-- =====================================================================

-- ---------- Definitions table ----------------------------------------
create table post_status_definitions (
  id         uuid primary key default gen_random_uuid(),
  conta_id   uuid not null references workspaces(id) on delete cascade,
  nome       text not null check (length(btrim(nome)) between 1 and 40),
  cor        text not null default '#94a3b8',
  behaves_as text not null check (behaves_as in
    ('rascunho', 'revisao_interna', 'aprovado_interno',
     'enviado_cliente', 'aprovado_cliente', 'correcao_cliente')),
  ordem      integer not null default 0,
  arquivado  boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Lets referencing tables (post_status_automations) use a composite FK
  -- that guarantees the referenced definition belongs to the same tenant.
  constraint post_status_definitions_id_conta_uq unique (id, conta_id)
);

-- Block live duplicates (case-insensitive) but allow reusing a name
-- after archiving.
create unique index post_status_definitions_conta_nome_live
  on post_status_definitions (conta_id, lower(btrim(nome)))
  where not arquivado;

create index idx_post_status_definitions_conta
  on post_status_definitions (conta_id);

create or replace function set_post_status_definitions_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger post_status_definitions_updated_at
  before update on post_status_definitions
  for each row execute function set_post_status_definitions_updated_at();

-- ---------- Detach posts when a definition is archived or deleted ------
-- Archiving/deleting happens on post_status_definitions, so the z1 trigger
-- on workflow_posts never sees it. This trigger detaches pointing posts
-- atomically: each post keeps its canonical status (the UPDATE mentions
-- only custom_status_id, so z1 early-returns on the null pointer) and the
-- audit trigger snapshots the definition's nome while the row still
-- exists (BEFORE DELETE runs before the row disappears, unlike the FK's
-- ON DELETE SET NULL, which would resolve after it).
create or replace function detach_posts_from_status_definition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    update workflow_posts set custom_status_id = null where custom_status_id = old.id;
    return old;
  end if;
  if new.arquivado and not old.arquivado then
    update workflow_posts set custom_status_id = null where custom_status_id = new.id;
  end if;
  return new;
end;
$$;

create trigger post_status_definitions_detach_posts
  before delete or update of arquivado on post_status_definitions
  for each row execute function detach_posts_from_status_definition();

-- ---------- Plan gate --------------------------------------------------
-- Custom statuses ship under the same plan feature as custom properties.
-- If they are ever sold separately: add a feature_custom_statuses plan
-- column defaulting to feature_custom_properties and swap the arg here.
drop trigger if exists trg_feature_post_status_defs on post_status_definitions;
create trigger trg_feature_post_status_defs
  before insert on post_status_definitions
  for each row execute function enforce_plan_feature('feature_custom_properties', 'direct', 'conta_id');

-- ---------- RLS --------------------------------------------------------
alter table post_status_definitions enable row level security;

-- Every workspace member (agents included) can read: the kanban, drawer
-- and chips need labels/colors. Only owner/admin manage definitions.
create policy psd_select on post_status_definitions
  for select using (conta_id in (select public.get_my_conta_id()));

create policy psd_insert on post_status_definitions
  for insert with check (
    conta_id in (select public.get_my_conta_id())
    and public.get_my_role() in ('owner', 'admin')
  );

create policy psd_update on post_status_definitions
  for update using (
    conta_id in (select public.get_my_conta_id())
    and public.get_my_role() in ('owner', 'admin')
  )
  with check (conta_id in (select public.get_my_conta_id()));

create policy psd_delete on post_status_definitions
  for delete using (
    conta_id in (select public.get_my_conta_id())
    and public.get_my_role() in ('owner', 'admin')
  );

create policy service_role_bypass_psd on post_status_definitions
  for all to service_role using (true) with check (true);

-- ---------- workflow_posts.custom_status_id ---------------------------
alter table workflow_posts
  add column custom_status_id uuid references post_status_definitions(id) on delete set null;

create index idx_workflow_posts_custom_status
  on workflow_posts (custom_status_id)
  where custom_status_id is not null;

-- ---------- Reconciliation trigger (z1) --------------------------------
-- BEFORE trigger so the pair (status, custom_status_id) is consistent in
-- the row that later AFTER triggers (audit, notifications) observe.
-- The OF-list keeps it away from hot updates that touch neither column
-- (claim_posts_for_publishing, hub_reorder_post_schedules, reordering).
create or replace function reconcile_post_custom_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_behaves text;
begin
  if new.custom_status_id is null then
    return new;
  end if;

  select behaves_as into v_behaves
    from post_status_definitions
   where id = new.custom_status_id
     and conta_id = new.conta_id
     and not arquivado;

  if v_behaves is null then
    -- Dangling, archived, or cross-tenant pointer: drop it.
    new.custom_status_id := null;
    return new;
  end if;

  if tg_op = 'INSERT'
     or new.custom_status_id is distinct from old.custom_status_id then
    -- Custom status explicitly (re)set: canonical must follow behaves_as.
    new.status := v_behaves;
  elsif new.status is distinct from old.status and new.status <> v_behaves then
    -- Canonical moved away (publish cron, client approval, re-arm, bulk
    -- send): the custom stand-in no longer applies.
    new.custom_status_id := null;
  elsif new.status <> v_behaves then
    -- Stale pairing touched by an unrelated status write.
    new.custom_status_id := null;
  end if;

  return new;
end;
$$;

-- BEFORE triggers on the same event fire in name order; z1 must run
-- after set_published_at/updated_at and before the (future) z2
-- automations trigger.
drop trigger if exists workflow_posts_z1_reconcile_custom_status on workflow_posts;
create trigger workflow_posts_z1_reconcile_custom_status
  before insert or update of status, custom_status_id on workflow_posts
  for each row execute function reconcile_post_custom_status();

-- ---------- Audit: extend post_status_events ---------------------------
-- Custom-status transitions are audited too. Labels are snapshotted so
-- history keeps its meaning after a definition is renamed or deleted.
alter table post_status_events
  add column from_custom_status_id uuid,
  add column to_custom_status_id   uuid,
  add column from_custom_nome      text,
  add column to_custom_nome        text;

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
  v_from_nome  text;
  v_to_nome    text;
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

    if old.custom_status_id is not null then
      select nome into v_from_nome from post_status_definitions where id = old.custom_status_id;
    end if;
    if new.custom_status_id is not null then
      select nome into v_to_nome from post_status_definitions where id = new.custom_status_id;
    end if;

    insert into post_status_events
      (post_id, conta_id, from_status, to_status, source,
       actor_user_id, actor_name, post_approval_id,
       from_custom_status_id, to_custom_status_id,
       from_custom_nome, to_custom_nome)
    values
      (new.id, new.conta_id, old.status, new.status, v_source,
       v_actor, v_actor_name, v_approval,
       old.custom_status_id, new.custom_status_id,
       v_from_nome, v_to_nome);
  exception when others then
    raise warning 'record_post_status_event failed for post %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

-- Widen the trigger so a custom-only move (canonical unchanged, e.g.
-- rascunho -> custom "Briefing" that behaves as rascunho) is audited.
drop trigger if exists workflow_posts_status_event on workflow_posts;
create trigger workflow_posts_status_event
  after update of status, custom_status_id on workflow_posts
  for each row
  when (new.status is distinct from old.status
        or new.custom_status_id is distinct from old.custom_status_id)
  execute function record_post_status_event();
