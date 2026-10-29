\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Suite for the Google connection RPCs (20261105000003_google_connection_rpcs.sql):
-- google_connection_upsert (token merge), google_connection_refresh_covers,
-- google_unlink_youtube / google_unlink_gbp_location (advisory-locked unlink + revoke when the
-- Google account is no longer used anywhere) and google_mark_revoked (invalid_grant).
-- Spec: docs/superpowers/specs/2026-10-29-youtube-google-meu-negocio-design.md (section 4.2).
--
-- RPCs run as service_role (the only role granted EXECUTE); seeding runs as postgres.
-- The parity helper is not called: these blocks never act as anon/authenticated, and the
-- Google tables' REVOKEs must stay intact.

-- =====================================================================
-- Shared seed: workspaces A and B, client A1 + A2 in A, client B1 in B.
-- =====================================================================
create or replace function pg_temp.gr_seed() returns jsonb language plpgsql as $$
declare
  v_ws_a uuid; v_ws_b uuid;
  v_a uuid := gen_random_uuid(); v_b uuid := gen_random_uuid();
  v_cli_a1 bigint; v_cli_a2 bigint; v_cli_b1 bigint;
begin
  v_ws_a := et_make_workspace('pro');
  v_ws_b := et_make_workspace('pro');
  insert into auth.users (id) values (v_a), (v_b);
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_a, v_ws_a, 'Cliente A1', 'A1', '#000') returning id into v_cli_a1;
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_a, v_ws_a, 'Cliente A2', 'A2', '#000') returning id into v_cli_a2;
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_b, v_ws_b, 'Cliente B1', 'B1', '#000') returning id into v_cli_b1;
  return jsonb_build_object('ws_a', v_ws_a, 'ws_b', v_ws_b,
    'cli_a1', v_cli_a1, 'cli_a2', v_cli_a2, 'cli_b1', v_cli_b1);
end $$;

create or replace function pg_temp.gr_yt() returns text[] language sql as $$
  select array['https://www.googleapis.com/auth/youtube.upload',
               'https://www.googleapis.com/auth/youtube.readonly',
               'https://www.googleapis.com/auth/yt-analytics.readonly']
$$;
create or replace function pg_temp.gr_gbp() returns text[] language sql as $$
  select array['https://www.googleapis.com/auth/business.manage']
$$;

-- Connection through the RPC, as service_role.
create or replace function pg_temp.gr_upsert(p_ws uuid, p_sub text, p_refresh text, p_scopes text[],
                                             p_access text default 'A1')
returns uuid language plpgsql as $$
declare v_id uuid;
begin
  perform set_config('role', 'service_role', true);
  v_id := google_connection_upsert(p_ws, p_sub, p_sub || '@example.com', 'Nome', p_access, p_refresh,
                                   now() + interval '1 hour', p_scopes);
  perform set_config('role', 'postgres', true);
  return v_id;
end $$;

create or replace function pg_temp.gr_channel(p_ws uuid, p_cli bigint, p_conn uuid, p_channel text)
returns uuid language plpgsql as $$
declare v_id uuid;
begin
  insert into youtube_channels (conta_id, client_id, connection_id, channel_id)
    values (p_ws, p_cli, p_conn, p_channel) returning id into v_id;
  return v_id;
end $$;

create or replace function pg_temp.gr_location(p_ws uuid, p_cli bigint, p_conn uuid, p_loc text)
returns uuid language plpgsql as $$
declare v_id uuid;
begin
  insert into gbp_locations (conta_id, client_id, connection_id, account_name, location_name)
    values (p_ws, p_cli, p_conn, 'accounts/1', p_loc) returning id into v_id;
  return v_id;
end $$;

-- Whether this backend holds pg_advisory_xact_lock(hashtext('google-sub:' || p_sub)).
create or replace function pg_temp.gr_holds_sub_lock(p_sub text) returns boolean language sql as $$
  select exists (
    select 1 from pg_locks
     where locktype = 'advisory' and pid = pg_backend_pid() and granted and objsubid = 1
       and ((classid::bigint << 32) | objid::bigint) = hashtext('google-sub:' || p_sub)::bigint);
