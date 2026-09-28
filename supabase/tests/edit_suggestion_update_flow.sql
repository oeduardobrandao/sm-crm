\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Suite for 20260928000001_edit_suggestion_update_flow.sql
-- (spec docs/superpowers/specs/2026-09-28-hub-editar-sugestao-diff-design.md §3).
--   E.1 notification metadata.updated: false on first insert, true after an update
--   E.2 upsert_edit_suggestion raises post_not_pending when the post left enviado_cliente
--   E.3 upsert_edit_suggestion raises post_not_pending for a foreign conta_id
--   E.4 create_edit_suggestion_notification returns 0 with no pending row
--   E.5 record_client_approval raises pending_suggestion for a client approval/correction
--   E.6 record_client_approval still succeeds for a workspace user with a pending row
--   E.7 accept_edit_suggestion still applies the suggestion (lock-order rewrite)

create or replace function pg_temp.esf_fixture(out ws uuid, out usr uuid, out cli bigint, out post bigint)
language plpgsql as $$
begin
  ws := et_make_workspace('max');
  usr := gen_random_uuid();
  insert into auth.users (id) values (usr);
  insert into workspace_members (user_id, workspace_id, role) values (usr, ws, 'owner');
  update profiles set conta_id = ws, active_workspace_id = ws where id = usr;
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (usr, ws, 'C', 'C', '#000') returning id into cli;
  insert into workflow_posts (conta_id, cliente_id, titulo, status, ig_caption, conteudo_plain)
    values (ws, cli, 'post sugestao', 'enviado_cliente', 'legenda v1', 'texto v1') returning id into post;
end $$;

-- E.1
begin;
do $$
declare f record; v_res jsonb; v_meta jsonb;
begin
  select * into f from pg_temp.esf_fixture();
  v_res := upsert_edit_suggestion(f.post, f.ws, 'tok', null, 'texto v1', 'legenda v2');
  assert v_res->>'action' = 'upserted' and (v_res->>'is_new')::boolean, format('first upsert: %s', v_res);
  perform create_edit_suggestion_notification(f.post);
  select metadata into v_meta from notifications
   where type = 'post_edit_suggestion' and (metadata->>'post_id')::bigint = f.post
   order by created_at desc limit 1;
  assert v_meta is not null, 'a notification must be created on first insert';
  assert (v_meta->>'updated')::boolean = false, format('first insert must be updated=false: %s', v_meta);

  -- created_at/updated_at are both now() inside one transaction; age the row so the
  -- BEFORE UPDATE trigger's new now() is observably later. That UPDATE itself fires the
  -- trigger (updated_at := now()), so reset updated_at = created_at afterwards; otherwise
  -- updated=true would hold even if the second upsert did nothing.
  update post_edit_suggestions set created_at = created_at - interval '1 minute' where post_id = f.post;
  alter table post_edit_suggestions disable trigger post_edit_suggestions_updated_at;
  update post_edit_suggestions set updated_at = created_at where post_id = f.post;
  alter table post_edit_suggestions enable trigger post_edit_suggestions_updated_at;
  v_res := upsert_edit_suggestion(f.post, f.ws, 'tok', null, 'texto v1', 'legenda v3');
  assert not (v_res->>'is_new')::boolean, 'second upsert must update the same pending row';
  delete from notifications where (metadata->>'post_id')::bigint = f.post;
  perform create_edit_suggestion_notification(f.post);
  select metadata into v_meta from notifications
   where type = 'post_edit_suggestion' and (metadata->>'post_id')::bigint = f.post
   order by created_at desc limit 1;
  assert (v_meta->>'updated')::boolean = true, format('update must be updated=true: %s', v_meta);
  raise notice 'PASS E.1 metadata.updated false on insert, true on update';
end $$;
rollback;

-- E.2
begin;
do $$
declare f record;
begin
  select * into f from pg_temp.esf_fixture();
  update workflow_posts set status = 'aprovado_cliente' where id = f.post;
  begin
    perform upsert_edit_suggestion(f.post, f.ws, 'tok', null, 'texto v1', 'legenda v2');
    raise exception 'expected post_not_pending' using errcode = 'P0002';
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'post_not_pending', format('unexpected message: %s', sqlerrm);
  end;
  assert not exists (select 1 from post_edit_suggestions where post_id = f.post), 'no row may be created';
  raise notice 'PASS E.2 upsert refuses a post that left enviado_cliente';
end $$;
rollback;

-- E.3
begin;
do $$
declare f record;
begin
  select * into f from pg_temp.esf_fixture();
  begin
    perform upsert_edit_suggestion(f.post, gen_random_uuid(), 'tok', null, 'texto v1', 'legenda v2');
    raise exception 'expected post_not_pending' using errcode = 'P0002';
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'post_not_pending', format('unexpected message: %s', sqlerrm);
  end;
  raise notice 'PASS E.3 upsert refuses a foreign conta_id';
end $$;
rollback;

-- E.4
begin;
do $$
declare f record; v_count int;
begin
  select * into f from pg_temp.esf_fixture();
  select create_edit_suggestion_notification(f.post) into v_count;
  assert v_count = 0, format('no pending row must notify nobody, got %s', v_count);
  assert not exists (select 1 from notifications where (metadata->>'post_id')::bigint = f.post);
  raise notice 'PASS E.4 notification is a no-op without a pending row';
end $$;
rollback;

-- E.5
begin;
do $$
declare f record; v_action text;
begin
  select * into f from pg_temp.esf_fixture();
  perform upsert_edit_suggestion(f.post, f.ws, 'tok', null, 'texto v1', 'legenda v2');
  foreach v_action in array array['aprovado', 'correcao'] loop
    begin
      perform record_client_approval(f.post, 'tok', v_action, null, false,
        case v_action when 'aprovado' then 'aprovado_cliente' else 'correcao_cliente' end);
      raise exception 'expected pending_suggestion for %', v_action using errcode = 'P0002';
    exception when sqlstate 'P0001' then
      assert sqlerrm = 'pending_suggestion', format('unexpected message: %s', sqlerrm);
    end;
  end loop;
  assert (select status from workflow_posts where id = f.post) = 'enviado_cliente', 'status must not move';
  assert (select status from post_edit_suggestions where post_id = f.post) = 'pending', 'suggestion must stay pending';
  raise notice 'PASS E.5 client approval/correction blocked while a suggestion is pending';
end $$;
rollback;

-- E.6
begin;
do $$
declare f record;
begin
  select * into f from pg_temp.esf_fixture();
  perform upsert_edit_suggestion(f.post, f.ws, 'tok', null, 'texto v1', 'legenda v2');
  perform record_client_approval(f.post, 'tok', 'aprovado', null, true, 'aprovado_cliente');
  assert (select status from workflow_posts where id = f.post) = 'aprovado_cliente';
  raise notice 'PASS E.6 workspace-user approval is not blocked';
end $$;
rollback;

-- E.7
begin;
do $$
declare f record; v_id bigint;
begin
  select * into f from pg_temp.esf_fixture();
  perform upsert_edit_suggestion(f.post, f.ws, 'tok', null, 'texto v1', 'legenda v2');
  select id into v_id from post_edit_suggestions where post_id = f.post and status = 'pending';
  perform accept_edit_suggestion(v_id);
  assert (select ig_caption from workflow_posts where id = f.post) = 'legenda v2';
  assert (select status from post_edit_suggestions where id = v_id) = 'accepted';
  raise notice 'PASS E.7 accept_edit_suggestion still applies the suggestion';
end $$;
rollback;
