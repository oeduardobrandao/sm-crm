\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Suite for the Google Meu Negócio history tables (20261112000011_gbp_history.sql):
-- gbp_metrics_daily, gbp_search_keywords_monthly, gbp_reviews and gbp_rating_daily are
-- service-role only (RLS on, no policies, REVOKE ALL from PUBLIC/anon/authenticated), keyed by
-- conta_id first with no FK to gbp_locations (history outlives an unlink for 30 days), plus
-- gbp_locations.maps_uri.
-- Spec: docs/superpowers/specs/2026-10-29-youtube-google-meu-negocio-design.md section 5.2.
--
-- The four new tables are excluded from the parity helper: their REVOKE is under test, and
-- parity would re-grant ALL to anon/authenticated and undo it.

create or replace function pg_temp.gh_seed() returns jsonb language plpgsql as $$
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
select et_grant_hosted_parity(array['gbp_metrics_daily','gbp_search_keywords_monthly',
                                    'gbp_reviews','gbp_rating_daily']);
do $$
declare v_t text; v_role text; v_priv text;
begin
  foreach v_t in array array['gbp_metrics_daily','gbp_search_keywords_monthly',
                              'gbp_reviews','gbp_rating_daily'] loop
    assert (select relrowsecurity from pg_class where oid = ('public.' || v_t)::regclass),
      format('%s should have RLS enabled', v_t);
    assert not exists (select 1 from pg_policies where schemaname = 'public' and tablename = v_t),
      format('%s should have no policies', v_t);
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
  raise notice 'PASS 99_gbp_history grants';
end $$;
rollback;

