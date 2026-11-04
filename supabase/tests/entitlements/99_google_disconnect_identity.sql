\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Suite for google_disconnect_identity (20261116000001_google_disconnect_identity.sql), the
-- "Desconectar conta" of Configurações > Contas conectadas. Spec:
-- docs/superpowers/specs/2026-11-04-google-account-disconnect-design.md, sections 3 and 7
-- (cases 1-12 below, in the spec's order).
--
-- The RPC runs as service_role (the only role granted EXECUTE); seeding runs as postgres.
-- The parity helper is not called: these blocks never act as anon/authenticated, and the
-- Google tables' REVOKEs must stay intact.

-- =====================================================================
-- Shared seed: workspaces A and B, clients A1 + A2 + A3 in A, client B1 in B.
-- youtube_channels.client_id is globally unique, so every channel needs its own client.
-- =====================================================================
create or replace function pg_temp.gd_seed() returns jsonb language plpgsql as $$
declare
  v_ws_a uuid; v_ws_b uuid;
  v_a uuid := gen_random_uuid(); v_b uuid := gen_random_uuid();
  v_cli_a1 bigint; v_cli_a2 bigint; v_cli_a3 bigint; v_cli_b1 bigint;
begin
  v_ws_a := et_make_workspace('pro');
  v_ws_b := et_make_workspace('pro');
  insert into auth.users (id) values (v_a), (v_b);
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_a, v_ws_a, 'Cliente A1', 'A1', '#000') returning id into v_cli_a1;
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_a, v_ws_a, 'Cliente A2', 'A2', '#000') returning id into v_cli_a2;
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_a, v_ws_a, 'Cliente A3', 'A3', '#000') returning id into v_cli_a3;
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_b, v_ws_b, 'Cliente B1', 'B1', '#000') returning id into v_cli_b1;
  return jsonb_build_object('ws_a', v_ws_a, 'ws_b', v_ws_b, 'user_a', v_a, 'user_b', v_b,
    'cli_a1', v_cli_a1, 'cli_a2', v_cli_a2, 'cli_a3', v_cli_a3, 'cli_b1', v_cli_b1);
end $$;

create or replace function pg_temp.gd_scopes() returns text[] language sql as $$
  select array['https://www.googleapis.com/auth/business.manage',
               'https://www.googleapis.com/auth/youtube.upload',
               'https://www.googleapis.com/auth/youtube.readonly',
               'https://www.googleapis.com/auth/yt-analytics.readonly']
$$;

-- Connection through the RPC, as service_role. Fresh (authorized_at = now()) until backdated.
create or replace function pg_temp.gd_upsert(p_ws uuid, p_sub text) returns uuid language plpgsql as $$
declare v_id uuid;
begin
  perform set_config('role', 'service_role', true);
  v_id := google_connection_upsert(p_ws, p_sub, p_sub || '@example.com', 'Nome', 'A1', 'R-' || p_sub,
                                   now() + interval '1 hour', pg_temp.gd_scopes());
  perform set_config('role', 'postgres', true);
  return v_id;
end $$;

-- Ends the fresh-connection grace: the connection was authorized two hours ago.
create or replace function pg_temp.gd_backdate(p_conn uuid) returns void language sql as $$
  update google_connections set authorized_at = now() - interval '2 hours' where id = p_conn;
$$;

create or replace function pg_temp.gd_channel(p_ws uuid, p_cli bigint, p_conn uuid, p_channel text)
returns uuid language plpgsql as $$
declare v_id uuid;
begin
  insert into youtube_channels (conta_id, client_id, connection_id, channel_id, title, handle)
    values (p_ws, p_cli, p_conn, p_channel, 'Canal ' || p_channel, '@' || p_channel)
    returning id into v_id;
  return v_id;
end $$;

