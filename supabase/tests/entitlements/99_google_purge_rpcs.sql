\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Suite for the purge, 30-day expiry and orphan-release RPCs (20261112000012_google_purge_rpcs.sql):
-- youtube_purge_channel (history + report snapshot + PDF queue + audit row), the re-created
-- google_unlink_youtube and google_mark_revoked (both now purge), google_expire_units (30 days
-- after a GMN disconnect/revoke or a YouTube revoke), google_orphan_subs and google_release_sub.
-- Spec: docs/superpowers/specs/2026-10-29-youtube-google-meu-negocio-design.md (sections 4.2,
-- 4.6, 5.2 step 5); Phase 2 plan task 3, rulings P2, P3, P4.
--
-- RPCs run as service_role (the only role granted EXECUTE); seeding runs as postgres.
-- The parity helper is not called: these blocks never act as anon/authenticated, and the
-- Google tables' REVOKEs must stay intact.

-- =====================================================================
-- Shared seed: workspaces A and B, clients A1 + A2 + A3 in A, client B1 in B.
-- youtube_channels.client_id is globally unique, so every channel needs its own client.
-- =====================================================================
create or replace function pg_temp.gp_seed() returns jsonb language plpgsql as $$
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
  return jsonb_build_object('ws_a', v_ws_a, 'ws_b', v_ws_b,
    'cli_a1', v_cli_a1, 'cli_a2', v_cli_a2, 'cli_a3', v_cli_a3, 'cli_b1', v_cli_b1);
end $$;

create or replace function pg_temp.gp_yt() returns text[] language sql as $$
  select array['https://www.googleapis.com/auth/youtube.upload',
               'https://www.googleapis.com/auth/youtube.readonly',
               'https://www.googleapis.com/auth/yt-analytics.readonly']
$$;
create or replace function pg_temp.gp_gbp() returns text[] language sql as $$
  select array['https://www.googleapis.com/auth/business.manage']
$$;

-- Connection through the RPC, as service_role.
create or replace function pg_temp.gp_upsert(p_ws uuid, p_sub text, p_refresh text, p_scopes text[])
returns uuid language plpgsql as $$
declare v_id uuid;
begin
  perform set_config('role', 'service_role', true);
  v_id := google_connection_upsert(p_ws, p_sub, p_sub || '@example.com', 'Nome', 'A1', p_refresh,
                                   now() + interval '1 hour', p_scopes);
  perform set_config('role', 'postgres', true);
  return v_id;
end $$;

-- Ends the fresh-connection grace (R10): the connection was authorized two hours ago.
create or replace function pg_temp.gp_backdate(p_conn uuid) returns void language sql as $$
  update google_connections set authorized_at = now() - interval '2 hours' where id = p_conn;
$$;

-- Channel with cached stats, avatar and every watermark set, so the P3 null checks are not vacuous.
create or replace function pg_temp.gp_channel(p_ws uuid, p_cli bigint, p_conn uuid, p_channel text)
returns uuid language plpgsql as $$
declare v_id uuid;
begin
  insert into youtube_channels (conta_id, client_id, connection_id, channel_id, title, handle, avatar_url,
                                uploads_playlist_id, subscriber_count, view_count, video_count,
                                shorts_count, long_count, last_synced_at, data_through,
                                content_type_through, traffic_through, videos_through)
    values (p_ws, p_cli, p_conn, p_channel, 'Canal ' || p_channel, '@' || p_channel,
            'https://yt3.example/avatar.jpg', 'UU' || p_channel, 1000, 50000, 40, 25, 15,
            now() - interval '1 hour', '2026-10-28', '2026-10-27', '2026-10-27', '2026-10-28')
    returning id into v_id;
  return v_id;
end $$;

create or replace function pg_temp.gp_location(p_ws uuid, p_cli bigint, p_conn uuid, p_loc text)
returns uuid language plpgsql as $$
declare v_id uuid;
begin
  insert into gbp_locations (conta_id, client_id, connection_id, account_name, location_name)
    values (p_ws, p_cli, p_conn, 'accounts/1', p_loc) returning id into v_id;
  return v_id;
end $$;

-- One row in each of the five YouTube history tables for (workspace, channel).
create or replace function pg_temp.gp_yt_hist(p_ws uuid, p_ch text, p_day date default '2026-10-01')
returns void language plpgsql as $$
begin
  insert into youtube_channel_daily (conta_id, channel_id, day, content_type, views)
    values (p_ws, p_ch, p_day, 'all', 10);
  insert into youtube_traffic_daily (conta_id, channel_id, day, source_type, views)
    values (p_ws, p_ch, p_day, 'YT_SEARCH', 3);
  insert into youtube_demographics (conta_id, channel_id, window_end, age_group, gender, viewer_pct)
    values (p_ws, p_ch, p_day, 'age18-24', 'female', 12.5);
  insert into youtube_videos (conta_id, channel_id, video_id, title)
    values (p_ws, p_ch, 'v-' || p_day, 'Vídeo');
  insert into youtube_video_daily (conta_id, channel_id, video_id, day, views)
    values (p_ws, p_ch, 'v-' || p_day, p_day, 5);
end $$;

create or replace function pg_temp.gp_yt_count(p_ws uuid, p_ch text) returns bigint language sql as $$
  select (select count(*) from youtube_channel_daily where conta_id = p_ws and channel_id = p_ch)
       + (select count(*) from youtube_traffic_daily where conta_id = p_ws and channel_id = p_ch)
       + (select count(*) from youtube_demographics where conta_id = p_ws and channel_id = p_ch)
       + (select count(*) from youtube_videos where conta_id = p_ws and channel_id = p_ch)
       + (select count(*) from youtube_video_daily where conta_id = p_ws and channel_id = p_ch);
$$;

-- One row in each of the four GMN history tables for (workspace, location).
create or replace function pg_temp.gp_gbp_hist(p_ws uuid, p_loc text) returns void language plpgsql as $$
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

create or replace function pg_temp.gp_gbp_count(p_ws uuid, p_loc text) returns bigint language sql as $$
  select (select count(*) from gbp_metrics_daily where conta_id = p_ws and location_name = p_loc)
       + (select count(*) from gbp_search_keywords_monthly where conta_id = p_ws and location_name = p_loc)
       + (select count(*) from gbp_reviews where conta_id = p_ws and location_name = p_loc)
       + (select count(*) from gbp_rating_daily where conta_id = p_ws and location_name = p_loc);
$$;

create or replace function pg_temp.gp_report(p_ws uuid, p_cli bigint, p_snapshot jsonb, p_pdf text)
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

create or replace function pg_temp.gp_audit_count(p_ws uuid) returns bigint language sql as $$
  select count(*) from audit_log
   where conta_id = p_ws and action = 'youtube-data-purged' and resource_type = 'youtube_channel';
$$;

-- Whether this backend holds pg_advisory_xact_lock(hashtext('google-sub:' || p_sub)).
create or replace function pg_temp.gp_holds_sub_lock(p_sub text) returns boolean language sql as $$
  select exists (
    select 1 from pg_locks
     where locktype = 'advisory' and pid = pg_backend_pid() and granted and objsubid = 1
       and ((classid::bigint << 32) | objid::bigint) = hashtext('google-sub:' || p_sub)::bigint);
