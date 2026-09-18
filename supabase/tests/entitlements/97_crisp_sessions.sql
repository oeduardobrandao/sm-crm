\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- crisp_sessions (migration 20260925000012): the per-user Crisp Session
-- Continuity token behind window.CRISP_TOKEN_ID. Only crisp-identity's
-- service-role client ever touches it.
--
-- Unlike 78_admin_mcp_oauth_grants (which inserts its fixture as the table
-- owner and so never exercises a service_role positive), this suite runs the
-- real get-or-create AS service_role -- the exact statement PostgREST
-- compiles `.upsert({ user_id }, { onConflict: 'user_id' })` to -- and
-- asserts the token is stable across calls.
--
-- crisp_sessions is EXCLUDED from et_grant_hosted_parity(): the helper
-- re-grants ALL on every public table to anon/authenticated, which would
-- silently undo the very REVOKE this suite asserts (see the helper's own
-- p_exclude comment).

begin;
select et_grant_hosted_parity(array['crisp_sessions']);
-- Defensive: 92_reorder_fluxos_board.sql calls et_grant_hosted_parity() at
-- its top level, outside any transaction, so its grants commit permanently
-- instead of rolling back like every other suite's usage -- a pre-existing
-- test-isolation gap in that file, not something this suite should also
-- carry. Any suite numbered after 92 that asserts a hard REVOKE (this one
-- does; most others rely on RLS instead, which isn't affected) inherits
-- those leaked grants unless it strips them itself first.
revoke all on crisp_sessions from anon, authenticated;
do $$
declare
  v_ua       uuid := gen_random_uuid();
  v_t1       uuid;
  v_t2       uuid;
  v_n        int  := -1;
  v_rejected boolean;
begin
  -- Fixture as the table owner, BEFORE any role switch: auth.users is not
  -- writable by the app roles.
  insert into auth.users (id) values (v_ua);

  -- service_role positive: get-or-create twice returns ONE stable token.
  execute 'set local role service_role';
  insert into crisp_sessions (user_id) values (v_ua)
    on conflict (user_id) do update set user_id = excluded.user_id
    returning token into v_t1;
  insert into crisp_sessions (user_id) values (v_ua)
    on conflict (user_id) do update set user_id = excluded.user_id
    returning token into v_t2;
  assert v_t1 is not null, 'service_role get-or-create returned no token';
  assert v_t1 = v_t2,
    format('second get-or-create minted a new token (%s vs %s)', v_t1, v_t2);
  select count(*) into v_n from crisp_sessions where user_id = v_ua;
  assert v_n = 1, format('expected exactly one crisp_sessions row, got %s', v_n);
  execute 'reset role';

  -- authenticated (the row's OWN user): table privilege denied outright.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_ua, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  v_rejected := false;
  begin
    select count(*) into v_n from crisp_sessions;
  exception when insufficient_privilege then
    v_rejected := true;
  end;
  assert v_rejected, 'authenticated read crisp_sessions';

  v_rejected := false;
  begin
    insert into crisp_sessions (user_id) values (v_ua)
      on conflict (user_id) do update set user_id = excluded.user_id;
  exception when insufficient_privilege then
    v_rejected := true;
  end;
  assert v_rejected, 'authenticated wrote crisp_sessions';

  v_rejected := false;
  begin
    update crisp_sessions set token = gen_random_uuid() where user_id = v_ua;
  exception when insufficient_privilege then
    v_rejected := true;
  end;
  assert v_rejected, 'authenticated rotated a crisp_sessions token';

  execute 'reset role';

  -- anon: table privilege denied outright.
  execute 'set local role anon';
  v_rejected := false;
  begin
    select count(*) into v_n from crisp_sessions;
  exception when insufficient_privilege then
    v_rejected := true;
  end;
  assert v_rejected, 'anon read crisp_sessions';
  execute 'reset role';
end $$;
rollback;
