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

  -- SEATS: max_team_members = base + purchased_seats (status-gated).
  -- starter base max_team_members = 2.
  v_ws := et_make_workspace('starter');
  -- no subscription row => +0
  v_lim := effective_plan_limit(v_ws, 'max_team_members');
  assert v_lim = 2, format('starter no-sub seats expected 2, got %s', v_lim);

  -- active sub with 1 purchased seat => 2 + 1 = 3
  v_ws := et_make_workspace('starter');
  perform et_seed_subscription(v_ws, 1, 'active');
  v_lim := effective_plan_limit(v_ws, 'max_team_members');
  assert v_lim = 3, format('starter +1 active seat expected 3, got %s', v_lim);

  -- trialing also adds
  v_ws := et_make_workspace('starter');
  perform et_seed_subscription(v_ws, 2, 'trialing');
  v_lim := effective_plan_limit(v_ws, 'max_team_members');
  assert v_lim = 4, format('starter +2 trialing seats expected 4, got %s', v_lim);

  -- canceled status => seats NOT added (billing-bypass guard)
  v_ws := et_make_workspace('starter');
  perform et_seed_subscription(v_ws, 5, 'canceled');
  v_lim := effective_plan_limit(v_ws, 'max_team_members');
  assert v_lim = 2, format('starter canceled seats must not add (expected 2), got %s', v_lim);

  -- NULL base via explicit null admin override => unlimited, never base+seats.
  v_ws := et_make_workspace('starter', '{"max_team_members": null}'::jsonb);
  perform et_seed_subscription(v_ws, 4, 'active');
  assert effective_plan_limit(v_ws, 'max_team_members') is null,
    'NULL base (override) must stay unlimited, never base+seats';

  -- admin numeric override (comp) returns OUTRIGHT, seats NOT stacked.
  v_ws := et_make_workspace('starter', '{"max_team_members": 8}'::jsonb);
  perform et_seed_subscription(v_ws, 4, 'active');
  v_lim := effective_plan_limit(v_ws, 'max_team_members');
  assert v_lim = 8, format('comp override must win outright (expected 8, no seat add), got %s', v_lim);

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

begin;
do $$
declare v_ws uuid;
begin
  -- malformed override value must fail closed (not throw)
  v_ws := et_make_workspace('free', '{"max_clients": "fifty"}'::jsonb);
  assert effective_plan_limit(v_ws, 'max_clients') = 0, 'malformed override must fail closed';
  -- unknown limit_key must fail closed (not throw)
  v_ws := et_make_workspace('free');
  assert effective_plan_limit(v_ws, 'nonexistent_column') = 0, 'unknown limit_key must fail closed';
  raise notice 'PASS 01 fail-closed edges';
end $$;
rollback;