$$;

-- ---------- RPC wrappers (service_role) ----------
create or replace function pg_temp.gp_purge(p_ws uuid, p_ch text, p_cli bigint) returns int
language plpgsql as $$
declare v int;
begin
  perform set_config('role', 'service_role', true);
  v := youtube_purge_channel(p_ws, p_ch, p_cli);
  perform set_config('role', 'postgres', true);
  return v;
end $$;

create or replace function pg_temp.gp_unlink_yt(p_ws uuid, p_cli bigint)
returns table(should_revoke boolean, revocation_id uuid) language plpgsql as $$
begin
  perform set_config('role', 'service_role', true);
  return query select u.should_revoke, u.revocation_id from google_unlink_youtube(p_ws, p_cli) u;
  perform set_config('role', 'postgres', true);
end $$;

create or replace function pg_temp.gp_mark_revoked(p_conn uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'service_role', true);
  perform google_mark_revoked(p_conn);
  perform set_config('role', 'postgres', true);
end $$;

create or replace function pg_temp.gp_expire() returns table(g int, y int, oy int, og int) language plpgsql as $$
begin
  perform set_config('role', 'service_role', true);
  return query select e.gbp_locations_deleted, e.youtube_channels_deleted,
                      e.orphan_youtube_rows_deleted, e.orphan_gbp_rows_deleted
                 from google_expire_units() e;
  perform set_config('role', 'postgres', true);
end $$;

create or replace function pg_temp.gp_orphans(p_limit int) returns text[] language plpgsql as $$
declare v text[];
begin
  perform set_config('role', 'service_role', true);
  v := array(select s from google_orphan_subs(p_limit) s);
  perform set_config('role', 'postgres', true);
  return v;
end $$;

create or replace function pg_temp.gp_release(p_sub text)
returns table(should_revoke boolean, revocation_id uuid) language plpgsql as $$
begin
  perform set_config('role', 'service_role', true);
  return query select u.should_revoke, u.revocation_id from google_release_sub(p_sub) u;
  perform set_config('role', 'postgres', true);
end $$;

-- =====================================================================
-- purge_deletes_only_own_workspace: A and B both link UCx; purging A leaves B's rows untouched
-- =====================================================================
begin;
do $$
declare
  s jsonb := pg_temp.gp_seed();
  v_ws_a uuid := (s->>'ws_a')::uuid; v_ws_b uuid := (s->>'ws_b')::uuid;
  v_conn_a uuid; v_conn_b uuid; v_n int;
begin
  v_conn_a := pg_temp.gp_upsert(v_ws_a, 'sub-1', 'RA', pg_temp.gp_yt());
  v_conn_b := pg_temp.gp_upsert(v_ws_b, 'sub-1', 'RB', pg_temp.gp_yt());
  perform pg_temp.gp_channel(v_ws_a, (s->>'cli_a1')::bigint, v_conn_a, 'UCx');
  perform pg_temp.gp_channel(v_ws_b, (s->>'cli_b1')::bigint, v_conn_b, 'UCx');
  perform pg_temp.gp_yt_hist(v_ws_a, 'UCx');
  perform pg_temp.gp_yt_hist(v_ws_b, 'UCx');
  -- another channel in A must not be touched either
  perform pg_temp.gp_yt_hist(v_ws_a, 'UCother');

  v_n := pg_temp.gp_purge(v_ws_a, 'UCx', (s->>'cli_a1')::bigint);
  assert v_n = 0, format('no report PDFs queued, got %s', v_n);
  assert pg_temp.gp_yt_count(v_ws_a, 'UCx') = 0, 'A''s UCx history is gone from all five tables';
  assert pg_temp.gp_yt_count(v_ws_b, 'UCx') = 5, 'B''s UCx history is untouched';
  assert pg_temp.gp_yt_count(v_ws_a, 'UCother') = 5, 'A''s other channel is untouched';
  assert pg_temp.gp_audit_count(v_ws_a) = 1, 'one audit row for A';
  assert pg_temp.gp_audit_count(v_ws_b) = 0, 'no audit row for B';
  assert (select resource_id from audit_log
           where conta_id = v_ws_a and action = 'youtube-data-purged') = 'UCx', 'audit names the channel';
  assert (select (metadata->>'client_id')::bigint from audit_log
           where conta_id = v_ws_a and action = 'youtube-data-purged') = (s->>'cli_a1')::bigint,
    'audit metadata carries the client';
  assert exists (select 1 from youtube_channels where conta_id = v_ws_a and channel_id = 'UCx'),
    'the purge alone does not delete the link row';
  raise notice 'PASS google_purge.purge_deletes_only_own_workspace';
end $$;
rollback;

-- =====================================================================
-- purge_strips_snapshot_and_queues_pdf
-- =====================================================================
begin;
do $$
declare
  s jsonb := pg_temp.gp_seed();
  v_ws_a uuid := (s->>'ws_a')::uuid; v_ws_b uuid := (s->>'ws_b')::uuid;
  v_r_yt uuid; v_r_plain uuid; v_r_nopdf uuid; v_r_other uuid; v_r_b uuid;
  v_gen timestamptz; v_n int; r record;