-- Active unit; p_status 'revoked' / 'disconnected' backdates disconnected_at by p_days.
create or replace function pg_temp.gd_location(p_ws uuid, p_cli bigint, p_conn uuid, p_loc text,
                                               p_status text default 'active', p_days int default 3)
returns uuid language plpgsql as $$
declare v_id uuid;
begin
  insert into gbp_locations (conta_id, client_id, connection_id, account_name, location_name)
    values (p_ws, p_cli, p_conn, 'accounts/1', p_loc) returning id into v_id;
  if p_status <> 'active' then
    update gbp_locations
       set status = p_status, disconnected_at = now() - make_interval(days => p_days)
     where id = v_id;
  end if;
  return v_id;
end $$;

-- One row in each of the five YouTube history tables for (workspace, channel).
create or replace function pg_temp.gd_yt_hist(p_ws uuid, p_ch text) returns void language plpgsql as $$
begin
  insert into youtube_channel_daily (conta_id, channel_id, day, content_type, views)
    values (p_ws, p_ch, '2026-10-01', 'all', 10);
  insert into youtube_traffic_daily (conta_id, channel_id, day, source_type, views)
    values (p_ws, p_ch, '2026-10-01', 'YT_SEARCH', 3);
  insert into youtube_demographics (conta_id, channel_id, window_end, age_group, gender, viewer_pct)
    values (p_ws, p_ch, '2026-10-01', 'age18-24', 'female', 12.5);
  insert into youtube_videos (conta_id, channel_id, video_id, title)
    values (p_ws, p_ch, 'v-1', 'Vídeo');
  insert into youtube_video_daily (conta_id, channel_id, video_id, day, views)
    values (p_ws, p_ch, 'v-1', '2026-10-01', 5);
end $$;

create or replace function pg_temp.gd_yt_count(p_ws uuid, p_ch text) returns bigint language sql as $$
  select (select count(*) from youtube_channel_daily where conta_id = p_ws and channel_id = p_ch)
       + (select count(*) from youtube_traffic_daily where conta_id = p_ws and channel_id = p_ch)
       + (select count(*) from youtube_demographics where conta_id = p_ws and channel_id = p_ch)
       + (select count(*) from youtube_videos where conta_id = p_ws and channel_id = p_ch)
       + (select count(*) from youtube_video_daily where conta_id = p_ws and channel_id = p_ch);
$$;

-- One row in each of the four GMN history tables for (workspace, location).
create or replace function pg_temp.gd_gbp_hist(p_ws uuid, p_loc text) returns void language plpgsql as $$
begin
  insert into gbp_metrics_daily (conta_id, location_name, day, call_clicks)
    values (p_ws, p_loc, '2026-10-01', 2);
  insert into gbp_search_keywords_monthly (conta_id, location_name, month, keyword, value)
    values (p_ws, p_loc, '2026-10-01', 'dentista', 15);
  insert into gbp_reviews (conta_id, location_name, review_id, reviewer_name, star_rating)
    values (p_ws, p_loc, 'r1', 'Ana', 5);
  insert into gbp_rating_daily (conta_id, location_name, day, average_rating, total_review_count)
    values (p_ws, p_loc, '2026-10-01', 4.5, 10);
end $$;

create or replace function pg_temp.gd_gbp_count(p_ws uuid, p_loc text) returns bigint language sql as $$
  select (select count(*) from gbp_metrics_daily where conta_id = p_ws and location_name = p_loc)
       + (select count(*) from gbp_search_keywords_monthly where conta_id = p_ws and location_name = p_loc)
       + (select count(*) from gbp_reviews where conta_id = p_ws and location_name = p_loc)
       + (select count(*) from gbp_rating_daily where conta_id = p_ws and location_name = p_loc);
$$;

