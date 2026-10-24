\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Financeiro v2 service-role entry points (20261029000002_financeiro_v2_rpc_as.sql).
-- Every public v2 RPC now delegates to a service_role-only core
-- _<name>_core(p_conta, p_user, ...), and an owner-checked <name>_as(p_conta, p_user, ...)
-- calls the same core for the MCP edge function (service-role client, no user JWT).
-- _as: flags, then owner of p_conta (42501 owner_only), then the core; the caller's
-- active workspace is never read. The public RPCs' behaviour is covered, unchanged, by
-- the other 99_financeiro_v2_*.sql suites.
begin;
select et_grant_hosted_parity();

-- A max workspace with an owner (active workspace = this one). p_v2 turns on
-- feature_financeiro_v2 through the per-workspace override.
create or replace function pg_temp.novo_ws(p_v2 boolean default true) returns uuid language plpgsql as $f$
declare v_ws uuid; v_owner uuid := gen_random_uuid();
begin
  v_ws := et_make_workspace('max');
  if p_v2 then
    insert into workspace_plan_overrides (workspace_id, feature_overrides) values (v_ws, '{"feature_financeiro_v2": true}'::jsonb);
  end if;
  insert into auth.users (id) values (v_owner);
  insert into workspace_members (user_id, workspace_id, role) values (v_owner, v_ws, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_owner;
  return v_ws;
end $f$;

create or replace function pg_temp.dono(p_ws uuid) returns uuid language sql as $f$
  select user_id from workspace_members where workspace_id = p_ws and role = 'owner' limit 1
$f$;

-- A member of p_ws with workspace role p_role and financial access (an admin with
-- can_see_financials edits financeiro through the legacy role fallback).
create or replace function pg_temp.membro(p_ws uuid, p_role text) returns uuid language plpgsql as $f$
declare v_u uuid := gen_random_uuid();
begin
  insert into auth.users (id) values (v_u);
  insert into workspace_members (user_id, workspace_id, role, can_see_financials) values (v_u, p_ws, p_role, true);
  update profiles set conta_id = p_ws, active_workspace_id = p_ws where id = v_u;
  return v_u;
end $f$;

-- Run p_sql as service_role (the MCP edge function's client) and return its scalar
-- result as text. p_sub, when given, also goes into the JWT claims, so
-- get_my_conta_id() / auth.uid() would resolve to that user's active workspace: the
-- _as functions must not look at it. Raises on error.
create or replace function pg_temp.svc(p_sql text, p_sub uuid default null) returns text language plpgsql as $f$
declare v text;
begin
  perform set_config('request.jwt.claims',
    (case when p_sub is null then json_build_object('role', 'service_role')
          else json_build_object('sub', p_sub, 'role', 'service_role') end)::text, true);
  execute 'set local role service_role';
  execute p_sql into v;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return v;
exception when others then
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  raise;
end $f$;
-- Same, NULL on success, else 'SQLSTATE:message'.
create or replace function pg_temp.svc_erro(p_sql text, p_sub uuid default null) returns text language plpgsql as $f$
begin
  perform pg_temp.svc(p_sql, p_sub);
  return null;
exception when others then
  return sqlstate || ':' || sqlerrm;
end $f$;

-- ---------------------------------------------------------------------------
-- grants_service_role_only
do $$
declare v_fn text;
begin
  foreach v_fn in array array[
    'public.financeiro_config_salvar_as(uuid,uuid,int,numeric)',
    'public.financeiro_funcao_salvar_as(uuid,uuid,bigint,text,int)',
    'public.financeiro_funcao_excluir_as(uuid,uuid,bigint)',
    'public.financeiro_cliente_salvar_as(uuid,uuid,bigint,date,numeric,int,text)',
    'public.financeiro_acordo_salvar_as(uuid,uuid,bigint,date,jsonb)',
    'public.financeiro_atribuicoes_salvar_as(uuid,uuid,date,jsonb)',
    'public.financeiro_entregas_salvar_as(uuid,uuid,date,bigint,jsonb)',
    'public.financeiro_seed_as(uuid,uuid,int)',
    'public.financeiro_periodo_reabrir_as(uuid,uuid,date)',
    'public.financeiro_periodo_fechar_as(uuid,uuid,date)',
    'public.financeiro_rentabilidade_as(uuid,uuid,date)',
    'public.financeiro_periodos_listar_as(uuid,uuid)',
    'public.financeiro_periodos_editaveis_as(uuid,uuid)',
    'public._financeiro_config_salvar_core(uuid,uuid,int,numeric)',
    'public._financeiro_funcao_salvar_core(uuid,uuid,bigint,text,int)',
    'public._financeiro_funcao_excluir_core(uuid,uuid,bigint)',
    'public._financeiro_cliente_salvar_core(uuid,uuid,bigint,date,numeric,int,text)',
    'public._financeiro_acordo_salvar_core(uuid,uuid,bigint,date,jsonb)',
    'public._financeiro_atribuicoes_salvar_core(uuid,uuid,date,jsonb)',
    'public._financeiro_entregas_salvar_core(uuid,uuid,date,bigint,jsonb)',
    'public._financeiro_seed_core(uuid,uuid,int)',
    'public._financeiro_periodo_reabrir_core(uuid,uuid,date)',
    'public._financeiro_periodo_fechar_core(uuid,uuid,date)',
    'public._financeiro_rentabilidade_core(uuid,uuid,date)',
    'public._financeiro_periodos_listar_core(uuid,uuid)',
    'public._financeiro_periodos_editaveis_core(uuid,uuid)',
    'public._financeiro_exigir_dono(uuid,uuid)'] loop
    assert not has_function_privilege('authenticated', v_fn, 'EXECUTE'), v_fn || ': authenticated can execute';
    assert not has_function_privilege('anon', v_fn, 'EXECUTE'), v_fn || ': anon can execute';
    assert has_function_privilege('service_role', v_fn, 'EXECUTE'), v_fn || ': service_role cannot execute';
    assert (select p.prosecdef from pg_proc p where p.oid = v_fn::regprocedure), v_fn || ': not SECURITY DEFINER';
  end loop;
  -- the public RPCs keep their grants
  foreach v_fn in array array[
    'public.financeiro_config_salvar(int,numeric)',
    'public.financeiro_funcao_salvar(bigint,text,int)',
    'public.financeiro_funcao_excluir(bigint)',
    'public.financeiro_cliente_salvar(bigint,date,numeric,int,text)',
    'public.financeiro_acordo_salvar(bigint,date,jsonb)',
    'public.financeiro_atribuicoes_salvar(date,jsonb)',
    'public.financeiro_entregas_salvar(date,bigint,jsonb)',
    'public.financeiro_seed(int)',
    'public.financeiro_periodo_reabrir(date)',
    'public.financeiro_periodo_fechar(date)',
    'public.financeiro_rentabilidade(date)',
    'public.financeiro_periodos_listar()',
    'public.financeiro_periodos_editaveis()'] loop
    assert has_function_privilege('authenticated', v_fn, 'EXECUTE'), v_fn || ': authenticated lost execute';
    assert not has_function_privilege('anon', v_fn, 'EXECUTE'), v_fn || ': anon can execute';
    assert has_function_privilege('service_role', v_fn, 'EXECUTE'), v_fn || ': service_role lost execute';
  end loop;
  raise notice 'PASS grants_service_role_only';
end $$;

-- cores_never_read_the_jwt: no core and no _as resolves the workspace or the user from
-- the request (the MCP's service-role call has no user JWT)
do $$
declare v_fn regprocedure; v_def text;
begin
  for v_fn in
    select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and (p.proname ~ '^_financeiro_.*_core$' or p.proname ~ '^financeiro_.*_as$' or p.proname = '_financeiro_exigir_dono')
  loop
    v_def := pg_get_functiondef(v_fn);
    assert strpos(v_def, 'auth.uid()') = 0, v_fn::text || ' reads auth.uid()';
    assert strpos(v_def, 'get_my_conta_id') = 0, v_fn::text || ' reads get_my_conta_id()';
    assert strpos(v_def, 'has_permission(') = 0, v_fn::text || ' reads has_permission()';
    assert strpos(v_def, 'can_see_financials()') = 0, v_fn::text || ' reads can_see_financials()';
    assert strpos(v_def, 'financeiro_periodos_editaveis()') = 0, v_fn::text || ' calls financeiro_periodos_editaveis()';
  end loop;
  assert (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public'
             and (p.proname ~ '^_financeiro_.*_core$' or p.proname ~ '^financeiro_.*_as$')) >= 26,
    'cores_never_read_the_jwt: expected the 13 cores and 13 _as';
  raise notice 'PASS cores_never_read_the_jwt';
end $$;

-- owner_as_works: seed, a funcao and a client version through the _as entry points,
-- as service_role with no user in the JWT
do $$
declare
  v_ws uuid := pg_temp.novo_ws(); v_dono uuid; v_cli bigint; v_aberto date; v_fn text; v_ver record; r jsonb;
begin
  v_dono := pg_temp.dono(v_ws);
  r := pg_temp.svc(format('select public.financeiro_seed_as(%L, %L, 1)', v_ws, v_dono))::jsonb;
  assert r = '{"seeded": true, "ja_existia": false}'::jsonb, 'owner_as: seed ' || r::text;
  assert (select seeded_at is not null from financeiro_config where conta_id = v_ws), 'owner_as: seeded_at';
  v_fn := pg_temp.svc(format('select public.financeiro_funcao_salvar_as(%L, %L, null, %L, null)', v_ws, v_dono, 'Social media'));
  assert v_fn is not null and exists (select 1 from financeiro_funcoes where id = v_fn::bigint and conta_id = v_ws and nome = 'Social media'),
    'owner_as: funcao id ' || coalesce(v_fn, 'null');

  insert into clientes (user_id, conta_id, nome, sigla, cor, valor_mensal)
    values (v_dono, v_ws, 'Cliente A', 'CA', '#000', 1000) returning id into v_cli;
  select inicio into v_aberto from financeiro_periodos where conta_id = v_ws and status = 'aberto';
  perform pg_temp.svc(format('select public.financeiro_cliente_salvar_as(%L, %L, %s, %L, 1800, 12, %L)',
    v_ws, v_dono, v_cli, v_aberto, 'ativo'));
  select * into v_ver from financeiro_cliente_versoes where cliente_id = v_cli and vale_desde = v_aberto;
  assert v_ver.valor_mensal = 1800 and v_ver.dia_pagamento = 12 and v_ver.created_by = v_dono,
    'owner_as: cliente version ' || row_to_json(v_ver)::text;
  assert (select valor_mensal from clientes where id = v_cli) = 1800, 'owner_as: legacy write-through';

  r := pg_temp.svc(format('select public.financeiro_periodos_listar_as(%L, %L)', v_ws, v_dono))::jsonb;
  assert jsonb_array_length(r) = 1, 'owner_as: periodos_listar ' || r::text;
  raise notice 'PASS owner_as_works';
end $$;

-- admin_as_denied: an admin (financeiro: editar through the role) is not the owner
do $$
declare v_ws uuid := pg_temp.novo_ws(); v_admin uuid; v_err text;
begin
  v_admin := pg_temp.membro(v_ws, 'admin');
  assert public.has_permission_for(v_admin, v_ws, 'financeiro', 'editar'), 'admin_as: fixture admin edits financeiro';
  v_err := pg_temp.svc_erro(format('select public.financeiro_config_salvar_as(%L, %L, 5, 60)', v_ws, v_admin));
  assert v_err = '42501:owner_only', 'admin_as: config_salvar_as ' || coalesce(v_err, 'success');
  v_err := pg_temp.svc_erro(format('select public.financeiro_seed_as(%L, %L, 1)', v_ws, v_admin));
  assert v_err = '42501:owner_only', 'admin_as: seed_as ' || coalesce(v_err, 'success');
  v_err := pg_temp.svc_erro(format('select public.financeiro_rentabilidade_as(%L, %L)', v_ws, v_admin));
  assert v_err = '42501:owner_only', 'admin_as: rentabilidade_as ' || coalesce(v_err, 'success');
  -- an owner of another workspace is not the owner of this one either
  v_err := pg_temp.svc_erro(format('select public.financeiro_periodos_editaveis_as(%L, %L)', v_ws, pg_temp.dono(pg_temp.novo_ws())));
  assert v_err = '42501:owner_only', 'admin_as: foreign owner ' || coalesce(v_err, 'success');
  assert not exists (select 1 from financeiro_config where conta_id = v_ws), 'admin_as: nothing written';
  raise notice 'PASS admin_as_denied';
end $$;

-- rpc_as_ignores_active_workspace: owner of A and B, active workspace B; writes for A land in A
do $$
declare v_a uuid := pg_temp.novo_ws(); v_b uuid := pg_temp.novo_ws(); v_dono uuid; v_fn text;
begin
  v_dono := pg_temp.dono(v_a);
  delete from workspace_members where workspace_id = v_b;
  insert into workspace_members (user_id, workspace_id, role) values (v_dono, v_b, 'owner');
  update profiles set active_workspace_id = v_b where id = v_dono;
  perform set_config('request.jwt.claims', json_build_object('sub', v_dono, 'role', 'authenticated')::text, true);
  assert public.get_my_conta_id() = v_b, 'ignores_active: fixture active workspace is B';
  perform set_config('request.jwt.claims', '', true);

  perform pg_temp.svc(format('select public.financeiro_seed_as(%L, %L, 1)', v_a, v_dono), v_dono);
  v_fn := pg_temp.svc(format('select public.financeiro_funcao_salvar_as(%L, %L, null, %L, null)', v_a, v_dono, 'Tráfego'), v_dono);
  assert (select conta_id from financeiro_funcoes where id = v_fn::bigint) = v_a, 'ignores_active: funcao in A';
  assert not exists (select 1 from financeiro_funcoes where conta_id = v_b), 'ignores_active: nothing in B';
  assert not exists (select 1 from financeiro_config where conta_id = v_b), 'ignores_active: B not seeded';
  raise notice 'PASS rpc_as_ignores_active_workspace';
end $$;

-- flags_before_owner: without feature_financeiro_v2 (or feature_financial) a non-owner
-- gets the flag error, not owner_only
do $$
declare v_ws uuid := pg_temp.novo_ws(false); v_fin uuid := pg_temp.novo_ws(); v_admin uuid; v_err text;
begin
  v_admin := pg_temp.membro(v_ws, 'admin');
  v_err := pg_temp.svc_erro(format('select public.financeiro_config_salvar_as(%L, %L, 5, 60)', v_ws, v_admin));
  assert v_err = 'P0001:feature_disabled:feature_financeiro_v2', 'flags_before_owner: ' || coalesce(v_err, 'success');
  v_err := pg_temp.svc_erro(format('select public.financeiro_rentabilidade_as(%L, %L)', v_ws, v_admin));
  assert v_err = 'P0001:feature_disabled:feature_financeiro_v2', 'flags_before_owner: rentabilidade ' || coalesce(v_err, 'success');
  -- feature_financial off (v2 on): checked first
  update workspace_plan_overrides set feature_overrides = '{"feature_financeiro_v2": true, "feature_financial": false}'::jsonb
   where workspace_id = v_fin;
  v_admin := pg_temp.membro(v_fin, 'admin');
  v_err := pg_temp.svc_erro(format('select public.financeiro_config_salvar_as(%L, %L, 5, 60)', v_fin, v_admin));
  assert v_err = 'P0001:feature_disabled:feature_financial', 'flags_before_owner: financial ' || coalesce(v_err, 'success');
  v_err := pg_temp.svc_erro(format('select public.financeiro_seed_as(%L, %L, 1)', v_fin, pg_temp.dono(v_fin)));
  assert v_err = 'P0001:feature_disabled:feature_financial', 'flags_before_owner: financial owner ' || coalesce(v_err, 'success');
  raise notice 'PASS flags_before_owner';
end $$;

-- reabrir_as_unseeded: the core keeps nao_configurado on the _as path
do $$
declare v_ws uuid := pg_temp.novo_ws(); v_err text;
begin
  v_err := pg_temp.svc_erro(format('select public.financeiro_periodo_reabrir_as(%L, %L, %L)', v_ws, pg_temp.dono(v_ws), '2026-10-01'));
  assert v_err = 'P0001:nao_configurado', 'reabrir_as_unseeded: ' || coalesce(v_err, 'success');
  v_err := pg_temp.svc_erro(format('select public.financeiro_periodo_fechar_as(%L, %L, %L)', v_ws, pg_temp.dono(v_ws), '2026-10-01'));
  assert v_err = 'P0001:nao_configurado', 'reabrir_as_unseeded: fechar ' || coalesce(v_err, 'success');
  raise notice 'PASS reabrir_as_unseeded';
end $$;

-- reabrir_audit_actor: reopen then re-close a closed period; the audit rows name the owner
do $$
declare v_ws uuid := pg_temp.novo_ws(); v_dono uuid; v_status text;
begin
  v_dono := pg_temp.dono(v_ws);
  perform pg_temp.svc(format('select public.financeiro_seed_as(%L, %L, 1)', v_ws, v_dono));
  insert into financeiro_periodos (conta_id, inicio, fim, status, snapshot, fechado_em)
    values (v_ws, date '2020-01-01', date '2020-02-01', 'fechado', '{"periodo": {"status": "fechado"}}'::jsonb, now());

  perform pg_temp.svc(format('select public.financeiro_periodo_reabrir_as(%L, %L, %L)', v_ws, v_dono, '2020-01-01'));
  select status into v_status from financeiro_periodos where conta_id = v_ws and inicio = date '2020-01-01';
  assert v_status = 'reaberto', 'reabrir_audit: reaberto ' || coalesce(v_status, 'null');
  perform pg_temp.svc(format('select public.financeiro_periodo_fechar_as(%L, %L, %L)', v_ws, v_dono, '2020-01-01'));
  select status into v_status from financeiro_periodos where conta_id = v_ws and inicio = date '2020-01-01';
  assert v_status = 'fechado', 'reabrir_audit: fechado again ' || coalesce(v_status, 'null');

  assert (select count(*) from audit_log where conta_id = v_ws and action = 'financeiro-periodo-reabrir'
            and resource_id = '2020-01-01' and actor_user_id = v_dono) = 1, 'reabrir_audit: reabrir actor';
  assert (select count(*) from audit_log where conta_id = v_ws and action = 'financeiro-periodo-fechar'
            and resource_id = '2020-01-01' and actor_user_id = v_dono) = 1, 'reabrir_audit: fechar actor';
  raise notice 'PASS reabrir_audit_actor';
end $$;

-- rentabilidade_as_explicit_period: A's numbers while the active workspace is B (unseeded)
do $$
declare
  v_a uuid := pg_temp.novo_ws(); v_b uuid := pg_temp.novo_ws(); v_dono uuid; v_ed jsonb; v_inicio date; r jsonb; v_err text;
begin
  v_dono := pg_temp.dono(v_a);
  delete from workspace_members where workspace_id = v_b;
  insert into workspace_members (user_id, workspace_id, role) values (v_dono, v_b, 'owner');
  update profiles set active_workspace_id = v_b where id = v_dono;

  perform pg_temp.svc(format('select public.financeiro_seed_as(%L, %L, 1)', v_a, v_dono), v_dono);
  v_ed := pg_temp.svc(format('select public.financeiro_periodos_editaveis_as(%L, %L)', v_a, v_dono), v_dono)::jsonb;
  -- the last editable start is a projected one (no period row): the nested editable check runs
  v_inicio := (v_ed->(jsonb_array_length(v_ed) - 1)->>'inicio')::date;
  assert not exists (select 1 from financeiro_periodos where conta_id = v_a and inicio = v_inicio),
    'rentabilidade_as: fixture start is projected ' || v_ed::text;
  r := pg_temp.svc(format('select public.financeiro_rentabilidade_as(%L, %L, %L)', v_a, v_dono, v_inicio), v_dono)::jsonb;
  assert (r->'seeded') = 'true'::jsonb and (r->'periodo'->>'inicio')::date = v_inicio,
    'rentabilidade_as: A computed ' || left(r::text, 200);
  -- the same call through the public RPC sees B, which is not seeded
  perform set_config('request.jwt.claims', json_build_object('sub', v_dono, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  r := public.financeiro_rentabilidade(null);
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  assert r = '{"seeded": false}'::jsonb, 'rentabilidade_as: public reads the active workspace ' || r::text;
  v_err := pg_temp.svc_erro(format('select public.financeiro_rentabilidade_as(%L, %L, %L)', v_a, v_dono, '1999-01-01'), v_dono);
  assert v_err = 'P0001:periodo_invalido', 'rentabilidade_as: unknown start ' || coalesce(v_err, 'success');
  raise notice 'PASS rentabilidade_as_explicit_period';
end $$;

rollback;
