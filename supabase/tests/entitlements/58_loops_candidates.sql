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
  -- 20260803000004) would then fall through the tied created_at straight to
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
--    claim. The Loops idempotency key is dormant_signup/<user_id>
--    (user-scoped), so Loops itself would 409 a second send on the same
--    key -- but that still means a wasted second claim/send round trip per
--    extra workspace, not a clean no-op. Deliberately filtering by owner_user_id here,
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

-- 8b. Send-time dormancy re-check: a user who creates their FIRST client between
--     get_dormant_signup_candidates' SELECT and the claim is no longer dormant,
--     so the dormant_signup claim must be refused. Otherwise they get a "you
--     haven't started yet" email minutes after starting.
--
--     The second half is the guard that keeps this scoped: the SAME workspace,
--     with the SAME client, must still win a paywall_hit claim. Widening the
--     zero-clientes predicate past the dormant branch would kill both
--     revenue-path triggers for every workspace that has a client, and only
--     this assertion catches that.
begin;
  do $$
  declare f record; won boolean; won_paywall boolean;
  begin
    select * into f from et_loops_fixture((select id from plans where is_default), true);
    insert into clientes (user_id, conta_id, nome, sigla, cor)
      values (f.user_id, f.workspace_id, 'Primeiro Cliente', 'PC', '#000');

    won := claim_marketing_email('dormant_signup', f.workspace_id, f.user_id, 1);
    if won then raise exception 'dormant_signup claim succeeded for a workspace that now has a client'; end if;

    won_paywall := claim_marketing_email('paywall_hit', f.workspace_id, f.user_id, 1);
    if not won_paywall then
      raise exception 'the zero-clientes re-check leaked past dormant_signup and refused paywall_hit';
    end if;
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

-- 11. Send-time re-check, MEMBERSHIP leg: the selected owner at SELECT time can
--     lose the workspace before the claim runs (removed from workspace_members,
--     or demoted). Consent, free plan and no-subscription all still hold, so
--     without the membership re-check the claim wins and the cron mails an
--     ex-member an event carrying workspaceName / planName / clientCount.
--     Three legs, all asserting FALSE:
--       (a) still an owner, but NOT the deterministically selected one -- the
--           pick's leading (wm.user_id = ws.created_by) desc tiebreak keeps
--           f.user_id ahead of u2 even though u2 joined earlier, so a re-check
--           written as a bare "is an owner" test, or one that copied only the
--           joined_at leg of the ORDER BY, would wrongly accept u2 here;
--       (b) membership row deleted outright -- the removed-member scenario;
--       (c) row present but demoted out of 'owner'.
--     u2's profile needs marketing_opt_in set explicitly: the column defaults to
--     false (20260719000002) and handle_new_user_workspace's new-signup branch
--     does not write it, so leg (a) would otherwise refuse at the CONSENT check
--     and pass for the wrong reason.
--
--     FIXTURE NOTE: et_loops_fixture builds its workspace on the free plan,
--     whose max_team_members is 1 (supabase/seed.sql), and the workspace
--     already holds f.user_id as its one seat. This case's whole point is a
--     SECOND owner (u2) coexisting with f.user_id, so a bare free-plan
--     workspace trips enforce_plan_count_limit('max_team_members', ...) the
--     moment u2 is inserted -- a fixture defect, not the product behaviour
--     under test. Raise the seat ceiling with a workspace_plan_overrides row,
--     the existing et_make_workspace(p_plan_id, p_overrides) convention (see
--     01_effective_plan_limit.sql, 02_clientes_limit.sql,
--     03_workspace_scoped.sql, 06_downgrade_keep_existing.sql). Scoped to this
--     case's own f.workspace_id inside this case's begin/rollback block, so it
--     does not touch the other 13 cases' fixtures. resource_overrides only
--     changes the effective_plan_limit() lookup (20260611130001_effective_plan_limit.sql)
--     -- it never writes workspaces.plan_id -- so the workspace still reads as
--     free for every `coalesce(ws.plan_id, default_plan_id()) = default_plan_id()`
--     gate the candidate RPCs use, which is exactly what this case needs to
--     keep exercising.
begin;
  do $$
  declare f record; u2 uuid := gen_random_uuid(); won boolean;
  begin
    select * into f from et_loops_fixture((select id from plans where is_default), true);
    insert into workspace_plan_overrides (workspace_id, resource_overrides)
      values (f.workspace_id, jsonb_build_object('max_team_members', 2));

    insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
      values (u2, u2 || '@et.test', now() - interval '5 days', '{}'::jsonb);
    update profiles set marketing_opt_in = true where id = u2;
    insert into workspace_members (user_id, workspace_id, role, joined_at)
      values (u2, f.workspace_id, 'owner', now() - interval '30 days');

    won := claim_marketing_email('paywall_hit', f.workspace_id, u2, 1);
    if won then
      raise exception 'claim succeeded for an owner who is not the deterministically selected one';
    end if;

    delete from workspace_members
      where workspace_id = f.workspace_id and user_id = f.user_id;
    won := claim_marketing_email('paywall_hit', f.workspace_id, f.user_id, 1);
    if won then
      raise exception 'claim succeeded for a user removed from workspace_members';
    end if;

    insert into workspace_members (user_id, workspace_id, role)
      values (f.user_id, f.workspace_id, 'agent');
    won := claim_marketing_email('paywall_hit', f.workspace_id, f.user_id, 1);
    if won then
      raise exception 'claim succeeded for a user demoted out of owner';
    end if;
  end $$;