create or replace function pg_temp.gd_report(p_ws uuid, p_cli bigint, p_snapshot jsonb, p_pdf text)
returns uuid language plpgsql as $$
declare v_id uuid;
begin
  insert into report_documents (conta_id, client_id, period_start, period_end, layout, data_snapshot,
                                pdf_storage_path, pdf_generated_at)
    values (p_ws, p_cli, '2026-09-01', '2026-09-30', jsonb_build_object('version', 1, 'blocks', '[]'::jsonb),
            p_snapshot, p_pdf, case when p_pdf is null then null else now() - interval '1 day' end)
    returning id into v_id;
  return v_id;
end $$;

create or replace function pg_temp.gd_state(p_ws uuid, p_user uuid, p_provider text) returns uuid
language plpgsql as $$
declare v_id uuid;
begin
  insert into oauth_states (nonce, client_id, conta_id, initiated_by, expires_at, provider)
    values (gen_random_uuid()::text, 1, p_ws::text, p_user, now() + interval '10 minutes', p_provider)
    returning id into v_id;
  return v_id;
end $$;

-- ---------- RPC wrappers (service_role) ----------
create or replace function pg_temp.gd_disconnect(p_ws uuid, p_conn uuid)
returns table(should_revoke boolean, revocation_id uuid, yt int, gbp int) language plpgsql as $$
begin
  perform set_config('role', 'service_role', true);
  return query select d.should_revoke, d.revocation_id, d.youtube_channels_unlinked, d.gbp_locations_unlinked
                 from google_disconnect_identity(p_ws, p_conn) d;
  perform set_config('role', 'postgres', true);
end $$;

create or replace function pg_temp.gd_mark_revoked(p_conn uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'service_role', true);
  perform google_mark_revoked(p_conn);
  perform set_config('role', 'postgres', true);
end $$;

-- =====================================================================
-- 1. foreign_connection: B's connection called with A -> P0002, nothing changed
-- =====================================================================
begin;
do $$
declare
  s jsonb := pg_temp.gd_seed();
  v_ws_a uuid := (s->>'ws_a')::uuid; v_ws_b uuid := (s->>'ws_b')::uuid;
  v_conn_b uuid; v_unit uuid; v_state uuid;
begin
  v_conn_b := pg_temp.gd_upsert(v_ws_b, 'sub-1');
  perform pg_temp.gd_backdate(v_conn_b);
  perform pg_temp.gd_channel(v_ws_b, (s->>'cli_b1')::bigint, v_conn_b, 'UCb');
  v_unit := pg_temp.gd_location(v_ws_b, (s->>'cli_b1')::bigint, v_conn_b, 'locations/b');
  v_state := pg_temp.gd_state(v_ws_a, (s->>'user_a')::uuid, 'google');

  begin
    perform * from pg_temp.gd_disconnect(v_ws_a, v_conn_b);
    assert false, 'a foreign connection id must raise';
  exception when sqlstate 'P0002' then null;
  end;
  perform set_config('role', 'postgres', true);

  assert exists (select 1 from google_connections where id = v_conn_b), 'B''s connection kept';
  assert exists (select 1 from youtube_channels where connection_id = v_conn_b), 'B''s channel kept';
  assert (select status from gbp_locations where id = v_unit) = 'active', 'B''s unit kept active';
  assert (select count(*) from google_revocations) = 0, 'nothing queued';
  assert (select consumed_at from oauth_states where id = v_state) is null, 'A''s state not consumed';

  -- an unknown id raises the same error
  begin
    perform * from pg_temp.gd_disconnect(v_ws_a, gen_random_uuid());
    assert false, 'a missing connection id must raise';
  exception when sqlstate 'P0002' then null;
  end;
  perform set_config('role', 'postgres', true);
  raise notice 'PASS google_disconnect.1_foreign_connection';
end $$;
rollback;

-- =====================================================================
-- 2. zero_units_old: nothing linked, older than 1 h, sub unused elsewhere -> revoked, row gone
-- =====================================================================
begin;
do $$
declare
  s jsonb := pg_temp.gd_seed();
  v_ws_a uuid := (s->>'ws_a')::uuid;
  v_conn uuid; r record;
