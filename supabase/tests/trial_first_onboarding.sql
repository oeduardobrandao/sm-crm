\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Trial-first onboarding (20261102000001): workspaces.trial_offer_seen_at +
-- mark_trial_offer_seen(), lifecycle_emails.ref_at/meta,
-- workspace_subscriptions.switched_from_trialing and
-- get_trial_reminder_candidates(). Every block is begin/rollback.

-- Helper fixtures are created at top level (auto-committed), so drop first to
-- make a rerun after an aborted run start clean, and drop again at the bottom.
drop function if exists tfo_member(uuid, text, uuid);
drop function if exists tfo_trial_sub(uuid, interval, text);

-- A user with an email and a membership of the given role in p_ws. The auth.users
-- insert fires on_auth_user_created_workspace, which already made a profiles row
-- (and a throwaway workspace), so UPDATE the profile: its active workspace is p_ws.
create or replace function tfo_member(p_ws uuid, p_role text, p_uid uuid default gen_random_uuid())
returns uuid language plpgsql as $$
begin
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
    values (p_uid, p_uid || '@tfo.test', now(), '{}'::jsonb);
  insert into workspace_members (user_id, workspace_id, role)
    values (p_uid, p_ws, p_role);
  update profiles set conta_id = p_ws, active_workspace_id = p_ws, nome = 'Ana Silva'
    where id = p_uid;
  return p_uid;
end $$;

-- A workspace on 'max' (plan_source manual) with an owner and a trialing
-- subscription whose current_period_end is now() + p_end. Returns the workspace id.
create or replace function tfo_trial_sub(p_ws uuid, p_end interval, p_provider text default 'stripe')
returns uuid language plpgsql as $$
begin
  perform tfo_member(p_ws, 'owner');
  insert into workspace_subscriptions
    (workspace_id, status, plan_id, billing_interval, current_period_end,
     cancel_at_period_end, provider, amount_cents, amount_interval)
  values (p_ws, 'trialing', 'max', 'month', now() + p_end, false, p_provider, 13990, 'month');
  return p_ws;
end $$;

-- =============================================================
-- mark_seen_owner: an owner stamps the active workspace once; the second call
-- leaves the first timestamp alone.
-- =============================================================
begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws uuid := et_make_workspace('max');
  v_uid uuid;
  v_first timestamptz;
  v_second timestamptz;
begin
  v_uid := tfo_member(v_ws, 'owner');
  if (select trial_offer_seen_at from workspaces where id = v_ws) is not null then
    raise exception 'mark_seen_owner: column must start null';
  end if;

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  perform mark_trial_offer_seen();
  reset role;
  select trial_offer_seen_at into v_first from workspaces where id = v_ws;
  if v_first is null then
    raise exception 'mark_seen_owner: owner call did not set trial_offer_seen_at';
  end if;

  -- Backdate so a (wrongly) re-stamped value would visibly differ: now() is
  -- fixed within the transaction, so an unchanged-looking timestamp proves nothing.
  update workspaces set trial_offer_seen_at = v_first - interval '2 days' where id = v_ws;
  select trial_offer_seen_at into v_first from workspaces where id = v_ws;

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  perform mark_trial_offer_seen();
  reset role;
  select trial_offer_seen_at into v_second from workspaces where id = v_ws;
  if v_second is distinct from v_first then
    raise exception 'mark_seen_owner: second call overwrote the timestamp (% -> %)', v_first, v_second;
  end if;
  raise notice 'mark_seen_owner: ok';
end $$;
rollback;

-- =============================================================
-- mark_seen_non_owner_noop: an agent (and an admin) member cannot stamp it.
-- =============================================================
begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws uuid := et_make_workspace('max');
  v_agent uuid;
  v_admin uuid;
begin
  v_agent := tfo_member(v_ws, 'agent');
  v_admin := tfo_member(v_ws, 'admin');

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_agent, 'role', 'authenticated')::text, true);
  perform mark_trial_offer_seen();
  reset role;
  if (select trial_offer_seen_at from workspaces where id = v_ws) is not null then
    raise exception 'mark_seen_non_owner_noop: an agent stamped the workspace';
  end if;

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform mark_trial_offer_seen();
  reset role;
  if (select trial_offer_seen_at from workspaces where id = v_ws) is not null then
    raise exception 'mark_seen_non_owner_noop: an admin stamped the workspace';
  end if;
  raise notice 'mark_seen_non_owner_noop: ok';
