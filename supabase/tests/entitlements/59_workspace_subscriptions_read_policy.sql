\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- workspace_subscriptions_owner_read must authorize against workspace_members
-- for the ACTIVE workspace, never against the global profiles.role.
--
-- WHY THIS SUITE EXISTS. The original policy (20260609120003) ANDed
-- `workspace_id = profiles.conta_id` with `profiles.role = 'owner'`.
-- switch_workspace() rewrites conta_id and active_workspace_id together but
-- leaves profiles.role alone, so for any multi-workspace user those two
-- conjuncts describe different workspaces. 20260804000001 replaces the role
-- conjunct with an EXISTS over workspace_members, matching the check
-- billing-checkout performs server side.
--
-- Every case below runs under `SET LOCAL ROLE authenticated`, because the table
-- owner bypasses row security entirely and a test that does not impersonate
-- proves nothing about an RLS policy. et_grant_hosted_parity() is required
-- first: local table privileges do not match hosted Supabase's, and without it
-- the impersonated SELECT fails with permission denied before RLS is ever
-- consulted (see the helper's own header).
--
-- The two stale-role cases are the point of the suite. The four are asserted in
-- ONE transaction on purpose: the positive reads prove the negative ones are
-- genuine denials and not "the whole fixture is unreadable".

-- =============================================================
-- 1. Structural: the shipped policy no longer authorizes on profiles.role.
--    Cheap, and it fails loudly if a later migration reinstates the old body.
-- =============================================================
do $$
declare v_qual text;
begin
  select qual into v_qual from pg_policies
   where schemaname = 'public'
     and tablename  = 'workspace_subscriptions'
     and policyname = 'workspace_subscriptions_owner_read';

  if v_qual is null then
    raise exception 'workspace_subscriptions_owner_read is missing';
  end if;
  if v_qual not like '%workspace_members%' then
    raise exception 'policy does not consult workspace_members: %', v_qual;
  end if;
  -- The conta_id conjunct is deliberately retained; losing it would let an
  -- owner of A read A's billing row while active in B.
  if v_qual not like '%conta_id%' then
    raise exception 'policy lost its conta_id active-workspace conjunct: %', v_qual;
  end if;
end $$;

-- =============================================================
-- 2. Behaviour, all four cases against real rows.
-- =============================================================
begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws         uuid;
  v_other_ws   uuid;
  -- stale profiles.role = 'owner', actually an agent in v_ws (the exposure)
  v_stale_own  uuid := gen_random_uuid();
  -- stale profiles.role = 'agent', actually the owner of v_ws (wrongly blocked)
  v_stale_agt  uuid := gen_random_uuid();
  -- ordinary owner: profile role and membership agree
  v_owner      uuid := gen_random_uuid();
  -- owner of a DIFFERENT workspace, holding no membership in v_ws
  v_outsider   uuid := gen_random_uuid();
  v_n          int;
begin
  v_ws       := et_make_workspace('max');
  v_other_ws := et_make_workspace('max');

  insert into auth.users (id)
    values (v_stale_own), (v_stale_agt), (v_owner), (v_outsider);

  insert into workspace_subscriptions (workspace_id, stripe_customer_id, status)
    values (v_ws, 'cus_et_59', 'canceled');

  -- Membership rows FIRST: trg_validate_active_workspace refuses an
  -- active_workspace_id the user does not already belong to.
  insert into workspace_members (user_id, workspace_id, role) values
    (v_stale_own, v_ws, 'agent'),
    (v_stale_agt, v_ws, 'owner'),
    (v_owner,     v_ws, 'owner');

  update profiles set role = 'owner', conta_id = v_ws, active_workspace_id = v_ws
   where id = v_stale_own;
  update profiles set role = 'agent', conta_id = v_ws, active_workspace_id = v_ws
   where id = v_stale_agt;
  update profiles set role = 'owner', conta_id = v_ws, active_workspace_id = v_ws
   where id = v_owner;

  -- The outsider sits consistently in v_other_ws, which it owns.
  --
  -- A user whose conta_id points at v_ws while holding NO membership there is
  -- not constructible, and deliberately so: trg_validate_active_workspace
  -- refuses to set active_workspace_id without a membership row, and
  -- get_my_conta_id() returns NULL unless a membership row exists for the
  -- active workspace, which would hide the user's own profile row from the
  -- policy's conta_id subquery. So case (d) below isolates the conjunct that
  -- IS reachable here: workspace_id = conta_id, i.e. an owner active in A
  -- cannot read B's billing row. That is exactly why 20260804000001 keeps that
  -- conjunct rather than relying on membership alone.
  insert into workspace_members (user_id, workspace_id, role)
    values (v_outsider, v_other_ws, 'owner');
  update profiles set role = 'owner', conta_id = v_other_ws,
                      active_workspace_id = v_other_ws
   where id = v_outsider;

  -- Guard the fixture: without the row there is nothing to deny, and every
  -- negative case below would "pass" vacuously.
  select count(*) into v_n from workspace_subscriptions where workspace_id = v_ws;
  if v_n <> 1 then
    raise exception 'fixture is wrong: expected 1 subscription row, found %', v_n;
  end if;

  -- (a) stale 'owner' profile, agent membership: MUST NOT read. This is the
  --     hole the migration closes; under the old policy this returned the row.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_stale_own, 'role', 'authenticated')::text, true);
  select count(*) into v_n from workspace_subscriptions where workspace_id = v_ws;
  reset role;
  if v_n <> 0 then
    raise exception 'EXPOSURE: agent member with stale profiles.role = owner read '
                     '% billing row(s) for the active workspace', v_n;
  end if;

  -- (b) stale 'agent' profile, owner membership: MUST read. Under the old
  --     policy this was blocked, hasEverSubscribed read false, and
  --     billing-checkout charged the card instead of opening a trial.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_stale_agt, 'role', 'authenticated')::text, true);
  select count(*) into v_n from workspace_subscriptions where workspace_id = v_ws;
  reset role;
  if v_n <> 1 then
    raise exception 'owner member with stale profiles.role = agent could not read '
                     'its own workspace billing row (got % rows)', v_n;
  end if;

  -- (c) ordinary owner, profile role and membership agreeing: MUST read.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  select count(*) into v_n from workspace_subscriptions where workspace_id = v_ws;
  reset role;
  if v_n <> 1 then
    raise exception 'ordinary owner could not read its workspace billing row '
                     '(got % rows)', v_n;
  end if;

  -- (d) owner of another workspace, active there: MUST NOT read v_ws.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_outsider, 'role', 'authenticated')::text, true);
  select count(*) into v_n from workspace_subscriptions where workspace_id = v_ws;
  reset role;
  if v_n <> 0 then
    raise exception 'non-member read % billing row(s) for a workspace it does '
                     'not belong to', v_n;
  end if;

  raise notice '59_workspace_subscriptions_read_policy: stale-owner agent denied, '
               'stale-agent owner allowed, ordinary owner allowed, non-member denied';
end $$;
rollback;
