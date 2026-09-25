\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql
begin;
do $$
declare
  v_ws uuid; v_ws2 uuid; v_res jsonb; v_n int; v_raised boolean;
  v_row1 jsonb; v_row2 jsonb;
begin
  v_ws := et_make_workspace('free');
  v_ws2 := et_make_workspace('free');
  v_row1 := jsonb_build_object('workspace_id', v_ws, 'provider', 'stripe', 'plan_id', 'pro',
    'plan_name', 'Pro', 'status', 'active', 'billing_interval', 'month', 'monthly_cents', 9900,
    'amount_source', 'stripe', 'provider_switch', false);
  v_row2 := jsonb_build_object('workspace_id', v_ws2, 'provider', 'pagarme', 'plan_id', 'max',
    'plan_name', 'Max', 'status', 'trialing', 'billing_interval', 'year', 'monthly_cents', 19900,
    'amount_source', 'pagarme', 'provider_switch', true);

  -- 1. cron writes the day and its completion marker
  v_res := admin_metrics_write_snapshot('2026-09-24', 'cron', jsonb_build_array(v_row1, v_row2));
  assert (v_res->>'written')::int = 2, format('written: %s', v_res);
  assert not (v_res->>'skipped')::boolean, 'cron write must not skip';
  assert (select row_count from metrics_snapshot_runs where snapshot_date = '2026-09-24') = 2;
  assert (select source from metrics_snapshot_runs where snapshot_date = '2026-09-24') = 'cron';
  assert (select provider_switch from workspace_subscription_snapshots
          where workspace_id = v_ws2 and snapshot_date = '2026-09-24'), 'provider_switch stored';

  -- 2. a rerun replaces the whole day (a workspace that lost its subscription disappears)
  v_res := admin_metrics_write_snapshot('2026-09-24', 'cron', jsonb_build_array(v_row1));
  select count(*) into v_n from workspace_subscription_snapshots where snapshot_date = '2026-09-24';
  assert v_n = 1, format('rerun must replace the day, found %s rows', v_n);
  assert (select row_count from metrics_snapshot_runs where snapshot_date = '2026-09-24') = 1;

  -- 3. backfill never overwrites a cron date
  v_res := admin_metrics_write_snapshot('2026-09-24', 'backfill', jsonb_build_array(v_row2));
  assert (v_res->>'skipped')::boolean, 'backfill over a cron date must skip';
  assert (v_res->>'written')::int = 0;
  select count(*) into v_n from workspace_subscription_snapshots
    where snapshot_date = '2026-09-24' and source = 'cron';
  assert v_n = 1, 'cron rows untouched';

  -- 4. backfill on a free date writes; a second backfill replaces it
  v_res := admin_metrics_write_snapshot('2026-08-31', 'backfill', jsonb_build_array(v_row1, v_row2));
  assert (v_res->>'written')::int = 2;
  v_res := admin_metrics_write_snapshot('2026-08-31', 'backfill', jsonb_build_array(v_row1));
  select count(*) into v_n from workspace_subscription_snapshots where snapshot_date = '2026-08-31';
  assert v_n = 1, 'second backfill replaces the date';
  assert (select source from metrics_snapshot_runs where snapshot_date = '2026-08-31') = 'backfill';

  -- 5. an empty day is a legitimate close: marker with zero rows
  v_res := admin_metrics_write_snapshot('2026-07-31', 'backfill', '[]'::jsonb);
  assert (select row_count from metrics_snapshot_runs where snapshot_date = '2026-07-31') = 0;

  -- 6. cron over a backfilled date takes it over
  v_res := admin_metrics_write_snapshot('2026-08-31', 'cron', jsonb_build_array(v_row2));
  assert (select source from metrics_snapshot_runs where snapshot_date = '2026-08-31') = 'cron';
  assert (select count(*) from workspace_subscription_snapshots
          where snapshot_date = '2026-08-31' and source = 'backfill') = 0;

  -- 7. invalid source is rejected
  v_raised := false;
  begin
    perform admin_metrics_write_snapshot('2026-07-01', 'manual', '[]'::jsonb);
  exception when sqlstate '22023' then v_raised := true;
  end;
  assert v_raised, 'invalid source must raise 22023';
end $$;

-- 8. only service_role may execute
do $$
begin
  assert not has_function_privilege('anon',
    'public.admin_metrics_write_snapshot(date, text, jsonb)', 'execute'), 'anon must not execute';
  assert not has_function_privilege('authenticated',
    'public.admin_metrics_write_snapshot(date, text, jsonb)', 'execute'), 'authenticated must not execute';
  assert has_function_privilege('service_role',
    'public.admin_metrics_write_snapshot(date, text, jsonb)', 'execute'), 'service_role must execute';
end $$;
rollback;