rollback;

-- 12. any_free must mean what the event RPCs mean by free: effective default
--     plan AND no trialing/active subscription. A workspace whose plan_id still
--     resolves to the default plan while a real subscription is active (Stripe
--     webhook lag, a manual dashboard action, plan_source = 'manual') is NOT
--     free -- reporting it as free files a paying customer into Loops'
--     free-plan segment and points the free-to-paid campaigns at someone who
--     already pays.
--     The delete is load-bearing: the fixture user owns TWO workspaces (v_ws
--     plus handle_new_user_workspace's throwaway one -- see et_loops_fixture's
--     comment), and bool_or is true if ANY owned workspace is free, so the
--     throwaway free workspace would mask the regression entirely. Dropping
--     that membership makes f.workspace_id genuinely the user's only workspace,
--     which is also what lets workspace_count be asserted at 1 -- proving the
--     subscription exclusion narrowed only any_free and did not leak into the
--     row set and deflate the count.
begin;
  do $$
  declare f record; v_any boolean; n int;
  begin
    select * into f from et_loops_fixture((select id from plans where is_default), true);
    delete from workspace_members
      where user_id = f.user_id and workspace_id <> f.workspace_id;

    -- Control: with no subscription, the same user MUST report any_free = true.
    -- Without this, the assertion below would pass identically if the fix had
    -- inverted the expression or made it constantly false.
    select any_free into v_any from get_loops_trait_candidates() where user_id = f.user_id;
    if v_any is not true then
      raise exception 'default-plan workspace with no subscription should report any_free = true (got %)', v_any;
    end if;

    insert into workspace_subscriptions (workspace_id, stripe_customer_id, status)
      values (f.workspace_id, 'cus_' || f.workspace_id, 'active');

    select any_free, workspace_count into v_any, n
      from get_loops_trait_candidates() where user_id = f.user_id;
    if n is null then raise exception 'trait candidate row disappeared for the fixture user'; end if;
    if n <> 1 then raise exception 'workspace_count should stay 1, got %', n; end if;
    if v_any is not false then
      raise exception 'active subscription on a default-plan workspace still reported any_free = % (expected false)', v_any;
    end if;
  end $$;
rollback;

