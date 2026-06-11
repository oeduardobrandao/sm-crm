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
