\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Suite for the YouTube history tables (20261112000010_youtube_history.sql):
-- youtube_channel_daily, youtube_traffic_daily, youtube_demographics, youtube_videos,
-- youtube_video_daily and youtube_pdf_purges are service-role only (RLS on, no policies,
-- REVOKE ALL from PUBLIC/anon/authenticated), keyed by conta_id first with no FK to the link
-- tables, plus the new last_sync_attempt_at columns on youtube_channels and gbp_locations.
-- Spec: docs/superpowers/specs/2026-10-29-youtube-google-meu-negocio-design.md section 5.1.
--
-- The six new tables are excluded from the parity helper: their REVOKE is under test, and
-- parity would re-grant ALL to anon/authenticated and undo it.

-- Two workspaces, no clientes needed: the history tables have no FK to the link tables.
create or replace function pg_temp.yh_seed() returns jsonb language plpgsql as $$
declare v_ws_a uuid; v_ws_b uuid;
begin
  v_ws_a := et_make_workspace('pro');
  v_ws_b := et_make_workspace('pro');
  return jsonb_build_object('ws_a', v_ws_a, 'ws_b', v_ws_b);
end $$;

-- =====================================================================
-- grants: service-role only
-- =====================================================================
begin;
select et_grant_hosted_parity(array['youtube_channel_daily','youtube_traffic_daily',
  'youtube_demographics','youtube_videos','youtube_video_daily','youtube_pdf_purges']);
do $$
declare v_t text; v_role text; v_priv text;
begin
  foreach v_t in array array['youtube_channel_daily','youtube_traffic_daily',
      'youtube_demographics','youtube_videos','youtube_video_daily','youtube_pdf_purges'] loop
    assert (select relrowsecurity from pg_class where oid = ('public.' || v_t)::regclass),
      format('%s should have RLS enabled', v_t);
    assert not exists (select 1 from pg_policies where schemaname = 'public' and tablename = v_t),
      format('%s should have no policies', v_t);
    -- All seven privileges, so a missing REVOKE fails on either local image (see
    -- 99_google_connections.sql for why).
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
  raise notice 'PASS 99_youtube_history grants';
end $$;
rollback;

-- =====================================================================
-- primary keys: conta_id first, exactly the columns the sync upserts on
-- =====================================================================
begin;
do $$
declare
  v_t text; v_expected text; v_actual text;
begin
  for v_t, v_expected in
    select * from (values
      ('youtube_channel_daily',  'conta_id,channel_id,day,content_type'),
      ('youtube_traffic_daily',  'conta_id,channel_id,day,source_type'),
      ('youtube_demographics',   'conta_id,channel_id,window_end,age_group,gender'),
      ('youtube_videos',         'conta_id,channel_id,video_id'),
      ('youtube_video_daily',    'conta_id,channel_id,video_id,day')
    ) as x(t, cols)
  loop
    select string_agg(a.attname, ',' order by k.ord) into v_actual
      from pg_index i
      cross join lateral unnest(i.indkey) with ordinality as k(attnum, ord)
      join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
     where i.indrelid = ('public.' || v_t)::regclass and i.indisprimary;
    assert v_actual = v_expected,
      format('%s primary key is (%s), expected (%s)', v_t, v_actual, v_expected);
  end loop;
  -- No FK to the link tables or to anything else: GMN-style history must outlive an unlink
  -- and the purge RPC (not a cascade) is what deletes it.
  assert not exists (
    select 1 from pg_constraint
     where contype = 'f'
       and conrelid in ('public.youtube_channel_daily'::regclass,
                        'public.youtube_traffic_daily'::regclass,
                        'public.youtube_demographics'::regclass,
                        'public.youtube_videos'::regclass,
                        'public.youtube_video_daily'::regclass)),
    'history tables should have no foreign keys';
  raise notice 'PASS 99_youtube_history primary keys';
end $$;
rollback;

-- =====================================================================
-- workspace isolation, nullable metrics, content_type CHECK, engaged_views
-- =====================================================================
begin;
select et_grant_hosted_parity(array['youtube_channel_daily','youtube_traffic_daily',
  'youtube_demographics','youtube_videos','youtube_video_daily','youtube_pdf_purges']);
do $$
declare
  s jsonb := pg_temp.yh_seed();
  v_ws_a uuid := (s->>'ws_a')::uuid; v_ws_b uuid := (s->>'ws_b')::uuid;