-- 13. THE PII RACE: a user with a PENDING contact deletion must NOT be
--     trait-synced until that deletion lands.
--     loops_contacts holds the OLD address after an email change, and
--     get_loops_contact_deletions selects it on its
--     `u.email is distinct from lc.synced_email` branch. If that delete fails
--     transiently at Loops, deleted_at is not stamped -- and the trait sweep,
--     which runs LAST in the same invocation, would call recordContactSync and
--     overwrite synced_email with the NEW address. From that moment
--     u.email = lc.synced_email, the deletions RPC can never select the row on
--     any branch again, and the Loops contact for the old address (name +
--     email) is stranded at the vendor permanently with nothing in our system
--     recording it. One transient failure, unrecoverable PII residue.
--     Both controls below are load-bearing: without them this case would pass
--     identically if the exclusion were written too broadly and suppressed
--     every previously-synced user, which would silently stop trait sync
--     altogether.
begin;
  do $$
  declare f record; n int; v_lc uuid;
  begin
    select * into f from et_loops_fixture((select id from plans where is_default), true);

    -- The email changed; the vendor still holds the old address and no deletion
    -- has landed. synced_at is backdated deliberately: the RPC orders by
    -- `lc.synced_at asc nulls first` under `limit 200`, so a fresh timestamp
    -- would sort this user LAST and a database with 200+ opted-in confirmed
    -- users could push them out of the window -- making the assertion below
    -- pass for the wrong reason. Backdating pins them at the front.
    insert into loops_contacts (user_id, synced_email, synced_at)
      values (f.user_id, 'old-' || f.user_id || '@et.test', now() - interval '365 days')
      returning id into v_lc;

    select count(*) into n from get_loops_trait_candidates() where user_id = f.user_id;
    if n <> 0 then
      raise exception 'user with a pending contact deletion was trait-synced (got % rows)', n;
    end if;

    -- Control A: once the deletion LANDS, the user syncs again -- the exclusion
    -- delays the sync, it does not cancel it. This is the self-heal.
    update loops_contacts set deleted_at = now() where id = v_lc;
    select count(*) into n from get_loops_trait_candidates() where user_id = f.user_id;
    if n <> 1 then
      raise exception 'user whose contact deletion completed should sync again (got %)', n;
    end if;

    -- Control B: a live row whose synced_email still MATCHES the user is not a
    -- pending deletion and must keep syncing normally.
    update loops_contacts
      set deleted_at = null,
          synced_email = (select u.email::text from auth.users u where u.id = f.user_id)
      where id = v_lc;
    select count(*) into n from get_loops_trait_candidates() where user_id = f.user_id;
    if n <> 1 then
      raise exception 'an up-to-date synced contact should still be trait-synced (got %)', n;
    end if;
  end $$;
rollback;

-- 14. record_loops_contact is the atomic write side of case 13, and it also
--     covers the TRIGGER sweeps, which have no candidate-side pending-deletion
--     exclusion at all. Loops' events/send creates a contact when none exists,
--     so the trigger path puts PII at the vendor exactly like the trait path
--     does; the ledger row has to be written first, and it must REFUSE rather
--     than overwrite a synced_email whose deletion is still owed.
begin;
  do $$
  declare f record; ok boolean; v_lc uuid; v_email text; v_deleted timestamptz;
  begin
    select * into f from et_loops_fixture((select id from plans where is_default), true);

    -- Never synced before: records, and reports that the caller may proceed.
    ok := record_loops_contact(f.user_id, 'first@et.test');
    if not ok then raise exception 'first record for a fresh user should have been accepted'; end if;
    select synced_email into v_email from loops_contacts where user_id = f.user_id;
    if v_email <> 'first@et.test' then
      raise exception 'ledger row holds %, expected first@et.test', v_email;
    end if;

    -- Same address again: idempotent, still accepted.
    ok := record_loops_contact(f.user_id, 'first@et.test');
    if not ok then raise exception 're-recording the same address should be accepted'; end if;

    -- THE REFUSAL: a live row for a DIFFERENT address means a deletion is owed
    -- at Loops. Overwriting it would make get_loops_contact_deletions unable to
    -- select the old address on any branch, ever again.
    ok := record_loops_contact(f.user_id, 'second@et.test');
    if ok then
      raise exception 'record was accepted while a deletion was owed for a different address';
    end if;
    select synced_email into v_email from loops_contacts where user_id = f.user_id;
    if v_email <> 'first@et.test' then
      raise exception 'refused record still clobbered synced_email (now %)', v_email;
    end if;

    -- Self-heal: once the deletion lands, the new address records normally and
    -- the row is revived. Without this control the assertion above would pass
    -- identically if the function simply always refused.
    select id into v_lc from loops_contacts where user_id = f.user_id;
    update loops_contacts set deleted_at = now() where id = v_lc;
    ok := record_loops_contact(f.user_id, 'second@et.test');
    if not ok then
      raise exception 'record should be accepted once the pending deletion has landed';
    end if;
    select synced_email, deleted_at into v_email, v_deleted
      from loops_contacts where user_id = f.user_id;
    if v_email <> 'second@et.test' then
      raise exception 'ledger row holds % after the deletion landed, expected second@et.test', v_email;
    end if;
    if v_deleted is not null then
      raise exception 'a revived ledger row must clear deleted_at, got %', v_deleted;
    end if;
  end $$;
rollback;

drop function if exists et_loops_fixture(text, boolean, int);
