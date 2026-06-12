\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql
begin;
do $$
declare v_ws uuid; v_uid uuid := gen_random_uuid(); v_cli bigint; v_blocked boolean := false;
begin
  -- free.feature_ideas = false. ideias NOT NULLs: workspace_id, cliente_id, titulo, descricao.
  v_ws := et_make_workspace('free');
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_uid, v_ws, 'C', 'C', '#000') returning id into v_cli;
  begin
    insert into ideias (workspace_id, cliente_id, titulo, descricao) values (v_ws, v_cli, 'I1', 'd');
  exception when sqlstate 'P0001' then
    assert sqlerrm like 'feature_disabled:feature_ideas%', format('wrong msg: %s', sqlerrm);
    v_blocked := true;
  end;
  assert v_blocked, 'ideias insert must block when feature off';

  -- pro.feature_ideas = true => allowed
  v_ws := et_make_workspace('pro');
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_uid, v_ws, 'C2', 'C2', '#000') returning id into v_cli;
  insert into ideias (workspace_id, cliente_id, titulo, descricao) values (v_ws, v_cli, 'OK', 'd');
  raise notice 'PASS 11_feature_triggers';
end $$;
rollback;

begin;
do $$
declare v_ws uuid; v_uid uuid := gen_random_uuid(); v_cli bigint; v_blocked boolean := false;
begin
  -- brand insert blocked on free (feature_brand_customization=false), scoped via clientes
  v_ws := et_make_workspace('free');
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (v_uid, v_ws, 'C', 'C', '#000') returning id into v_cli;
  begin
    insert into hub_brand (cliente_id) values (v_cli);
  exception when sqlstate 'P0001' then v_blocked := true; end;
  assert v_blocked, 'brand insert must block on free';
  raise notice 'PASS 11 brand';
end $$;
rollback;

-- 6. transacoes feature_financial: blocked on free, allowed on pro.
begin;
do $$
declare v_ws uuid; v_uid uuid := gen_random_uuid(); v_blocked boolean := false;
begin
  -- free.feature_financial = false
  v_ws := et_make_workspace('free');
  begin
    insert into transacoes (user_id, conta_id, data, tipo, valor)
      values (v_uid, v_ws, '2026-01-01', 'entrada', 100);
  exception when sqlstate 'P0001' then
    assert sqlerrm like 'feature_disabled:feature_financial%', format('wrong msg: %s', sqlerrm);
    v_blocked := true;
  end;
  assert v_blocked, 'transacoes insert must block on free';

  -- pro.feature_financial = true => allowed
  v_ws := et_make_workspace('pro');
  insert into transacoes (user_id, conta_id, data, tipo, valor)
    values (v_uid, v_ws, '2026-01-01', 'entrada', 100);
  raise notice 'PASS 11 transacoes feature_financial';
end $$;
rollback;

-- 7. contratos feature_contracts: blocked on free, allowed on start.
begin;
do $$
declare v_ws uuid; v_uid uuid := gen_random_uuid(); v_blocked boolean := false;
begin
  -- free.feature_contracts = false
  v_ws := et_make_workspace('free');
  begin
    insert into contratos (user_id, conta_id, titulo, data_inicio, data_fim, valor_total)
      values (v_uid, v_ws, 'Ct1', '2026-01-01', '2026-12-31', 1000);
  exception when sqlstate 'P0001' then
    assert sqlerrm like 'feature_disabled:feature_contracts%', format('wrong msg: %s', sqlerrm);
    v_blocked := true;
  end;
  assert v_blocked, 'contratos insert must block on free';

  -- start.feature_contracts = true => allowed
  v_ws := et_make_workspace('start');
  insert into contratos (user_id, conta_id, titulo, data_inicio, data_fim, valor_total)
    values (v_uid, v_ws, 'Ct1', '2026-01-01', '2026-12-31', 1000);
  raise notice 'PASS 11 contratos feature_contracts';
end $$;
rollback;

-- 8. client_hub_tokens feature_hub_portal: blocked on free.
--    free has feature_hub_portal OFF; this is the FEATURE gate (distinct from the count
--    test in 05, which runs on start where the feature is enabled).
begin;
do $$
declare v_ws uuid; v_uid uuid := gen_random_uuid(); v_cli bigint; v_blocked boolean := false;
begin
  v_ws := et_make_workspace('free');
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_uid, v_ws, 'C', 'C', '#000') returning id into v_cli;
  begin
    insert into client_hub_tokens (cliente_id, conta_id) values (v_cli, v_ws);
  exception when sqlstate 'P0001' then
    assert sqlerrm like 'feature_disabled:feature_hub_portal%', format('wrong msg: %s', sqlerrm);
    v_blocked := true;
  end;
  assert v_blocked, 'hub token insert must block on free (feature off)';
  raise notice 'PASS 11 client_hub_tokens feature_hub_portal';
end $$;
rollback;

-- 9. template_property_definitions feature_custom_properties: blocked on free.
begin;
do $$
declare v_ws uuid; v_uid uuid := gen_random_uuid(); v_tpl bigint; v_blocked boolean := false;
begin
  insert into auth.users (id) values (v_uid); -- workflow_templates.user_id FK -> auth.users
  v_ws := et_make_workspace('free'); -- feature_custom_properties = false
  insert into workflow_templates (user_id, conta_id, nome) values (v_uid, v_ws, 'TPL') returning id into v_tpl;
  begin
    insert into template_property_definitions (template_id, conta_id, name, type)
      values (v_tpl, v_ws, 'P1', 'text');
  exception when sqlstate 'P0001' then
    assert sqlerrm like 'feature_disabled:feature_custom_properties%', format('wrong msg: %s', sqlerrm);
    v_blocked := true;
  end;
  assert v_blocked, 'custom property insert must block on free (feature off)';
  raise notice 'PASS 11 template_property_definitions feature_custom_properties';
end $$;
rollback;