-- =====================================================================
-- primary keys and no foreign keys
-- =====================================================================
begin;
do $$
declare v_t text; v_expected text; v_actual text;
begin
  for v_t, v_expected in
    select * from (values
      ('gbp_metrics_daily',            'conta_id,location_name,day'),
      ('gbp_search_keywords_monthly',  'conta_id,location_name,month,keyword'),
      ('gbp_reviews',                  'conta_id,location_name,review_id'),
      ('gbp_rating_daily',             'conta_id,location_name,day')
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
  assert not exists (
    select 1 from pg_constraint
     where contype = 'f'
       and conrelid in ('public.gbp_metrics_daily'::regclass,
                        'public.gbp_search_keywords_monthly'::regclass,
                        'public.gbp_reviews'::regclass,
                        'public.gbp_rating_daily'::regclass)),
    'history tables should have no foreign keys';
  raise notice 'PASS 99_gbp_history primary keys';
end $$;
rollback;

-- =====================================================================
-- metrics defaults, CHECKs, workspace isolation
-- =====================================================================
begin;
select et_grant_hosted_parity(array['gbp_metrics_daily','gbp_search_keywords_monthly',
                                    'gbp_reviews','gbp_rating_daily']);
do $$
declare
  s jsonb := pg_temp.gh_seed();
  v_ws_a uuid := (s->>'ws_a')::uuid; v_ws_b uuid := (s->>'ws_b')::uuid;
  v_col text;
begin
  perform set_config('role', 'service_role', true);

  -- daily metrics: all ten default to 0 (a day the API omits is stored as zeros)
  insert into gbp_metrics_daily (conta_id, location_name, day)
    values (v_ws_a, 'locations/1', date '2026-10-01');
  foreach v_col in array array['business_impressions_desktop_maps',
      'business_impressions_desktop_search','business_impressions_mobile_maps',
      'business_impressions_mobile_search','call_clicks','business_direction_requests',
      'website_clicks','messaging_clicks','business_bookings','business_food_menu_clicks'] loop
    assert (select (to_jsonb(m) ->> v_col)::int from gbp_metrics_daily m
             where conta_id = v_ws_a and location_name = 'locations/1') = 0,
      format('gbp_metrics_daily.%s should default to 0', v_col);
  end loop;
  -- NOT NULL
  begin
    insert into gbp_metrics_daily (conta_id, location_name, day, call_clicks)
      values (v_ws_a, 'locations/1', date '2026-10-02', null);
    assert false, 'call_clicks is NOT NULL';
  exception when not_null_violation then null;
  end;
  -- same location and day in two workspaces: no conflict; twice in one: conflict
  insert into gbp_metrics_daily (conta_id, location_name, day, call_clicks)
    values (v_ws_b, 'locations/1', date '2026-10-01', 7);
  assert (select count(*) from gbp_metrics_daily where location_name = 'locations/1') = 2,
    'two workspaces share (location_name, day)';
  begin
    insert into gbp_metrics_daily (conta_id, location_name, day)
      values (v_ws_a, 'locations/1', date '2026-10-01');
    assert false, 'duplicate (conta_id, location_name, day) should fail';
  exception when unique_violation then null;
  end;

  -- keywords: exactly one of value / threshold
  insert into gbp_search_keywords_monthly (conta_id, location_name, month, keyword, value)
    values (v_ws_a, 'locations/1', date '2026-09-01', 'pizza', 120);
  insert into gbp_search_keywords_monthly (conta_id, location_name, month, keyword, threshold)
    values (v_ws_a, 'locations/1', date '2026-09-01', 'pizzaria perto', 15);
  begin
    insert into gbp_search_keywords_monthly (conta_id, location_name, month, keyword)
      values (v_ws_a, 'locations/1', date '2026-09-01', 'nenhum');
    assert false, 'keyword with neither value nor threshold should fail';
  exception when check_violation then null;
  end;
  begin
    insert into gbp_search_keywords_monthly (conta_id, location_name, month, keyword, value, threshold)
      values (v_ws_a, 'locations/1', date '2026-09-01', 'ambos', 10, 15);
    assert false, 'keyword with both value and threshold should fail';
  exception when check_violation then null;
  end;
  insert into gbp_search_keywords_monthly (conta_id, location_name, month, keyword, value)
    values (v_ws_b, 'locations/1', date '2026-09-01', 'pizza', 1);
  assert (select count(*) from gbp_search_keywords_monthly where keyword = 'pizza') = 2,
    'keywords shared across workspaces';

  -- reviews: star_rating 1..5, reviewer_name nullable, has_reply default
  insert into gbp_reviews (conta_id, location_name, review_id, reviewer_name, star_rating,
                           comment, create_time, update_time, has_reply)
    values (v_ws_a, 'locations/1', 'r1', 'Maria', 5, 'Otimo', now(), now(), true);
  insert into gbp_reviews (conta_id, location_name, review_id, star_rating)
    values (v_ws_a, 'locations/1', 'r-anon', 1);
  assert (select reviewer_name is null and comment is null and has_reply = false
            from gbp_reviews where review_id = 'r-anon'),
    'anonymous reviewer: reviewer_name and comment null, has_reply false';
  begin
    insert into gbp_reviews (conta_id, location_name, review_id, star_rating)
      values (v_ws_a, 'locations/1', 'r0', 0);
    assert false, 'star_rating 0 should fail';
  exception when check_violation then null;
  end;
  begin
    insert into gbp_reviews (conta_id, location_name, review_id, star_rating)
      values (v_ws_a, 'locations/1', 'r6', 6);
    assert false, 'star_rating 6 should fail';
  exception when check_violation then null;
  end;
  insert into gbp_reviews (conta_id, location_name, review_id, star_rating)
    values (v_ws_b, 'locations/1', 'r1', 3);
  assert (select count(*) from gbp_reviews where review_id = 'r1') = 2,
    'reviews shared across workspaces';

  -- rating daily
  insert into gbp_rating_daily (conta_id, location_name, day, average_rating, total_review_count)
    values (v_ws_a, 'locations/1', date '2026-10-01', 4.7, 120),
           (v_ws_b, 'locations/1', date '2026-10-01', 3.2, 4);
  assert (select average_rating from gbp_rating_daily where conta_id = v_ws_a) = 4.7,
    'average_rating keeps one decimal';

  perform set_config('role', 'postgres', true);
  raise notice 'PASS 99_gbp_history defaults, checks and isolation';
end $$;
rollback;

-- =====================================================================
-- gbp_locations.maps_uri
-- =====================================================================
begin;
do $$
begin
  assert exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'gbp_locations'
       and column_name = 'maps_uri' and data_type = 'text'),
    'gbp_locations.maps_uri should exist as text';
  raise notice 'PASS 99_gbp_history maps_uri';
end $$;
rollback;