begin
  v_r_yt := pg_temp.gp_report(v_ws_a, (s->>'cli_a1')::bigint,
    '{"youtube": {"views": 10}, "instagram": {"reach": 5}}'::jsonb, 'reports/a1/yt.pdf');
  v_r_plain := pg_temp.gp_report(v_ws_a, (s->>'cli_a1')::bigint,
    '{"instagram": {"reach": 7}}'::jsonb, 'reports/a1/plain.pdf');
  v_r_nopdf := pg_temp.gp_report(v_ws_a, (s->>'cli_a1')::bigint,
    '{"youtube": {"views": 3}}'::jsonb, null);
  v_r_other := pg_temp.gp_report(v_ws_a, (s->>'cli_a2')::bigint,
    '{"youtube": {"views": 1}}'::jsonb, 'reports/a2/yt.pdf');
  v_r_b := pg_temp.gp_report(v_ws_b, (s->>'cli_b1')::bigint,
    '{"youtube": {"views": 2}}'::jsonb, 'reports/b1/yt.pdf');
  v_gen := (select pdf_generated_at from report_documents where id = v_r_plain);

  v_n := pg_temp.gp_purge(v_ws_a, 'UCx', (s->>'cli_a1')::bigint);
  assert v_n = 1, format('one PDF path queued, got %s', v_n);

  select * into r from report_documents where id = v_r_yt;
  assert not (r.data_snapshot ? 'youtube'), 'youtube key stripped';
  assert r.data_snapshot->'instagram' = '{"reach": 5}'::jsonb, 'other snapshot keys kept';
  assert r.pdf_storage_path is null, 'PDF path cleared';
  assert r.pdf_generated_at is null, 'pdf_generated_at cleared';

  select * into r from report_documents where id = v_r_plain;
  assert r.pdf_storage_path = 'reports/a1/plain.pdf', 'a report without the key keeps its PDF';
  assert r.pdf_generated_at = v_gen, 'and its pdf_generated_at';
  assert r.data_snapshot = '{"instagram": {"reach": 7}}'::jsonb, 'and its snapshot';

  assert not ((select data_snapshot from report_documents where id = v_r_nopdf) ? 'youtube'),
    'key stripped from a report without a PDF';
  assert (select data_snapshot from report_documents where id = v_r_other) ? 'youtube',
    'another client of the same workspace keeps its key';
  assert (select pdf_storage_path from report_documents where id = v_r_other) = 'reports/a2/yt.pdf',
    'and its PDF';
  assert (select data_snapshot from report_documents where id = v_r_b) ? 'youtube',
    'workspace B keeps its key';

  assert (select count(*) from youtube_pdf_purges) = 1, 'exactly one queued purge';
  select * into r from youtube_pdf_purges;
  assert r.conta_id = v_ws_a and r.client_id = (s->>'cli_a1')::bigint, 'queued for A1';
  assert r.storage_path = 'reports/a1/yt.pdf', 'the old path';
  assert r.attempts = 0, 'fresh row';

  assert (select (metadata->>'pdfs_queued')::int from audit_log
           where conta_id = v_ws_a and action = 'youtube-data-purged') = 1, 'audit records the queued count';

  -- a second purge is harmless: nothing left to strip or queue
  assert pg_temp.gp_purge(v_ws_a, 'UCx', (s->>'cli_a1')::bigint) = 0, 'second purge queues nothing';
  assert (select count(*) from youtube_pdf_purges) = 1, 'still one queued purge';
  raise notice 'PASS google_purge.purge_strips_snapshot_and_queues_pdf';
end $$;
rollback;

-- =====================================================================
-- unlink_youtube_purges
-- =====================================================================
begin;
do $$
declare
  s jsonb := pg_temp.gp_seed();
  v_ws_a uuid := (s->>'ws_a')::uuid; v_ws_b uuid := (s->>'ws_b')::uuid;
  v_conn_a uuid; v_conn_b uuid; v_rep uuid; r record;
begin
  v_conn_a := pg_temp.gp_upsert(v_ws_a, 'sub-1', 'RA', pg_temp.gp_yt());
  v_conn_b := pg_temp.gp_upsert(v_ws_b, 'sub-2', 'RB', pg_temp.gp_yt());
  perform pg_temp.gp_channel(v_ws_a, (s->>'cli_a1')::bigint, v_conn_a, 'UCx');
  perform pg_temp.gp_channel(v_ws_b, (s->>'cli_b1')::bigint, v_conn_b, 'UCx');
  perform pg_temp.gp_yt_hist(v_ws_a, 'UCx');
  perform pg_temp.gp_yt_hist(v_ws_b, 'UCx');
  v_rep := pg_temp.gp_report(v_ws_a, (s->>'cli_a1')::bigint, '{"youtube": {"views": 1}}'::jsonb, 'p/a1.pdf');
  perform pg_temp.gp_backdate(v_conn_a);

  select * into r from pg_temp.gp_unlink_yt(v_ws_a, (s->>'cli_a1')::bigint);
  assert r.should_revoke = true and r.revocation_id is not null, 'last use of sub-1: revoke decision unchanged';
  assert not exists (select 1 from youtube_channels where client_id = (s->>'cli_a1')::bigint), 'link row deleted';
  assert pg_temp.gp_yt_count(v_ws_a, 'UCx') = 0, 'channel history purged';
  assert pg_temp.gp_yt_count(v_ws_b, 'UCx') = 5, 'B''s history of the same channel kept';
  assert not ((select data_snapshot from report_documents where id = v_rep) ? 'youtube'), 'snapshot stripped';
  assert (select count(*) from youtube_pdf_purges where conta_id = v_ws_a) = 1, 'PDF queued';
  assert pg_temp.gp_audit_count(v_ws_a) = 1, 'one audit row';

  -- unknown client still raises P0002 and purges nothing
  begin
    perform * from pg_temp.gp_unlink_yt(v_ws_a, (s->>'cli_a1')::bigint);
    assert false, 'no channel left: should raise';
  exception when sqlstate 'P0002' then null;
  end;
  perform set_config('role', 'postgres', true);
  assert pg_temp.gp_audit_count(v_ws_a) = 1, 'no audit row for a failed unlink';
  raise notice 'PASS google_purge.unlink_youtube_purges';
end $$;
rollback;

-- =====================================================================
-- mark_revoked_purges_and_resets (P3)
-- =====================================================================
begin;
do $$
declare
  s jsonb := pg_temp.gp_seed();
  v_ws uuid := (s->>'ws_a')::uuid;
  v_conn uuid; v_ch uuid; v_lock timestamptz := now() - interval '5 seconds';
  v_rev_at timestamptz; r record;
begin
  v_conn := pg_temp.gp_upsert(v_ws, 'sub-1', 'R1', pg_temp.gp_yt());
  v_ch := pg_temp.gp_channel(v_ws, (s->>'cli_a1')::bigint, v_conn, 'UC-1');
  perform pg_temp.gp_yt_hist(v_ws, 'UC-1');
  perform pg_temp.gp_report(v_ws, (s->>'cli_a1')::bigint, '{"youtube": {"views": 1}}'::jsonb, 'p/1.pdf');
  update google_connections set refresh_lock_at = v_lock where id = v_conn;

  perform pg_temp.gp_mark_revoked(v_conn);
  assert pg_temp.gp_yt_count(v_ws, 'UC-1') = 0, 'history purged';
  assert (select count(*) from youtube_pdf_purges where conta_id = v_ws) = 1, 'report PDF queued';
  select * into r from youtube_channels where id = v_ch;
  assert r.authorization_status = 'revoked' and r.revoked_at is not null, 'channel revoked';
  assert r.subscriber_count is null and r.view_count is null and r.video_count is null
     and r.shorts_count is null and r.long_count is null, 'cached stats nulled';
  assert r.avatar_url is null, 'avatar nulled';
  assert r.data_through is null and r.content_type_through is null
     and r.traffic_through is null and r.videos_through is null, 'watermarks reset';
  assert r.title = 'Canal UC-1' and r.handle = '@UC-1', 'title and handle kept for the Reconectar card';
  assert (select refresh_lock_at from google_connections where id = v_conn) = v_lock, 'lock untouched';
  assert (select status from google_connections where id = v_conn) = 'revoked', 'connection revoked';
  assert pg_temp.gp_audit_count(v_ws) = 1, 'one audit row';

  -- second call: nothing new purged (a row written after the first purge survives it)
  update youtube_channels set revoked_at = now() - interval '1 hour' where id = v_ch;
  v_rev_at := (select revoked_at from youtube_channels where id = v_ch);
  perform pg_temp.gp_yt_hist(v_ws, 'UC-1', '2026-10-02');
  perform pg_temp.gp_mark_revoked(v_conn);
  assert pg_temp.gp_yt_count(v_ws, 'UC-1') = 5, 'second call purges nothing';
  assert pg_temp.gp_audit_count(v_ws) = 1, 'second call writes no audit row';
  assert (select revoked_at from youtube_channels where id = v_ch) = v_rev_at, 'revoked_at kept';
  assert (select refresh_lock_at from google_connections where id = v_conn) = v_lock, 'lock still untouched';
  raise notice 'PASS google_purge.mark_revoked_purges_and_resets';