begin
  perform set_config('role', 'service_role', true);

  -- the same channel and day in two workspaces: no conflict
  insert into youtube_channel_daily (conta_id, channel_id, day, content_type, views)
    values (v_ws_a, 'UC-1', date '2026-10-01', 'all', 10),
           (v_ws_b, 'UC-1', date '2026-10-01', 'all', 99);
  assert (select count(*) from youtube_channel_daily where channel_id = 'UC-1') = 2,
    'two workspaces share (channel_id, day, content_type) without conflict';

  -- the same key inside one workspace conflicts
  begin
    insert into youtube_channel_daily (conta_id, channel_id, day, content_type)
      values (v_ws_a, 'UC-1', date '2026-10-01', 'all');
    assert false, 'duplicate (conta_id, channel_id, day, content_type) should fail';
  exception when unique_violation then null;
  end;

  -- every metric is nullable (Google leaves some unsplit on split rows), so a split row can
  -- carry views only
  insert into youtube_channel_daily (conta_id, channel_id, day, content_type, views)
    values (v_ws_a, 'UC-1', date '2026-10-01', 'shorts', 4);
  assert (select engaged_views is null and estimated_minutes_watched is null
                 and likes is null and comments is null and shares is null
                 and subscribers_gained is null and subscribers_lost is null
                 and average_view_duration_s is null
            from youtube_channel_daily
           where conta_id = v_ws_a and day = date '2026-10-01' and content_type = 'shorts'),
    'channel_daily metrics default to null';

  -- content_type CHECK
  begin
    insert into youtube_channel_daily (conta_id, channel_id, day, content_type)
      values (v_ws_a, 'UC-1', date '2026-10-02', 'reels');
    assert false, 'content_type reels should be rejected';
  exception when check_violation then null;
  end;
  insert into youtube_channel_daily (conta_id, channel_id, day, content_type)
    values (v_ws_a, 'UC-1', date '2026-10-02', 'long'),
           (v_ws_a, 'UC-1', date '2026-10-02', 'live');

  -- traffic
  insert into youtube_traffic_daily (conta_id, channel_id, day, source_type, views)
    values (v_ws_a, 'UC-1', date '2026-10-01', 'YT_SEARCH', 3),
           (v_ws_b, 'UC-1', date '2026-10-01', 'YT_SEARCH', 7);
  assert (select count(*) from youtube_traffic_daily) = 2, 'traffic shared across workspaces';

  -- demographics: viewer_pct is numeric
  insert into youtube_demographics (conta_id, channel_id, window_end, age_group, gender, viewer_pct)
    values (v_ws_a, 'UC-1', date '2026-10-01', 'age25-34', 'female', 12.345),
           (v_ws_b, 'UC-1', date '2026-10-01', 'age25-34', 'female', 1);
  assert (select viewer_pct from youtube_demographics where conta_id = v_ws_a) = 12.345,
    'viewer_pct keeps fractional precision';

  -- videos
  insert into youtube_videos (conta_id, channel_id, video_id, title, published_at, duration_s,
                              is_short, thumbnail_url, view_count, like_count, comment_count,
                              metadata_refreshed_at, daily_through)
    values (v_ws_a, 'UC-1', 'vid1', 'Titulo', now(), 45, true, 'https://i.ytimg.com/x.jpg',
            100, 10, 2, now(), date '2026-10-01'),
           (v_ws_b, 'UC-1', 'vid1', 'Outro', now(), 45, true, null, null, null, null, null, null);
  assert (select count(*) from youtube_videos where video_id = 'vid1') = 2,
    'videos shared across workspaces';

  -- video daily, including engaged_views (P8)
  insert into youtube_video_daily (conta_id, channel_id, video_id, day, views, engaged_views,
                                   likes, comments, shares, subscribers_gained,
                                   average_view_duration_s, average_view_percentage)
    values (v_ws_a, 'UC-1', 'vid1', date '2026-10-01', 5, 4, 1, 0, 0, 0, 20.5, 45.5),
           (v_ws_b, 'UC-1', 'vid1', date '2026-10-01', 6, 5, 1, 0, 0, 0, 21, 46);
  assert (select engaged_views from youtube_video_daily where conta_id = v_ws_a) = 4,
    'video_daily stores engaged_views';

  -- pdf purge queue
  insert into youtube_pdf_purges (conta_id, client_id, storage_path)
    values (v_ws_a, 1, 'reports/a.pdf');
  assert (select attempts from youtube_pdf_purges where conta_id = v_ws_a) = 0,
    'pdf purge attempts default 0';
  assert (select id is not null and created_at is not null from youtube_pdf_purges
           where conta_id = v_ws_a), 'pdf purge id and created_at default';
  begin
    insert into youtube_pdf_purges (conta_id, client_id, storage_path)
      values (v_ws_a, 1, null);
    assert false, 'storage_path is NOT NULL';
  exception when not_null_violation then null;
  end;

  perform set_config('role', 'postgres', true);
  raise notice 'PASS 99_youtube_history isolation and checks';
end $$;
rollback;

-- =====================================================================
-- last_sync_attempt_at on the link tables
-- =====================================================================
begin;
do $$
declare v_t text;
begin
  foreach v_t in array array['youtube_channels','gbp_locations'] loop
    assert exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = v_t
         and column_name = 'last_sync_attempt_at' and data_type = 'timestamp with time zone'),
      format('%s.last_sync_attempt_at should exist as timestamptz', v_t);
  end loop;
  raise notice 'PASS 99_youtube_history last_sync_attempt_at';
end $$;
rollback;