begin
  v_conn := pg_temp.gd_upsert(v_ws_a, 'sub-1');
  perform pg_temp.gd_backdate(v_conn);

  select * into r from pg_temp.gd_disconnect(v_ws_a, v_conn);
  assert r.should_revoke = true and r.revocation_id is not null, 'unused identity: revoke decided';
  assert (r.yt, r.gbp) = (0, 0), format('counts (0, 0), got (%s, %s)', r.yt, r.gbp);
  assert (select count(*) from google_revocations) = 1, 'one revocation queued';
  assert (select google_sub from google_revocations where id = r.revocation_id) = 'sub-1', 'for sub-1';
  assert (select token_kind from google_revocations where id = r.revocation_id) = 'refresh', 'the refresh token';
  assert not exists (select 1 from google_connections where id = v_conn), 'connection row gone';
  raise notice 'PASS google_disconnect.2_zero_units_old';
end $$;
rollback;

-- =====================================================================
-- 3. zero_units_fresh: authorized_at = now() -> still revoked (own grace ended)
-- =====================================================================
begin;
do $$
declare
  s jsonb := pg_temp.gd_seed();
  v_ws_a uuid := (s->>'ws_a')::uuid;
  v_conn uuid; r record;
begin
  v_conn := pg_temp.gd_upsert(v_ws_a, 'sub-1');
  assert (select authorized_at > now() - interval '1 minute' from google_connections where id = v_conn),
    'precondition: the connection is fresh';

  select * into r from pg_temp.gd_disconnect(v_ws_a, v_conn);
  assert r.should_revoke = true and r.revocation_id is not null, 'own fresh row does not keep the sub in use';
  assert (select count(*) from google_revocations) = 1, 'one revocation queued';
  assert not exists (select 1 from google_connections where id = v_conn), 'connection row gone';
  raise notice 'PASS google_disconnect.3_zero_units_fresh';
end $$;
rollback;

-- =====================================================================
-- 4. channels_and_units: 2 channels + 3 units (active, revoked, disconnected) -> all unlinked
-- =====================================================================
begin;
do $$
declare
  s jsonb := pg_temp.gd_seed();
  v_ws_a uuid := (s->>'ws_a')::uuid;
  v_cli_a1 bigint := (s->>'cli_a1')::bigint; v_cli_a2 bigint := (s->>'cli_a2')::bigint;
  v_cli_a3 bigint := (s->>'cli_a3')::bigint;
  v_conn uuid; v_u_active uuid; v_u_revoked uuid; v_u_disc uuid; v_rep uuid;
  v_rev_at timestamptz; v_disc_at timestamptz; r record;
