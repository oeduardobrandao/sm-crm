\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Robust against a previous aborted run of this file: ON_ERROR_STOP means any
-- unhandled exception in a case below exits psql immediately, skipping the
-- final `drop function` at the bottom and leaving this helper (created here at
-- top level, hence auto-committed, not inside any of the per-case
-- begin/rollback blocks) behind in the database. Dropping it first makes a
-- rerun start clean regardless of how the previous run ended.
drop function if exists et_loops_fixture(text, boolean, int);

-- Fixture builder: a confirmed self-serve owner of a fresh workspace on the
-- given plan, with the given consent. Returns (user_id, workspace_id).
create or replace function et_loops_fixture(
  p_plan_id text, p_opt_in boolean, p_confirmed_days_ago int default 5
) returns table (user_id uuid, workspace_id uuid) language plpgsql as $$
declare v_uid uuid := gen_random_uuid(); v_ws uuid;
begin
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
    values (v_uid, v_uid || '@et.test',
            now() - make_interval(days => p_confirmed_days_ago), '{}'::jsonb);
  v_ws := et_make_workspace(p_plan_id);
  -- Force v_ws to be the OLDER of this user's two workspaces. Without this,
  -- v_ws and the trigger's throwaway workspace (below) share the same
  -- transaction-start now() -- Postgres now() is fixed per transaction, and
  -- auth.users insert + et_make_workspace run in the same transaction here --
  -- so workspaces.created_at (DEFAULT now(), 20260317_multi_workspace.sql:11)
  -- is IDENTICAL on both rows. get_dormant_signup_candidates' dedupe
  -- (distinct on (u.id) order by u.id, ws.created_at asc, ws.id asc,
  -- 20260731000004) would then fall through the tied created_at straight to
  -- ws.id asc -- a coin flip between two independent gen_random_uuid()s.
  -- Roughly half the time the RPC would return the THROWAWAY workspace
  -- instead of v_ws, and every assertion below that filters
  -- get_dormant_signup_candidates() by workspace_id = f.workspace_id would
  -- flake. Backdating v_ws makes it deterministically the oldest, so the
  -- dedupe always picks it.
  update workspaces set created_at = now() - interval '1 day' where id = v_ws;
  update workspaces set created_by = v_uid where id = v_ws;
  insert into workspace_members (user_id, workspace_id, role)
    values (v_uid, v_ws, 'owner');
  -- Do NOT insert into profiles here. The AFTER INSERT trigger
  -- on_auth_user_created_workspace (handle_new_user_workspace,
  -- 20260317_multi_workspace.sql) already created a profiles row for v_uid --
  -- and because a bare auth.users insert carries no raw_user_meta_data, it
  -- took the ELSE branch, which ALSO created a throwaway conta+workspace with
  -- created_by = v_uid and a matching 'owner' workspace_members row (see
  -- 31_hub_token_rotate_extend.sql:19-24 for the same trap, hit first there).
  -- An INSERT here dies on profiles_pkey; UPDATE the row the trigger already
  -- made instead.
  --
  -- Consequence: every fixture user ends up owning TWO effectively-free
  -- workspaces (v_ws, forced oldest above, plus the trigger's throwaway one).
  -- Most assertions below filter get_*_candidates() by workspace_id =
  -- f.workspace_id: for get_paywall_hit_candidates and
  -- get_abandoned_checkout_candidates that is safe regardless of the second
  -- workspace, because both RPCs are genuinely workspace-scoped (one row per
  -- qualifying workspace, no cross-workspace dedupe). For
  -- get_dormant_signup_candidates it is safe ONLY because of the created_at
  -- backdating above, which pins which of the two workspaces its per-user
  -- dedupe returns. get_loops_trait_candidates is filtered by user_id instead
  -- (it aggregates across every owned workspace into one row per person, so
  -- workspace_id was never the right key there). Case 3 below deliberately
  -- filters get_dormant_signup_candidates by owner_user_id rather than
  -- workspace_id, specifically because counting by workspace_id can never
  -- observe the duplicate-user regression that case exists to catch.
  update profiles set conta_id = v_ws, role = 'owner'::user_role,
                       nome = 'Ana Silva', marketing_opt_in = p_opt_in
    where id = v_uid;
  return query select v_uid, v_ws;
end $$;

-- 1. An opted-out owner produces NO candidate from any of the three RPCs.
begin;
  do $$
  declare f record; n int;
  begin
    select * into f from et_loops_fixture((select id from plans where is_default), false);
    insert into paywall_hits (workspace_id, feature) values (f.workspace_id, 'feature_hub_portal');
    insert into checkout_attempts (workspace_id, stripe_session_id)
      values (f.workspace_id, 'cs_' || f.workspace_id);
    update checkout_attempts set created_at = now() - interval '30 hours'
      where workspace_id = f.workspace_id;

    select count(*) into n from get_paywall_hit_candidates() where workspace_id = f.workspace_id;
    if n <> 0 then raise exception 'opted-out owner produced a paywall_hit candidate'; end if;
    select count(*) into n from get_abandoned_checkout_candidates() where workspace_id = f.workspace_id;
    if n <> 0 then raise exception 'opted-out owner produced a checkout_abandoned candidate'; end if;
    select count(*) into n from get_dormant_signup_candidates() where workspace_id = f.workspace_id;
    if n <> 0 then raise exception 'opted-out owner produced a dormant_signup candidate'; end if;
    select count(*) into n from get_loops_trait_candidates() where user_id = f.user_id;
    if n <> 0 then raise exception 'opted-out owner was synced to Loops'; end if;
  end $$;
rollback;

-- 2. POSITIVE CONTROL: a well-formed opted-in, default-plan fixture actually
--    PRODUCES a candidate from get_dormant_signup_candidates,
--    get_abandoned_checkout_candidates, and get_loops_trait_candidates.
--    Without this, case 9's invited-user exclusion (and the opted-out
--    negatives in case 1) would pass identically if the underlying predicate
--    were deleted or the RPC always returned zero rows -- a test that passes
--    for the wrong reason is worse than no test. get_paywall_hit_candidates
--    already gets its positive control from case 5 below (n <> 1 there
--    proves the happy path, not just the cancellation carve-out).
begin;
  do $$
  declare f record; n int;
  begin
    select * into f from et_loops_fixture((select id from plans where is_default), true);

    select count(*) into n from get_dormant_signup_candidates() where workspace_id = f.workspace_id;
    if n <> 1 then raise exception 'opted-in fixture did not produce a dormant_signup candidate (got %)', n; end if;

    insert into checkout_attempts (workspace_id, stripe_session_id)
      values (f.workspace_id, 'cs_' || f.workspace_id);
    update checkout_attempts set created_at = now() - interval '30 hours'
      where workspace_id = f.workspace_id;
    select count(*) into n from get_abandoned_checkout_candidates() where workspace_id = f.workspace_id;
    if n <> 1 then raise exception 'opted-in fixture did not produce a checkout_abandoned candidate (got %)', n; end if;

    select count(*) into n from get_loops_trait_candidates() where user_id = f.user_id;
    if n <> 1 then raise exception 'opted-in fixture did not produce a loops trait candidate (got %)', n; end if;
  end $$;
