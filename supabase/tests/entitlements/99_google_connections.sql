\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Suite for the Google connection tables (20261105000002_google_connections.sql):
-- google_connections, google_revocations, youtube_channels and gbp_locations are service-role
-- only (RLS on, no policies, REVOKE ALL from PUBLIC/anon/authenticated), with the uniqueness,
-- cascade and CHECK rules the connect flow relies on, plus oauth_states accepting 'google'.
-- Spec: docs/superpowers/specs/2026-10-29-youtube-google-meu-negocio-design.md.
--
-- The four new tables are excluded from the parity helper: their REVOKE is under test, and
-- parity would re-grant ALL to anon/authenticated and undo it.

-- =====================================================================
-- Shared seed: two workspaces, one owner each, client A1 + A2 in ws A, client B1 in ws B.
-- =====================================================================
create or replace function pg_temp.gc_seed() returns jsonb language plpgsql as $$
declare
  v_ws_a uuid; v_ws_b uuid;
  v_a uuid := gen_random_uuid(); v_b uuid := gen_random_uuid();
  v_cli_a1 bigint; v_cli_a2 bigint; v_cli_b1 bigint;
begin
  v_ws_a := et_make_workspace('pro');
  v_ws_b := et_make_workspace('pro');
  insert into auth.users (id) values (v_a), (v_b);
  insert into workspace_members (user_id, workspace_id, role) values
    (v_a, v_ws_a, 'owner'), (v_b, v_ws_b, 'owner');
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_a, v_ws_a, 'Cliente A1', 'A1', '#000') returning id into v_cli_a1;
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_a, v_ws_a, 'Cliente A2', 'A2', '#000') returning id into v_cli_a2;
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_b, v_ws_b, 'Cliente B1', 'B1', '#000') returning id into v_cli_b1;
  return jsonb_build_object('ws_a', v_ws_a, 'ws_b', v_ws_b, 'a', v_a, 'b', v_b,
    'cli_a1', v_cli_a1, 'cli_a2', v_cli_a2, 'cli_b1', v_cli_b1);
end $$;

-- Inserts run as service_role (the only role the edge functions use for these tables).
create or replace function pg_temp.gc_conn(p_ws uuid, p_sub text) returns uuid language plpgsql as $$
declare v_id uuid;
begin
  perform set_config('role', 'service_role', true);
  insert into google_connections (conta_id, google_sub, email, encrypted_access_token,
                                  encrypted_refresh_token, access_token_expires_at, scopes)
    values (p_ws, p_sub, p_sub || '@example.com', 'enc-access', 'enc-refresh',
            now() + interval '1 hour', array['https://www.googleapis.com/auth/youtube.readonly'])
    returning id into v_id;
  perform set_config('role', 'postgres', true);
  return v_id;
end $$;

create or replace function pg_temp.gc_channel(p_ws uuid, p_cli bigint, p_conn uuid, p_channel text)
returns uuid language plpgsql as $$
declare v_id uuid;
begin
  perform set_config('role', 'service_role', true);
  insert into youtube_channels (conta_id, client_id, connection_id, channel_id, title)
    values (p_ws, p_cli, p_conn, p_channel, 'Canal ' || p_channel)
    returning id into v_id;
  perform set_config('role', 'postgres', true);
  return v_id;
end $$;

create or replace function pg_temp.gc_location(p_ws uuid, p_cli bigint, p_conn uuid, p_loc text)
returns uuid language plpgsql as $$
declare v_id uuid;
begin
  perform set_config('role', 'service_role', true);
  insert into gbp_locations (conta_id, client_id, connection_id, account_name, location_name, title)
    values (p_ws, p_cli, p_conn, 'accounts/1', p_loc, 'Unidade ' || p_loc)
    returning id into v_id;
  perform set_config('role', 'postgres', true);
  return v_id;
end $$;

-- =====================================================================
-- grants: service-role only
-- =====================================================================
begin;
select et_grant_hosted_parity(array['google_connections','google_revocations',
                                    'youtube_channels','gbp_locations']);