begin
  v_conn := pg_temp.gd_upsert(v_ws_a, 'sub-1');
  perform pg_temp.gd_backdate(v_conn);
  perform pg_temp.gd_channel(v_ws_a, v_cli_a1, v_conn, 'UC1');
  perform pg_temp.gd_channel(v_ws_a, v_cli_a2, v_conn, 'UC2');
  perform pg_temp.gd_yt_hist(v_ws_a, 'UC1');
  perform pg_temp.gd_yt_hist(v_ws_a, 'UC2');
  v_rep := pg_temp.gd_report(v_ws_a, v_cli_a1, '{"youtube": {"views": 1}, "instagram": {"reach": 2}}'::jsonb,
                             'reports/a1/yt.pdf');
  v_u_active := pg_temp.gd_location(v_ws_a, v_cli_a1, v_conn, 'locations/active');
  v_u_revoked := pg_temp.gd_location(v_ws_a, v_cli_a2, v_conn, 'locations/revoked', 'revoked', 3);
  v_u_disc := pg_temp.gd_location(v_ws_a, v_cli_a3, v_conn, 'locations/disc', 'disconnected', 5);
  perform pg_temp.gd_gbp_hist(v_ws_a, 'locations/active');
  v_rev_at := (select disconnected_at from gbp_locations where id = v_u_revoked);
  v_disc_at := (select disconnected_at from gbp_locations where id = v_u_disc);

  select * into r from pg_temp.gd_disconnect(v_ws_a, v_conn);
  assert (r.yt, r.gbp) = (2, 2), format('counts (2, 2), got (%s, %s)', r.yt, r.gbp);
  assert r.should_revoke = true and r.revocation_id is not null, 'sub unused elsewhere: revoked';
  assert (select count(*) from google_revocations) = 1, 'one revocation queued';

  assert not exists (select 1 from youtube_channels where conta_id = v_ws_a), 'both channels deleted';
  assert pg_temp.gd_yt_count(v_ws_a, 'UC1') = 0 and pg_temp.gd_yt_count(v_ws_a, 'UC2') = 0,
    'YouTube history purged';
  assert (select count(*) from audit_log
           where conta_id = v_ws_a and action = 'youtube-data-purged') = 2, 'one purge audit row per channel';
  assert not ((select data_snapshot from report_documents where id = v_rep) ? 'youtube'), 'snapshot stripped';
  assert (select pdf_storage_path from report_documents where id = v_rep) is null, 'PDF path cleared';
  assert (select count(*) from youtube_pdf_purges
           where conta_id = v_ws_a and storage_path = 'reports/a1/yt.pdf') = 1, 'PDF queued';

  assert (select status from gbp_locations where id = v_u_active) = 'disconnected', 'active unit disconnected';
  assert (select disconnected_at is not null from gbp_locations where id = v_u_active), 'with a disconnect date';
  assert (select status from gbp_locations where id = v_u_revoked) = 'disconnected', 'revoked unit disconnected';
  assert (select disconnected_at from gbp_locations where id = v_u_revoked) = v_rev_at,
    'the revoked unit keeps its revoke date';
  assert (select status from gbp_locations where id = v_u_disc) = 'disconnected', 'disconnected unit unchanged';
  assert (select disconnected_at from gbp_locations where id = v_u_disc) = v_disc_at, 'and its date unchanged';
  assert (select count(*) from gbp_locations where conta_id = v_ws_a and connection_id is null) = 3,
    'all three units lost connection_id';
  assert pg_temp.gd_gbp_count(v_ws_a, 'locations/active') = 4, 'GMN history kept for the 30-day expiry';
  assert not exists (select 1 from google_connections where id = v_conn), 'connection row gone';
  raise notice 'PASS google_disconnect.4_channels_and_units';
end $$;
rollback;

-- =====================================================================
-- 5. in_use_elsewhere: same sub in B with a linked unit -> A unlinked, A's row gone, no revoke
-- =====================================================================
begin;
do $$
declare
  s jsonb := pg_temp.gd_seed();
  v_ws_a uuid := (s->>'ws_a')::uuid; v_ws_b uuid := (s->>'ws_b')::uuid;
  v_conn_a uuid; v_conn_b uuid; v_u_a uuid; v_u_b uuid; v_b_updated timestamptz; r record;
