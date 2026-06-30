\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

do $$
declare
  r record;
  v_n int;
  v_feature_cols text[];
  v_col text;
  v_all_true boolean;
begin
  -- The 3 Slice-1 tiers exist and are active.
  select count(*) into v_n
    from plans where id in ('starter','agency','scale') and is_active;
  assert v_n = 3, format('expected 3 active slice-1 tiers, got %s', v_n);

  -- max_clients: 10 / 30 / NULL(unlimited)
  select max_clients into v_n from plans where id = 'starter';
  assert v_n = 10, format('starter max_clients expected 10, got %s', v_n);
  select max_clients into v_n from plans where id = 'agency';
  assert v_n = 30, format('agency max_clients expected 30, got %s', v_n);
  assert (select max_clients from plans where id = 'scale') is null,
    'scale max_clients must be NULL (unlimited)';

  -- max_team_members: 2 / 5 / 10
  assert (select max_team_members from plans where id = 'starter') = 2, 'starter seats=2';
  assert (select max_team_members from plans where id = 'agency')  = 5, 'agency seats=5';
  assert (select max_team_members from plans where id = 'scale')   = 10, 'scale seats=10';

  -- rate_ai_analyses_per_month set/scaled (NOT NULL): 30 / 100 / 300
  assert (select rate_ai_analyses_per_month from plans where id = 'starter') = 30,  'starter ai=30';
  assert (select rate_ai_analyses_per_month from plans where id = 'agency')  = 100, 'agency ai=100';
  assert (select rate_ai_analyses_per_month from plans where id = 'scale')   = 300, 'scale ai=300';

  -- other rate_* + storage are NULL (unlimited / uncapped)
  for r in select id from plans where id in ('starter','agency','scale') loop
    assert (select rate_instagram_syncs_per_day   from plans where id = r.id) is null,
      format('%s rate_instagram_syncs_per_day must be NULL', r.id);
    assert (select rate_report_generations_per_month from plans where id = r.id) is null,
      format('%s rate_report_generations_per_month must be NULL', r.id);
    assert (select storage_quota_bytes from plans where id = r.id) is null,
      format('%s storage_quota_bytes must be NULL', r.id);
  end loop;

  -- Seat DISPLAY price (centavos) is set and SHARED across all three tiers: 2500 / 25000.
  -- These back the cost breakdown / computeSeatCost; a NULL here would 400 listActivePlans.
  for r in select id from plans where id in ('starter','agency','scale') loop
    assert (select seat_addon_brl from plans where id = r.id) = 2500,
      format('%s seat_addon_brl expected 2500', r.id);
    assert (select seat_addon_brl_annual from plans where id = r.id) = 25000,
      format('%s seat_addon_brl_annual expected 25000', r.id);
  end loop;

  -- EVERY live feature_* column is TRUE on all three tiers (everything-included invariant).
  select array_agg(column_name::text order by column_name) into v_feature_cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'plans'
     and column_name like 'feature\_%';
  assert array_length(v_feature_cols, 1) >= 1, 'no feature_* columns found';
  for r in select id from plans where id in ('starter','agency','scale') loop
    foreach v_col in array v_feature_cols loop
      execute format('select %I from plans where id = $1', v_col)
        into v_all_true using r.id;
      assert v_all_true is true,
        format('feature %s must be TRUE on %s', v_col, r.id);
    end loop;
  end loop;

  -- Seat price-id columns exist on the plans table (may be NULL until operator pastes ids).
  perform 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'plans'
      and column_name = 'stripe_price_id_seat';
  assert found, 'plans.stripe_price_id_seat column must exist';
  perform 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'plans'
      and column_name = 'stripe_price_id_seat_annual';
  assert found, 'plans.stripe_price_id_seat_annual column must exist';

  raise notice 'PASS 07_catalog_slice1';
end $$;
