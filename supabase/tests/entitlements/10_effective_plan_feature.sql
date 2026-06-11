\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql
begin;
do $$
declare v_ws uuid;
begin
  -- free.feature_leads = false (per seeded catalog)
  v_ws := et_make_workspace('free');
  assert effective_plan_feature(v_ws, 'feature_leads') = false, 'free should not have leads';
  -- pro.feature_leads = true
  v_ws := et_make_workspace('pro');
  assert effective_plan_feature(v_ws, 'feature_leads') = true, 'pro should have leads';
  -- feature_overrides flips it on for a free ws
  v_ws := et_make_workspace('free');
  insert into workspace_plan_overrides (workspace_id, feature_overrides)
    values (v_ws, '{"feature_leads": true}'::jsonb);
  assert effective_plan_feature(v_ws, 'feature_leads') = true, 'override should enable leads';
  -- fail-closed: unknown workspace
  assert effective_plan_feature('00000000-0000-0000-0000-000000000000', 'feature_leads') = false,
    'unknown ws fails closed';
  -- fail-closed: malformed override value (not true/false)
  v_ws := et_make_workspace('free');
  insert into workspace_plan_overrides (workspace_id, feature_overrides)
    values (v_ws, '{"feature_leads": "yes"}'::jsonb);
  assert effective_plan_feature(v_ws, 'feature_leads') = false, 'malformed override fails closed';
  -- fail-closed: unknown feature_key (would be undefined_column)
  v_ws := et_make_workspace('pro');
  assert effective_plan_feature(v_ws, 'feature_nonexistent') = false, 'unknown feature_key fails closed';
  raise notice 'PASS 10_effective_plan_feature';
end $$;
rollback;