begin
  v_conn_a := pg_temp.gd_upsert(v_ws_a, 'sub-1');
  v_conn_b := pg_temp.gd_upsert(v_ws_b, 'sub-1');
  perform pg_temp.gd_backdate(v_conn_a);
  perform pg_temp.gd_backdate(v_conn_b);
  perform pg_temp.gd_channel(v_ws_a, (s->>'cli_a1')::bigint, v_conn_a, 'UC1');
  perform pg_temp.gd_yt_hist(v_ws_a, 'UC1');
  v_u_a := pg_temp.gd_location(v_ws_a, (s->>'cli_a2')::bigint, v_conn_a, 'locations/a');
  v_u_b := pg_temp.gd_location(v_ws_b, (s->>'cli_b1')::bigint, v_conn_b, 'locations/b');
  v_b_updated := (select updated_at from google_connections where id = v_conn_b);

  select * into r from pg_temp.gd_disconnect(v_ws_a, v_conn_a);
  assert r.should_revoke = false and r.revocation_id is null, 'in use in B: not revoked';
  assert (r.yt, r.gbp) = (1, 1), format('counts (1, 1), got (%s, %s)', r.yt, r.gbp);
  assert (select count(*) from google_revocations) = 0, 'no revocation queued';
  assert not exists (select 1 from google_connections where id = v_conn_a), 'A''s row gone';
  assert not exists (select 1 from youtube_channels where conta_id = v_ws_a), 'A''s channel deleted';
  assert pg_temp.gd_yt_count(v_ws_a, 'UC1') = 0, 'A''s YouTube history purged';
  assert (select status from gbp_locations where id = v_u_a) = 'disconnected', 'A''s unit disconnected';
  assert (select connection_id from gbp_locations where id = v_u_a) is null, 'A''s unit lost connection_id';

  assert exists (select 1 from google_connections where id = v_conn_b), 'B''s row kept';
  assert (select updated_at from google_connections where id = v_conn_b) = v_b_updated, 'B''s row untouched';
  assert (select authorized_at < now() - interval '1 hour' from google_connections where id = v_conn_b),
    'B''s authorized_at untouched';
  assert (select (status, connection_id) from gbp_locations where id = v_u_b) = ('active'::text, v_conn_b),
    'B''s unit untouched';
  raise notice 'PASS google_disconnect.5_in_use_elsewhere';
end $$;
rollback;

-- =====================================================================
-- 6. fresh_elsewhere: same sub in B with a fresh idle row -> not revoked, A's row gone, B's kept
-- =====================================================================
begin;
do $$
declare
  s jsonb := pg_temp.gd_seed();
  v_ws_a uuid := (s->>'ws_a')::uuid; v_ws_b uuid := (s->>'ws_b')::uuid;
  v_conn_a uuid; v_conn_b uuid; r record;
begin
  v_conn_a := pg_temp.gd_upsert(v_ws_a, 'sub-1');
  perform pg_temp.gd_backdate(v_conn_a);
  v_conn_b := pg_temp.gd_upsert(v_ws_b, 'sub-1'); -- fresh, nothing linked

  select * into r from pg_temp.gd_disconnect(v_ws_a, v_conn_a);
  assert r.should_revoke = false and r.revocation_id is null, 'B''s fresh row keeps the sub in use';
  assert (select count(*) from google_revocations) = 0, 'no revocation queued';
  assert not exists (select 1 from google_connections where id = v_conn_a), 'A''s row gone';
  assert exists (select 1 from google_connections where id = v_conn_b), 'B''s row kept';
  assert (select authorized_at > now() - interval '1 hour' from google_connections where id = v_conn_b),
    'B''s grace untouched';
  raise notice 'PASS google_disconnect.6_fresh_elsewhere';
end $$;
rollback;

-- =====================================================================
-- 7. idle_elsewhere: same sub in B with an idle row older than 1 h -> revoked, both rows gone
-- =====================================================================
begin;
do $$
declare
  s jsonb := pg_temp.gd_seed();
  v_ws_a uuid := (s->>'ws_a')::uuid; v_ws_b uuid := (s->>'ws_b')::uuid;
  v_conn_a uuid; v_conn_b uuid; r record;
begin
  v_conn_a := pg_temp.gd_upsert(v_ws_a, 'sub-1');
  v_conn_b := pg_temp.gd_upsert(v_ws_b, 'sub-1');
  perform pg_temp.gd_backdate(v_conn_b);

  select * into r from pg_temp.gd_disconnect(v_ws_a, v_conn_a);
  assert r.should_revoke = true and r.revocation_id is not null, 'idle everywhere: revoked';
  assert (select count(*) from google_revocations) = 1, 'one revocation queued';
  assert not exists (select 1 from google_connections where google_sub = 'sub-1'), 'both rows gone';
  raise notice 'PASS google_disconnect.7_idle_elsewhere';