end $$;
rollback;

-- =============================================================
-- mark_seen_active_workspace_only: an owner of A and B whose active workspace is
-- A stamps A only.
-- =============================================================
begin;
select et_grant_hosted_parity();
do $$
declare
  v_a uuid := et_make_workspace('max');
  v_b uuid := et_make_workspace('max');
  v_uid uuid;
begin
  v_uid := tfo_member(v_a, 'owner');
  insert into workspace_members (user_id, workspace_id, role) values (v_uid, v_b, 'owner');
  update profiles set conta_id = v_a, active_workspace_id = v_a where id = v_uid;

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  perform mark_trial_offer_seen();
  reset role;

  if (select trial_offer_seen_at from workspaces where id = v_a) is null then
    raise exception 'mark_seen_active_workspace_only: active workspace A was not stamped';
  end if;
  if (select trial_offer_seen_at from workspaces where id = v_b) is not null then
    raise exception 'mark_seen_active_workspace_only: non-active workspace B was stamped';
  end if;
  raise notice 'mark_seen_active_workspace_only: ok';
end $$;
rollback;

-- =============================================================
-- candidates_window: only first charges 3d..7d1h away qualify.
-- =============================================================
begin;
do $$
declare
  w2 uuid := tfo_trial_sub(et_make_workspace('max'), interval '2 days');
  w5 uuid := tfo_trial_sub(et_make_workspace('max'), interval '5 days');
  w7 uuid := tfo_trial_sub(et_make_workspace('max'), interval '7 days 30 minutes');
  w9 uuid := tfo_trial_sub(et_make_workspace('max'), interval '9 days');
  got uuid[];
begin
  select array_agg(workspace_id) into got
    from get_trial_reminder_candidates()
   where workspace_id in (w2, w5, w7, w9);
  if got is null or not (got @> array[w5, w7]) then
    raise exception 'candidates_window: +5d and +7d30m must be returned (got %)', got;
  end if;
  if w2 = any(got) then raise exception 'candidates_window: +2d must not be returned'; end if;
  if w9 = any(got) then raise exception 'candidates_window: +9d must not be returned'; end if;
  if cardinality(got) <> 2 then raise exception 'candidates_window: expected exactly 2 rows (got %)', got; end if;

  -- Ordered by first charge ascending; the row carries the announced facts.
  if (select workspace_id from get_trial_reminder_candidates()
       where workspace_id in (w5, w7) order by first_charge_at asc limit 1) is distinct from w5 then
    raise exception 'candidates_window: +5d must sort before +7d30m';
  end if;
  if not exists (
    select 1 from get_trial_reminder_candidates() c
     where c.workspace_id = w5 and c.plan_name = (select name from plans where id = 'max')
       and c.provider = 'stripe' and c.amount_cents = 13990 and c.amount_interval = 'month'
       and c.billing_interval = 'month' and c.attempts = 0
       and c.owner_email like '%@tfo.test' and c.owner_nome = 'Ana Silva'
  ) then
    raise exception 'candidates_window: returned columns do not match the subscription';
  end if;
  raise notice 'candidates_window: ok';
end $$;
rollback;

-- =============================================================
-- candidates_exclusions
-- =============================================================
begin;
do $$
declare
  w_cancel uuid := tfo_trial_sub(et_make_workspace('max'), interval '5 days');
  w_null   uuid := tfo_trial_sub(et_make_workspace('max'), interval '5 days');
  w_swf    uuid := tfo_trial_sub(et_make_workspace('max'), interval '5 days', 'pagarme');
  w_swn    uuid := tfo_trial_sub(et_make_workspace('max'), interval '5 days', 'pagarme');
  w_swt    uuid := tfo_trial_sub(et_make_workspace('max'), interval '5 days', 'pagarme');
  w_active uuid := tfo_trial_sub(et_make_workspace('max'), interval '5 days');
  w_noem   uuid := tfo_trial_sub(et_make_workspace('max'), interval '5 days');
  got uuid[];
