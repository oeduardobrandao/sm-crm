\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- switch_workspace() is the replacement for the client's direct UPDATE of
-- profiles.active_workspace_id / conta_id. Its whole value is the membership
-- check, so the non-member case below is the load-bearing test.

-- =============================================================
-- 1. anon cannot execute it at all.
-- =============================================================
begin;
do $$
declare v_denied boolean := false;
begin
  set local role anon;
  begin
    perform public.switch_workspace(gen_random_uuid());
  exception when insufficient_privilege then
    v_denied := true;
  end;
  reset role;
  if not v_denied then
    raise exception 'anon must not be able to execute switch_workspace';
  end if;
end $$;
rollback;

-- =============================================================
-- 2. A member can switch; a non-member cannot. Both directions in one
--    transaction so the positive case proves the negative is not simply
--    "everything fails".
-- =============================================================
begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws_a   uuid;
  v_ws_b   uuid;
  v_uid    uuid := gen_random_uuid();
  v_got    uuid;
  v_denied boolean := false;
begin
  v_ws_a := et_make_workspace('max');
  v_ws_b := et_make_workspace('max');

  insert into auth.users (id) values (v_uid);
  -- Member of A only.
  insert into workspace_members (user_id, workspace_id, role)
    values (v_uid, v_ws_a, 'owner');
  update profiles set conta_id = v_ws_a, active_workspace_id = v_ws_a
   where id = v_uid;

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);

  -- Positive: switching to a workspace we belong to succeeds and moves BOTH
  -- selectors. Checking only active_workspace_id would miss a partial write,
  -- and conta_id is the column the legacy policies actually read.
  perform public.switch_workspace(v_ws_a);
  reset role;
  select active_workspace_id into v_got from profiles where id = v_uid;
  if v_got is distinct from v_ws_a then
    raise exception 'authorized switch did not set active_workspace_id (got %)', v_got;
  end if;
  select conta_id into v_got from profiles where id = v_uid;
  if v_got is distinct from v_ws_a then
    raise exception 'authorized switch did not set conta_id (got %)', v_got;
  end if;

  -- Negative: workspace B, where we hold no membership.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  begin
    perform public.switch_workspace(v_ws_b);
  exception when others then
    v_denied := true;
  end;
  reset role;

  if not v_denied then
    raise exception 'switch_workspace allowed a non-member to switch';
  end if;

  -- And the refusal left nothing behind.
  select conta_id into v_got from profiles where id = v_uid;
  if v_got is distinct from v_ws_a then
    raise exception 'refused switch still mutated conta_id (got %)', v_got;
  end if;

  raise notice '55_switch_workspace_rpc: member switches, non-member refused';
end $$;
rollback;
