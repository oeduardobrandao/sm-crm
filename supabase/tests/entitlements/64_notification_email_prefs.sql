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