end $$;
rollback;

-- =====================================================================
-- 8. revoked_connection: status 'revoked' with a revoked channel and unit -> handled as 4
-- =====================================================================
begin;
do $$
declare
  s jsonb := pg_temp.gd_seed();
  v_ws_a uuid := (s->>'ws_a')::uuid;
  v_conn uuid; v_unit uuid; v_rev_at timestamptz; r record;
begin
  v_conn := pg_temp.gd_upsert(v_ws_a, 'sub-1');
  perform pg_temp.gd_backdate(v_conn);
  perform pg_temp.gd_channel(v_ws_a, (s->>'cli_a1')::bigint, v_conn, 'UC1');
  perform pg_temp.gd_yt_hist(v_ws_a, 'UC1');
  v_unit := pg_temp.gd_location(v_ws_a, (s->>'cli_a2')::bigint, v_conn, 'locations/a');
  perform pg_temp.gd_mark_revoked(v_conn);
  assert (select status from google_connections where id = v_conn) = 'revoked', 'precondition: connection revoked';
  assert (select authorization_status from youtube_channels where connection_id = v_conn) = 'revoked',
    'precondition: channel revoked';
  assert (select status from gbp_locations where id = v_unit) = 'revoked', 'precondition: unit revoked';
  v_rev_at := (select disconnected_at from gbp_locations where id = v_unit);

  select * into r from pg_temp.gd_disconnect(v_ws_a, v_conn);
  assert (r.yt, r.gbp) = (1, 1), format('counts (1, 1), got (%s, %s)', r.yt, r.gbp);
  assert r.should_revoke = true and r.revocation_id is not null, 'revoke queued for the dead token';
  assert (select count(*) from google_revocations) = 1, 'one revocation queued';
  assert not exists (select 1 from youtube_channels where conta_id = v_ws_a), 'revoked channel deleted';
  assert pg_temp.gd_yt_count(v_ws_a, 'UC1') = 0, 'no YouTube history left';
  assert (select status from gbp_locations where id = v_unit) = 'disconnected', 'revoked unit disconnected';
  assert (select disconnected_at from gbp_locations where id = v_unit) = v_rev_at, 'revoke date kept';
  assert (select connection_id from gbp_locations where id = v_unit) is null, 'unit lost connection_id';
  assert not exists (select 1 from google_connections where id = v_conn), 'connection row gone';
  raise notice 'PASS google_disconnect.8_revoked_connection';
end $$;
rollback;

-- =====================================================================
-- 9. second_call: after a successful disconnect -> P0002
-- =====================================================================
begin;
do $$
declare
  s jsonb := pg_temp.gd_seed();
  v_ws_a uuid := (s->>'ws_a')::uuid;
  v_conn uuid;
begin
  v_conn := pg_temp.gd_upsert(v_ws_a, 'sub-1');
  perform * from pg_temp.gd_disconnect(v_ws_a, v_conn);
  begin
    perform * from pg_temp.gd_disconnect(v_ws_a, v_conn);
    assert false, 'the row is gone: should raise';
  exception when sqlstate 'P0002' then null;
  end;
  perform set_config('role', 'postgres', true);
  assert (select count(*) from google_revocations) = 1, 'still exactly one revocation';
  raise notice 'PASS google_disconnect.9_second_call';
end $$;
rollback;

-- =====================================================================
-- 10. grants: EXECUTE for service_role only; definer with a pinned search_path
-- =====================================================================
begin;
do $$
declare
  v_fn text := 'public.google_disconnect_identity(uuid, uuid)';
  v_role text;