end $$;
rollback;

-- =====================================================================
-- expire_units_30_days
-- =====================================================================
begin;
do $$
declare
  s jsonb := pg_temp.gp_seed();
  v_ws uuid := (s->>'ws_a')::uuid;
  v_conn uuid; v_l31 uuid; v_l29 uuid; v_lrev uuid; v_lact uuid; v_c31 uuid; v_c29 uuid; r record;
begin
  v_conn := pg_temp.gp_upsert(v_ws, 'sub-1', 'R1', pg_temp.gp_yt() || pg_temp.gp_gbp());
  v_l31 := pg_temp.gp_location(v_ws, (s->>'cli_a1')::bigint, v_conn, 'locations/31');
  v_l29 := pg_temp.gp_location(v_ws, (s->>'cli_a1')::bigint, v_conn, 'locations/29');
  v_lrev := pg_temp.gp_location(v_ws, (s->>'cli_a2')::bigint, v_conn, 'locations/rev');
  v_lact := pg_temp.gp_location(v_ws, (s->>'cli_a2')::bigint, v_conn, 'locations/act');
  update gbp_locations set status = 'disconnected', disconnected_at = now() - interval '31 days' where id = v_l31;
  update gbp_locations set status = 'disconnected', disconnected_at = now() - interval '29 days' where id = v_l29;
  update gbp_locations set status = 'revoked', disconnected_at = now() - interval '31 days' where id = v_lrev;
  perform pg_temp.gp_gbp_hist(v_ws, 'locations/31');
  perform pg_temp.gp_gbp_hist(v_ws, 'locations/29');
  perform pg_temp.gp_gbp_hist(v_ws, 'locations/rev');
  perform pg_temp.gp_gbp_hist(v_ws, 'locations/act');

  v_c31 := pg_temp.gp_channel(v_ws, (s->>'cli_a1')::bigint, v_conn, 'UC-31');
  v_c29 := pg_temp.gp_channel(v_ws, (s->>'cli_a2')::bigint, v_conn, 'UC-29');
  update youtube_channels set authorization_status = 'revoked', revoked_at = now() - interval '31 days'
   where id = v_c31;
  update youtube_channels set authorization_status = 'revoked', revoked_at = now() - interval '29 days'
   where id = v_c29;
  -- rows written after the first purge (the backstop must catch them)
  perform pg_temp.gp_yt_hist(v_ws, 'UC-31');
  perform pg_temp.gp_yt_hist(v_ws, 'UC-29');
  perform pg_temp.gp_report(v_ws, (s->>'cli_a1')::bigint, '{"youtube": {"views": 1}}'::jsonb, 'p/31.pdf');

  select * into r from pg_temp.gp_expire();
  assert r.g = 2, format('two GMN units expired, got %s', r.g);
  assert r.y = 1, format('one YouTube channel expired, got %s', r.y);

  assert not exists (select 1 from gbp_locations where id = v_l31), 'disconnected 31 days ago: row deleted';
  assert pg_temp.gp_gbp_count(v_ws, 'locations/31') = 0, 'and its history in all four tables';
  assert not exists (select 1 from gbp_locations where id = v_lrev), 'revoked 31 days ago: row deleted';
  assert pg_temp.gp_gbp_count(v_ws, 'locations/rev') = 0, 'and its history';
  assert exists (select 1 from gbp_locations where id = v_l29), 'disconnected 29 days ago: kept';
  assert pg_temp.gp_gbp_count(v_ws, 'locations/29') = 4, 'with its history';
  assert exists (select 1 from gbp_locations where id = v_lact), 'active unit kept';
  assert pg_temp.gp_gbp_count(v_ws, 'locations/act') = 4, 'with its history';

  assert not exists (select 1 from youtube_channels where id = v_c31), 'revoked 31 days ago: channel deleted';
  assert pg_temp.gp_yt_count(v_ws, 'UC-31') = 0, 'with the rows written after the first purge';
  assert (select count(*) from youtube_pdf_purges where conta_id = v_ws) = 1, 'backstop queued the PDF';
  assert exists (select 1 from youtube_channels where id = v_c29), 'revoked 29 days ago: channel kept';
  assert pg_temp.gp_yt_count(v_ws, 'UC-29') = 5, 'and not purged by the expiry';

  select * into r from pg_temp.gp_expire();
  assert r.g = 0 and r.y = 0, 'a second run expires nothing';
  raise notice 'PASS google_purge.expire_units_30_days';
end $$;
rollback;

-- =====================================================================
-- expire_units_cross_workspace: B links the same location and channel and keeps everything
-- =====================================================================
begin;
do $$
declare
  s jsonb := pg_temp.gp_seed();
  v_ws_a uuid := (s->>'ws_a')::uuid; v_ws_b uuid := (s->>'ws_b')::uuid;
  v_conn_a uuid; v_conn_b uuid; v_la uuid; v_lb uuid; v_ca uuid; v_cb uuid; v_rep_b uuid; r record;
begin
  v_conn_a := pg_temp.gp_upsert(v_ws_a, 'sub-1', 'RA', pg_temp.gp_yt() || pg_temp.gp_gbp());
  v_conn_b := pg_temp.gp_upsert(v_ws_b, 'sub-1', 'RB', pg_temp.gp_yt() || pg_temp.gp_gbp());
  v_la := pg_temp.gp_location(v_ws_a, (s->>'cli_a1')::bigint, v_conn_a, 'locations/X');
  v_lb := pg_temp.gp_location(v_ws_b, (s->>'cli_b1')::bigint, v_conn_b, 'locations/X');
  v_ca := pg_temp.gp_channel(v_ws_a, (s->>'cli_a1')::bigint, v_conn_a, 'UCx');
  v_cb := pg_temp.gp_channel(v_ws_b, (s->>'cli_b1')::bigint, v_conn_b, 'UCx');
  perform pg_temp.gp_gbp_hist(v_ws_a, 'locations/X');
  perform pg_temp.gp_gbp_hist(v_ws_b, 'locations/X');
  perform pg_temp.gp_yt_hist(v_ws_a, 'UCx');
  perform pg_temp.gp_yt_hist(v_ws_b, 'UCx');
  v_rep_b := pg_temp.gp_report(v_ws_b, (s->>'cli_b1')::bigint, '{"youtube": {"views": 1}}'::jsonb, 'p/b.pdf');
  update gbp_locations set status = 'disconnected', disconnected_at = now() - interval '31 days' where id = v_la;
  update youtube_channels set authorization_status = 'revoked', revoked_at = now() - interval '31 days'
   where id = v_ca;

  select * into r from pg_temp.gp_expire();
  assert r.g = 1 and r.y = 1, format('A''s unit and channel expired, got (%s, %s)', r.g, r.y);
  assert not exists (select 1 from gbp_locations where id = v_la), 'A''s unit gone';
  assert not exists (select 1 from youtube_channels where id = v_ca), 'A''s channel gone';
  assert pg_temp.gp_gbp_count(v_ws_a, 'locations/X') = 0, 'A''s GMN history gone';
  assert pg_temp.gp_yt_count(v_ws_a, 'UCx') = 0, 'A''s YouTube history gone';

  assert (select status from gbp_locations where id = v_lb) = 'active', 'B''s unit untouched';
  assert (select authorization_status from youtube_channels where id = v_cb) = 'active', 'B''s channel untouched';
  assert (select subscriber_count from youtube_channels where id = v_cb) = 1000, 'B''s cached stats untouched';
  assert pg_temp.gp_gbp_count(v_ws_b, 'locations/X') = 4, 'B''s GMN history kept';
  assert pg_temp.gp_yt_count(v_ws_b, 'UCx') = 5, 'B''s YouTube history kept';
  assert (select data_snapshot from report_documents where id = v_rep_b) ? 'youtube', 'B''s report kept';
  assert not exists (select 1 from youtube_pdf_purges where conta_id = v_ws_b), 'nothing queued for B';
  assert pg_temp.gp_audit_count(v_ws_b) = 0, 'no audit row for B';
  raise notice 'PASS google_purge.expire_units_cross_workspace';
