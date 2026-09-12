\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Regression test for the seat-limit first-row carve-out: when no plan has
-- is_default = true, a brand-new workspace's plan_id resolves to NULL and
-- effective_plan_limit() fails closed to 0 for every resource, including
-- max_team_members. Without the carve-out, the very first workspace_members
-- insert (the signup owner's own seat) would be blocked, aborting the whole
-- AFTER INSERT ON auth.users transaction. See migration
-- 20260919000009_seat_limit_first_row_carveout.sql.
begin;
do $$
declare
  v_uid uuid := gen_random_uuid();
  v_email text := 'seat-carveout-' || replace(v_uid::text, '-', '') || '@example.com';
  v_ws uuid;
  v_second_uid uuid := gen_random_uuid();
  v_blocked boolean := false;
begin
  -- Force the exact failure condition: zero plans with is_default = true.
  -- This UPDATE never commits (the whole test runs inside `begin; ... rollback;`).
  update plans set is_default = false where is_default;
  assert (select count(*) from plans where is_default) = 0,
    'setup failed: expected zero default plans';

  -- Fresh signup: no conta_id in metadata, so handle_new_user_workspace()
  -- takes the fresh-signup (owner) branch and creates a new workspace, then
  -- inserts the owner's workspace_members row. Must NOT raise.
  insert into auth.users (id, email, raw_user_meta_data)
    values (v_uid, v_email, jsonb_build_object('empresa', 'Seat Carveout Co'));

  select workspace_id into v_ws
    from workspace_members
    where user_id = v_uid and role = 'owner';

  assert v_ws is not null,
    'expected a workspace_members owner row for the freshly-signed-up user';

  raise notice 'PASS 93 first seat allowed with zero default plans';

  -- The carve-out must exempt only the FIRST row for this workspace: a
  -- second member insert, with the workspace still on zero default plans,
  -- must still be blocked by the seat limit. Use a real second auth.users
  -- row (workspace_members.user_id has an FK to auth.users) so a blocked
  -- insert unambiguously means "seat limit enforced", not "FK violation".
  insert into auth.users (id, email)
    values (v_second_uid, 'seat-carveout-second-' || replace(v_second_uid::text, '-', '') || '@example.com');
  begin
    insert into workspace_members (user_id, workspace_id, role)
      values (v_second_uid, v_ws, 'agent');
  exception when sqlstate 'P0001' then
    assert sqlerrm like 'plan_limit_exceeded:max_team_members%', format('wrong msg: %s', sqlerrm);
    v_blocked := true;
  end;
  assert v_blocked, 'second member insert should still be blocked (limit resolves to 0, not unlimited)';

  raise notice 'PASS 93 second seat still blocked (carve-out is first-row only)';
end $$;
rollback;
