\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Hub "Pauta" rollout flag (feature_hub_pauta, 20261012000001). The column is
-- born false on every plan and is switched per workspace through
-- workspace_plan_overrides.feature_overrides. The same migration widens the
-- hub_font_* CHECKs with the "Assinatura" pair (bricolage-grotesque / figtree).

begin;
do $$
declare
  v_ws uuid;
  v_ok boolean;
begin
  assert exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'plans' and column_name = 'feature_hub_pauta'
                    and data_type = 'boolean' and is_nullable = 'NO' and column_default = 'false'),
    'plans.feature_hub_pauta is not boolean NOT NULL DEFAULT false';
  assert not exists (select 1 from plans where feature_hub_pauta), 'a plan has feature_hub_pauta on by default';

  v_ws := et_make_workspace('max');
  assert not effective_plan_feature(v_ws, 'feature_hub_pauta'), 'new workspace resolves feature_hub_pauta on';

  insert into workspace_plan_overrides (workspace_id, feature_overrides)
    values (v_ws, '{"feature_hub_pauta": true}'::jsonb);
  assert effective_plan_feature(v_ws, 'feature_hub_pauta'), 'override true did not enable feature_hub_pauta';

  -- the new ids are accepted
  update workspaces set hub_font_display = 'bricolage-grotesque', hub_font_body = 'figtree' where id = v_ws;
  assert (select hub_font_display = 'bricolage-grotesque' and hub_font_body = 'figtree' from workspaces where id = v_ws),
    'Assinatura ids were not stored';

  -- the old ids still are
  update workspaces set hub_font_display = 'fraunces', hub_font_body = 'instrument-sans' where id = v_ws;

  -- an unknown id is refused on each column
  v_ok := false;
  begin
    update workspaces set hub_font_display = 'comic-sans' where id = v_ws;
  exception when check_violation then v_ok := true;
  end;
  assert v_ok, 'unknown display font accepted';

  v_ok := false;
  begin
    update workspaces set hub_font_body = 'comic-sans' where id = v_ws;
  exception when check_violation then v_ok := true;
  end;
  assert v_ok, 'unknown body font accepted';

  raise notice 'PASS 99_hub_pauta_flag';
end $$;
rollback;
