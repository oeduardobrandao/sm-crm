\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

begin;
do $$
declare
  v_ws uuid; v_ws2 uuid;
  v_owner uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_nullu uuid := gen_random_uuid();
  v_cli bigint; v_tid uuid; v_old_tok uuid; v_new_tok uuid;
  v_count_before bigint; v_count_after bigint;
  v_exp timestamptz; v_denied boolean; v_audit bigint;
begin
  v_ws  := et_make_workspace('start');
  v_ws2 := et_make_workspace('start');

  insert into auth.users (id) values (v_owner), (v_other), (v_nullu);
  -- IMPORTANT: do NOT insert into profiles here. The AFTER INSERT trigger
  -- on_auth_user_created_workspace (handle_new_user_workspace) already created a profile
  -- for each user — and because a bare auth.users row carries no raw_user_meta_data, it
  -- took the ELSE branch and also created a throwaway conta+workspace per user, pointing
  -- each profile's active_workspace_id at THAT workspace. An INSERT here dies on
  -- duplicate key (profiles.id is the PK). Re-point the existing rows instead.
  -- owner -> v_ws; other -> v_ws2 (foreign workspace); nullu -> NULL active_workspace_id.
  --
  -- trg_validate_active_workspace (20260317_multi_workspace.sql) blocks pointing
  -- active_workspace_id at a workspace the user isn't a member of, so seed
  -- workspace_members first (et_make_workspace does not create membership rows).
  insert into workspace_members (user_id, workspace_id, role)
    values (v_owner, v_ws, 'owner'), (v_other, v_ws2, 'owner');
  update profiles set conta_id = v_ws,  active_workspace_id = v_ws  where id = v_owner;
  update profiles set conta_id = v_ws2, active_workspace_id = v_ws2 where id = v_other;
  update profiles set conta_id = v_ws,  active_workspace_id = null  where id = v_nullu;
  -- (role is left as the trigger set it; profiles.role is the user_role ENUM, not text,
  --  so any write to it needs an explicit ::user_role cast.)

  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_owner, v_ws, 'C', 'C', '#000') returning id into v_cli;
  insert into client_hub_tokens (cliente_id, conta_id, expires_at)
    values (v_cli, v_ws, now() + interval '10 days')
    returning id, token into v_tid, v_old_tok;

  -- ---- act as the legitimate owner ----
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner)::text, true);

  select count(*) into v_count_before from client_hub_tokens;
  select token into v_new_tok from hub_token_rotate(v_tid);
  select count(*) into v_count_after from client_hub_tokens;

  assert v_new_tok <> v_old_tok, 'rotate must change the token value';
  assert v_count_after = v_count_before,
    'rotate must NOT insert a row (would burn max_hub_tokens quota)';

  select expires_at into v_exp from client_hub_tokens where id = v_tid;
  assert v_exp > now() + interval '364 days', 'rotate must reset expires_at to 365d';

  -- extend
  update client_hub_tokens set expires_at = now() - interval '1 day' where id = v_tid;
  select hub_token_extend(v_tid) into v_exp;
  assert v_exp > now() + interval '364 days', 'extend must revive a lapsed token to 365d';

  -- audit rows written, and NO token value leaked into them
  select count(*) into v_audit from audit_log
   where resource_id = v_tid::text and action in ('hub_token.rotate','hub_token.extend');
  assert v_audit = 2, 'rotate and extend must each write an audit_log row';

  select count(*) into v_audit from audit_log
   where resource_id = v_tid::text
     and (metadata::text like '%' || v_old_tok::text || '%'
       or metadata::text like '%' || v_new_tok::text || '%');
  assert v_audit = 0, 'audit_log metadata must never contain a token value';

  -- ---- act as a user from ANOTHER workspace ----
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_other)::text, true);
  v_denied := false;
  begin perform hub_token_rotate(v_tid);
  exception when others then v_denied := true; end;
  assert v_denied, 'a foreign workspace must not rotate this token';

  -- ---- act as a user whose active_workspace_id IS NULL ----
  -- REGRESSION TEST for the IS DISTINCT FROM trap: with `<>` or `NOT IN`, the
  -- comparison yields NULL, the IF never fires, and this rotate SUCCEEDS.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_nullu)::text, true);
  v_denied := false;
  begin perform hub_token_rotate(v_tid);
  exception when others then v_denied := true; end;
  assert v_denied, 'a NULL active_workspace_id must not rotate any token';

  raise notice 'PASS 31_hub_token_rotate_extend';
end $$;
rollback;
