\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Nurture for owners who never subscribed (migration 20261119000001):
-- get_nurture_candidates(p_now) and claim_nurture_email(...).
--
-- Every call passes p_now explicitly. The pinned clock is
--   T = '2026-11-10 13:00:00+00'  (Tuesday 10:00 in America/Sao_Paulo)
-- and every other instant is T moved onto a weekday 10:00 SP, so the 9h-11h59
-- weekday window never makes a case pass or fail by accident.

-- Same rerun reason as 58_loops_candidates.sql: the fixture is created at top
-- level (auto-committed), so an aborted previous run leaves it behind.
drop function if exists et_nurture_fixture(int);

-- Fixture: the self-serve owner of a fresh, never-subscribed workspace, with
-- p_clients clients. Returns (user_id, workspace_id).
--
-- The signup trigger trap (58_loops_candidates.sql:24-60): the bare auth.users
-- insert fires handle_new_user_workspace, which creates a throwaway workspace
-- with created_by = v_uid, the same transaction-start created_at, an 'owner'
-- workspace_members row, and points profiles.conta_id at it. Left in place it
-- would be a second never-subscribed workspace of the same person. So the
-- fixture forward-dates v_ws (newest of the person's workspaces), points
-- profiles.conta_id at v_ws and then deletes the throwaway workspace, so
-- "owns no ever-subscribed workspace" and "one sequence per person" only ever
-- see v_ws.
create or replace function et_nurture_fixture(p_clients int default 0)
returns table (user_id uuid, workspace_id uuid) language plpgsql as $$
declare
  v_uid uuid := gen_random_uuid();
  v_ws uuid;
  v_t timestamptz := '2026-11-10 13:00:00+00';
  i int;
begin
  insert into auth.users (id, email, email_confirmed_at, last_sign_in_at, raw_user_meta_data)
    values (v_uid, v_uid || '@et.test', now(), now(), '{}'::jsonb);
  v_ws := et_make_workspace((select id from plans where is_default));
  -- et_make_workspace creates plan_source = 'manual', which is excluded.
  update workspaces
     set created_by = v_uid,
         created_at = now() + interval '1 minute',
         plan_source = 'system',
         name = 'Agencia ' || left(v_uid::text, 8)
   where id = v_ws;
  insert into workspace_members (user_id, workspace_id, role)
    values (v_uid, v_ws, 'owner');
  update profiles set conta_id = v_ws, nurture_opt_out_at = null, nome = 'Ana Silva'
   where id = v_uid;
  delete from workspaces where created_by = v_uid and id <> v_ws;
  update auth.users set created_at = v_t - interval '4 days' where id = v_uid;
  for i in 1..p_clients loop
    insert into clientes (user_id, conta_id, nome, sigla, cor, created_at)
      values (v_uid, v_ws, 'Cliente ' || i, 'C' || i, '#000',
              now() + make_interval(secs => i));
  end loop;
  return query select v_uid, v_ws;
end $$;

-- 0. Fixture sanity: exactly one workspace owned by the person.
begin;
  select et_grant_hosted_parity();
  do $$
  declare f record; n int;
  begin
    select * into f from et_nurture_fixture(0);
    select count(*) into n from workspace_members where user_id = f.user_id and role = 'owner';
    if n <> 1 then raise exception 'fixture: person owns % workspaces, expected 1', n; end if;
    if (select conta_id from profiles where id = f.user_id) <> f.workspace_id then
      raise exception 'fixture: profiles.conta_id is not the fixture workspace';
    end if;
  end $$;
rollback;

-- 1. a1_for_new_zero_clients
begin;
  select et_grant_hosted_parity();
  do $$
  declare f record; r record; n int; v_t timestamptz := '2026-11-10 13:00:00+00';
  begin
    select * into f from et_nurture_fixture(0);
    select count(*) into n from get_nurture_candidates(v_t) c where c.workspace_id = f.workspace_id;
    if n <> 1 then raise exception 'a1_for_new_zero_clients: % rows, expected 1', n; end if;
    select * into r from get_nurture_candidates(v_t) c where c.workspace_id = f.workspace_id;
    if r.step <> 'a1' or r.email_type <> 'nurture_a1' or r.attempts <> 0
       or r.client_count <> 0 or r.user_id <> f.user_id or r.has_instagram
       or r.first_client_name is not null or r.email <> f.user_id || '@et.test'
       or r.nome <> 'Ana Silva' then
      raise exception 'a1_for_new_zero_clients: unexpected row %', row_to_json(r);
    end if;
  end $$;
rollback;

-- 2. b1_with_first_client_and_instagram
begin;
  select et_grant_hosted_parity();
  do $$
  declare f record; r record; n int; v_cli bigint; v_t timestamptz := '2026-11-10 13:00:00+00';
  begin
    select * into f from et_nurture_fixture(2);
    select id into v_cli from clientes where conta_id = f.workspace_id order by created_at, id limit 1;
    insert into instagram_accounts (client_id, instagram_user_id, authorization_status)
      values (v_cli, 'ig-' || f.workspace_id, 'active');
    select count(*) into n from get_nurture_candidates(v_t) c where c.workspace_id = f.workspace_id;
    if n <> 1 then raise exception 'b1_with_first_client_and_instagram: % rows, expected 1', n; end if;
    select * into r from get_nurture_candidates(v_t) c where c.workspace_id = f.workspace_id;
    if r.step <> 'b1' or r.client_count <> 2 or r.first_client_name <> 'Cliente 1'
       or not r.has_instagram or r.attempts <> 0 then
      raise exception 'b1_with_first_client_and_instagram: unexpected row %', row_to_json(r);
    end if;
    -- a revoked Instagram does not count
    update instagram_accounts set authorization_status = 'revoked' where client_id = v_cli;
    select * into r from get_nurture_candidates(v_t) c where c.workspace_id = f.workspace_id;
    if r.has_instagram then raise exception 'b1: revoked instagram counted as connected'; end if;
  end $$;
rollback;

-- 3. outside_window_empty
begin;
  select et_grant_hosted_parity();
  do $$
  declare f record; n int;
  begin
    select * into f from et_nurture_fixture(0);
    select count(*) into n from get_nurture_candidates('2026-11-14 13:00+00') c where c.workspace_id = f.workspace_id;
    if n <> 0 then raise exception 'outside_window_empty: saturday returned % rows', n; end if;
    select count(*) into n from get_nurture_candidates('2026-11-10 15:00+00') c where c.workspace_id = f.workspace_id;
    if n <> 0 then raise exception 'outside_window_empty: 12:00 SP returned % rows', n; end if;
    select count(*) into n from get_nurture_candidates('2026-11-10 11:59+00') c where c.workspace_id = f.workspace_id;
    if n <> 0 then raise exception 'outside_window_empty: 08:59 SP returned % rows', n; end if;
    -- edges inside the window
    select count(*) into n from get_nurture_candidates('2026-11-10 12:00+00') c where c.workspace_id = f.workspace_id;
    if n <> 1 then raise exception 'outside_window_empty: 09:00 SP returned % rows, expected 1', n; end if;
    select count(*) into n from get_nurture_candidates('2026-11-10 14:59+00') c where c.workspace_id = f.workspace_id;
    if n <> 1 then raise exception 'outside_window_empty: 11:59 SP returned % rows, expected 1', n; end if;
  end $$;
rollback;

-- 4. excluded_states: one fixture each, all -> 0 rows. Plus inverses.
begin;
  select et_grant_hosted_parity();
  do $$
  declare f record; n int; v_t timestamptz := '2026-11-10 13:00:00+00'; v_other uuid;
  begin
    -- trialing subscription
    select * into f from et_nurture_fixture(0);
    insert into workspace_subscriptions (workspace_id, status) values (f.workspace_id, 'trialing');
    select count(*) into n from get_nurture_candidates(v_t) c where c.workspace_id = f.workspace_id;
    if n <> 0 then raise exception 'excluded_states: trialing returned % rows', n; end if;

    -- canceled Stripe subscription (a cancelled trial is still "ever subscribed")
    select * into f from et_nurture_fixture(0);
    insert into workspace_subscriptions (workspace_id, status, stripe_subscription_id)
      values (f.workspace_id, 'canceled', 'sub_' || f.workspace_id);
    select count(*) into n from get_nurture_candidates(v_t) c where c.workspace_id = f.workspace_id;
    if n <> 0 then raise exception 'excluded_states: canceled stripe sub returned % rows', n; end if;

    -- canceled Pagar.me subscription
    select * into f from et_nurture_fixture(0);
    insert into workspace_subscriptions (workspace_id, status, pagarme_subscription_id)
      values (f.workspace_id, 'canceled', 'pg_' || f.workspace_id);
    select count(*) into n from get_nurture_candidates(v_t) c where c.workspace_id = f.workspace_id;
    if n <> 0 then raise exception 'excluded_states: canceled pagarme sub returned % rows', n; end if;

    -- ever_subscribed_at
    select * into f from et_nurture_fixture(0);
    insert into workspace_subscriptions (workspace_id, status, ever_subscribed_at)
      values (f.workspace_id, 'canceled', v_t - interval '30 days');
    select count(*) into n from get_nurture_candidates(v_t) c where c.workspace_id = f.workspace_id;
    if n <> 0 then raise exception 'excluded_states: ever_subscribed_at returned % rows', n; end if;

    -- demo workspace
    select * into f from et_nurture_fixture(0);
    update workspaces set demo_created_at = v_t - interval '10 days' where id = f.workspace_id;
    select count(*) into n from get_nurture_candidates(v_t) c where c.workspace_id = f.workspace_id;
    if n <> 0 then raise exception 'excluded_states: demo returned % rows', n; end if;

    -- manual plan
    select * into f from et_nurture_fixture(0);
    update workspaces set plan_source = 'manual' where id = f.workspace_id;
    select count(*) into n from get_nurture_candidates(v_t) c where c.workspace_id = f.workspace_id;
    if n <> 0 then raise exception 'excluded_states: manual plan returned % rows', n; end if;

    -- opted out
    select * into f from et_nurture_fixture(0);
    update profiles set nurture_opt_out_at = v_t - interval '1 day' where id = f.user_id;
    select count(*) into n from get_nurture_candidates(v_t) c where c.workspace_id = f.workspace_id;
    if n <> 0 then raise exception 'excluded_states: opted out returned % rows', n; end if;

    -- active workspace is another one
    select * into f from et_nurture_fixture(0);
    v_other := et_make_workspace((select id from plans where is_default));
    update profiles set conta_id = v_other where id = f.user_id;
    select count(*) into n from get_nurture_candidates(v_t) c where c.workspace_id = f.workspace_id;
    if n <> 0 then raise exception 'excluded_states: conta_id elsewhere returned % rows', n; end if;

    -- workspace older than 180 days
    select * into f from et_nurture_fixture(0);
    update workspaces set created_at = v_t - interval '181 days' where id = f.workspace_id;
    select count(*) into n from get_nurture_candidates(v_t) c where c.workspace_id = f.workspace_id;
    if n <> 0 then raise exception 'excluded_states: 181-day-old workspace returned % rows', n; end if;

    -- account younger than 72h
    select * into f from et_nurture_fixture(0);
    update auth.users set created_at = v_t - interval '71 hours' where id = f.user_id;
    select count(*) into n from get_nurture_candidates(v_t) c where c.workspace_id = f.workspace_id;
    if n <> 0 then raise exception 'excluded_states: 71h-old account returned % rows', n; end if;

    -- welcome delivered 71h ago (cap)
    select * into f from et_nurture_fixture(0);
    insert into lifecycle_emails (email_type, user_id, workspace_id, sent_at, delivered_at)
      values ('welcome', f.user_id, f.workspace_id, v_t - interval '71 hours', v_t - interval '71 hours');
    select count(*) into n from get_nurture_candidates(v_t) c where c.workspace_id = f.workspace_id;
    if n <> 0 then raise exception 'excluded_states: recent welcome returned % rows', n; end if;

    -- inverse: welcome delivered 73h ago -> eligible
    select * into f from et_nurture_fixture(0);
    insert into lifecycle_emails (email_type, user_id, workspace_id, sent_at, delivered_at)
      values ('welcome', f.user_id, f.workspace_id, v_t - interval '73 hours', v_t - interval '73 hours');
    select count(*) into n from get_nurture_candidates(v_t) c where c.workspace_id = f.workspace_id;
    if n <> 1 then raise exception 'excluded_states: old welcome returned % rows, expected 1', n; end if;

    -- inverse: no welcome row at all -> eligible (pre-welcome signups)
    select * into f from et_nurture_fixture(0);
    select count(*) into n from get_nurture_candidates(v_t) c where c.workspace_id = f.workspace_id;
    if n <> 1 then raise exception 'excluded_states: no-welcome signup returned % rows, expected 1', n; end if;

    -- inverse: a canceled subscription row with no ids and no marker is still never-paid
    select * into f from et_nurture_fixture(0);
    insert into workspace_subscriptions (workspace_id, stripe_customer_id, status)
      values (f.workspace_id, 'cus_' || f.workspace_id, 'canceled');
    select count(*) into n from get_nurture_candidates(v_t) c where c.workspace_id = f.workspace_id;
    if n <> 1 then raise exception 'excluded_states: id-less canceled row returned % rows, expected 1', n; end if;
  end $$;
rollback;

-- 5. owns_other_paid_workspace
begin;
  select et_grant_hosted_parity();
  do $$
  declare f record; n int; v_t timestamptz := '2026-11-10 13:00:00+00'; v_ws2 uuid;
  begin
    select * into f from et_nurture_fixture(0);
    v_ws2 := et_make_workspace((select id from plans where is_default));
    -- v_ws2 stays plan_source = 'manual' from et_make_workspace: only the
    -- subscription predicate counts on OTHER workspaces, so a manual plan there
    -- must not block (positive control below).
    update workspaces set created_by = f.user_id where id = v_ws2;
    insert into workspace_members (user_id, workspace_id, role) values (f.user_id, v_ws2, 'owner');
    select count(*) into n from get_nurture_candidates(v_t) c where c.workspace_id = f.workspace_id;
    if n <> 1 then raise exception 'owns_other_paid_workspace: control (other ws never paid) returned % rows, expected 1', n; end if;
    insert into workspace_subscriptions (workspace_id, status, stripe_subscription_id)
      values (v_ws2, 'canceled', 'sub_' || v_ws2);
    select count(*) into n from get_nurture_candidates(v_t) c where c.workspace_id = f.workspace_id;
    if n <> 0 then raise exception 'owns_other_paid_workspace: % rows', n; end if;
  end $$;
rollback;

-- 6. cadence_a
begin;
  select et_grant_hosted_parity();
  do $$
  declare f record; r record; n int; v_t timestamptz := '2026-11-10 13:00:00+00';
  begin
    -- a1 delivered 3 days ago: nothing yet; day 4 -> a2
    select * into f from et_nurture_fixture(0);
    insert into nurture_emails (workspace_id, step, recipient_user_id, sent_at, delivered_at)
      values (f.workspace_id, 'a1', f.user_id, v_t - interval '3 days', v_t - interval '3 days');
    select count(*) into n from get_nurture_candidates(v_t) c where c.workspace_id = f.workspace_id;
    if n <> 0 then raise exception 'cadence_a: day 3 returned % rows', n; end if;
    select * into r from get_nurture_candidates(v_t + interval '1 day') c where c.workspace_id = f.workspace_id;
    if r.step is distinct from 'a2' or r.attempts <> 0 then
      raise exception 'cadence_a: day 4 got %, expected a2', row_to_json(r);
    end if;

    -- a1 at D, a2 at D+4: day 8 nothing, day 9 -> a3 (D = T - 8 days)
    select * into f from et_nurture_fixture(0);
    insert into nurture_emails (workspace_id, step, recipient_user_id, sent_at, delivered_at) values
      (f.workspace_id, 'a1', f.user_id, v_t - interval '8 days', v_t - interval '8 days'),
      (f.workspace_id, 'a2', f.user_id, v_t - interval '4 days', v_t - interval '4 days');
    select count(*) into n from get_nurture_candidates(v_t) c where c.workspace_id = f.workspace_id;
    if n <> 0 then raise exception 'cadence_a: a3 on day 8 returned % rows', n; end if;
    select * into r from get_nurture_candidates(v_t + interval '1 day') c where c.workspace_id = f.workspace_id;
    if r.step is distinct from 'a3' then
      raise exception 'cadence_a: day 9 got %, expected a3', row_to_json(r);
    end if;

    -- a1 at D, a2, a3 delivered: a4 from D+16 (D = T - 16 days)
    select * into f from et_nurture_fixture(0);
    insert into nurture_emails (workspace_id, step, recipient_user_id, sent_at, delivered_at) values
      (f.workspace_id, 'a1', f.user_id, v_t - interval '16 days', v_t - interval '16 days'),
      (f.workspace_id, 'a2', f.user_id, v_t - interval '12 days', v_t - interval '12 days'),
      (f.workspace_id, 'a3', f.user_id, v_t - interval '7 days', v_t - interval '7 days');
    select * into r from get_nurture_candidates(v_t) c where c.workspace_id = f.workspace_id;
    if r.step is distinct from 'a4' then
      raise exception 'cadence_a: day 16 got %, expected a4', row_to_json(r);
    end if;
  end $$;
rollback;

-- 7. cap_72h_counts_other_emails
begin;
  select et_grant_hosted_parity();
  do $$
  declare f record; n int; v_t timestamptz := '2026-11-10 13:00:00+00';
  begin
    -- a2 due, but a trial_reminder for the workspace was delivered 2 days ago
    select * into f from et_nurture_fixture(0);
    insert into nurture_emails (workspace_id, step, recipient_user_id, sent_at, delivered_at)
      values (f.workspace_id, 'a1', f.user_id, v_t - interval '5 days', v_t - interval '5 days');
    select count(*) into n from get_nurture_candidates(v_t) c where c.workspace_id = f.workspace_id;
    if n <> 1 then raise exception 'cap_72h: control (a2 due) returned % rows, expected 1', n; end if;
    insert into lifecycle_emails (email_type, user_id, workspace_id, sent_at, delivered_at)
      values ('trial_reminder', null, f.workspace_id, v_t - interval '2 days', v_t - interval '2 days');
    select count(*) into n from get_nurture_candidates(v_t) c where c.workspace_id = f.workspace_id;
    if n <> 0 then raise exception 'cap_72h: trial_reminder 2 days ago returned % rows', n; end if;

    -- subscription_thanks counts the same way
    select * into f from et_nurture_fixture(0);
    insert into nurture_emails (workspace_id, step, recipient_user_id, sent_at, delivered_at)
      values (f.workspace_id, 'a1', f.user_id, v_t - interval '5 days', v_t - interval '5 days');
    insert into lifecycle_emails (email_type, user_id, workspace_id, sent_at, delivered_at)
      values ('subscription_thanks', null, f.workspace_id, v_t - interval '2 days', v_t - interval '2 days');
    select count(*) into n from get_nurture_candidates(v_t) c where c.workspace_id = f.workspace_id;
    if n <> 0 then raise exception 'cap_72h: subscription_thanks 2 days ago returned % rows', n; end if;

    -- a fresh undelivered nurture claim instead
    select * into f from et_nurture_fixture(0);
    insert into nurture_emails (workspace_id, step, recipient_user_id, sent_at, delivered_at) values
      (f.workspace_id, 'a1', f.user_id, v_t - interval '5 days', v_t - interval '5 days'),
      (f.workspace_id, 'a2', f.user_id, v_t - interval '30 minutes', null);
    select count(*) into n from get_nurture_candidates(v_t) c where c.workspace_id = f.workspace_id;
    if n <> 0 then raise exception 'cap_72h: fresh claim returned % rows', n; end if;
  end $$;
rollback;

-- 8. migration_a_to_b
begin;
  select et_grant_hosted_parity();
  do $$
  declare f record; r record; n int; v_t timestamptz := '2026-11-10 13:00:00+00';
  begin
    select * into f from et_nurture_fixture(0);
    insert into nurture_emails (workspace_id, step, recipient_user_id, sent_at, delivered_at) values
      (f.workspace_id, 'a1', f.user_id, v_t - interval '9 days', v_t - interval '9 days'),
      (f.workspace_id, 'a2', f.user_id, v_t - interval '5 days', v_t - interval '5 days');
    insert into clientes (user_id, conta_id, nome, sigla, cor)
      values (f.user_id, f.workspace_id, 'Primeiro', 'P', '#000');
    select * into r from get_nurture_candidates(v_t) c where c.workspace_id = f.workspace_id;
    if r.step is distinct from 'b1' or r.client_count <> 1 or r.first_client_name <> 'Primeiro' then
      raise exception 'migration_a_to_b: got %, expected b1', row_to_json(r);
    end if;

    -- a4 already delivered: no migration, sequence is over
    select * into f from et_nurture_fixture(0);
    insert into nurture_emails (workspace_id, step, recipient_user_id, sent_at, delivered_at) values
      (f.workspace_id, 'a1', f.user_id, v_t - interval '20 days', v_t - interval '20 days'),
      (f.workspace_id, 'a2', f.user_id, v_t - interval '16 days', v_t - interval '16 days'),
      (f.workspace_id, 'a3', f.user_id, v_t - interval '11 days', v_t - interval '11 days'),
      (f.workspace_id, 'a4', f.user_id, v_t - interval '4 days', v_t - interval '4 days');
    insert into clientes (user_id, conta_id, nome, sigla, cor)
      values (f.user_id, f.workspace_id, 'Primeiro', 'P', '#000');
    select count(*) into n from get_nurture_candidates(v_t) c where c.workspace_id = f.workspace_id;
    if n <> 0 then raise exception 'migration_a_to_b: after a4 returned % rows', n; end if;
  end $$;
rollback;

-- 9. b_continues_after_client_deleted
begin;
  select et_grant_hosted_parity();
  do $$
  declare f record; r record; v_t timestamptz := '2026-11-10 13:00:00+00';
  begin
    select * into f from et_nurture_fixture(0);
    insert into nurture_emails (workspace_id, step, recipient_user_id, sent_at, delivered_at)
      values (f.workspace_id, 'b1', f.user_id, v_t - interval '5 days', v_t - interval '5 days');
    select * into r from get_nurture_candidates(v_t) c where c.workspace_id = f.workspace_id;
    if r.step is distinct from 'b2' or r.client_count <> 0 then
      raise exception 'b_continues_after_client_deleted: got %, expected b2', row_to_json(r);
    end if;
  end $$;
rollback;

-- 10. stale_claim_retry
begin;
  select et_grant_hosted_parity();
  do $$
  declare f record; r record; n int; v_t timestamptz := '2026-11-10 13:00:00+00';
  begin
    select * into f from et_nurture_fixture(0);
    insert into nurture_emails (workspace_id, step, recipient_user_id, sent_at, delivered_at, attempts)
      values (f.workspace_id, 'a1', f.user_id, v_t - interval '2 hours', null, 3);
    select * into r from get_nurture_candidates(v_t) c where c.workspace_id = f.workspace_id;
    if r.step is distinct from 'a1' or r.attempts <> 3 then
      raise exception 'stale_claim_retry: got %, expected a1 with attempts 3', row_to_json(r);
    end if;
    update nurture_emails set attempts = 30 where workspace_id = f.workspace_id;
    select count(*) into n from get_nurture_candidates(v_t) c where c.workspace_id = f.workspace_id;
    if n <> 0 then raise exception 'stale_claim_retry: 30 attempts returned % rows', n; end if;
  end $$;
rollback;

-- 11. daily_quota_15: at most 15 new entries per Sao Paulo day.
begin;
  select et_grant_hosted_parity();
  create temp table et_q (k int, user_id uuid, workspace_id uuid) on commit drop;
  do $$
  declare f record; n int; i int; v_t timestamptz := '2026-11-10 13:00:00+00';
  begin
    -- k = 1..16, k = 1 signed in most recently; k = 17 is a continuation (a2 due)
    for i in 1..17 loop
      select * into f from et_nurture_fixture(0);
      update auth.users set last_sign_in_at = now() - make_interval(mins => i) where id = f.user_id;
      insert into et_q values (i, f.user_id, f.workspace_id);
    end loop;
    insert into nurture_emails (workspace_id, step, recipient_user_id, sent_at, delivered_at)
      select workspace_id, 'a1', user_id, v_t - interval '5 days', v_t - interval '5 days'
      from et_q where k = 17;
    -- 15 entries already claimed today (k = 1..15)
    insert into nurture_emails (workspace_id, step, recipient_user_id, sent_at, delivered_at)
      select workspace_id, 'a1', user_id, v_t - interval '1 hour', v_t - interval '1 hour'
      from et_q where k <= 15;
    select count(*) into n from get_nurture_candidates(v_t) c join et_q q on q.workspace_id = c.workspace_id
     where q.k = 16;
    if n <> 0 then raise exception 'daily_quota_15: quota full but a new entry came back'; end if;
    select count(*) into n from get_nurture_candidates(v_t) c join et_q q on q.workspace_id = c.workspace_id
     where q.k = 17 and c.step = 'a2';
    if n <> 1 then raise exception 'daily_quota_15: continuation blocked by the quota (got %)', n; end if;

    -- 14 claimed today (drop k = 15's claim): exactly one new entry, k = 15
    -- (more recent sign-in than k = 16)
    delete from nurture_emails where workspace_id = (select workspace_id from et_q where k = 15);
    select count(*) into n from get_nurture_candidates(v_t) c join et_q q on q.workspace_id = c.workspace_id
     where q.k in (15, 16);
    if n <> 1 then raise exception 'daily_quota_15: 14 claimed, % new entries, expected 1', n; end if;
    select count(*) into n from get_nurture_candidates(v_t) c join et_q q on q.workspace_id = c.workspace_id
     where q.k = 15 and c.step = 'a1';
    if n <> 1 then raise exception 'daily_quota_15: the new entry is not the most recent sign-in'; end if;

    -- a claim from yesterday (SP date) does not use today's quota
    update nurture_emails set sent_at = v_t - interval '1 day', delivered_at = v_t - interval '1 day'
     where workspace_id in (select workspace_id from et_q where k <= 14);
    select count(*) into n from get_nurture_candidates(v_t) c join et_q q on q.workspace_id = c.workspace_id
     where q.k in (15, 16);
    if n <> 2 then raise exception 'daily_quota_15: yesterday counted against today (% entries)', n; end if;
  end $$;
rollback;

-- 12. end_after_4
begin;
  select et_grant_hosted_parity();
  do $$
  declare f record; n int; v_t timestamptz := '2026-11-10 13:00:00+00';
  begin
    select * into f from et_nurture_fixture(0);
    insert into nurture_emails (workspace_id, step, recipient_user_id, sent_at, delivered_at) values
      (f.workspace_id, 'a1', f.user_id, v_t - interval '20 days', v_t - interval '20 days'),
      (f.workspace_id, 'a2', f.user_id, v_t - interval '16 days', v_t - interval '16 days'),
      (f.workspace_id, 'a3', f.user_id, v_t - interval '11 days', v_t - interval '11 days'),
      (f.workspace_id, 'a4', f.user_id, v_t - interval '4 days', v_t - interval '4 days');
    select count(*) into n from get_nurture_candidates(v_t) c where c.workspace_id = f.workspace_id;
    if n <> 0 then raise exception 'end_after_4: returned % rows at T', n; end if;
    -- T + 30 days = Thursday 10:00 SP
    select count(*) into n from get_nurture_candidates(v_t + interval '30 days') c where c.workspace_id = f.workspace_id;
    if n <> 0 then raise exception 'end_after_4: returned % rows at T + 30 days', n; end if;

    -- same for b4
    select * into f from et_nurture_fixture(1);
    insert into nurture_emails (workspace_id, step, recipient_user_id, sent_at, delivered_at) values
      (f.workspace_id, 'b1', f.user_id, v_t - interval '20 days', v_t - interval '20 days'),
      (f.workspace_id, 'b2', f.user_id, v_t - interval '16 days', v_t - interval '16 days'),
      (f.workspace_id, 'b3', f.user_id, v_t - interval '11 days', v_t - interval '11 days'),
      (f.workspace_id, 'b4', f.user_id, v_t - interval '4 days', v_t - interval '4 days');
    select count(*) into n from get_nurture_candidates(v_t + interval '30 days') c where c.workspace_id = f.workspace_id;
    if n <> 0 then raise exception 'end_after_4: b returned % rows at T + 30 days', n; end if;
  end $$;
rollback;

-- 13. claim_refuses_changed_owner
begin;
  select et_grant_hosted_parity();
  do $$
  declare f record; n int; v_r int; v_owner2 uuid := gen_random_uuid();
          v_t timestamptz := '2026-11-10 13:00:00+00';
  begin
    select * into f from et_nurture_fixture(0);
    insert into auth.users (id, email, raw_user_meta_data) values (v_owner2, v_owner2 || '@et.test', '{}'::jsonb);
    -- Free allows one member; plan_id plays no part in eligibility.
    update workspaces set plan_id = 'max' where id = f.workspace_id;
    insert into workspace_members (user_id, workspace_id, role) values (v_owner2, f.workspace_id, 'owner');
    update workspaces set created_by = v_owner2 where id = f.workspace_id;

    v_r := claim_nurture_email(f.workspace_id, 'a1', f.user_id, v_t);
    if v_r is not null then raise exception 'claim: changed owner returned %, expected null', v_r; end if;
    select count(*) into n from nurture_emails where workspace_id = f.workspace_id;
    if n <> 0 then raise exception 'claim: changed owner wrote % rows', n; end if;

    update workspaces set created_by = f.user_id where id = f.workspace_id;
    v_r := claim_nurture_email(f.workspace_id, 'a1', f.user_id, v_t);
    if v_r is distinct from 1 then raise exception 'claim: first claim returned %, expected 1', v_r; end if;
    select count(*) into n from nurture_emails
     where workspace_id = f.workspace_id and step = 'a1' and recipient_user_id = f.user_id
       and sent_at = v_t and delivered_at is null and attempts = 1;
    if n <> 1 then raise exception 'claim: first claim row not as expected'; end if;

    v_r := claim_nurture_email(f.workspace_id, 'a1', f.user_id, v_t);
    if v_r is not null then raise exception 'claim: fresh re-claim returned %, expected null', v_r; end if;

    update nurture_emails set sent_at = v_t - interval '2 hours' where workspace_id = f.workspace_id;
    v_r := claim_nurture_email(f.workspace_id, 'a1', f.user_id, v_t);
    if v_r is distinct from 2 then raise exception 'claim: stale re-claim returned %, expected 2', v_r; end if;

    -- a delivered step is never claimed again
    update nurture_emails set sent_at = v_t - interval '2 hours', delivered_at = v_t - interval '2 hours'
     where workspace_id = f.workspace_id;
    v_r := claim_nurture_email(f.workspace_id, 'a1', f.user_id, v_t);
    if v_r is not null then raise exception 'claim: delivered re-claim returned %, expected null', v_r; end if;

    -- invalid step
    v_r := claim_nurture_email(f.workspace_id, 'c1', f.user_id, v_t);
    if v_r is not null then raise exception 'claim: invalid step returned %, expected null', v_r; end if;
  end $$;
rollback;

-- 14. acl (no et_grant_hosted_parity here: it would grant the very privileges
--     this case asserts are absent)
begin;
  do $$
  declare v_acl text; v_cols text[]; v_fn text;
  begin
    foreach v_fn in array array[
      'get_nurture_candidates(timestamptz)',
      'claim_nurture_email(uuid,text,uuid,timestamptz)',
      '_nurture_current_owner(uuid)'] loop
      select coalesce(proacl::text, '<null>') into v_acl from pg_proc where oid = v_fn::regprocedure;
      if v_acl not like '%service_role=X/%' then
        raise exception 'acl: % lacks service_role execute (%)', v_fn, v_acl;
      end if;
      if v_acl like '%anon=%' or v_acl like '%authenticated=%' or v_acl like '%{=X/%' or v_acl like '%,=X/%' then
        raise exception 'acl: % is executable by a client role or PUBLIC (%)', v_fn, v_acl;
      end if;
    end loop;

    if has_table_privilege('authenticated', 'public.nurture_emails', 'select') then
      raise exception 'acl: authenticated can select nurture_emails';
    end if;
    if has_table_privilege('anon', 'public.nurture_emails', 'select') then
      raise exception 'acl: anon can select nurture_emails';
    end if;
    if not has_table_privilege('service_role', 'public.nurture_emails', 'insert') then
      raise exception 'acl: service_role cannot insert into nurture_emails';
    end if;
    if not (select relrowsecurity from pg_class where oid = 'public.nurture_emails'::regclass) then
      raise exception 'acl: RLS not enabled on nurture_emails';
    end if;

    select array_agg(column_name::text order by column_name) into v_cols
      from information_schema.column_privileges
     where table_schema = 'public' and table_name = 'profiles'
       and grantee = 'authenticated' and privilege_type = 'UPDATE';
    if v_cols is distinct from array['empresa','marketing_opt_in','nome','nurture_opt_out_at',
                                     'onboarding_complete','telefone','whatsapp'] then
      raise exception 'acl: authenticated UPDATE columns on profiles are %', v_cols;
    end if;
  end $$;
rollback;

-- 15. unsub_stops_sequence
begin;
  select et_grant_hosted_parity();
  do $$
  declare f record; n int; v_t timestamptz := '2026-11-10 13:00:00+00';
  begin
    select * into f from et_nurture_fixture(0);
    insert into nurture_emails (workspace_id, step, recipient_user_id, sent_at, delivered_at)
      values (f.workspace_id, 'a1', f.user_id, v_t - interval '5 days', v_t - interval '5 days');
    select count(*) into n from get_nurture_candidates(v_t) c where c.workspace_id = f.workspace_id;
    if n <> 1 then raise exception 'unsub: control (a2 due) returned % rows, expected 1', n; end if;
    update profiles set nurture_opt_out_at = v_t - interval '1 hour' where id = f.user_id;
    select count(*) into n from get_nurture_candidates(v_t) c where c.workspace_id = f.workspace_id;
    if n <> 0 then raise exception 'unsub: opted out mid-sequence returned % rows', n; end if;

    select * into f from et_nurture_fixture(0);
    insert into nurture_emails (workspace_id, step, recipient_user_id, sent_at, delivered_at)
      values (f.workspace_id, 'a1', f.user_id, v_t - interval '5 days', v_t - interval '5 days');
    insert into workspace_subscriptions (workspace_id, status) values (f.workspace_id, 'trialing');
    select count(*) into n from get_nurture_candidates(v_t) c where c.workspace_id = f.workspace_id;
    if n <> 0 then raise exception 'unsub: trial started mid-sequence returned % rows', n; end if;
  end $$;
rollback;

-- 16. one_sequence_per_person: a nurture row on another workspace of the same
--     person blocks a second sequence.
begin;
  select et_grant_hosted_parity();
  do $$
  declare f record; n int; v_ws2 uuid; v_t timestamptz := '2026-11-10 13:00:00+00';
  begin
    select * into f from et_nurture_fixture(0);
    v_ws2 := et_make_workspace((select id from plans where is_default));
    update workspaces set created_by = f.user_id, plan_source = 'system' where id = v_ws2;
    insert into workspace_members (user_id, workspace_id, role) values (f.user_id, v_ws2, 'owner');
    insert into nurture_emails (workspace_id, step, recipient_user_id, sent_at, delivered_at)
      values (v_ws2, 'a1', f.user_id, v_t - interval '30 days', v_t - interval '30 days');
    select count(*) into n from get_nurture_candidates(v_t) c where c.workspace_id = f.workspace_id;
    if n <> 0 then raise exception 'one_sequence_per_person: returned % rows', n; end if;
  end $$;
rollback;

drop function if exists et_nurture_fixture(int);

do $$ begin raise notice 'PASS 99_nurture_candidates'; end $$;
