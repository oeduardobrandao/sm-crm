\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

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
  update workspaces set created_by = v_uid where id = v_ws;
  insert into workspace_members (user_id, workspace_id, role)
    values (v_uid, v_ws, 'owner');
  insert into profiles (id, conta_id, role, nome, marketing_opt_in)
    values (v_uid, v_ws, 'owner', 'Ana Silva', p_opt_in);
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

-- 2. A workspace on a paid (non-default) plan produces no candidate.
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

-- 3. A CANCELLED subscription still counts as free: the mirror row survives
--    cancellation, so row existence is not a proxy for paid.
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

-- 4. THE REGRESSION: a dormant_signup sent 12h ago must suppress a paywall_hit
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

-- 5. Two claim_marketing_email calls for DIFFERENT types on one workspace:
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

-- 6. Send-time re-check: a workspace that subscribed after the RPC selected it
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

-- 7. An invited user (conta_id in signup metadata) is not a dormant_signup
--    candidate, even though workspaces.created_by points at them.
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

-- 8. Attempt cap: 20 is terminal, 19 with a stale claim is still eligible.
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
