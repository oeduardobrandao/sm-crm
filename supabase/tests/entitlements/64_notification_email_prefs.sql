\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Part A: notification_email_prefs RLS -- a user sees/writes only their own rows.
-- Part B/C (default-on absence semantics, master pause) are appended by a
-- later task once the read-side helper exists.
begin;
select et_grant_hosted_parity();
do $$
declare v_u1 uuid := gen_random_uuid(); v_u2 uuid := gen_random_uuid(); v_n int;
begin
  insert into auth.users (id, email) values (v_u1, 'u1@x.test'), (v_u2, 'u2@x.test');
  -- Seed one pref for each user as the table owner (bypasses RLS).
  insert into notification_email_prefs (user_id, type, enabled)
    values (v_u1, 'mention', false), (v_u2, 'mention', false);

  -- Impersonate u1: RLS must expose only u1's row.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_u1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from notification_email_prefs;
  assert v_n = 1, format('u1 must see exactly 1 row, saw %s', v_n);

  -- u1 cannot write a row for u2 (WITH CHECK).
  begin
    insert into notification_email_prefs (user_id, type, enabled)
      values (v_u2, 'post_message', false);
    assert false, 'u1 inserting a pref for u2 must be denied by RLS';
  exception when insufficient_privilege or check_violation then null;
  end;

  reset role;
  raise notice 'PASS 64 Part A notification_email_prefs RLS';
end $$;
rollback;

-- Part B: claim_notification_emails predicates.
begin;
select et_grant_hosted_parity();
do $$
declare
  -- 'pro' (not 'free'): the test seeds 2 workspace_members and free's
  -- max_team_members=1 plan-count trigger would reject the second insert
  -- before the claim RPC's own predicates are ever exercised.
  v_ws  uuid := et_make_workspace('pro');
  v_in  uuid := gen_random_uuid();   -- member, opted in
  v_out uuid := gen_random_uuid();   -- member, opted out of post_message
  v_gone uuid := gen_random_uuid();  -- was a member, now removed
  v_settle timestamptz := now() - interval '11 minutes';
  v_claimed int;
  v_has_gone int;
begin
  insert into auth.users (id, email) values
    (v_in,'in@x.test'), (v_out,'out@x.test'), (v_gone,'gone@x.test');
  insert into workspace_members (workspace_id, user_id, role) values
    (v_ws, v_in, 'admin'), (v_ws, v_out, 'admin');
  -- v_gone is intentionally NOT in workspace_members (removed), but still has a row.

  insert into notifications (workspace_id, user_id, type, metadata, link, created_at) values
    (v_ws, v_in,   'post_message', '{}'::jsonb, '/x', now() - interval '20 minutes'),
    (v_ws, v_out,  'post_message', '{}'::jsonb, '/x', now() - interval '20 minutes'),
    (v_ws, v_gone, 'post_message', '{}'::jsonb, '/x', now() - interval '20 minutes');

  -- v_out opts out of post_message; v_in opts out of nothing.
  insert into notification_email_prefs (user_id, type, enabled)
    values (v_out, 'post_message', false);

  select count(*) into v_claimed
    from claim_notification_emails(v_settle, now() - interval '24 hours', 100);

  -- Only v_in is claimed: v_out is opted out, v_gone is no longer a member.
  assert v_claimed = 1, format('expected 1 claimed, got %s', v_claimed);

  select count(*) into v_has_gone
    from notifications where user_id = v_gone and emailed_at is not null;
  assert v_has_gone = 0, 'removed user notification must NOT be claimed (emailed_at stays NULL)';

  raise notice 'PASS 64 Part B claim_notification_emails membership + opt-out';
end $$;
rollback;

-- Part C: authenticated cannot execute the claim RPC.
begin;
select et_grant_hosted_parity();
do $$
begin
  set local role authenticated;
  begin
    perform claim_notification_emails(now(), now() - interval '24 hours', 1);
    assert false, 'authenticated must NOT be able to execute claim_notification_emails';
  exception when insufficient_privilege then null;
  end;
  reset role;
  raise notice 'PASS 64 Part C claim RPC is service_role-only';
end $$;
rollback;
