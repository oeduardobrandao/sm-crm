\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Predicate truth table for can_see_financials().
--
-- IMPORTANT: these assertions must impersonate `authenticated`, not merely set
-- a JWT claim. Claims alone are enough for a SECURITY DEFINER function reading
-- auth.uid(), but the test session runs as the table owner, who bypasses RLS and
-- column privileges — a claims-only test would pass with the policies reverted.

begin;
do $$
declare
  v_ws    uuid;
  v_owner uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_agent uuid := gen_random_uuid();
  v_none  uuid := gen_random_uuid();
  v_got   boolean;
begin
  v_ws := et_make_workspace('start');

  insert into auth.users (id) values (v_owner), (v_admin), (v_agent), (v_none);
  insert into workspace_members (user_id, workspace_id, role) values
    (v_owner, v_ws, 'owner'),
    (v_admin, v_ws, 'admin'),
    (v_agent, v_ws, 'agent');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws
   where id in (v_owner, v_admin, v_agent);

  -- owner: true regardless of the flag
  update workspace_members set can_see_financials = false
   where user_id = v_owner and workspace_id = v_ws;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select public.can_see_financials() into v_got;
  reset role;
  if v_got is not true then
    raise exception 'owner with flag=false should still see financials, got %', v_got;
  end if;

  -- admin: follows the flag (true)
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select public.can_see_financials() into v_got;
  reset role;
  if v_got is not true then
    raise exception 'admin with default flag should see financials, got %', v_got;
  end if;

  -- admin: follows the flag (false)
  update workspace_members set can_see_financials = false
   where user_id = v_admin and workspace_id = v_ws;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select public.can_see_financials() into v_got;
  reset role;
  if v_got is not false then
    raise exception 'restricted admin should not see financials, got %', v_got;
  end if;

  -- agent: false regardless of the flag
  update workspace_members set can_see_financials = true
   where user_id = v_agent and workspace_id = v_ws;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_agent, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select public.can_see_financials() into v_got;
  reset role;
  if v_got is not false then
    raise exception 'agent with flag=true should NOT see financials, got %', v_got;
  end if;

  -- no membership: NULL (fails closed in an RLS USING clause)
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_none, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select public.can_see_financials() into v_got;
  reset role;
  if v_got is not null then
    raise exception 'non-member should get NULL, got %', v_got;
  end if;

  raise notice '50_can_see_financials: all predicate cases passed';
end $$;
rollback;

-- Anonymous cannot execute the helper.
begin;
do $$
declare v_ok boolean := false;
begin
  set local role anon;
  begin
    perform public.can_see_financials();
  exception when insufficient_privilege then
    v_ok := true;
  end;
  reset role;
  if not v_ok then
    raise exception 'anon must not be able to execute can_see_financials()';
  end if;
  raise notice '50_can_see_financials: anon correctly denied';
end $$;
rollback;