end $$;
rollback;

-- =====================================================================
-- mark_revoked_whole_connection: two channels purged at once, the GMN unit revoked with history
-- =====================================================================
begin;
do $$
declare
  s jsonb := pg_temp.gp_seed();
  v_ws uuid := (s->>'ws_a')::uuid;
  v_conn uuid; v_c1 uuid; v_c2 uuid; v_loc uuid;
begin
  v_conn := pg_temp.gp_upsert(v_ws, 'sub-1', 'R1', pg_temp.gp_yt() || pg_temp.gp_gbp());
  v_c1 := pg_temp.gp_channel(v_ws, (s->>'cli_a1')::bigint, v_conn, 'UC-1');
  v_c2 := pg_temp.gp_channel(v_ws, (s->>'cli_a2')::bigint, v_conn, 'UC-2');
  v_loc := pg_temp.gp_location(v_ws, (s->>'cli_a3')::bigint, v_conn, 'locations/1');
  perform pg_temp.gp_yt_hist(v_ws, 'UC-1');
  perform pg_temp.gp_yt_hist(v_ws, 'UC-2');
  perform pg_temp.gp_gbp_hist(v_ws, 'locations/1');

  perform pg_temp.gp_mark_revoked(v_conn);
  assert pg_temp.gp_yt_count(v_ws, 'UC-1') = 0, 'UC-1 purged';
  assert pg_temp.gp_yt_count(v_ws, 'UC-2') = 0, 'UC-2 purged';
  assert (select count(*) from youtube_channels
           where connection_id = v_conn and authorization_status = 'revoked'
             and data_through is null and subscriber_count is null) = 2, 'both channels revoked and reset';
  assert pg_temp.gp_audit_count(v_ws) = 2, 'one audit row per channel';
  assert (select status from gbp_locations where id = v_loc) = 'revoked', 'unit revoked';
  assert pg_temp.gp_gbp_count(v_ws, 'locations/1') = 4, 'unit history intact';
  raise notice 'PASS google_purge.mark_revoked_whole_connection';
end $$;
rollback;

-- =====================================================================
-- reconnect_within_30_days_keeps_gmn_history
-- =====================================================================
begin;
do $$
declare
  s jsonb := pg_temp.gp_seed();
  v_ws uuid := (s->>'ws_a')::uuid;
  v_conn uuid; v_loc uuid; r record;
begin
  v_conn := pg_temp.gp_upsert(v_ws, 'sub-1', 'R1', pg_temp.gp_gbp());
  v_loc := pg_temp.gp_location(v_ws, (s->>'cli_a1')::bigint, v_conn, 'locations/1');
  perform pg_temp.gp_gbp_hist(v_ws, 'locations/1');

  perform pg_temp.gp_mark_revoked(v_conn);
  select * into r from pg_temp.gp_expire();
  assert r.g = 0, 'a unit revoked just now does not expire';
  assert pg_temp.gp_upsert(v_ws, 'sub-1', 'R2', pg_temp.gp_gbp()) = v_conn, 'same connection';
  assert (select status from gbp_locations where id = v_loc) = 'active', 'unit active again';
  assert (select disconnected_at from gbp_locations where id = v_loc) is null, 'disconnected_at cleared';
  assert pg_temp.gp_gbp_count(v_ws, 'locations/1') = 4, 'history rows remain';
  raise notice 'PASS google_purge.reconnect_within_30_days_keeps_gmn_history';
end $$;
rollback;

-- =====================================================================
-- orphan_subs_respects_grace_and_units
-- =====================================================================
begin;
do $$
declare
  s jsonb := pg_temp.gp_seed();
  v_ws_a uuid := (s->>'ws_a')::uuid; v_ws_b uuid := (s->>'ws_b')::uuid;
  v_conn uuid; v_loc uuid; v_list text[];