do $$
declare v_t text; v_role text; v_priv text;
begin
  foreach v_t in array array['google_connections','google_revocations',
                              'youtube_channels','gbp_locations'] loop
    assert (select relrowsecurity from pg_class where oid = ('public.' || v_t)::regclass),
      format('%s should have RLS enabled', v_t);
    assert not exists (select 1 from pg_policies where schemaname = 'public' and tablename = v_t),
      format('%s should have no policies', v_t);
    -- All seven privileges, so a missing REVOKE fails on either local image: CLI 2.122's
    -- default ACL grants anon/authenticated arwdDxtm on new tables (like hosted's GRANT ALL),
    -- while older images grant only Dxtm, where TRUNCATE/REFERENCES/TRIGGER are the only
    -- privileges that prove the migration's REVOKE ran.
    foreach v_role in array array['authenticated','anon'] loop
      foreach v_priv in array array['select','insert','update','delete',
                                    'truncate','references','trigger'] loop
        assert not has_table_privilege(v_role, 'public.' || v_t, v_priv),
          format('%s should not have %s on %s', v_role, v_priv, v_t);
      end loop;
    end loop;
    foreach v_priv in array array['select','insert','update','delete'] loop
      assert has_table_privilege('service_role', 'public.' || v_t, v_priv),
        format('service_role should have %s on %s', v_priv, v_t);
    end loop;
  end loop;
  raise notice 'PASS 99_google_connections grants';
end $$;
rollback;

-- =====================================================================
-- service role writes, uniqueness, updated_at
-- =====================================================================
begin;
select et_grant_hosted_parity(array['google_connections','google_revocations',
                                    'youtube_channels','gbp_locations']);
do $$
declare
  s jsonb := pg_temp.gc_seed();
  v_ws_a uuid := (s->>'ws_a')::uuid; v_ws_b uuid := (s->>'ws_b')::uuid;
  v_conn_a uuid; v_conn_b uuid; v_ch uuid; v_loc uuid;
  v_created timestamptz; v_updated timestamptz;
begin
  v_conn_a := pg_temp.gc_conn(v_ws_a, 'sub-1');
  v_ch := pg_temp.gc_channel(v_ws_a, (s->>'cli_a1')::bigint, v_conn_a, 'UC-1');
  v_loc := pg_temp.gc_location(v_ws_a, (s->>'cli_a1')::bigint, v_conn_a, 'locations/10');
  assert (select status from google_connections where id = v_conn_a) = 'active',
    'connection status defaults to active';
  assert (select authorization_status from youtube_channels where id = v_ch) = 'active',
    'channel authorization_status defaults to active';
  assert (select status from gbp_locations where id = v_loc) = 'active',
    'location status defaults to active';

  -- same Google account twice in one workspace
  begin
    perform pg_temp.gc_conn(v_ws_a, 'sub-1');
    assert false, 'duplicate (conta_id, google_sub) should fail';
  exception when unique_violation then null;
  end;

  -- same channel twice in one workspace (on another client)
  begin
    perform pg_temp.gc_channel(v_ws_a, (s->>'cli_a2')::bigint, v_conn_a, 'UC-1');
    assert false, 'duplicate (conta_id, channel_id) should fail';
  exception when unique_violation then null;
  end;

  -- one channel per client
  begin
    perform pg_temp.gc_channel(v_ws_a, (s->>'cli_a1')::bigint, v_conn_a, 'UC-2');
    assert false, 'second channel on the same client should fail';
  exception when unique_violation then null;
  end;

  -- same channel in another workspace is fine
  v_conn_b := pg_temp.gc_conn(v_ws_b, 'sub-1');
  perform pg_temp.gc_channel(v_ws_b, (s->>'cli_b1')::bigint, v_conn_b, 'UC-1');

  -- same location on a second client of the same workspace
  begin
    perform pg_temp.gc_location(v_ws_a, (s->>'cli_a2')::bigint, v_conn_a, 'locations/10');
    assert false, 'duplicate (conta_id, location_name) should fail';
  exception when unique_violation then null;
  end;

  -- one client may hold several locations; the same location in another workspace is fine
  perform pg_temp.gc_location(v_ws_a, (s->>'cli_a1')::bigint, v_conn_a, 'locations/11');
  perform pg_temp.gc_location(v_ws_b, (s->>'cli_b1')::bigint, v_conn_b, 'locations/10');

  -- revocation queue row
  perform set_config('role', 'service_role', true);
  insert into google_revocations (google_sub, encrypted_token, token_kind)
    values ('sub-1', 'enc-refresh', 'refresh');
  assert (select attempts from google_revocations where google_sub = 'sub-1') = 0,
    'attempts defaults to 0';
  begin
    insert into google_revocations (google_sub, encrypted_token, token_kind)
      values ('sub-1', 'enc', 'id_token');
    assert false, 'token_kind outside refresh/access should fail';
  exception when check_violation then null;
  end;
  perform set_config('role', 'postgres', true);

  -- updated_at triggers
  update google_connections set created_at = now() - interval '1 day',
                                updated_at = now() - interval '1 day' where id = v_conn_a;
  update google_connections set display_name = 'Ana' where id = v_conn_a;
  select created_at, updated_at into v_created, v_updated from google_connections where id = v_conn_a;
  assert v_updated > v_created, 'google_connections.updated_at should move on update';
  update youtube_channels set updated_at = now() - interval '1 day' where id = v_ch;
  update youtube_channels set title = 'Novo' where id = v_ch;
  assert (select updated_at from youtube_channels where id = v_ch) > now() - interval '1 hour',
    'youtube_channels.updated_at should move on update';
  update gbp_locations set updated_at = now() - interval '1 day' where id = v_loc;
  update gbp_locations set title = 'Nova' where id = v_loc;
  assert (select updated_at from gbp_locations where id = v_loc) > now() - interval '1 hour',
    'gbp_locations.updated_at should move on update';

  raise notice 'PASS 99_google_connections writes and uniqueness';
end $$;
rollback;

-- =====================================================================
-- CHECKs: statuses and the gbp_locations disconnected pair
-- =====================================================================
begin;
do $$
declare
  s jsonb := pg_temp.gc_seed();
  v_ws_a uuid := (s->>'ws_a')::uuid;
  v_conn uuid; v_ch uuid; v_loc uuid;
begin
  v_conn := pg_temp.gc_conn(v_ws_a, 'sub-1');
  v_ch := pg_temp.gc_channel(v_ws_a, (s->>'cli_a1')::bigint, v_conn, 'UC-1');
  v_loc := pg_temp.gc_location(v_ws_a, (s->>'cli_a1')::bigint, v_conn, 'locations/10');

  begin
    update google_connections set status = 'expired' where id = v_conn;
    assert false, 'connection status outside active/revoked should fail';
  exception when check_violation then null;
  end;
  update google_connections set status = 'revoked' where id = v_conn;

  begin
    update youtube_channels set authorization_status = 'expired' where id = v_ch;
    assert false, 'channel authorization_status outside active/revoked should fail';
  exception when check_violation then null;
  end;
  update youtube_channels set authorization_status = 'revoked', revoked_at = now() where id = v_ch;

  begin
    update gbp_locations set status = 'gone' where id = v_loc;
    assert false, 'location status outside the three values should fail';
  exception when check_violation then null;
  end;
  begin
    update gbp_locations set disconnected_at = now() where id = v_loc;
    assert false, 'active location with disconnected_at should fail';
  exception when check_violation then null;
  end;
  begin
    update gbp_locations set status = 'disconnected' where id = v_loc;
    assert false, 'disconnected location without disconnected_at should fail';
  exception when check_violation then null;
  end;
  begin
    update gbp_locations set connection_id = null where id = v_loc;
    assert false, 'active location without a connection should fail';
  exception when check_violation then null;
  end;

  -- a disconnected unit keeps its row after the connection is gone
  update gbp_locations set status = 'disconnected', disconnected_at = now() where id = v_loc;
  delete from youtube_channels where id = v_ch;
  delete from google_connections where id = v_conn;
  assert (select connection_id from gbp_locations where id = v_loc) is null,
    'deleting the connection should null connection_id on a disconnected location';
  assert (select status from gbp_locations where id = v_loc) = 'disconnected',
    'disconnected location survives the connection';

  raise notice 'PASS 99_google_connections checks';
end $$;
rollback;

-- =====================================================================
-- deleting a connection fails closed while a non-disconnected location uses it
-- (SET NULL would leave an active/revoked unit without a connection; the unlink RPCs
-- must mark the unit disconnected first)
-- =====================================================================
begin;
do $$
declare
  s jsonb := pg_temp.gc_seed();
  v_ws_a uuid := (s->>'ws_a')::uuid;
  v_conn uuid; v_loc uuid;
begin
  v_conn := pg_temp.gc_conn(v_ws_a, 'sub-1');
  v_loc := pg_temp.gc_location(v_ws_a, (s->>'cli_a1')::bigint, v_conn, 'locations/10');
  begin
    delete from google_connections where id = v_conn;
    assert false, 'deleting a connection used by an active location should fail';
  exception when check_violation then null;
  end;
  update gbp_locations set status = 'revoked', disconnected_at = now() where id = v_loc;
  begin
    delete from google_connections where id = v_conn;
    assert false, 'deleting a connection used by a revoked location should fail';
  exception when check_violation then null;
  end;
  assert exists (select 1 from google_connections where id = v_conn), 'connection still there';
  raise notice 'PASS 99_google_connections location keeps connection';
end $$;
rollback;

-- =====================================================================
-- a channel blocks deleting its connection (NO ACTION)
-- =====================================================================
begin;
do $$
declare
  s jsonb := pg_temp.gc_seed();
  v_ws_a uuid := (s->>'ws_a')::uuid;
  v_conn uuid;
begin
  v_conn := pg_temp.gc_conn(v_ws_a, 'sub-1');
  perform pg_temp.gc_channel(v_ws_a, (s->>'cli_a1')::bigint, v_conn, 'UC-1');
  begin
    delete from google_connections where id = v_conn;
    assert false, 'deleting a connection that a channel uses should fail';
  exception when foreign_key_violation then null;
  end;
  raise notice 'PASS 99_google_connections channel keeps connection';
end $$;
rollback;

-- =====================================================================
-- cascades: client delete, workspace delete
-- =====================================================================
begin;
do $$
declare
  s jsonb := pg_temp.gc_seed();
  v_ws_a uuid := (s->>'ws_a')::uuid;
  v_cli bigint := (s->>'cli_a1')::bigint;
  v_conn uuid;
begin
  v_conn := pg_temp.gc_conn(v_ws_a, 'sub-1');
  perform pg_temp.gc_channel(v_ws_a, v_cli, v_conn, 'UC-1');
  perform pg_temp.gc_location(v_ws_a, v_cli, v_conn, 'locations/10');
  perform pg_temp.gc_location(v_ws_a, v_cli, v_conn, 'locations/11');

  delete from clientes where id = v_cli;
  assert not exists (select 1 from youtube_channels where client_id = v_cli),
    'client delete should cascade its channel';
  assert not exists (select 1 from gbp_locations where client_id = v_cli),
    'client delete should cascade its locations';
  assert exists (select 1 from google_connections where id = v_conn),
    'client delete should keep the workspace connection';
  raise notice 'PASS 99_google_connections client cascade';
end $$;
rollback;

begin;
do $$
declare
  s jsonb := pg_temp.gc_seed();
  v_ws_a uuid := (s->>'ws_a')::uuid;
  v_ws_b uuid := (s->>'ws_b')::uuid;
  v_conn uuid; v_conn_b uuid;
begin
  v_conn := pg_temp.gc_conn(v_ws_a, 'sub-1');
  perform pg_temp.gc_channel(v_ws_a, (s->>'cli_a1')::bigint, v_conn, 'UC-1');
  perform pg_temp.gc_location(v_ws_a, (s->>'cli_a1')::bigint, v_conn, 'locations/10');
  perform pg_temp.gc_location(v_ws_a, (s->>'cli_a2')::bigint, v_conn, 'locations/11');
  v_conn_b := pg_temp.gc_conn(v_ws_b, 'sub-1');
  perform pg_temp.gc_channel(v_ws_b, (s->>'cli_b1')::bigint, v_conn_b, 'UC-1');

  delete from workspaces where id = v_ws_a;
  assert not exists (select 1 from google_connections where conta_id = v_ws_a), 'connections gone';
  assert not exists (select 1 from youtube_channels where conta_id = v_ws_a), 'channels gone';
  assert not exists (select 1 from gbp_locations where conta_id = v_ws_a), 'locations gone';
  assert exists (select 1 from youtube_channels where conta_id = v_ws_b), 'other workspace untouched';
  raise notice 'PASS 99_google_connections workspace cascade';
end $$;
rollback;

-- =====================================================================
-- oauth_states.provider accepts google
-- =====================================================================
begin;
do $$
begin
  insert into oauth_states (nonce, client_id, conta_id, initiated_by, expires_at, provider)
    values ('n-google', 1, gen_random_uuid()::text, gen_random_uuid(), now() + interval '10 minutes', 'google');
  insert into oauth_states (nonce, client_id, conta_id, initiated_by, expires_at, provider)
    values ('n-tiktok', 1, gen_random_uuid()::text, gen_random_uuid(), now() + interval '10 minutes', 'tiktok');
  begin
    insert into oauth_states (nonce, client_id, conta_id, initiated_by, expires_at, provider)
      values ('n-yt', 1, gen_random_uuid()::text, gen_random_uuid(), now() + interval '10 minutes', 'youtube');
    assert false, 'provider youtube should fail';
  exception when check_violation then null;
  end;
  assert (select count(*) from pg_constraint
           where conrelid = 'public.oauth_states'::regclass and contype = 'c'
             and pg_get_constraintdef(oid) like '%provider%') = 1,
    'exactly one provider CHECK on oauth_states';
  assert exists (select 1 from pg_constraint
                  where conrelid = 'public.oauth_states'::regclass
                    and conname = 'oauth_states_provider_check'),
    'provider CHECK is named oauth_states_provider_check';
  raise notice 'PASS 99_google_connections oauth_states provider';
end $$;
rollback;
