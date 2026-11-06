\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- A push device follows the session that registered it
-- (20261122000002_push_devices_session.sql): register_push_device stores the
-- JWT's session_id, and deleting that auth.sessions row disables the device,
-- so a sign-out the app could not report still stops the pushes.

begin;
select et_grant_hosted_parity();

do $$
declare
  v_user  uuid := gen_random_uuid();
  v_s1    uuid := gen_random_uuid();
  v_s2    uuid := gen_random_uuid();
  v_state text;
begin
  insert into auth.users (id) values (v_user);
  insert into auth.sessions (id, user_id, created_at, updated_at) values
    (v_s1, v_user, now(), now()),
    (v_s2, v_user, now(), now());

  -- Register as the user, under session s1.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated', 'session_id', v_s1)::text, true);
  set local role authenticated;
  perform register_push_device('tok-a', 'ios', 'sandbox', '1.0 (1)');
  reset role;

  select coalesce(session_id::text, 'null') || '/' || (disabled_at is null)::text
    into v_state from push_devices where token = 'tok-a';
  if v_state <> v_s1::text || '/true' then
    raise exception 'register should store session s1, active: got %', v_state;
  end if;

  -- Another session ending leaves the device alone.
  delete from auth.sessions where id = v_s2;
  if (select disabled_at from push_devices where token = 'tok-a') is not null then
    raise exception 'ending an unrelated session disabled the device';
  end if;

  -- Its own session ending disables it.
  delete from auth.sessions where id = v_s1;
  if (select disabled_at from push_devices where token = 'tok-a') is null then
    raise exception 'ending the registering session should disable the device';
  end if;

  -- A new login re-registers the token under the new session and reactivates it.
  insert into auth.sessions (id, user_id, created_at, updated_at) values (v_s2, v_user, now(), now());
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated', 'session_id', v_s2)::text, true);
  set local role authenticated;
  perform register_push_device('tok-a', 'ios', 'sandbox', '1.0 (1)');
  reset role;

  select coalesce(session_id::text, 'null') || '/' || (disabled_at is null)::text
    into v_state from push_devices where token = 'tok-a';
  if v_state <> v_s2::text || '/true' then
    raise exception 're-register should move to session s2 and reactivate: got %', v_state;
  end if;

  -- A token without the claim keeps working (NULL session_id, never auto-disabled).
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform register_push_device('tok-b', 'ios', 'sandbox', null);
  reset role;
  if (select session_id from push_devices where token = 'tok-b') is not null then
    raise exception 'a JWT without session_id should store NULL';
  end if;
  delete from auth.sessions where user_id = v_user;
  if (select disabled_at from push_devices where token = 'tok-b') is not null then
    raise exception 'a device without session_id must not be disabled by a session ending';
  end if;
end;
$$;

-- The trigger function is not callable by clients.
do $$
begin
  if has_function_privilege('authenticated', 'public.push_devices_session_ended()', 'execute') then
    raise exception 'authenticated must not execute push_devices_session_ended()';
  end if;
end;
$$;

rollback;