begin
  -- 2 h old, no units: orphan
  v_conn := pg_temp.gp_upsert(v_ws_a, 'sub-old', 'R', pg_temp.gp_yt());
  perform pg_temp.gp_backdate(v_conn);
  -- 10 min old, no units: still in the grace
  v_conn := pg_temp.gp_upsert(v_ws_a, 'sub-new', 'R', pg_temp.gp_yt());
  update google_connections set authorized_at = now() - interval '10 minutes' where id = v_conn;
  -- 2 h old with an active unit
  v_conn := pg_temp.gp_upsert(v_ws_a, 'sub-unit', 'R', pg_temp.gp_gbp());
  perform pg_temp.gp_location(v_ws_a, (s->>'cli_a1')::bigint, v_conn, 'locations/1');
  perform pg_temp.gp_backdate(v_conn);
  -- 2 h old with a revoked unit (still in use: reconnect may bring it back)
  v_conn := pg_temp.gp_upsert(v_ws_a, 'sub-revoked', 'R', pg_temp.gp_gbp());
  v_loc := pg_temp.gp_location(v_ws_a, (s->>'cli_a2')::bigint, v_conn, 'locations/2');
  update gbp_locations set status = 'revoked', disconnected_at = now() where id = v_loc;
  perform pg_temp.gp_backdate(v_conn);
  -- 2 h old with a channel
  v_conn := pg_temp.gp_upsert(v_ws_a, 'sub-channel', 'R', pg_temp.gp_yt());
  perform pg_temp.gp_channel(v_ws_a, (s->>'cli_a3')::bigint, v_conn, 'UC-1');
  perform pg_temp.gp_backdate(v_conn);
  -- 2 h old with only a disconnected unit: orphan
  v_conn := pg_temp.gp_upsert(v_ws_b, 'sub-disc', 'R', pg_temp.gp_gbp());
  v_loc := pg_temp.gp_location(v_ws_b, (s->>'cli_b1')::bigint, v_conn, 'locations/3');
  update gbp_locations set status = 'disconnected', disconnected_at = now() where id = v_loc;
  perform pg_temp.gp_backdate(v_conn);
  -- the same sub stale in A and fresh in B: the sub is in use (per sub, not per row)
  v_conn := pg_temp.gp_upsert(v_ws_a, 'sub-split', 'R', pg_temp.gp_yt());
  perform pg_temp.gp_backdate(v_conn);
  perform pg_temp.gp_upsert(v_ws_b, 'sub-split', 'R', pg_temp.gp_yt());

  v_list := pg_temp.gp_orphans(100);
  assert 'sub-old' = any(v_list), format('2 h old with no units is listed: %s', v_list);
  assert 'sub-disc' = any(v_list), format('only a disconnected unit is listed: %s', v_list);
  assert not ('sub-new' = any(v_list)), 'inside the grace: not listed';
  assert not ('sub-unit' = any(v_list)), 'active unit: not listed';
  assert not ('sub-revoked' = any(v_list)), 'revoked unit: not listed';
  assert not ('sub-channel' = any(v_list)), 'channel: not listed';
  assert not ('sub-split' = any(v_list)), 'a fresh connection in another workspace keeps the sub';
  assert (select count(*) from unnest(v_list) x where x = 'sub-old') = 1, 'distinct subs';
  assert cardinality(pg_temp.gp_orphans(1)) = 1, 'p_limit caps the list';

  -- read-only: nothing changed
  assert (select count(*) from google_connections where google_sub = 'sub-old') = 1, 'connection kept';
  assert not exists (select 1 from google_revocations), 'nothing revoked';
  raise notice 'PASS google_purge.orphan_subs_respects_grace_and_units';
end $$;
rollback;

-- =====================================================================
-- release_sub_revokes_once
-- =====================================================================
begin;
do $$
declare
  s jsonb := pg_temp.gp_seed();
  v_ws_a uuid := (s->>'ws_a')::uuid;
  v_conn uuid; v_conn_busy uuid; r record;
begin
  -- inserted directly (not through the upsert, which takes the sub lock) to observe the lock
  insert into google_connections (conta_id, google_sub, email, encrypted_access_token,
                                  encrypted_refresh_token, access_token_expires_at, authorized_at)
    values (v_ws_a, 'sub-1', 'x@example.com', 'A1', 'R1', now() + interval '1 hour',
            now() - interval '2 hours')
    returning id into v_conn;
  v_conn_busy := pg_temp.gp_upsert(v_ws_a, 'sub-busy', 'R2', pg_temp.gp_gbp());
  perform pg_temp.gp_location(v_ws_a, (s->>'cli_a1')::bigint, v_conn_busy, 'locations/1');
  perform pg_temp.gp_backdate(v_conn_busy);

  assert not pg_temp.gp_holds_sub_lock('sub-1'), 'no google-sub lock before the call';
  select * into r from pg_temp.gp_release('sub-1');
  assert r.should_revoke = true and r.revocation_id is not null, 'first call revokes';
  assert pg_temp.gp_holds_sub_lock('sub-1'), 'release holds the google-sub advisory lock';
  assert not exists (select 1 from google_connections where google_sub = 'sub-1'), 'connection deleted';
  assert (select google_sub from google_revocations where id = r.revocation_id) = 'sub-1', 'sub recorded';

  select * into r from pg_temp.gp_release('sub-1');
  assert r.should_revoke = false and r.revocation_id is null, 'second call is a no-op';
  assert (select count(*) from google_revocations) = 1, 'exactly one revocation row';

  select * into r from pg_temp.gp_release('sub-busy');
  assert r.should_revoke = false and r.revocation_id is null, 'a sub in use is not released';
  assert exists (select 1 from google_connections where id = v_conn_busy), 'its connection kept';
  assert (select count(*) from google_revocations) = 1, 'still one revocation row';
  raise notice 'PASS google_purge.release_sub_revokes_once';
end $$;
rollback;

-- =====================================================================
-- client_delete_history_reaped_by_expire (I-1): deleting a client cascades its channel and unit
-- rows away (the history tables have no FK by design); the next google_expire_units reaps the
-- orphaned history, and only that history.
-- =====================================================================
begin;
do $$
declare
  s jsonb := pg_temp.gp_seed();
  v_ws_a uuid := (s->>'ws_a')::uuid; v_ws_b uuid := (s->>'ws_b')::uuid;
  v_conn_a uuid; v_conn_b uuid; r record;
begin
  v_conn_a := pg_temp.gp_upsert(v_ws_a, 'sub-1', 'RA', pg_temp.gp_yt() || pg_temp.gp_gbp());
  v_conn_b := pg_temp.gp_upsert(v_ws_b, 'sub-1', 'RB', pg_temp.gp_yt() || pg_temp.gp_gbp());
  -- A1 (deleted below) and A2 (kept) in workspace A; B1 links the same channel and unit as A1.
  perform pg_temp.gp_channel(v_ws_a, (s->>'cli_a1')::bigint, v_conn_a, 'UCx');
  perform pg_temp.gp_location(v_ws_a, (s->>'cli_a1')::bigint, v_conn_a, 'locations/X');
  perform pg_temp.gp_channel(v_ws_a, (s->>'cli_a2')::bigint, v_conn_a, 'UC-a2');
  perform pg_temp.gp_location(v_ws_a, (s->>'cli_a2')::bigint, v_conn_a, 'locations/a2');
  perform pg_temp.gp_channel(v_ws_b, (s->>'cli_b1')::bigint, v_conn_b, 'UCx');
  perform pg_temp.gp_location(v_ws_b, (s->>'cli_b1')::bigint, v_conn_b, 'locations/X');
  perform pg_temp.gp_yt_hist(v_ws_a, 'UCx');
  perform pg_temp.gp_gbp_hist(v_ws_a, 'locations/X');
  perform pg_temp.gp_yt_hist(v_ws_a, 'UC-a2');
  perform pg_temp.gp_gbp_hist(v_ws_a, 'locations/a2');
  perform pg_temp.gp_yt_hist(v_ws_b, 'UCx');
  perform pg_temp.gp_gbp_hist(v_ws_b, 'locations/X');

  delete from clientes where id = (s->>'cli_a1')::bigint;
  assert not exists (select 1 from youtube_channels where conta_id = v_ws_a and channel_id = 'UCx'),
    'the channel row cascaded away with the client';
  assert not exists (select 1 from gbp_locations where conta_id = v_ws_a and location_name = 'locations/X'),
    'the unit row cascaded away with the client';
  assert pg_temp.gp_yt_count(v_ws_a, 'UCx') = 5, 'history is orphaned until the expiry runs';

  select * into r from pg_temp.gp_expire();
  assert r.g = 0 and r.y = 0, format('no unit reached its 30 days, got (%s, %s)', r.g, r.y);
  assert r.oy = 5, format('five orphaned YouTube rows reaped, got %s', r.oy);
  assert r.og = 4, format('four orphaned GMN rows reaped, got %s', r.og);
  assert pg_temp.gp_yt_count(v_ws_a, 'UCx') = 0, 'the deleted client''s YouTube history is gone';
  assert pg_temp.gp_gbp_count(v_ws_a, 'locations/X') = 0, 'the deleted client''s GMN history is gone';
  assert pg_temp.gp_yt_count(v_ws_a, 'UC-a2') = 5, 'another client''s YouTube history is untouched';
  assert pg_temp.gp_gbp_count(v_ws_a, 'locations/a2') = 4, 'another client''s GMN history is untouched';
  assert pg_temp.gp_yt_count(v_ws_b, 'UCx') = 5, 'B''s history of the same channel is untouched';
  assert pg_temp.gp_gbp_count(v_ws_b, 'locations/X') = 4, 'B''s history of the same unit is untouched';

  select * into r from pg_temp.gp_expire();
  assert r.oy = 0 and r.og = 0, 'a second run reaps nothing';
  raise notice 'PASS google_purge.client_delete_history_reaped_by_expire';