begin
  foreach v_role in array array['authenticated', 'anon'] loop
    assert not has_function_privilege(v_role, v_fn, 'EXECUTE'), format('%s cannot execute %s', v_role, v_fn);
  end loop;
  assert has_function_privilege('service_role', v_fn, 'EXECUTE'), format('service_role executes %s', v_fn);
  assert (select prosecdef from pg_proc where oid = v_fn::regprocedure), format('%s is SECURITY DEFINER', v_fn);
  assert (select proconfig from pg_proc where oid = v_fn::regprocedure) @> array['search_path=public, pg_temp'],
    format('%s pins search_path', v_fn);
  raise notice 'PASS google_disconnect.10_grants';
end $$;
rollback;

-- =====================================================================
-- 11. outstanding_states: A's unconsumed Google states are consumed; B's and A's TikTok are not
-- =====================================================================
begin;
do $$
declare
  s jsonb := pg_temp.gd_seed();
  v_ws_a uuid := (s->>'ws_a')::uuid; v_ws_b uuid := (s->>'ws_b')::uuid;
  v_conn uuid; v_a_google uuid; v_a_google2 uuid; v_b_google uuid; v_a_tiktok uuid;
  v_old timestamptz := now() - interval '1 minute';
begin
  v_conn := pg_temp.gd_upsert(v_ws_a, 'sub-1');
  v_a_google := pg_temp.gd_state(v_ws_a, (s->>'user_a')::uuid, 'google');
  v_a_google2 := pg_temp.gd_state(v_ws_a, (s->>'user_a')::uuid, 'google');
  update oauth_states set consumed_at = v_old where id = v_a_google2; -- already consumed
  v_b_google := pg_temp.gd_state(v_ws_b, (s->>'user_b')::uuid, 'google');
  v_a_tiktok := pg_temp.gd_state(v_ws_a, (s->>'user_a')::uuid, 'tiktok');

  perform * from pg_temp.gd_disconnect(v_ws_a, v_conn);
  assert (select consumed_at from oauth_states where id = v_a_google) is not null, 'A''s Google state consumed';
  assert (select consumed_at from oauth_states where id = v_a_google2) = v_old, 'an already consumed state is kept';
  assert (select consumed_at from oauth_states where id = v_b_google) is null, 'B''s Google state untouched';
  assert (select consumed_at from oauth_states where id = v_a_tiktok) is null, 'A''s TikTok state untouched';
  raise notice 'PASS google_disconnect.11_outstanding_states';
end $$;
rollback;

-- =====================================================================
-- 12. unit_relink_fails: A's disconnected unit lost connection_id, and pointing it back at the
--     deleted connection fails on the FK (23503). The two-session interleaving is not testable in
--     one psql script; the Deno 409 test covers the route mapping.
-- =====================================================================
begin;
do $$
declare
  s jsonb := pg_temp.gd_seed();
  v_ws_a uuid := (s->>'ws_a')::uuid;
  v_conn uuid; v_unit uuid;
begin
  v_conn := pg_temp.gd_upsert(v_ws_a, 'sub-1');
  v_unit := pg_temp.gd_location(v_ws_a, (s->>'cli_a1')::bigint, v_conn, 'locations/a', 'disconnected', 2);

  perform * from pg_temp.gd_disconnect(v_ws_a, v_conn);
  assert (select connection_id from gbp_locations where id = v_unit) is null, 'the unit lost connection_id';
  assert not exists (select 1 from google_connections where id = v_conn), 'connection row gone';

  -- disconnected_at = NULL too, so the status CHECK passes and the FK is what fails.
  begin
    update gbp_locations
       set status = 'active', disconnected_at = null, connection_id = v_conn
     where id = v_unit;
    assert false, 'relinking to the deleted connection must fail';
  exception when sqlstate '23503' then null;
  end;
  assert (select status from gbp_locations where id = v_unit) = 'disconnected', 'unit still disconnected';
  raise notice 'PASS google_disconnect.12_unit_relink_fails';
end $$;
rollback;
