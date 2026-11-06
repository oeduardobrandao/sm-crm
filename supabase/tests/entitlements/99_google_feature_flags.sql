\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Suite for the Google plan flags (20261108000001_google_feature_flags.sql): plans gain
-- feature_youtube and feature_google_business, boolean NOT NULL DEFAULT false, born off on
-- every plan and turned on per workspace through workspace_plan_overrides.feature_overrides.
-- Spec: docs/superpowers/specs/2026-10-29-youtube-google-meu-negocio-design.md (section 4.5).

begin;
do $$
declare
  v_ws uuid;
  v_col text;
  v_type text;
  v_nullable text;
  v_default text;
  v_on int;
begin
  foreach v_col in array array['feature_youtube', 'feature_google_business'] loop
    select data_type, is_nullable, column_default
      into v_type, v_nullable, v_default
      from information_schema.columns
     where table_schema = 'public' and table_name = 'plans' and column_name = v_col;
    assert found, format('plans.%s should exist', v_col);
    assert v_type = 'boolean', format('plans.%s should be boolean, got %s', v_col, v_type);
    assert v_nullable = 'NO', format('plans.%s should be NOT NULL', v_col);
    assert v_default = 'false', format('plans.%s should default to false, got %s', v_col, v_default);

    execute format('select count(*) from public.plans where %I is distinct from false', v_col)
      into v_on;
    assert v_on = 0, format('plans.%s should be false on every plan, %s plan(s) differ', v_col, v_on);
  end loop;

  -- Off on the plan itself: even the top plan does not have them.
  v_ws := et_make_workspace('pro');
  assert effective_plan_feature(v_ws, 'feature_youtube') = false, 'pro should not have youtube';
  assert effective_plan_feature(v_ws, 'feature_google_business') = false,
    'pro should not have google_business';

  -- Pilot path: a feature override flips one flag on and leaves the other off.
  v_ws := et_make_workspace('pro');
  insert into workspace_plan_overrides (workspace_id, feature_overrides)
    values (v_ws, '{"feature_youtube": true}'::jsonb);
  assert effective_plan_feature(v_ws, 'feature_youtube') = true, 'override should enable youtube';
  assert effective_plan_feature(v_ws, 'feature_google_business') = false,
    'youtube override must not enable google_business';

  v_ws := et_make_workspace('free');
  insert into workspace_plan_overrides (workspace_id, feature_overrides)
    values (v_ws, '{"feature_google_business": true}'::jsonb);
  assert effective_plan_feature(v_ws, 'feature_google_business') = true,
    'override should enable google_business';
  assert effective_plan_feature(v_ws, 'feature_youtube') = false,
    'google_business override must not enable youtube';

  raise notice 'PASS 99_google_feature_flags';
end $$;
rollback;