$$;

-- Ends the fresh-connection grace (R10): the connection was authorized two hours ago.
create or replace function pg_temp.gr_backdate(p_conn uuid) returns void language sql as $$
  update google_connections set authorized_at = now() - interval '2 hours' where id = p_conn;
$$;

create or replace function pg_temp.gr_unlink_yt(p_ws uuid, p_cli bigint)
returns table(should_revoke boolean, revocation_id uuid) language plpgsql as $$
begin
  perform set_config('role', 'service_role', true);
  return query select u.should_revoke, u.revocation_id from google_unlink_youtube(p_ws, p_cli) u;
  perform set_config('role', 'postgres', true);
end $$;

create or replace function pg_temp.gr_unlink_loc(p_ws uuid, p_loc uuid)
returns table(should_revoke boolean, revocation_id uuid) language plpgsql as $$
begin
  perform set_config('role', 'service_role', true);
  return query select u.should_revoke, u.revocation_id from google_unlink_gbp_location(p_ws, p_loc) u;
  perform set_config('role', 'postgres', true);
end $$;

create or replace function pg_temp.gr_mark_revoked(p_conn uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'service_role', true);
  perform google_mark_revoked(p_conn);
  perform set_config('role', 'postgres', true);
end $$;

create or replace function pg_temp.gr_covers(p_ws uuid, p_sub text, p_scopes text[])
returns boolean language plpgsql as $$
declare v boolean;
begin
  perform set_config('role', 'service_role', true);
  v := google_connection_refresh_covers(p_ws, p_sub, p_scopes);
  perform set_config('role', 'postgres', true);
  return v;
end $$;

-- =====================================================================
-- upsert_keeps_refresh
-- =====================================================================
begin;
do $$
declare
  s jsonb := pg_temp.gr_seed();
  v_ws uuid := (s->>'ws_a')::uuid;
  v_id uuid; v_id2 uuid; r record;
begin
  v_id := pg_temp.gr_upsert(v_ws, 'sub-1', 'R1', pg_temp.gr_yt(), 'A1');
  v_id2 := pg_temp.gr_upsert(v_ws, 'sub-1', null, pg_temp.gr_gbp() || (pg_temp.gr_yt())[1:1], 'A2');
  assert v_id2 = v_id, 'second upsert updates the same row';
  select * into r from google_connections where id = v_id;
  assert r.encrypted_refresh_token = 'R1', 'null refresh keeps the stored one';
  assert r.encrypted_access_token = 'A2', 'access token replaced';
  assert r.scopes = array(select distinct x from unnest(pg_temp.gr_yt() || pg_temp.gr_gbp()) x order by x),
    format('scopes are the sorted distinct union, got %s', r.scopes);
  assert (select count(*) from google_connections where google_sub = 'sub-1') = 1, 'one row';

  update google_connections set authorized_at = now() - interval '2 hours' where id = v_id;
  perform pg_temp.gr_upsert(v_ws, 'sub-1', 'R2', pg_temp.gr_yt(), 'A3');
  assert (select authorized_at from google_connections where id = v_id) = now(),
    'every upsert stamps authorized_at';
  assert (select encrypted_refresh_token from google_connections where id = v_id) = 'R2',
    'a new refresh token replaces the stored one';
  assert (select scopes from google_connections where id = v_id)
         = array(select distinct x from unnest(pg_temp.gr_yt()) x order by x),
    format('a fresh grant replaces the stored scopes, got %s',
           (select scopes from google_connections where id = v_id));
  raise notice 'PASS google_rpcs.upsert_keeps_refresh';
end $$;
rollback;

