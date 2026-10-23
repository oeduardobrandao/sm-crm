\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Financeiro v2 rollout flag (feature_financeiro_v2, 20261025000001). The column
-- is born false on every plan and is switched per workspace through
-- workspace_plan_overrides.feature_overrides.

begin;
do $$
declare
  v_ws uuid;
begin
  assert exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'plans' and column_name = 'feature_financeiro_v2'
                    and data_type = 'boolean' and is_nullable = 'NO' and column_default = 'false'),
    'plans.feature_financeiro_v2 is not boolean NOT NULL DEFAULT false';
  assert not exists (select 1 from plans where feature_financeiro_v2), 'a plan has feature_financeiro_v2 on by default';

  v_ws := et_make_workspace('max');
  assert not effective_plan_feature(v_ws, 'feature_financeiro_v2'), 'new workspace resolves feature_financeiro_v2 on';

  insert into workspace_plan_overrides (workspace_id, feature_overrides)
    values (v_ws, '{"feature_financeiro_v2": true}'::jsonb);
  assert effective_plan_feature(v_ws, 'feature_financeiro_v2'), 'override true did not enable feature_financeiro_v2';

  raise notice 'PASS 99_financeiro_v2_flag';
end $$;
rollback;
