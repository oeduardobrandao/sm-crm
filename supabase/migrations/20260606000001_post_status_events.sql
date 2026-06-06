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