-- =====================================================================
-- upsert_fresh_grant_replaces_scopes: a new refresh token is a new grant, so its scopes are
-- the whole truth (a scope unticked on reconnect is gone); a NULL refresh token keeps the union
-- =====================================================================
begin;
do $$
declare
  s jsonb := pg_temp.gr_seed();
  v_ws uuid := (s->>'ws_a')::uuid;
  v_id uuid;
begin
  v_id := pg_temp.gr_upsert(v_ws, 'sub-1', 'R1', pg_temp.gr_yt() || pg_temp.gr_gbp());
  perform pg_temp.gr_upsert(v_ws, 'sub-1', 'R2',
                            pg_temp.gr_gbp() || pg_temp.gr_gbp() || (pg_temp.gr_yt())[2:2]);
  assert (select scopes from google_connections where id = v_id)
         = array(select distinct x from unnest(pg_temp.gr_gbp() || (pg_temp.gr_yt())[2:2]) x order by x),
    format('fresh grant: sorted distinct p_scopes only, got %s',
           (select scopes from google_connections where id = v_id));

  perform pg_temp.gr_upsert(v_ws, 'sub-1', null, (pg_temp.gr_yt())[1:1]);
  assert (select scopes from google_connections where id = v_id)
         = array(select distinct x from unnest(pg_temp.gr_gbp() || (pg_temp.gr_yt())[1:2]) x order by x),
    format('null refresh: stored scopes unioned with p_scopes, got %s',
           (select scopes from google_connections where id = v_id));
  assert pg_temp.gr_covers(v_ws, 'sub-1', pg_temp.gr_yt()) = false,
    'the dropped yt-analytics scope is no longer claimed';
  raise notice 'PASS google_rpcs.upsert_fresh_grant_replaces_scopes';
end $$;
rollback;

-- =====================================================================
-- refresh_covers_scopes
-- =====================================================================
begin;
do $$
declare
  s jsonb := pg_temp.gr_seed();
  v_ws uuid := (s->>'ws_a')::uuid; v_ws_b uuid := (s->>'ws_b')::uuid;
  v_id uuid;
begin
  v_id := pg_temp.gr_upsert(v_ws, 'sub-1', 'R1', pg_temp.gr_yt());
  assert pg_temp.gr_covers(v_ws, 'sub-1', pg_temp.gr_gbp()) = false,
    'YouTube-only refresh token does not cover business.manage';
  assert pg_temp.gr_covers(v_ws, 'sub-1', pg_temp.gr_yt()) = true, 'covers its own scopes';
  assert pg_temp.gr_covers(v_ws_b, 'sub-1', pg_temp.gr_yt()) = false, 'scoped to the workspace';
  assert pg_temp.gr_covers(v_ws, 'sub-2', pg_temp.gr_yt()) = false, 'unknown sub';

  perform pg_temp.gr_upsert(v_ws_b, 'sub-3', null, pg_temp.gr_yt());
  assert pg_temp.gr_covers(v_ws_b, 'sub-3', pg_temp.gr_yt()) = false, 'no refresh token stored';

  -- a revoked connection's refresh token is dead (invalid_grant): never trust it
  perform pg_temp.gr_mark_revoked(v_id);
  assert pg_temp.gr_covers(v_ws, 'sub-1', pg_temp.gr_yt()) = false, 'revoked connection does not cover';
  raise notice 'PASS google_rpcs.refresh_covers_scopes';
end $$;
rollback;

-- =====================================================================
-- mark_revoked: idempotent, leaves refresh_lock_at alone
-- =====================================================================
begin;
do $$
declare
  s jsonb := pg_temp.gr_seed();
  v_ws uuid := (s->>'ws_a')::uuid;
  v_conn uuid; v_ch uuid; v_loc uuid; v_loc_d uuid; v_lock timestamptz := now() - interval '5 seconds';
  v_rev_at timestamptz;
