\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Desktop "Vidro" rollout flag (feature_crm_vidro, 20261017000001). Born false on
-- every plan; switched per workspace through workspace_plan_overrides.feature_overrides.

begin;
do $$
declare
  v_ws uuid;
begin
  assert exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'plans' and column_name = 'feature_crm_vidro'
                    and data_type = 'boolean' and is_nullable = 'NO' and column_default = 'false'),
    'plans.feature_crm_vidro is not boolean NOT NULL DEFAULT false';
  assert not exists (select 1 from plans where feature_crm_vidro), 'a plan has feature_crm_vidro on by default';

  v_ws := et_make_workspace('max');
  assert not effective_plan_feature(v_ws, 'feature_crm_vidro'), 'new workspace resolves feature_crm_vidro on';

  insert into workspace_plan_overrides (workspace_id, feature_overrides)
    values (v_ws, '{"feature_crm_vidro": true}'::jsonb);
  assert effective_plan_feature(v_ws, 'feature_crm_vidro'), 'override true did not enable feature_crm_vidro';

  raise notice 'PASS 99_crm_vidro_flag';
end $$;
rollback;
