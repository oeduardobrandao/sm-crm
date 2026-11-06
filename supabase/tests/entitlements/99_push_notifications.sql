\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- 20261015000001_push_notifications: push_devices + RPCs, notification_push_prefs,
-- claim_notification_pushes, push_badge_counts.
--
-- push_devices is excluded from et_grant_hosted_parity: the migration's REVOKE ALL
-- + column-level SELECT grant is itself under test, and the helper would otherwise
-- hand authenticated full table privileges back.

-- Part A: push_devices reads: own rows only, never the token column, no direct writes.
begin;
select et_grant_hosted_parity(array['push_devices']);
do $$
declare v_u1 uuid := gen_random_uuid(); v_u2 uuid := gen_random_uuid(); v_n int;
begin
  insert into auth.users (id, email) values (v_u1, 'u1@x.test'), (v_u2, 'u2@x.test');
  insert into push_devices (user_id, token, platform, environment)
    values (v_u1, 'tok-u1', 'ios', 'production'), (v_u2, 'tok-u2', 'ios', 'production');

  perform set_config('request.jwt.claims', json_build_object('sub', v_u1, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select count(*) into v_n from (select id from push_devices) d;
  assert v_n = 1, format('u1 must see exactly its own device, saw %s', v_n);

  begin
    perform token from push_devices;
    assert false, 'authenticated must not read push_devices.token';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into push_devices (user_id, token, platform, environment) values (v_u1, 'x', 'ios', 'production');
    assert false, 'authenticated must not insert into push_devices directly';
  exception when insufficient_privilege then null;
  end;

  begin
    update push_devices set disabled_at = now();
    assert false, 'authenticated must not update push_devices directly';
  exception when insufficient_privilege then null;
  end;

  reset role;
  raise notice 'PASS 99_push Part A push_devices read/write privileges';
end $$;
rollback;

-- Part B: register_push_device / unregister_push_device.
begin;
select et_grant_hosted_parity(array['push_devices']);
do $$
declare v_u1 uuid := gen_random_uuid(); v_u2 uuid := gen_random_uuid(); v_owner uuid; v_disabled timestamptz; v_n int;
begin
  insert into auth.users (id, email) values (v_u1, 'u1@x.test'), (v_u2, 'u2@x.test');

  -- u1 registers; a disabled row for the same token is re-enabled.
  perform set_config('request.jwt.claims', json_build_object('sub', v_u1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform register_push_device('tok-shared', 'ios', 'sandbox', '1.0.0');
  reset role;
  update push_devices set disabled_at = now() where token = 'tok-shared';

  -- The phone changes hands: u2 logs in on it and registers the same token.
  perform set_config('request.jwt.claims', json_build_object('sub', v_u2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform register_push_device('tok-shared', 'ios', 'production', '1.0.1');
  reset role;
  select user_id, disabled_at into v_owner, v_disabled from push_devices where token = 'tok-shared';
  assert v_owner = v_u2, 'token must move to the user who registered it last';
  assert v_disabled is null, 're-registering must clear disabled_at';
  select count(*) into v_n from push_devices where token = 'tok-shared';
  assert v_n = 1, 'one row per token';

  -- Validation.
  set local role authenticated;
  begin
    perform register_push_device('tok', 'windows', 'production', null);
    assert false, 'invalid platform must raise';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform register_push_device('', 'ios', 'production', null);
    assert false, 'empty token must raise';
  exception when invalid_parameter_value then null;
  end;

  -- u1 cannot unregister a token that now belongs to u2.
  perform set_config('request.jwt.claims', json_build_object('sub', v_u1, 'role', 'authenticated')::text, true);
  perform unregister_push_device('tok-shared');
  reset role;
  select count(*) into v_n from push_devices where token = 'tok-shared';
  assert v_n = 1, 'unregister must only delete the caller''s own row';

  -- u2 can.
  perform set_config('request.jwt.claims', json_build_object('sub', v_u2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform unregister_push_device('tok-shared');
  reset role;
  select count(*) into v_n from push_devices where token = 'tok-shared';
  assert v_n = 0, 'owner must be able to unregister';

  -- No JWT subject: refused.
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform register_push_device('tok-anon', 'ios', 'production', null);
    assert false, 'register without auth.uid() must raise';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- anon has no EXECUTE at all.
  set local role anon;
  begin
    perform register_push_device('tok-anon', 'ios', 'production', null);
    assert false, 'anon must not execute register_push_device';
  exception when insufficient_privilege then null;
  end;
  reset role;

  raise notice 'PASS 99_push Part B register/unregister';
end $$;
rollback;

-- Part C: notification_push_prefs RLS.
begin;
select et_grant_hosted_parity(array['push_devices']);
do $$
declare v_u1 uuid := gen_random_uuid(); v_u2 uuid := gen_random_uuid(); v_n int;
begin
  insert into auth.users (id, email) values (v_u1, 'u1@x.test'), (v_u2, 'u2@x.test');
  insert into notification_push_prefs (user_id, type, enabled) values (v_u1, 'mention', false), (v_u2, 'mention', false);

  perform set_config('request.jwt.claims', json_build_object('sub', v_u1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from notification_push_prefs;
  assert v_n = 1, format('u1 must see exactly 1 pref, saw %s', v_n);
  begin
    insert into notification_push_prefs (user_id, type, enabled) values (v_u2, 'post_message', false);
    assert false, 'u1 inserting a pref for u2 must be denied';
  exception when insufficient_privilege or check_violation then null;
  end;
  insert into notification_push_prefs (user_id, type, enabled) values (v_u1, 'event_reminder', false);
  reset role;
  raise notice 'PASS 99_push Part C notification_push_prefs RLS';
end $$;
rollback;

-- Part D: claim_notification_pushes predicates.
begin;
select et_grant_hosted_parity(array['push_devices']);
do $$
declare
  -- Override: pro's max_team_members is below the five members this part seeds.
  v_ws     uuid := et_make_workspace('pro', '{"max_team_members": 20}'::jsonb);
  v_ok     uuid := gen_random_uuid();  -- member, device, opted in
  v_out    uuid := gen_random_uuid();  -- member, device, opted out of post_message
  v_paused uuid := gen_random_uuid();  -- member, device, paused everything
  v_nodev  uuid := gen_random_uuid();  -- member, no device
  v_dead   uuid := gen_random_uuid();  -- member, only a disabled device
  v_gone   uuid := gen_random_uuid();  -- removed from the workspace, device
  v_claimed text[];
begin
  insert into auth.users (id, email) values
    (v_ok,'ok@x.test'), (v_out,'out@x.test'), (v_paused,'p@x.test'),
    (v_nodev,'nd@x.test'), (v_dead,'dead@x.test'), (v_gone,'gone@x.test');
  insert into workspace_members (workspace_id, user_id, role) values
    (v_ws, v_ok, 'admin'), (v_ws, v_out, 'admin'), (v_ws, v_paused, 'admin'),
    (v_ws, v_nodev, 'admin'), (v_ws, v_dead, 'admin');
  insert into push_devices (user_id, token, platform, environment, disabled_at) values
    (v_ok, 't-ok', 'ios', 'production', null),
    (v_out, 't-out', 'ios', 'production', null),
    (v_paused, 't-p', 'ios', 'production', null),
    (v_dead, 't-dead', 'ios', 'production', now()),
    (v_gone, 't-gone', 'ios', 'production', null);
  insert into notification_push_prefs (user_id, type, enabled) values
    (v_out, 'post_message', false), (v_paused, '__all__', false);

  insert into notifications (workspace_id, user_id, type, metadata, link, created_at) values
    (v_ws, v_ok,     'post_message',     '{}'::jsonb, '/a', now() - interval '1 minute'),   -- claimed
    (v_ws, v_ok,     'event_reminder',   '{}'::jsonb, '/b', now() - interval '1 minute'),   -- claimed (push-only type)
    (v_ws, v_ok,     'step_activated',   '{}'::jsonb, '/c', now() - interval '1 minute'),   -- not push-eligible
    (v_ws, v_ok,     'post_message',     '{}'::jsonb, '/d', now() - interval '30 minutes'), -- outside window
    (v_ws, v_out,    'post_message',     '{}'::jsonb, '/e', now() - interval '1 minute'),   -- opted out of type
    (v_ws, v_out,    'post_correction',  '{}'::jsonb, '/f', now() - interval '1 minute'),   -- claimed (other type)
    (v_ws, v_paused, 'post_message',     '{}'::jsonb, '/g', now() - interval '1 minute'),   -- paused all
    (v_ws, v_nodev,  'post_message',     '{}'::jsonb, '/h', now() - interval '1 minute'),   -- no device
    (v_ws, v_dead,   'post_message',     '{}'::jsonb, '/i', now() - interval '1 minute'),   -- device disabled
    (v_ws, v_gone,   'post_message',     '{}'::jsonb, '/j', now() - interval '1 minute');   -- not a member
  insert into notifications (workspace_id, user_id, type, metadata, link, created_at, read_at) values
    (v_ws, v_ok, 'post_message', '{}'::jsonb, '/k', now() - interval '1 minute', now());    -- already read

  select array_agg(link order by link) into v_claimed
    from claim_notification_pushes(now() - interval '15 minutes', 100);
  assert v_claimed = array['/a','/b','/f'],
    format('expected /a,/b,/f claimed, got %s', v_claimed);

  assert (select count(*) from notifications where pushed_at is not null) = 3, 'exactly the claimed rows are stamped';

  -- A second run claims nothing: pushed_at is set.
  assert (select count(*) from claim_notification_pushes(now() - interval '15 minutes', 100)) = 0,
    'a stamped row must not be claimed twice';

  raise notice 'PASS 99_push Part D claim_notification_pushes predicates';
end $$;
rollback;

-- Part E: push_badge_counts mirrors the bell.
begin;
select et_grant_hosted_parity(array['push_devices']);
do $$
declare
  v_ws uuid := et_make_workspace('pro');
  v_u  uuid := gen_random_uuid();
  v_other_ws uuid := et_make_workspace('pro');
  v_count int;
begin
  insert into auth.users (id, email) values (v_u, 'u@x.test');
  insert into workspace_members (workspace_id, user_id, role) values (v_ws, v_u, 'admin');
  insert into notification_inapp_prefs (user_id, type, enabled) values (v_u, 'mention', false);
  insert into notifications (workspace_id, user_id, type, metadata, link) values
    (v_ws, v_u, 'post_message', '{}'::jsonb, '/1'),
    (v_ws, v_u, 'post_approved', '{}'::jsonb, '/2'),
    (v_ws, v_u, 'mention', '{}'::jsonb, '/3'),               -- hidden from the bell
    (v_other_ws, v_u, 'post_message', '{}'::jsonb, '/4');    -- not a member there
  insert into notifications (workspace_id, user_id, type, metadata, link, read_at) values
    (v_ws, v_u, 'post_message', '{}'::jsonb, '/5', now());   -- read
  insert into notifications (workspace_id, user_id, type, metadata, link, dismissed_at) values
    (v_ws, v_u, 'post_message', '{}'::jsonb, '/6', now());   -- dismissed

  select unread into v_count from push_badge_counts(array[v_u]);
  assert v_count = 2, format('badge must be 2, got %s', v_count);
  raise notice 'PASS 99_push Part E push_badge_counts';
end $$;
rollback;

-- Part F: the cron RPCs are service_role-only.
begin;
select et_grant_hosted_parity(array['push_devices']);
do $$
begin
  set local role authenticated;
  begin
    perform claim_notification_pushes(now(), 1);
    assert false, 'authenticated must NOT execute claim_notification_pushes';
  exception when insufficient_privilege then null;
  end;
  begin
    perform push_badge_counts(array[gen_random_uuid()]);
    assert false, 'authenticated must NOT execute push_badge_counts';
  exception when insufficient_privilege then null;
  end;
  reset role;
  raise notice 'PASS 99_push Part F cron RPCs are service_role-only';
end $$;
rollback;