begin
  v_conn := pg_temp.gr_upsert(v_ws, 'sub-1', 'R1', pg_temp.gr_yt() || pg_temp.gr_gbp());
  v_ch := pg_temp.gr_channel(v_ws, (s->>'cli_a1')::bigint, v_conn, 'UC-1');
  v_loc := pg_temp.gr_location(v_ws, (s->>'cli_a1')::bigint, v_conn, 'locations/1');
  v_loc_d := pg_temp.gr_location(v_ws, (s->>'cli_a2')::bigint, v_conn, 'locations/2');
  update gbp_locations set status = 'disconnected', disconnected_at = now() - interval '1 day' where id = v_loc_d;
  update google_connections set refresh_lock_at = v_lock where id = v_conn;

  perform pg_temp.gr_mark_revoked(v_conn);
  assert (select status from google_connections where id = v_conn) = 'revoked', 'connection revoked';
  assert (select refresh_lock_at from google_connections where id = v_conn) = v_lock, 'lock untouched';
  assert (select authorization_status from youtube_channels where id = v_ch) = 'revoked', 'channel revoked';
  assert (select revoked_at from youtube_channels where id = v_ch) is not null, 'channel revoked_at set';
  assert (select status from gbp_locations where id = v_loc) = 'revoked', 'active location revoked';
  assert (select disconnected_at from gbp_locations where id = v_loc) is not null, 'location disconnected_at set';
  assert (select status from gbp_locations where id = v_loc_d) = 'disconnected', 'disconnected stays disconnected';

  update youtube_channels set revoked_at = now() - interval '1 hour' where id = v_ch;
  v_rev_at := (select revoked_at from youtube_channels where id = v_ch);
  perform pg_temp.gr_mark_revoked(v_conn);
  assert (select revoked_at from youtube_channels where id = v_ch) = v_rev_at, 'second call keeps revoked_at';
  assert (select status from google_connections where id = v_conn) = 'revoked', 'still revoked';
  assert (select refresh_lock_at from google_connections where id = v_conn) = v_lock, 'lock still untouched';

  perform pg_temp.gr_mark_revoked(gen_random_uuid());  -- unknown id is a no-op
  raise notice 'PASS google_rpcs.mark_revoked_idempotent';
end $$;
rollback;

-- =====================================================================
-- upsert_reactivates
-- =====================================================================
begin;
do $$
declare
  s jsonb := pg_temp.gr_seed();
  v_ws uuid := (s->>'ws_a')::uuid;
  v_conn uuid; v_ch uuid; v_loc uuid; v_loc_d uuid;
begin
  v_conn := pg_temp.gr_upsert(v_ws, 'sub-1', 'R1', pg_temp.gr_yt() || pg_temp.gr_gbp());
  v_ch := pg_temp.gr_channel(v_ws, (s->>'cli_a1')::bigint, v_conn, 'UC-1');
  v_loc := pg_temp.gr_location(v_ws, (s->>'cli_a1')::bigint, v_conn, 'locations/1');
  v_loc_d := pg_temp.gr_location(v_ws, (s->>'cli_a2')::bigint, v_conn, 'locations/2');
  update gbp_locations set status = 'disconnected', disconnected_at = now() where id = v_loc_d;

  perform pg_temp.gr_mark_revoked(v_conn);
  assert pg_temp.gr_upsert(v_ws, 'sub-1', 'R2', pg_temp.gr_yt() || pg_temp.gr_gbp()) = v_conn, 'same connection';
  assert (select status from google_connections where id = v_conn) = 'active', 'connection active';
  assert (select authorization_status from youtube_channels where id = v_ch) = 'active', 'channel active';
  assert (select revoked_at from youtube_channels where id = v_ch) is null, 'channel revoked_at cleared';
  assert (select status from gbp_locations where id = v_loc) = 'active', 'revoked location active';
  assert (select disconnected_at from gbp_locations where id = v_loc) is null, 'location disconnected_at cleared';
  assert (select status from gbp_locations where id = v_loc_d) = 'disconnected', 'disconnected location stays';
  raise notice 'PASS google_rpcs.upsert_reactivates';
end $$;
rollback;

