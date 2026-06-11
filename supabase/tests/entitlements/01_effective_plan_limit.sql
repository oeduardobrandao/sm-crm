\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

begin;
do $$
declare v_ws uuid; v_lim bigint;
begin
  -- 'free' plan: max_clients = 2 (per seeded catalog)
  v_ws := et_make_workspace('free');
  v_lim := effective_plan_limit(v_ws, 'max_clients');
  assert v_lim = 2, format('expected 2, got %s', v_lim);

  -- override wins
  v_ws := et_make_workspace('free', '{"max_clients": 50}'::jsonb);
  v_lim := effective_plan_limit(v_ws, 'max_clients');
  assert v_lim = 50, format('expected 50, got %s', v_lim);

  -- unlimited column (max plan has null max_clients) => NULL
  v_ws := et_make_workspace('max');
  assert effective_plan_limit(v_ws, 'max_clients') is null, 'expected NULL (unlimited)';

  -- fail-closed: unknown workspace
  assert effective_plan_limit('00000000-0000-0000-0000-000000000000', 'max_clients') = 0,
    'unknown workspace must fail closed to 0';

  raise notice 'PASS 01_effective_plan_limit';
end $$;
rollback;

do $$
declare v_n int;
begin
  select count(*) into v_n from plans where is_default;
  assert v_n = 1, format('expected exactly one is_default plan, got %s', v_n);
  raise notice 'PASS is_default invariant';
end $$;
