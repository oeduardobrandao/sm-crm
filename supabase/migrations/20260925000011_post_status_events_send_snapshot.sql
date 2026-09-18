-- =====================================================================
-- 20260925000011_post_status_events_send_snapshot.sql
-- Snapshot of the caption/plain text on every "sent to client" event, so
-- the Hub can diff what the client saw in send N-1 vs send N. Copied from
-- NEW.* inside the status trigger: immutable by construction. A foreign key
-- to post_content_versions would NOT be: record_post_content_version()
-- coalesces a later same-actor edit into the tip row for 5 minutes
-- (20260923000001_post_content_versions.sql:119-140), so the referenced
-- row could change after the client already saw the text.
-- Function body copied from 20260805000001_post_status_definitions.sql
-- (the latest definition, with the custom-status columns) plus the two
-- snapshot assignments. Trigger unchanged.
-- =====================================================================

alter table post_status_events
  add column if not exists snapshot_conteudo_plain text,
  add column if not exists snapshot_ig_caption     text;

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
  v_snap_plain text;
  v_snap_cap   text;
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

    -- Only a real transition INTO enviado_cliente is a "send"; a custom-only
    -- move that keeps status = enviado_cliente is not.
    if new.status = 'enviado_cliente' and new.status is distinct from old.status then
      v_snap_plain := new.conteudo_plain;
      v_snap_cap   := new.ig_caption;
    end if;

    insert into post_status_events
      (post_id, conta_id, from_status, to_status, source,
       actor_user_id, actor_name, post_approval_id,
       from_custom_status_id, to_custom_status_id,
       from_custom_nome, to_custom_nome,
       snapshot_conteudo_plain, snapshot_ig_caption)
    values
      (new.id, new.conta_id, old.status, new.status, v_source,
       v_actor, v_actor_name, v_approval,
       old.custom_status_id, new.custom_status_id,
       v_from_nome, v_to_nome,
       v_snap_plain, v_snap_cap);
  exception when others then
    raise warning 'record_post_status_event failed for post %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;