-- =====================================================================
-- upsert_reactivates_only_covered (R14): a fresh grant replaces the scopes, so a reconnect for one
-- product must not bring back the other product's revoked units on a token that cannot serve them
-- =====================================================================
begin;
do $$
declare
  s jsonb := pg_temp.gr_seed();
  v_ws uuid := (s->>'ws_a')::uuid;
  v_conn uuid; v_ch uuid; v_loc uuid;
begin
  -- YouTube reconnect after a Google-side revoke: the channel comes back, GMN units stay revoked.
  v_conn := pg_temp.gr_upsert(v_ws, 'sub-1', 'R1', pg_temp.gr_yt() || pg_temp.gr_gbp());
  v_ch := pg_temp.gr_channel(v_ws, (s->>'cli_a1')::bigint, v_conn, 'UC-1');
  v_loc := pg_temp.gr_location(v_ws, (s->>'cli_a2')::bigint, v_conn, 'locations/1');
  perform pg_temp.gr_mark_revoked(v_conn);
  perform pg_temp.gr_upsert(v_ws, 'sub-1', 'R2', pg_temp.gr_yt());
  assert (select authorization_status from youtube_channels where id = v_ch) = 'active',
    'yt grant reactivates the channel';
  assert (select status from gbp_locations where id = v_loc) = 'revoked',
    'yt-only grant leaves the GMN unit revoked';

  -- GMN reconnect: the unit comes back, the channel stays revoked.
  perform pg_temp.gr_mark_revoked(v_conn);
  perform pg_temp.gr_upsert(v_ws, 'sub-1', 'R3', pg_temp.gr_gbp());
  assert (select status from gbp_locations where id = v_loc) = 'active',
    'gbp grant reactivates the GMN unit';
  assert (select authorization_status from youtube_channels where id = v_ch) = 'revoked',
    'gbp-only grant leaves the channel revoked';

  -- A partial YouTube set does not cover the channel either.
  perform pg_temp.gr_mark_revoked(v_conn);
  perform pg_temp.gr_upsert(v_ws, 'sub-1', 'R4', (pg_temp.gr_yt())[1:2]);
  assert (select authorization_status from youtube_channels where id = v_ch) = 'revoked',
    'all three YouTube scopes are required to reactivate the channel';

  -- A NULL refresh token keeps the union: both stored product scopes still cover.
  perform pg_temp.gr_upsert(v_ws, 'sub-1', 'R5', pg_temp.gr_yt() || pg_temp.gr_gbp());
  perform pg_temp.gr_mark_revoked(v_conn);
  perform pg_temp.gr_upsert(v_ws, 'sub-1', null, pg_temp.gr_gbp());
  assert (select authorization_status from youtube_channels where id = v_ch) = 'active',
    'unioned scopes still cover YouTube';
  assert (select status from gbp_locations where id = v_loc) = 'active', 'and GMN';
  raise notice 'PASS google_rpcs.upsert_reactivates_only_covered';
end $$;
rollback;

-- =====================================================================
-- unlink_shared_sub_no_revoke + unlink_last_revokes_once + unlink_other_workspace_404
-- =====================================================================
begin;
do $$
declare
  s jsonb := pg_temp.gr_seed();
  v_ws_a uuid := (s->>'ws_a')::uuid; v_ws_b uuid := (s->>'ws_b')::uuid;
  v_conn_a uuid; v_conn_b uuid; v_loc_b uuid; r record;