rollback;

-- 3. THE REGRESSION: a user who self-created TWO qualifying free workspaces
--    (the fixture's own v_ws, plus handle_new_user_workspace's throwaway one
--    -- see et_loops_fixture's comment above) must be counted ONCE by
--    get_dormant_signup_candidates, not once per workspace. dormant_signup's
--    ledger row keys on user_id, so two rows here would mean two separate
--    emails to the same person -- and nothing else catches it: the two
--    workspaces take different advisory locks, the 72h cap is keyed by
--    workspace_id so the second workspace's check never sees the first
--    claim, and the Loops idempotency key is dormant_signup/<workspace_id>,
--    different per workspace. Deliberately filtering by owner_user_id here,
--    NOT workspace_id: every other case in this file filters by
--    workspace_id, which would hide a duplicate row surfacing under the
--    OTHER workspace_id entirely.
begin;
  do $$
  declare f record; n int;
  begin
    select * into f from et_loops_fixture((select id from plans where is_default), true);
    select count(*) into n from get_dormant_signup_candidates() where owner_user_id = f.user_id;
    if n <> 1 then
      raise exception 'user with two qualifying workspaces produced % dormant_signup rows, expected 1', n;
    end if;
  end $$;
rollback;

-- 4. A workspace on a paid (non-default) plan produces no candidate.
begin;
  do $$
  declare f record; n int; v_paid text;
  begin
    select id into v_paid from plans where not is_default limit 1;
    select * into f from et_loops_fixture(v_paid, true);
    insert into paywall_hits (workspace_id, feature) values (f.workspace_id, 'feature_hub_portal');
    select count(*) into n from get_paywall_hit_candidates() where workspace_id = f.workspace_id;
    if n <> 0 then raise exception 'paid workspace produced a candidate'; end if;
  end $$;
rollback;

-- 5. A CANCELLED subscription still counts as free: the mirror row survives
--    cancellation, so row existence is not a proxy for paid. This is also
--    get_paywall_hit_candidates' positive control: n <> 1 fails on either a
--    broken free-plan check OR a broken happy path.
begin;
  do $$
  declare f record; n int;
  begin
    select * into f from et_loops_fixture((select id from plans where is_default), true);
    insert into workspace_subscriptions (workspace_id, stripe_customer_id, status)
      values (f.workspace_id, 'cus_' || f.workspace_id, 'canceled');
    insert into paywall_hits (workspace_id, feature) values (f.workspace_id, 'feature_leads');
    select count(*) into n from get_paywall_hit_candidates() where workspace_id = f.workspace_id;
    if n <> 1 then raise exception 'cancelled workspace was not treated as free (got %)', n; end if;
  end $$;
rollback;

-- 6. THE REGRESSION: a dormant_signup sent 12h ago must suppress a paywall_hit
--    for the same workspace. Before dormant rows carried workspace_id, the cap
--    predicate could not see them at all.
begin;
  do $$
  declare f record; n int;
  begin
    select * into f from et_loops_fixture((select id from plans where is_default), true);
    insert into lifecycle_emails (email_type, user_id, workspace_id, sent_at, delivered_at)
      values ('dormant_signup', f.user_id, f.workspace_id, now() - interval '12 hours', now() - interval '12 hours');
    insert into paywall_hits (workspace_id, feature) values (f.workspace_id, 'feature_hub_portal');
    select count(*) into n from get_paywall_hit_candidates() where workspace_id = f.workspace_id;
    if n <> 0 then raise exception '72h cap did not cross event types'; end if;
  end $$;
rollback;

-- 7. Two claim_marketing_email calls for DIFFERENT types on one workspace:
--    exactly one wins.
begin;
  do $$
  declare f record; a boolean; b boolean;
  begin
    select * into f from et_loops_fixture((select id from plans where is_default), true);
    a := claim_marketing_email('paywall_hit', f.workspace_id, f.user_id, 1);
    b := claim_marketing_email('checkout_abandoned', f.workspace_id, f.user_id, 1);
    if not a then raise exception 'first claim should have won'; end if;
    if b then raise exception 'second claim of a different type should have been refused'; end if;
  end $$;
rollback;

-- 8. Send-time re-check: a workspace that subscribed after the RPC selected it
--    loses the claim.
begin;
  do $$
  declare f record; won boolean;
  begin
    select * into f from et_loops_fixture((select id from plans where is_default), true);
    insert into workspace_subscriptions (workspace_id, stripe_customer_id, status)
      values (f.workspace_id, 'cus_' || f.workspace_id, 'active');
    won := claim_marketing_email('paywall_hit', f.workspace_id, f.user_id, 1);
    if won then raise exception 'claim succeeded for a workspace with an active subscription'; end if;
  end $$;
rollback;

-- 9. An invited user (conta_id in signup metadata) is not a dormant_signup
--    candidate, even though workspaces.created_by points at them. Case 2
--    above is the positive control this negative relies on: without it, this
--    case would pass identically if the whole RPC always returned zero rows.
begin;
  do $$
  declare f record; n int;
  begin
    select * into f from et_loops_fixture((select id from plans where is_default), true);
    update auth.users set raw_user_meta_data = jsonb_build_object('conta_id', f.workspace_id::text)
      where id = f.user_id;
    select count(*) into n from get_dormant_signup_candidates() where workspace_id = f.workspace_id;
    if n <> 0 then raise exception 'invited user produced a dormant_signup candidate'; end if;
  end $$;
rollback;

-- 10. Attempt cap: 20 is terminal, 19 with a stale claim is still eligible.
begin;
  do $$
  declare f record; n int;
  begin
    select * into f from et_loops_fixture((select id from plans where is_default), true);
    insert into paywall_hits (workspace_id, feature) values (f.workspace_id, 'feature_leads');
    insert into lifecycle_emails (email_type, workspace_id, sent_at, attempts)
      values ('paywall_hit', f.workspace_id, now() - interval '2 hours', 20);
    select count(*) into n from get_paywall_hit_candidates() where workspace_id = f.workspace_id;
    if n <> 0 then raise exception 'attempts = 20 should be terminal'; end if;

    update lifecycle_emails set attempts = 19
      where email_type = 'paywall_hit' and workspace_id = f.workspace_id;
    select count(*) into n from get_paywall_hit_candidates() where workspace_id = f.workspace_id;
    if n <> 1 then raise exception 'attempts = 19 with a stale claim should be eligible (got %)', n; end if;
  end $$;
rollback;

drop function if exists et_loops_fixture(text, boolean, int);
