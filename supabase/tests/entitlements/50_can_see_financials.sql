\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Predicate truth table for can_see_financials().
--
-- IMPORTANT: two mechanisms are combined below, for two different reasons —
-- neither is redundant with the other.
--
-- `request.jwt.claims` is strictly necessary: auth.uid() reads it, and without
-- it every case here returns NULL regardless of role.
--
-- `SET LOCAL ROLE authenticated` is NOT needed for the five truth-table
-- outcomes themselves — can_see_financials() is SECURITY DEFINER, so its
-- internal read of workspace_members is role-independent. It is load-bearing
-- anyway, as the only positive proof in this file that `authenticated`
-- actually holds EXECUTE on the function: delete the GRANT in the migration
-- and this first block dies with insufficient_privilege instead of silently
-- passing.

-- Anonymous cannot execute the helper. Runs first and stays independent of
-- the truth-table block below (own transaction) so it still executes even if
-- ON_ERROR_STOP aborts the file on a truth-table failure.
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
  v_ws := et_make_workspace('max');

  insert into auth.users (id) values (v_owner), (v_admin), (v_agent), (v_none);
  insert into workspace_members (user_id, workspace_id, role) values
    (v_owner, v_ws, 'owner'),
    (v_admin, v_ws, 'admin'),
    (v_agent, v_ws, 'agent');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws
   where id in (v_owner, v_admin, v_agent);

  -- v_none must be made a genuine non-participant, and inserting them into
  -- auth.users is NOT enough. That insert fires handle_new_user_workspace()
  -- (20260317_multi_workspace.sql), which auto-creates a throwaway workspace
  -- and makes the new user its OWNER. Verified live on a fresh local database:
  -- memberships=1, role=owner, active_workspace_id NOT NULL. Left alone,
  -- v_none is an owner of their own workspace and the predicate correctly
  -- returns true — the assertion below would fail for a reason that has
  -- nothing to do with the code under test.
  --
  -- Null the pointer instead of deleting the membership:
  -- trg_validate_active_workspace forbids active_workspace_id pointing at a
  -- workspace the user does not belong to, so "member of nothing, pointing
  -- somewhere" is unreachable by construction. Same precedent as
  -- 31_hub_token_rotate_extend.sql:34.
  update profiles set active_workspace_id = null where id = v_none;

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

  -- No active workspace: NULL, which fails closed in an RLS USING clause.
  -- (The other NULL-yielding case — membership deleted while
  -- active_workspace_id still points at the workspace — is the stale-pointer
  -- assertion in 51_financial_views.sql.)
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_none, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select public.can_see_financials() into v_got;
  reset role;
  if v_got is not null then
    raise exception 'user with no active workspace should get NULL, got %', v_got;
  end if;

  raise notice '50_can_see_financials: all predicate cases passed';
end $$;
rollback;