begin
  v_conn_a := pg_temp.gr_upsert(v_ws_a, 'sub-1', 'RA', pg_temp.gr_yt());
  v_conn_b := pg_temp.gr_upsert(v_ws_b, 'sub-1', 'RB', pg_temp.gr_gbp());
  perform pg_temp.gr_channel(v_ws_a, (s->>'cli_a1')::bigint, v_conn_a, 'UC-1');
  v_loc_b := pg_temp.gr_location(v_ws_b, (s->>'cli_b1')::bigint, v_conn_b, 'locations/1');
  perform pg_temp.gr_backdate(v_conn_a);
  perform pg_temp.gr_backdate(v_conn_b);

  -- unlink_other_workspace_404
  begin
    perform * from pg_temp.gr_unlink_yt(v_ws_b, (s->>'cli_a1')::bigint);
    assert false, 'unlinking another workspace''s client should raise';
  exception when sqlstate 'P0002' then null;
  end;
  perform set_config('role', 'postgres', true);
  begin
    perform * from pg_temp.gr_unlink_loc(v_ws_a, v_loc_b);
    assert false, 'unlinking another workspace''s location should raise';
  exception when sqlstate 'P0002' then null;
  end;
  perform set_config('role', 'postgres', true);
  assert exists (select 1 from youtube_channels where client_id = (s->>'cli_a1')::bigint), 'channel untouched';
  assert (select status from gbp_locations where id = v_loc_b) = 'active', 'location untouched';
  raise notice 'PASS google_rpcs.unlink_other_workspace_404';

  -- unlink_shared_sub_no_revoke
  select * into r from pg_temp.gr_unlink_yt(v_ws_a, (s->>'cli_a1')::bigint);
  assert r.should_revoke = false, 'sub still used by B: no revoke';
  assert r.revocation_id is null, 'no revocation id';
  assert not exists (select 1 from youtube_channels where client_id = (s->>'cli_a1')::bigint), 'channel deleted';
  assert (select encrypted_refresh_token from google_connections where id = v_conn_a) = 'RA',
    'A''s connection keeps its token';
  assert not exists (select 1 from google_revocations), 'no revocation queued';
  raise notice 'PASS google_rpcs.unlink_shared_sub_no_revoke';

  -- unlink_last_revokes_once
  select * into r from pg_temp.gr_unlink_loc(v_ws_b, v_loc_b);
  assert r.should_revoke = true, 'last use: revoke';
  assert r.revocation_id is not null, 'revocation id returned';
  assert (select count(*) from google_revocations) = 1, 'exactly one revocation row';
  assert (select token_kind from google_revocations where id = r.revocation_id) = 'refresh', 'refresh token';
  assert (select google_sub from google_revocations where id = r.revocation_id) = 'sub-1', 'sub recorded';
  assert (select encrypted_token from google_revocations where id = r.revocation_id) in ('RA', 'RB'),
    'one of the sub''s refresh tokens';
  assert not exists (select 1 from google_connections where google_sub = 'sub-1'),
    'no connection with that sub remains in A or B';
  assert (select status from gbp_locations where id = v_loc_b) = 'disconnected', 'location disconnected';
  assert (select disconnected_at from gbp_locations where id = v_loc_b) is not null, 'disconnected_at set';
  assert (select connection_id from gbp_locations where id = v_loc_b) is null, 'connection_id nulled';
  raise notice 'PASS google_rpcs.unlink_last_revokes_once';

  -- unlinking the already-disconnected unit again is a harmless no-op
  select * into r from pg_temp.gr_unlink_loc(v_ws_b, v_loc_b);
  assert r.should_revoke = false and r.revocation_id is null, 'repeat unlink does not revoke';
  assert (select count(*) from google_revocations) = 1, 'still one revocation row';

  -- unlinking a client with no channel raises P0002
  begin
    perform * from pg_temp.gr_unlink_yt(v_ws_a, (s->>'cli_a1')::bigint);
    assert false, 'no channel left: should raise';
  exception when sqlstate 'P0002' then null;
  end;
  perform set_config('role', 'postgres', true);
  raise notice 'PASS google_rpcs.unlink_repeat';
end $$;
rollback;

-- =====================================================================
-- in use: a revoked location or a revoked channel still counts; a disconnected one does not
-- =====================================================================
begin;
do $$
declare
  s jsonb := pg_temp.gr_seed();
  v_ws uuid := (s->>'ws_a')::uuid;
  v_conn uuid; v_loc1 uuid; v_loc2 uuid; r record;