begin
  update workspace_subscriptions set cancel_at_period_end = true where workspace_id = w_cancel;
  update workspace_subscriptions set current_period_end = null where workspace_id = w_null;
  update workspace_subscriptions set switched_from_stripe_subscription_id = 'sub_x',
         switched_from_trialing = false where workspace_id = w_swf;
  update workspace_subscriptions set switched_from_stripe_subscription_id = 'sub_y',
         switched_from_trialing = null where workspace_id = w_swn;
  update workspace_subscriptions set switched_from_stripe_subscription_id = 'sub_z',
         switched_from_trialing = true where workspace_id = w_swt;
  update workspace_subscriptions set status = 'active' where workspace_id = w_active;
  update auth.users set email = null
   where id in (select user_id from workspace_members where workspace_id = w_noem);

  select coalesce(array_agg(workspace_id), '{}') into got
    from get_trial_reminder_candidates()
   where workspace_id in (w_cancel, w_null, w_swf, w_swn, w_swt, w_active, w_noem);

  if w_cancel = any(got) then raise exception 'candidates_exclusions: cancel_at_period_end row returned'; end if;
  if w_null   = any(got) then raise exception 'candidates_exclusions: null current_period_end row returned'; end if;
  if w_swf    = any(got) then raise exception 'candidates_exclusions: switched_from_trialing=false row returned'; end if;
  if w_swn    = any(got) then raise exception 'candidates_exclusions: switched_from_trialing=null row returned'; end if;
  if w_active = any(got) then raise exception 'candidates_exclusions: non-trialing row returned'; end if;
  if w_noem   = any(got) then raise exception 'candidates_exclusions: owner without email returned'; end if;
  if not (w_swt = any(got)) then raise exception 'candidates_exclusions: switched_from_trialing=true row must be returned'; end if;
  if cardinality(got) <> 1 then raise exception 'candidates_exclusions: expected exactly 1 row (got %)', got; end if;
  raise notice 'candidates_exclusions: ok';
end $$;
rollback;

-- =============================================================
-- candidates_ledger
-- =============================================================
begin;
do $$
declare
  w uuid := tfo_trial_sub(et_make_workspace('max'), interval '5 days');
  v_end timestamptz;
  v_att int;
begin
  select current_period_end into v_end from workspace_subscriptions where workspace_id = w;

  -- Delivered for THIS first-charge date: excluded.
  insert into lifecycle_emails (email_type, workspace_id, sent_at, delivered_at, attempts, ref_at)
    values ('trial_reminder', w, now() - interval '2 days', now() - interval '2 days', 1, v_end);
  if exists (select 1 from get_trial_reminder_candidates() where workspace_id = w) then
    raise exception 'candidates_ledger: delivered reminder for the same ref_at must exclude the workspace';
  end if;

  -- The trial end moves (still inside the window): candidate again, attempts reset.
  update workspace_subscriptions set current_period_end = v_end + interval '1 day' where workspace_id = w;
  select attempts into v_att from get_trial_reminder_candidates() where workspace_id = w;
  if v_att is distinct from 0 then
    raise exception 'candidates_ledger: moved trial end must return attempts = 0 (got %)', v_att;
  end if;

  -- Same date again, now an undelivered claim.
  update workspace_subscriptions set current_period_end = v_end where workspace_id = w;
  update lifecycle_emails set delivered_at = null, attempts = 3, sent_at = now()
   where email_type = 'trial_reminder' and workspace_id = w;
  if exists (select 1 from get_trial_reminder_candidates() where workspace_id = w) then
    raise exception 'candidates_ledger: a fresh undelivered claim must not be a candidate';
  end if;

  -- Stale claim (older than 1h, under 30 attempts): retried, attempts preserved.
  update lifecycle_emails set sent_at = now() - interval '2 hours'
   where email_type = 'trial_reminder' and workspace_id = w;
  select attempts into v_att from get_trial_reminder_candidates() where workspace_id = w;
  if v_att is distinct from 3 then
    raise exception 'candidates_ledger: stale claim must be a candidate with its attempts (got %)', v_att;
  end if;

  -- Terminal: 30 attempts.
  update lifecycle_emails set attempts = 30
   where email_type = 'trial_reminder' and workspace_id = w;
  if exists (select 1 from get_trial_reminder_candidates() where workspace_id = w) then
    raise exception 'candidates_ledger: attempts >= 30 must be terminal';
  end if;

  -- A different email_type for the same workspace is not a trial_reminder ledger row.
  delete from lifecycle_emails where email_type = 'trial_reminder' and workspace_id = w;
  insert into lifecycle_emails (email_type, workspace_id, delivered_at)
    values ('subscription_thanks', w, now());
  if not exists (select 1 from get_trial_reminder_candidates() where workspace_id = w) then
    raise exception 'candidates_ledger: a subscription_thanks row must not suppress the reminder';
  end if;

  -- meta carries the announcement.
  insert into lifecycle_emails (email_type, workspace_id, ref_at, meta)
    values ('trial_reminder', w, v_end, jsonb_build_object('to', 'a@b.c', 'amount_cents', 13990));
  if (select meta ->> 'amount_cents' from lifecycle_emails
       where email_type = 'trial_reminder' and workspace_id = w) <> '13990' then
    raise exception 'candidates_ledger: meta jsonb round trip failed';
  end if;
  raise notice 'candidates_ledger: ok';
