\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql
begin;

-- mcp_revoke_oauth_client_access / mcp_oauth_prepare_authorization / the revoke trigger
-- (migration 20261107000001): revoking an MCP grant ends the client's Supabase OAuth consent and
-- sessions, unless the user still holds an active grant for that client in either grant table;
-- the consent page clears a stale consent before Supabase can auto-approve it.
do $$
declare
  v_ws uuid := et_make_workspace('pro');
  v_u uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_c uuid := gen_random_uuid();   -- client with a workspace grant
  v_c2 uuid := gen_random_uuid();  -- unrelated client of the same user
  v_c3 uuid := gen_random_uuid();  -- client used by the prepare cases
  v_s_c uuid := gen_random_uuid();
  v_s_c2 uuid := gen_random_uuid();
  v_s_login uuid := gen_random_uuid();
  v_s_other uuid := gen_random_uuid();
  v_grant uuid;
  v_admin_grant uuid;
  v_res text;
  v_fn regprocedure;
begin
  -- (0) EXECUTE: service_role only, all SECURITY DEFINER
  foreach v_fn in array array[
    'public.mcp_revoke_oauth_client_access(uuid,text)'::regprocedure,
    'public.mcp_oauth_prepare_authorization(text,uuid)'::regprocedure,
    'public.mcp_oauth_grant_revoked()'::regprocedure
  ] loop
    assert not has_function_privilege('anon', v_fn, 'EXECUTE'), format('anon must not execute %s', v_fn);
    assert not has_function_privilege('authenticated', v_fn, 'EXECUTE'), format('authenticated must not execute %s', v_fn);
    assert (select prosecdef from pg_proc where oid = v_fn), format('%s is SECURITY DEFINER', v_fn);
  end loop;
  assert has_function_privilege('service_role', 'public.mcp_revoke_oauth_client_access(uuid,text)'::regprocedure, 'EXECUTE'),
    'service_role executes the revoke';
  assert has_function_privilege('service_role', 'public.mcp_oauth_prepare_authorization(text,uuid)'::regprocedure, 'EXECUTE'),
    'service_role executes prepare';

  -- fixtures
  insert into auth.users (id) values (v_u), (v_other) on conflict do nothing;
  insert into auth.oauth_clients (id, registration_type, redirect_uris, grant_types, token_endpoint_auth_method, client_type)
    values (v_c, 'dynamic', 'https://a.example/cb', 'authorization_code,refresh_token', 'none', 'public'),
           (v_c2, 'dynamic', 'https://b.example/cb', 'authorization_code,refresh_token', 'none', 'public'),
           (v_c3, 'dynamic', 'https://c.example/cb', 'authorization_code,refresh_token', 'none', 'public');
  insert into auth.oauth_consents (id, user_id, client_id, scopes)
    values (gen_random_uuid(), v_u, v_c, 'openid'),
           (gen_random_uuid(), v_u, v_c2, 'openid'),
           (gen_random_uuid(), v_other, v_c, 'openid');
  insert into auth.sessions (id, user_id, oauth_client_id)
    values (v_s_c, v_u, v_c), (v_s_c2, v_u, v_c2), (v_s_login, v_u, null), (v_s_other, v_other, v_c);
  insert into auth.refresh_tokens (token, user_id, revoked, session_id)
    values ('rt-' || v_s_c, v_u::text, false, v_s_c);
  insert into mcp_oauth_grants (user_id, client_id, conta_id, scopes)
    values (v_u, v_c::text, v_ws, array['posts:read']) returning id into v_grant;
  insert into admin_mcp_oauth_grants (user_id, client_id, scopes)
    values (v_u, v_c::text, array['kb:read']) returning id into v_admin_grant;

  -- (1) the direct call refuses while an active grant exists, and for a non-uuid client id
  assert not mcp_revoke_oauth_client_access(v_u, v_c::text), 'active grant keeps the client';
  assert not mcp_revoke_oauth_client_access(v_u, 'not-a-uuid'), 'non-uuid client id is a no-op';
  assert (select revoked_at is null from auth.oauth_consents where user_id = v_u and client_id = v_c),
    'consent untouched while a grant is active';

  -- (2) revoking the workspace grant while the Admin grant for the same client is active: no-op
  update mcp_oauth_grants set revoked_at = now(), revoked_by = v_u where id = v_grant;
  assert (select revoked_at is null from auth.oauth_consents where user_id = v_u and client_id = v_c),
    'admin grant still active keeps the consent';
  assert exists (select 1 from auth.sessions where id = v_s_c), 'admin grant still active keeps the session';

  -- (3) revoking the last active grant ends consent + client sessions (refresh tokens cascade)
  update admin_mcp_oauth_grants set revoked_at = now(), revoked_by = v_u where id = v_admin_grant;
  assert (select revoked_at is not null from auth.oauth_consents where user_id = v_u and client_id = v_c),
    'consent revoked with the last grant';
  assert not exists (select 1 from auth.sessions where id = v_s_c), 'client session deleted';
  assert not exists (select 1 from auth.refresh_tokens where session_id = v_s_c), 'refresh token gone';
  -- nothing else touched
  assert exists (select 1 from auth.sessions where id = v_s_login), 'normal login session kept';
  assert exists (select 1 from auth.sessions where id = v_s_c2), 'other client session kept';
  assert (select revoked_at is null from auth.oauth_consents where user_id = v_u and client_id = v_c2),
    'other client consent kept';
  assert exists (select 1 from auth.sessions where id = v_s_other), 'other user session kept';
  assert (select revoked_at is null from auth.oauth_consents where user_id = v_other and client_id = v_c),
    'other user consent kept';

  -- (4) reconnect (approve re-activates the grant) then revoke again: the trigger fires again
  update auth.oauth_consents set revoked_at = null where user_id = v_u and client_id = v_c;
  update mcp_oauth_grants set revoked_at = null, revoked_by = null where id = v_grant;
  update mcp_oauth_grants set revoked_at = now() where id = v_grant;
  assert (select revoked_at is not null from auth.oauth_consents where user_id = v_u and client_id = v_c),
    'second revoke ends the consent again';
  -- an update that does not flip revoked_at from NULL does not run it
  update auth.oauth_consents set revoked_at = null where user_id = v_u and client_id = v_c;
  update mcp_oauth_grants set scopes = array['posts:write'] where id = v_grant;
  assert (select revoked_at is null from auth.oauth_consents where user_id = v_u and client_id = v_c),
    'updating an already-revoked grant leaves the consent alone';

  -- (5) prepare: stale consent (no active grant) behind a pending authorization -> repaired.
  -- Real flow: the row is not bound to a user yet (Supabase binds user_id only when the consent
  -- page fetches the details, which prepare runs before).
  insert into auth.oauth_consents (id, user_id, client_id, scopes) values (gen_random_uuid(), v_u, v_c3, 'openid');
  insert into auth.oauth_authorizations (id, authorization_id, client_id, user_id, redirect_uri, scope)
    values (gen_random_uuid(), 'az-unbound', v_c3, null, 'https://c.example/cb', 'openid');
  v_res := mcp_oauth_prepare_authorization('az-unbound', v_u);
  assert v_res = 'repaired', format('unbound authorization: expected repaired, got %s', v_res);
  assert (select revoked_at is not null from auth.oauth_consents where user_id = v_u and client_id = v_c3),
    'prepare revoked the stale consent';
  -- the same, already bound to the caller
  update auth.oauth_consents set revoked_at = null where user_id = v_u and client_id = v_c3;
  insert into auth.oauth_authorizations (id, authorization_id, client_id, user_id, redirect_uri, scope)
    values (gen_random_uuid(), 'az-stale', v_c3, v_u, 'https://c.example/cb', 'openid');
  v_res := mcp_oauth_prepare_authorization('az-stale', v_u);
  assert v_res = 'repaired', format('bound authorization: expected repaired, got %s', v_res);
  -- an unbound authorization only ever touches the CALLER's consent for that client
  insert into auth.oauth_consents (id, user_id, client_id, scopes) values (gen_random_uuid(), v_other, v_c3, 'openid');
  update auth.oauth_consents set revoked_at = null where user_id = v_u and client_id = v_c3;
  v_res := mcp_oauth_prepare_authorization('az-unbound', v_u);
  assert v_res = 'repaired', format('unbound again: expected repaired, got %s', v_res);
  assert (select revoked_at is null from auth.oauth_consents where user_id = v_other and client_id = v_c3),
    'another user consent for the same client is never touched';
  -- no consent left -> ok
  v_res := mcp_oauth_prepare_authorization('az-stale', v_u);
  assert v_res = 'ok', format('no consent: expected ok, got %s', v_res);

  -- (6) prepare: active grant -> ok, consent kept
  update auth.oauth_consents set revoked_at = null where user_id = v_u and client_id = v_c3;
  insert into mcp_oauth_grants (user_id, client_id, conta_id, scopes) values (v_u, v_c3::text, v_ws, array['posts:read']);
  v_res := mcp_oauth_prepare_authorization('az-stale', v_u);
  assert v_res = 'ok', format('active grant: expected ok, got %s', v_res);
  assert (select revoked_at is null from auth.oauth_consents where user_id = v_u and client_id = v_c3),
    'active grant keeps the consent';

  -- (7) prepare: not this user's, expired or no longer pending -> not_found, nothing touched
  v_res := mcp_oauth_prepare_authorization('az-stale', v_other);
  assert v_res = 'not_found', format('other user: expected not_found, got %s', v_res);
  v_res := mcp_oauth_prepare_authorization('az-missing', v_u);
  assert v_res = 'not_found', format('unknown id: expected not_found, got %s', v_res);
  insert into auth.oauth_authorizations (id, authorization_id, client_id, user_id, redirect_uri, scope, created_at, expires_at)
    values (gen_random_uuid(), 'az-expired', v_c2, v_u, 'https://b.example/cb', 'openid',
            now() - interval '5 minutes', now() - interval '1 minute');
  v_res := mcp_oauth_prepare_authorization('az-expired', v_u);
  assert v_res = 'not_found', format('expired: expected not_found, got %s', v_res);
  insert into auth.oauth_authorizations (id, authorization_id, client_id, user_id, redirect_uri, scope, status)
    values (gen_random_uuid(), 'az-approved', v_c2, v_u, 'https://b.example/cb', 'openid', 'approved');
  v_res := mcp_oauth_prepare_authorization('az-approved', v_u);
  assert v_res = 'not_found', format('approved: expected not_found, got %s', v_res);
  assert (select revoked_at is null from auth.oauth_consents where user_id = v_u and client_id = v_c2),
    'not_found never touches the consent';

  raise notice 'mcp_oauth_revoke_client_access: all assertions passed';
end;
$$;

rollback;