end $$;
rollback;

-- =====================================================================
-- orphan_pass_spares_disconnected_units: a disconnected unit keeps its row (and history) for its
-- 30 days, so the orphan pass never fights the soft delete.
-- =====================================================================
begin;
do $$
declare
  s jsonb := pg_temp.gp_seed();
  v_ws uuid := (s->>'ws_a')::uuid;
  v_conn uuid; v_loc uuid; r record;
begin
  v_conn := pg_temp.gp_upsert(v_ws, 'sub-1', 'R1', pg_temp.gp_gbp());
  v_loc := pg_temp.gp_location(v_ws, (s->>'cli_a1')::bigint, v_conn, 'locations/1');
  perform pg_temp.gp_gbp_hist(v_ws, 'locations/1');
  update gbp_locations set status = 'disconnected', disconnected_at = now() - interval '5 days' where id = v_loc;

  select * into r from pg_temp.gp_expire();
  assert r.og = 0 and r.g = 0, format('nothing reaped, got (%s, %s)', r.og, r.g);
  assert pg_temp.gp_gbp_count(v_ws, 'locations/1') = 4, 'the disconnected unit keeps its history';
  raise notice 'PASS google_purge.orphan_pass_spares_disconnected_units';
end $$;
rollback;

-- =====================================================================
-- workspace_delete_revokes_unused_sub (I-1): the workspace is the only user of its Google
-- identities, and one of them was authorized minutes ago (inside the one-hour grace). Deleting
-- the workspace queues a revocation for each identity before the cascade drops the tokens; the
-- orphaned history goes on the next expiry.
-- =====================================================================
begin;
do $$
declare
  s jsonb := pg_temp.gp_seed();
  v_ws_a uuid := (s->>'ws_a')::uuid; v_ws_b uuid := (s->>'ws_b')::uuid;
  v_conn uuid; v_conn2 uuid; v_conn_b uuid; r record;
begin
  -- fresh: no gp_backdate, so _google_revoke_if_unused's grace would otherwise keep the token
  v_conn := pg_temp.gp_upsert(v_ws_a, 'sub-ws', 'R-fresh', pg_temp.gp_yt() || pg_temp.gp_gbp());
  v_conn2 := pg_temp.gp_upsert(v_ws_a, 'sub-ws2', 'R-old', pg_temp.gp_gbp());
  perform pg_temp.gp_backdate(v_conn2);
  perform pg_temp.gp_channel(v_ws_a, (s->>'cli_a1')::bigint, v_conn, 'UC-1');
  perform pg_temp.gp_location(v_ws_a, (s->>'cli_a2')::bigint, v_conn, 'locations/1');
  perform pg_temp.gp_location(v_ws_a, (s->>'cli_a3')::bigint, v_conn2, 'locations/2');
  perform pg_temp.gp_yt_hist(v_ws_a, 'UC-1');
  perform pg_temp.gp_gbp_hist(v_ws_a, 'locations/1');
  perform pg_temp.gp_gbp_hist(v_ws_a, 'locations/2');
  -- an unrelated identity in B must not be touched
  v_conn_b := pg_temp.gp_upsert(v_ws_b, 'sub-b', 'RB', pg_temp.gp_yt());
  perform pg_temp.gp_channel(v_ws_b, (s->>'cli_b1')::bigint, v_conn_b, 'UC-b');

  delete from workspaces where id = v_ws_a;

  assert (select count(*) from google_revocations where google_sub = 'sub-ws') = 1,
    'one revocation queued for the fresh identity';
  select * into r from google_revocations where google_sub = 'sub-ws';
  assert r.token_kind = 'refresh' and r.encrypted_token = 'R-fresh', 'the refresh token is queued';
  assert (select count(*) from google_revocations where google_sub = 'sub-ws2') = 1,
    'one revocation queued for the second identity';
  assert not exists (select 1 from google_revocations where google_sub = 'sub-b'), 'B''s identity is not revoked';
  assert not exists (select 1 from google_connections where google_sub in ('sub-ws', 'sub-ws2')),
    'the workspace''s connections are gone';
  assert exists (select 1 from google_connections where id = v_conn_b), 'B''s connection is kept';
  assert pg_temp.gp_yt_count(v_ws_a, 'UC-1') = 5, 'history is orphaned until the expiry runs';

  select * into r from pg_temp.gp_expire();
  assert r.oy = 5 and r.og = 8, format('orphaned history reaped, got (%s, %s)', r.oy, r.og);
  assert pg_temp.gp_yt_count(v_ws_a, 'UC-1') = 0, 'YouTube history gone';
  assert pg_temp.gp_gbp_count(v_ws_a, 'locations/1') = 0, 'GMN history gone';
  assert pg_temp.gp_gbp_count(v_ws_a, 'locations/2') = 0, 'GMN history of the second identity gone';
  raise notice 'PASS google_purge.workspace_delete_revokes_unused_sub';
end $$;
rollback;

-- =====================================================================
-- workspace_delete_keeps_shared_sub (I-1, spec 4.2): B still uses the same Google identity, so
-- deleting A revokes nothing and leaves B's connection, units and history alone.
-- =====================================================================
begin;
do $$
declare
  s jsonb := pg_temp.gp_seed();
  v_ws_a uuid := (s->>'ws_a')::uuid; v_ws_b uuid := (s->>'ws_b')::uuid;
  v_conn_a uuid; v_conn_b uuid; v_ch_b uuid; v_loc_b uuid; r record;
