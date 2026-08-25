\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

begin;
do $$
declare
  v_ws uuid;
  v_early uuid := gen_random_uuid();
  v_late uuid := gen_random_uuid();
  v_result jsonb;
  v_owner jsonb;
begin
  v_ws := et_make_workspace('max');

  insert into auth.users (id, email) values
    (v_early, 'early-owner@example.com'),
    (v_late,  'late-owner@example.com');

  -- v_late is inserted first, but v_early has the EARLIER joined_at -- the tie-break
  -- must go by joined_at, not insertion order.
  insert into workspace_members (user_id, workspace_id, role, joined_at) values
    (v_late,  v_ws, 'owner', now()),
    (v_early, v_ws, 'owner', now() - interval '1 day');

  -- handle_new_user_workspace already created a profile per user; re-point them.
  -- Must update profiles AFTER inserting into workspace_members, because the
  -- validate_active_workspace trigger checks workspace membership.
  update profiles set nome = 'Early Owner', conta_id = v_ws, active_workspace_id = v_ws
    where id = v_early;
  update profiles set nome = 'Late Owner', conta_id = v_ws, active_workspace_id = v_ws
    where id = v_late;

  execute 'set local role service_role';
  v_result := admin_list_workspaces(null, null, 0, 50);
  execute 'reset role';

  select w -> 'owner' into v_owner
    from jsonb_array_elements(v_result -> 'workspaces') w
   where (w ->> 'id')::uuid = v_ws;

  assert v_owner ->> 'name' = 'Early Owner',
    format('expected earliest-joined_at owner, got %s', v_owner ->> 'name');
  assert v_owner ->> 'email' = 'early-owner@example.com',
    'owner email must match the earliest-joined_at row';

  raise notice 'PASS 67_admin_list_workspaces_owner_tiebreak';
end $$;
rollback;