end $$;
rollback;

-- =============================================================
-- candidates_acl: service role only. Checked against proacl directly:
-- REVOKE FROM PUBLIC alone strips service_role too, and has_function_privilege
-- reports EFFECTIVE privilege, so it would mask a PUBLIC leak.
-- =============================================================
begin;
do $$
declare
  v_svc boolean; v_anon boolean; v_auth boolean; v_pub boolean;
begin
  if has_function_privilege('authenticated', 'get_trial_reminder_candidates()', 'execute') then
    raise exception 'candidates_acl: authenticated must not execute get_trial_reminder_candidates';
  end if;
  if has_function_privilege('anon', 'get_trial_reminder_candidates()', 'execute') then
    raise exception 'candidates_acl: anon must not execute get_trial_reminder_candidates';
  end if;
  if not has_function_privilege('service_role', 'get_trial_reminder_candidates()', 'execute') then
    raise exception 'candidates_acl: service_role must execute get_trial_reminder_candidates';
  end if;

  select
    bool_or(a.grantee = 'service_role'::regrole and a.privilege_type = 'EXECUTE'),
    bool_or(a.grantee = 'anon'::regrole          and a.privilege_type = 'EXECUTE'),
    bool_or(a.grantee = 'authenticated'::regrole and a.privilege_type = 'EXECUTE'),
    bool_or(a.grantee = 0::oid                   and a.privilege_type = 'EXECUTE')
  into v_svc, v_anon, v_auth, v_pub
  from pg_proc p, lateral aclexplode(p.proacl) a
  where p.oid = 'public.get_trial_reminder_candidates()'::regprocedure;
  if not coalesce(v_svc, false) then raise exception 'candidates_acl: service_role needs a DIRECT EXECUTE grant in proacl'; end if;
  if coalesce(v_anon, false) or coalesce(v_auth, false) or coalesce(v_pub, false) then
    raise exception 'candidates_acl: anon/authenticated/PUBLIC must have no EXECUTE in proacl';
  end if;

  -- mark_trial_offer_seen: authenticated yes; anon and PUBLIC no.
  select
    bool_or(a.grantee = 'authenticated'::regrole and a.privilege_type = 'EXECUTE'),
    bool_or(a.grantee = 'anon'::regrole          and a.privilege_type = 'EXECUTE'),
    bool_or(a.grantee = 0::oid                   and a.privilege_type = 'EXECUTE')
  into v_auth, v_anon, v_pub
  from pg_proc p, lateral aclexplode(p.proacl) a
  where p.oid = 'public.mark_trial_offer_seen()'::regprocedure;
  if not coalesce(v_auth, false) then raise exception 'candidates_acl: authenticated must execute mark_trial_offer_seen'; end if;
  if coalesce(v_anon, false) or coalesce(v_pub, false) then
    raise exception 'candidates_acl: anon/PUBLIC must not execute mark_trial_offer_seen';
  end if;
  raise notice 'candidates_acl: ok';
end $$;
rollback;

drop function if exists tfo_member(uuid, text, uuid);
drop function if exists tfo_trial_sub(uuid, interval, text);