begin
  v_conn_a := pg_temp.gp_upsert(v_ws_a, 'sub-shared', 'RA', pg_temp.gp_yt() || pg_temp.gp_gbp());
  v_conn_b := pg_temp.gp_upsert(v_ws_b, 'sub-shared', 'RB', pg_temp.gp_yt() || pg_temp.gp_gbp());
  -- B is past its grace: only its units keep the identity in use
  perform pg_temp.gp_backdate(v_conn_b);
  perform pg_temp.gp_channel(v_ws_a, (s->>'cli_a1')::bigint, v_conn_a, 'UCx');
  perform pg_temp.gp_location(v_ws_a, (s->>'cli_a1')::bigint, v_conn_a, 'locations/X');
  v_ch_b := pg_temp.gp_channel(v_ws_b, (s->>'cli_b1')::bigint, v_conn_b, 'UCx');
  v_loc_b := pg_temp.gp_location(v_ws_b, (s->>'cli_b1')::bigint, v_conn_b, 'locations/X');
  perform pg_temp.gp_yt_hist(v_ws_a, 'UCx');
  perform pg_temp.gp_gbp_hist(v_ws_a, 'locations/X');
  perform pg_temp.gp_yt_hist(v_ws_b, 'UCx');
  perform pg_temp.gp_gbp_hist(v_ws_b, 'locations/X');

  delete from workspaces where id = v_ws_a;

  assert not exists (select 1 from google_revocations), 'no revocation queued';
  assert not exists (select 1 from google_connections where id = v_conn_a), 'A''s connection is gone';
  assert (select status from google_connections where id = v_conn_b) = 'active', 'B''s connection is kept';
  assert (select encrypted_refresh_token from google_connections where id = v_conn_b) = 'RB', 'with its token';
  assert (select authorization_status from youtube_channels where id = v_ch_b) = 'active', 'B''s channel kept';
  assert (select status from gbp_locations where id = v_loc_b) = 'active', 'B''s unit kept';

  select * into r from pg_temp.gp_expire();
  assert r.oy = 5 and r.og = 4, format('only A''s history is reaped, got (%s, %s)', r.oy, r.og);
  assert pg_temp.gp_yt_count(v_ws_a, 'UCx') = 0 and pg_temp.gp_gbp_count(v_ws_a, 'locations/X') = 0,
    'A''s history gone';
  assert pg_temp.gp_yt_count(v_ws_b, 'UCx') = 5, 'B''s YouTube history kept';
  assert pg_temp.gp_gbp_count(v_ws_b, 'locations/X') = 4, 'B''s GMN history kept';
  raise notice 'PASS google_purge.workspace_delete_keeps_shared_sub';
end $$;
rollback;

-- =====================================================================
-- workspace_delete_keeps_sub_fresh_elsewhere: B authorized the same identity minutes ago and has
-- no unit yet (its picker is open). That is B's grace, and it still keeps the identity in use.
-- =====================================================================
begin;
do $$
declare
  s jsonb := pg_temp.gp_seed();
  v_ws_a uuid := (s->>'ws_a')::uuid; v_ws_b uuid := (s->>'ws_b')::uuid;
  v_conn_a uuid; v_conn_b uuid;
begin
  v_conn_a := pg_temp.gp_upsert(v_ws_a, 'sub-shared', 'RA', pg_temp.gp_yt());
  perform pg_temp.gp_backdate(v_conn_a);
  perform pg_temp.gp_channel(v_ws_a, (s->>'cli_a1')::bigint, v_conn_a, 'UCx');
  v_conn_b := pg_temp.gp_upsert(v_ws_b, 'sub-shared', 'RB', pg_temp.gp_gbp());

  delete from workspaces where id = v_ws_a;

  assert not exists (select 1 from google_revocations), 'no revocation queued';
  assert exists (select 1 from google_connections where id = v_conn_b), 'B''s fresh connection is kept';
  raise notice 'PASS google_purge.workspace_delete_keeps_sub_fresh_elsewhere';
end $$;
rollback;

-- =====================================================================
-- workspace_delete_trigger_takes_sub_lock: the trigger serializes with the other in-use paths
-- =====================================================================
begin;
do $$
declare
  s jsonb := pg_temp.gp_seed();
  v_ws_a uuid := (s->>'ws_a')::uuid;
begin
  perform pg_temp.gp_upsert(v_ws_a, 'sub-lock', 'R', pg_temp.gp_yt());
  -- the upsert took the lock in this transaction too; check a sub the upsert never saw instead
  insert into google_connections (conta_id, google_sub, email, encrypted_access_token,
                                  encrypted_refresh_token, access_token_expires_at)
    values (v_ws_a, 'sub-direct', 'x@example.com', 'A1', 'R1', now() + interval '1 hour');
  assert not pg_temp.gp_holds_sub_lock('sub-direct'), 'no lock before the delete';
  delete from workspaces where id = v_ws_a;
  assert pg_temp.gp_holds_sub_lock('sub-direct'), 'the workspace delete holds the google-sub lock';
  assert (select count(*) from google_revocations where google_sub = 'sub-direct') = 1, 'and revoked it';
  raise notice 'PASS google_purge.workspace_delete_trigger_takes_sub_lock';
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
    'public.youtube_purge_channel(uuid, text, bigint)',
    'public.google_unlink_youtube(uuid, bigint)',
    'public.google_mark_revoked(uuid)',
    'public.google_expire_units()',
    'public.google_orphan_subs(integer)',
    'public.google_release_sub(text)'] loop
    foreach v_role in array array['authenticated', 'anon'] loop
      assert not has_function_privilege(v_role, v_fn, 'EXECUTE'), format('%s cannot execute %s', v_role, v_fn);
    end loop;
    assert has_function_privilege('service_role', v_fn, 'EXECUTE'), format('service_role executes %s', v_fn);
    assert (select prosecdef from pg_proc where oid = v_fn::regprocedure), format('%s is SECURITY DEFINER', v_fn);
    assert (select proconfig from pg_proc where oid = v_fn::regprocedure) @> array['search_path=public, pg_temp'],
      format('%s pins search_path', v_fn);
  end loop;
  foreach v_role in array array['authenticated', 'anon', 'service_role'] loop
    assert not has_function_privilege(v_role, 'public._google_revoke_if_unused(text)', 'EXECUTE'),
      format('%s cannot execute _google_revoke_if_unused', v_role);
  end loop;
  -- the workspace-delete trigger function: definer, pinned search_path, nobody may call it
  v_fn := 'public.google_workspace_release_identities()';
  foreach v_role in array array['authenticated', 'anon'] loop
    assert not has_function_privilege(v_role, v_fn, 'EXECUTE'), format('%s cannot execute %s', v_role, v_fn);
  end loop;
  assert (select prosecdef from pg_proc where oid = v_fn::regprocedure), format('%s is SECURITY DEFINER', v_fn);
  assert (select proconfig from pg_proc where oid = v_fn::regprocedure) @> array['search_path=public, pg_temp'],
    format('%s pins search_path', v_fn);
  assert exists (
    select 1 from pg_trigger t
     where t.tgrelid = 'public.workspaces'::regclass and t.tgname = 'trg_workspaces_google_release'
       and t.tgfoid = v_fn::regprocedure and not t.tgisinternal
       and (t.tgtype & 2) = 2      -- BEFORE
       and (t.tgtype & 8) = 8      -- DELETE
       and (t.tgtype & 1) = 1),    -- FOR EACH ROW
    'BEFORE DELETE row trigger on workspaces';
  raise notice 'PASS google_purge.grants';
end $$;
rollback;