begin
  v_conn := pg_temp.gr_upsert(v_ws, 'sub-1', 'R1', pg_temp.gr_yt() || pg_temp.gr_gbp());
  v_loc1 := pg_temp.gr_location(v_ws, (s->>'cli_a1')::bigint, v_conn, 'locations/1');
  v_loc2 := pg_temp.gr_location(v_ws, (s->>'cli_a2')::bigint, v_conn, 'locations/2');
  perform pg_temp.gr_channel(v_ws, (s->>'cli_a2')::bigint, v_conn, 'UC-1');
  perform pg_temp.gr_mark_revoked(v_conn);
  perform pg_temp.gr_backdate(v_conn);

  select * into r from pg_temp.gr_unlink_loc(v_ws, v_loc1);
  assert r.should_revoke = false, 'revoked location 2 and revoked channel still use the sub';
  select * into r from pg_temp.gr_unlink_yt(v_ws, (s->>'cli_a2')::bigint);
  assert r.should_revoke = false, 'revoked location 2 still uses the sub';
  select * into r from pg_temp.gr_unlink_loc(v_ws, v_loc2);
  assert r.should_revoke = true, 'only disconnected units left: revoke';
  assert not exists (select 1 from google_connections where id = v_conn), 'connection deleted';
  assert (select count(*) from gbp_locations where conta_id = v_ws and status = 'disconnected'
            and connection_id is null) = 2, 'both units kept as disconnected';
  raise notice 'PASS google_rpcs.in_use_definition';
end $$;
rollback;

-- =====================================================================
-- revoke_falls_back_to_access
-- =====================================================================
begin;
do $$
declare
  s jsonb := pg_temp.gr_seed();
  v_ws uuid := (s->>'ws_a')::uuid;
  v_conn uuid; r record;
begin
  v_conn := pg_temp.gr_upsert(v_ws, 'sub-1', null, pg_temp.gr_yt(), 'ACCESS-1');
  perform pg_temp.gr_channel(v_ws, (s->>'cli_a1')::bigint, v_conn, 'UC-1');
  perform pg_temp.gr_backdate(v_conn);
  select * into r from pg_temp.gr_unlink_yt(v_ws, (s->>'cli_a1')::bigint);
  assert r.should_revoke = true, 'last use: revoke';
  assert (select count(*) from google_revocations) = 1, 'one revocation row';
  assert (select token_kind from google_revocations where id = r.revocation_id) = 'access', 'access fallback';
  assert (select encrypted_token from google_revocations where id = r.revocation_id) = 'ACCESS-1', 'the access token';
  assert not exists (select 1 from google_connections where google_sub = 'sub-1'), 'connection deleted';
  raise notice 'PASS google_rpcs.revoke_falls_back_to_access';
end $$;
rollback;

-- =====================================================================
-- fresh_connection_grace (R10): a connection authorized in the last hour keeps its sub in use
-- even with no unit (callback upsert -> channel insert / GMN unit picker). Only the upsert
-- extends the grace: token refreshes, lock claims and mark_revoked do not.
-- =====================================================================
begin;
do $$
declare
  s jsonb := pg_temp.gr_seed();
  v_ws_a uuid := (s->>'ws_a')::uuid; v_ws_b uuid := (s->>'ws_b')::uuid;
  v_conn_a uuid; v_conn_b uuid; v_loc1 uuid; v_loc2 uuid; r record;
begin
  v_conn_b := pg_temp.gr_upsert(v_ws_b, 'sub-1', 'RB', pg_temp.gr_gbp());
  v_loc1 := pg_temp.gr_location(v_ws_b, (s->>'cli_b1')::bigint, v_conn_b, 'locations/1');
  perform pg_temp.gr_backdate(v_conn_b);
  -- A just came back from the callback: connection upserted, no unit linked yet
  v_conn_a := pg_temp.gr_upsert(v_ws_a, 'sub-1', 'RA', pg_temp.gr_yt());

  select * into r from pg_temp.gr_unlink_loc(v_ws_b, v_loc1);
  assert r.should_revoke = false and r.revocation_id is null, 'fresh connection keeps the sub in use';
  assert exists (select 1 from google_connections where id = v_conn_a), 'fresh connection kept';
  assert exists (select 1 from google_connections where id = v_conn_b), 'B connection kept';
  assert not exists (select 1 from google_revocations), 'nothing revoked';

  -- grace over; refresh-style writes and mark_revoked must not bring it back
  v_loc2 := pg_temp.gr_location(v_ws_b, (s->>'cli_b1')::bigint, v_conn_b, 'locations/2');
  perform pg_temp.gr_backdate(v_conn_a);
  update google_connections
     set encrypted_access_token = 'A-refreshed', access_token_expires_at = now() + interval '1 hour',
         refresh_lock_at = now()
   where google_sub = 'sub-1';
  update google_connections set refresh_lock_at = null where google_sub = 'sub-1';
  perform pg_temp.gr_mark_revoked(v_conn_a);
  assert (select updated_at from google_connections where id = v_conn_a) = now(), 'updated_at is fresh';

  select * into r from pg_temp.gr_unlink_loc(v_ws_b, v_loc2);
  assert r.should_revoke = true, 'stale connection: last unlink revokes';
  assert not exists (select 1 from google_connections where google_sub = 'sub-1'), 'both connections deleted';
  assert (select count(*) from google_revocations) = 1, 'one revocation row';
  raise notice 'PASS google_rpcs.fresh_connection_grace';
end $$;
rollback;

-- =====================================================================
-- mark_revoked takes the per-sub advisory lock
-- =====================================================================
begin;
do $$
declare
  s jsonb := pg_temp.gr_seed();
  v_conn uuid;
begin
  insert into google_connections (conta_id, google_sub, email, encrypted_access_token, access_token_expires_at)
    values ((s->>'ws_a')::uuid, 'sub-lock', 'x@example.com', 'A', now() + interval '1 hour')
    returning id into v_conn;
  assert not pg_temp.gr_holds_sub_lock('sub-lock'), 'no google-sub lock before the call';
  perform pg_temp.gr_mark_revoked(v_conn);
  assert pg_temp.gr_holds_sub_lock('sub-lock'), 'mark_revoked holds the google-sub advisory lock';
  raise notice 'PASS google_rpcs.mark_revoked_locks';
end $$;
rollback;

-- =====================================================================
-- grants
-- =====================================================================
begin;
do $$
declare v_fn text; v_role text;
begin
  foreach v_fn in array array[
    'public.google_connection_upsert(uuid, text, text, text, text, text, timestamptz, text[])',
    'public.google_connection_refresh_covers(uuid, text, text[])',
    'public.google_unlink_youtube(uuid, bigint)',
    'public.google_unlink_gbp_location(uuid, uuid)',
    'public.google_mark_revoked(uuid)'] loop
    foreach v_role in array array['authenticated', 'anon'] loop
      assert not has_function_privilege(v_role, v_fn, 'EXECUTE'), format('%s cannot execute %s', v_role, v_fn);
    end loop;
    assert has_function_privilege('service_role', v_fn, 'EXECUTE'), format('service_role executes %s', v_fn);
    assert (select prosecdef from pg_proc where oid = v_fn::regprocedure), format('%s is SECURITY DEFINER', v_fn);
    assert (select proconfig from pg_proc where oid = v_fn::regprocedure) @> array['search_path=public, pg_temp'],
      format('%s pins search_path', v_fn);
  end loop;
  -- the internal helper is callable by nobody but its owner
  foreach v_role in array array['authenticated', 'anon', 'service_role'] loop
    assert not has_function_privilege(v_role, 'public._google_revoke_if_unused(text)', 'EXECUTE'),
      format('%s cannot execute _google_revoke_if_unused', v_role);
  end loop;
  raise notice 'PASS google_rpcs.grants';
end $$;
rollback;
