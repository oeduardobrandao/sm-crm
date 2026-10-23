\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Financeiro v2 rollout flag (feature_financeiro_v2, 20261027000001). The column
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

-- ============ Schema, RLS and grants (20261027000002_financeiro_v2_schema.sql) ============
-- Seven tables, SELECT-only for authenticated. A row is readable only when the
-- workspace has feature_financial AND feature_financeiro_v2 AND the caller
-- can_see_financials(); every write goes through the RPCs of later tasks.
-- The hosted default ACL is mirrored explicitly (as 99_agenda_feature_flag does)
-- so the suite proves the migration's own grants, not an environment artifact.
begin;
select et_grant_hosted_parity(array[
  'financeiro_config','financeiro_funcoes','financeiro_cliente_versoes','financeiro_acordo_versoes',
  'financeiro_atribuicoes','financeiro_entregas_manuais','financeiro_periodos']);
revoke all on public.financeiro_config, public.financeiro_funcoes, public.financeiro_cliente_versoes,
  public.financeiro_acordo_versoes, public.financeiro_atribuicoes, public.financeiro_entregas_manuais,
  public.financeiro_periodos from anon, authenticated;
grant select on public.financeiro_config, public.financeiro_funcoes, public.financeiro_cliente_versoes,
  public.financeiro_acordo_versoes, public.financeiro_atribuicoes, public.financeiro_entregas_manuais,
  public.financeiro_periodos to authenticated;
grant all on public.financeiro_config, public.financeiro_funcoes, public.financeiro_cliente_versoes,
  public.financeiro_acordo_versoes, public.financeiro_atribuicoes, public.financeiro_entregas_manuais,
  public.financeiro_periodos to service_role;

-- 'SQLSTATE:message' of the error p_sql raises as p_user (authenticated), or NULL on success
create or replace function pg_temp.erro(p_user uuid, p_sql text) returns text language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  execute p_sql;
  execute 'reset role';
  return null;
exception when others then
  execute 'reset role';
  return sqlstate || ':' || sqlerrm;
end $f$;
-- rows of p_table that p_user (authenticated) can select
create or replace function pg_temp.vistas(p_user uuid, p_table text) returns bigint language plpgsql as $f$
declare v bigint;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  execute format('select count(*) from public.%I', p_table) into v;
  execute 'reset role';
  return v;
end $f$;
-- runs p_sql as service_role; 'SQLSTATE:message' of the error, or NULL on success
create or replace function pg_temp.erro_sr(p_sql text) returns text language plpgsql as $f$
begin
  execute 'set local role service_role';
  execute p_sql;
  execute 'reset role';
  return null;
exception when others then
  execute 'reset role';
  return sqlstate || ':' || sqlerrm;
end $f$;
grant execute on all functions in schema pg_temp to authenticated, service_role;

do $$
declare
  v_tabelas constant text[] := array[
    'financeiro_config','financeiro_funcoes','financeiro_cliente_versoes','financeiro_acordo_versoes',
    'financeiro_atribuicoes','financeiro_entregas_manuais','financeiro_periodos'];
  v_t text;
  v_ws uuid; v_other uuid;
  v_owner uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_owner_b uuid := gen_random_uuid();
  v_cli bigint; v_cli_b bigint; v_mem bigint; v_mem_b bigint; v_fn bigint; v_fn_b bigint;
  v_err text; v_n bigint; v_extra text;
begin
  v_ws := et_make_workspace('max');
  v_other := et_make_workspace('max');
  insert into workspace_plan_overrides (workspace_id, feature_overrides)
    values (v_ws, '{"feature_financeiro_v2": true}'::jsonb),
           (v_other, '{"feature_financeiro_v2": true}'::jsonb);

  insert into auth.users (id) values (v_owner), (v_admin), (v_owner_b);
  insert into workspace_members (user_id, workspace_id, role) values
    (v_owner, v_ws, 'owner'), (v_admin, v_ws, 'admin'), (v_owner_b, v_other, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id in (v_owner, v_admin);
  update profiles set conta_id = v_other, active_workspace_id = v_other where id = v_owner_b;

  insert into clientes (user_id, conta_id, nome, sigla, cor, valor_mensal) values (v_owner, v_ws, 'Cliente A', 'CA', '#000', 3000)
    returning id into v_cli;
  insert into clientes (user_id, conta_id, nome, sigla, cor, valor_mensal) values (v_owner_b, v_other, 'Cliente B', 'CB', '#000', 100)
    returning id into v_cli_b;
  insert into membros (user_id, conta_id, nome, cargo, tipo, custo_mensal, avatar_url) values (v_owner, v_ws, 'Membro A', 'Designer', 'clt', 5000, '')
    returning id into v_mem;
  insert into membros (user_id, conta_id, nome, cargo, tipo, custo_mensal, avatar_url) values (v_owner_b, v_other, 'Membro B', 'Dev', 'clt', 10, '')
    returning id into v_mem_b;

  -- one row of every table in workspace A; the funcao goes in as service_role
  execute 'set local role service_role';
  insert into financeiro_funcoes (conta_id, nome, ordem) values (v_ws, 'Designer', 1) returning id into v_fn;
  insert into financeiro_funcoes (conta_id, nome, ordem) values (v_other, 'Designer', 1) returning id into v_fn_b;
  insert into financeiro_config (conta_id) values (v_ws);
  insert into financeiro_cliente_versoes (conta_id, cliente_id, vale_desde, valor_mensal, status)
    values (v_ws, v_cli, date '2026-10-01', 3000, 'ativo');
  insert into financeiro_acordo_versoes (conta_id, membro_id, vale_desde, funcao_id, modelo, valor)
    values (v_ws, v_mem, date '2026-10-01', v_fn, 'mensal_meta', 5000);
  insert into financeiro_atribuicoes (conta_id, membro_id, cliente_id, desde) values (v_ws, v_mem, v_cli, date '2026-10-01');
  insert into financeiro_entregas_manuais (conta_id, periodo_inicio, membro_id, cliente_id, quantidade)
    values (v_ws, date '2026-10-01', v_mem, v_cli, 4);
  insert into financeiro_periodos (conta_id, inicio, fim) values (v_ws, date '2026-10-01', date '2026-11-01');
  execute 'reset role';

  -- defaults of financeiro_config
  assert (select periodo_dia from financeiro_config where conta_id = v_ws) = 1, 'periodo_dia default is not 1';
  assert (select meta_margem from financeiro_config where conta_id = v_ws) = 55, 'meta_margem default is not 55';

  -- select_visible_when_allowed: owner of a workspace with both flags sees every table
  foreach v_t in array v_tabelas loop
    assert pg_temp.vistas(v_owner, v_t) = 1, format('select_visible_when_allowed: owner sees %s rows in %s', pg_temp.vistas(v_owner, v_t), v_t);
  end loop;
  raise notice 'PASS select_visible_when_allowed';

  -- tenant isolation: workspace B owner (flags on) sees none of A's rows. B owns one
  -- funcao of its own, so it reads exactly that one (A's owner above read exactly A's).
  foreach v_t in array v_tabelas loop
    assert pg_temp.vistas(v_owner_b, v_t) = (case when v_t = 'financeiro_funcoes' then 1 else 0 end),
      format('tenant leak: workspace B reads %s rows of %s', pg_temp.vistas(v_owner_b, v_t), v_t);
  end loop;
  raise notice 'PASS select_isolated_by_tenant';

  -- select_zero_rows_without_financials: flag on, but the admin lost can_see_financials
  assert pg_temp.vistas(v_admin, 'financeiro_funcoes') = 1, 'admin with can_see_financials should see the funcao';
  update workspace_members set can_see_financials = false where user_id = v_admin and workspace_id = v_ws;
  foreach v_t in array v_tabelas loop
    assert pg_temp.vistas(v_admin, v_t) = 0, format('select_zero_rows_without_financials: admin without financials reads %s', v_t);
  end loop;
  update workspace_members set can_see_financials = true where user_id = v_admin and workspace_id = v_ws;
  raise notice 'PASS select_zero_rows_without_financials';

  -- select_zero_rows_when_flag_off: override off hides everything, owner included
  update workspace_plan_overrides set feature_overrides = '{"feature_financeiro_v2": false}'::jsonb where workspace_id = v_ws;
  foreach v_t in array v_tabelas loop
    assert pg_temp.vistas(v_owner, v_t) = 0, format('select_zero_rows_when_flag_off: owner reads %s with v2 off', v_t);
  end loop;
  raise notice 'PASS select_zero_rows_when_flag_off';

  -- feature_financial off (v2 on) hides everything as well
  update workspace_plan_overrides set feature_overrides = '{"feature_financeiro_v2": true, "feature_financial": false}'::jsonb where workspace_id = v_ws;
  foreach v_t in array v_tabelas loop
    assert pg_temp.vistas(v_owner, v_t) = 0, format('owner reads %s with feature_financial off', v_t);
  end loop;
  update workspace_plan_overrides set feature_overrides = '{"feature_financeiro_v2": true}'::jsonb where workspace_id = v_ws;
  assert pg_temp.vistas(v_owner, 'financeiro_periodos') = 1, 'rows did not come back after restoring the flags';
  raise notice 'PASS select_zero_rows_when_financial_off';

  -- no_direct_insert / update / delete / truncate for authenticated
  v_err := pg_temp.erro(v_owner, format('insert into financeiro_funcoes (conta_id, nome) values (%L, %L)', v_ws, 'Hack'));
  assert v_err like '42501:%', 'no_direct_insert: expected insufficient_privilege, got ' || coalesce(v_err, 'success');
  foreach v_t in array v_tabelas loop
    v_err := pg_temp.erro(v_owner, format('update public.%I set created_at = now()', v_t));
    assert v_err like '42501:%', format('authenticated can update %s: %s', v_t, coalesce(v_err, 'success'));
    v_err := pg_temp.erro(v_owner, format('delete from public.%I', v_t));
    assert v_err like '42501:%', format('authenticated can delete from %s: %s', v_t, coalesce(v_err, 'success'));
    v_err := pg_temp.erro(v_owner, format('truncate public.%I', v_t));
    assert v_err like '42501:%', format('authenticated can truncate %s: %s', v_t, coalesce(v_err, 'success'));
  end loop;
  raise notice 'PASS no_direct_insert';

  -- grants: authenticated holds SELECT and nothing else, anon holds nothing, service_role everything
  foreach v_t in array v_tabelas loop
    select string_agg(privilege_type, ', ' order by privilege_type) into v_extra
      from information_schema.role_table_grants
     where table_schema = 'public' and table_name = v_t and grantee = 'authenticated' and privilege_type <> 'SELECT';
    assert v_extra is null, format('%s: authenticated holds more than SELECT (%s)', v_t, v_extra);
    assert exists (select 1 from information_schema.role_table_grants
                    where table_schema = 'public' and table_name = v_t and grantee = 'authenticated' and privilege_type = 'SELECT'),
      v_t || ': authenticated lost SELECT';
    assert not exists (select 1 from information_schema.role_table_grants
                        where table_schema = 'public' and table_name = v_t and grantee = 'anon'),
      v_t || ': anon holds a privilege';
    assert (select count(*) from information_schema.role_table_grants
             where table_schema = 'public' and table_name = v_t and grantee = 'service_role'
               and privilege_type in ('SELECT','INSERT','UPDATE','DELETE')) = 4,
      v_t || ': service_role lost a DML privilege';
    assert (select relrowsecurity from pg_class where oid = ('public.' || v_t)::regclass), v_t || ': RLS is off';
  end loop;
  raise notice 'PASS grants';

  -- cross_tenant_fk_rejected: a client / member / funcao of workspace B cannot be referenced from A
  v_err := pg_temp.erro_sr(format(
    'insert into financeiro_atribuicoes (conta_id, membro_id, cliente_id, desde) values (%L, %s, %s, date ''2026-10-01'')', v_ws, v_mem, v_cli_b));
  assert v_err like '23503:%', 'cross_tenant_fk_rejected (atribuicao.cliente): ' || coalesce(v_err, 'success');
  v_err := pg_temp.erro_sr(format(
    'insert into financeiro_atribuicoes (conta_id, membro_id, cliente_id, desde) values (%L, %s, %s, date ''2026-10-01'')', v_ws, v_mem_b, v_cli));
  assert v_err like '23503:%', 'cross_tenant_fk_rejected (atribuicao.membro): ' || coalesce(v_err, 'success');
  v_err := pg_temp.erro_sr(format(
    'insert into financeiro_cliente_versoes (conta_id, cliente_id, vale_desde, valor_mensal, status) values (%L, %s, date ''2026-09-01'', 1, ''ativo'')', v_ws, v_cli_b));
  assert v_err like '23503:%', 'cross_tenant_fk_rejected (cliente_versoes): ' || coalesce(v_err, 'success');
  v_err := pg_temp.erro_sr(format(
    'insert into financeiro_acordo_versoes (conta_id, membro_id, vale_desde, modelo, valor) values (%L, %s, date ''2026-09-01'', ''por_entrega'', 1)', v_ws, v_mem_b));
  assert v_err like '23503:%', 'cross_tenant_fk_rejected (acordo_versoes.membro): ' || coalesce(v_err, 'success');
  v_err := pg_temp.erro_sr(format(
    'insert into financeiro_acordo_versoes (conta_id, membro_id, vale_desde, funcao_id, modelo, valor) values (%L, %s, date ''2026-09-01'', %s, ''por_entrega'', 1)', v_ws, v_mem, v_fn_b));
  assert v_err like '23503:%', 'cross_tenant_fk_rejected (acordo_versoes.funcao): ' || coalesce(v_err, 'success');
  v_err := pg_temp.erro_sr(format(
    'insert into financeiro_entregas_manuais (conta_id, periodo_inicio, membro_id, cliente_id, quantidade) values (%L, date ''2026-09-01'', %s, %s, 1)', v_ws, v_mem, v_cli_b));
  assert v_err like '23503:%', 'cross_tenant_fk_rejected (entregas_manuais): ' || coalesce(v_err, 'success');
  raise notice 'PASS cross_tenant_fk_rejected';

  -- check constraints and uniqueness
  v_err := pg_temp.erro_sr(format('insert into financeiro_config (conta_id, periodo_dia) values (%L, 29)', v_other));
  assert v_err like '23514:%', 'periodo_dia 29 accepted: ' || coalesce(v_err, 'success');
  v_err := pg_temp.erro_sr(format('insert into financeiro_config (conta_id, periodo_dia) values (%L, 0)', v_other));
  assert v_err like '23514:%', 'periodo_dia 0 accepted: ' || coalesce(v_err, 'success');
  v_err := pg_temp.erro_sr(format('insert into financeiro_config (conta_id, meta_margem) values (%L, 101)', v_other));
  assert v_err like '23514:%', 'meta_margem 101 accepted: ' || coalesce(v_err, 'success');
  v_err := pg_temp.erro_sr(format('insert into financeiro_config (conta_id) values (%L)', v_ws));
  assert v_err like '23505:%', 'second financeiro_config row for a workspace accepted: ' || coalesce(v_err, 'success');

  v_err := pg_temp.erro_sr(format('insert into financeiro_funcoes (conta_id, nome) values (%L, %L)', v_ws, 'designer'));
  assert v_err like '23505:%', 'funcao name unique ignoring case: ' || coalesce(v_err, 'success');
  v_err := pg_temp.erro_sr(format('insert into financeiro_funcoes (conta_id, nome) values (%L, %L)', v_ws, '   '));
  assert v_err like '23514:%', 'blank funcao name accepted: ' || coalesce(v_err, 'success');
  v_err := pg_temp.erro_sr(format('insert into financeiro_funcoes (conta_id, nome) values (%L, %L)', v_ws, repeat('x', 61)));
  assert v_err like '23514:%', '61-char funcao name accepted: ' || coalesce(v_err, 'success');

  v_err := pg_temp.erro_sr(format(
    'insert into financeiro_cliente_versoes (conta_id, cliente_id, vale_desde, valor_mensal, status) values (%L, %s, date ''2026-10-01'', 1, ''ativo'')', v_ws, v_cli));
  assert v_err like '23505:%', 'duplicate (cliente, vale_desde) accepted: ' || coalesce(v_err, 'success');
  v_err := pg_temp.erro_sr(format(
    'insert into financeiro_cliente_versoes (conta_id, cliente_id, vale_desde, valor_mensal, status) values (%L, %s, date ''2026-09-01'', -1, ''ativo'')', v_ws, v_cli));
  assert v_err like '23514:%', 'negative valor_mensal accepted: ' || coalesce(v_err, 'success');
  v_err := pg_temp.erro_sr(format(
    'insert into financeiro_cliente_versoes (conta_id, cliente_id, vale_desde, valor_mensal, status) values (%L, %s, date ''2026-09-01'', 1, ''cancelado'')', v_ws, v_cli));
  assert v_err like '23514:%', 'unknown status accepted: ' || coalesce(v_err, 'success');
  v_err := pg_temp.erro_sr(format(
    'insert into financeiro_cliente_versoes (conta_id, cliente_id, vale_desde, valor_mensal, status, dia_pagamento) values (%L, %s, date ''2026-09-01'', 1, ''ativo'', 32)', v_ws, v_cli));
  assert v_err like '23514:%', 'dia_pagamento 32 accepted: ' || coalesce(v_err, 'success');

  v_err := pg_temp.erro_sr(format(
    'insert into financeiro_acordo_versoes (conta_id, membro_id, vale_desde, modelo, valor) values (%L, %s, date ''2026-10-01'', ''mensal_meta'', 1)', v_ws, v_mem));
  assert v_err like '23505:%', 'duplicate (membro, vale_desde) accepted: ' || coalesce(v_err, 'success');
  v_err := pg_temp.erro_sr(format(
    'insert into financeiro_acordo_versoes (conta_id, membro_id, vale_desde, modelo, valor) values (%L, %s, date ''2026-09-01'', ''hora'', 1)', v_ws, v_mem));
  assert v_err like '23514:%', 'unknown modelo accepted: ' || coalesce(v_err, 'success');
  v_err := pg_temp.erro_sr(format(
    'insert into financeiro_acordo_versoes (conta_id, membro_id, vale_desde, modelo, valor, meta_periodo) values (%L, %s, date ''2026-09-01'', ''por_entrega'', 1, ''ano'')', v_ws, v_mem));
  assert v_err like '23514:%', 'unknown meta_periodo accepted: ' || coalesce(v_err, 'success');
  v_err := pg_temp.erro_sr(format(
    'insert into financeiro_acordo_versoes (conta_id, membro_id, vale_desde, modelo, valor) values (%L, %s, date ''2026-09-01'', ''por_entrega'', -1)', v_ws, v_mem));
  assert v_err like '23514:%', 'negative valor accepted: ' || coalesce(v_err, 'success');
  v_err := pg_temp.erro_sr(format(
    'insert into financeiro_acordo_versoes (conta_id, membro_id, vale_desde, modelo, valor, limite_clientes) values (%L, %s, date ''2026-09-01'', ''mensal_limite'', 1, 0)', v_ws, v_mem));
  assert v_err like '23514:%', 'limite_clientes 0 accepted: ' || coalesce(v_err, 'success');
  v_err := pg_temp.erro_sr(format(
    'insert into financeiro_acordo_versoes (conta_id, membro_id, vale_desde, modelo, valor, meta_quantidade) values (%L, %s, date ''2026-09-01'', ''mensal_meta'', 1, 0)', v_ws, v_mem));
  assert v_err like '23514:%', 'meta_quantidade 0 accepted: ' || coalesce(v_err, 'success');

  v_err := pg_temp.erro_sr(format(
    'insert into financeiro_atribuicoes (conta_id, membro_id, cliente_id, desde) values (%L, %s, %s, date ''2026-11-01'')', v_ws, v_mem, v_cli));
  assert v_err like '23505:%', 'second open atribuicao for the same pair accepted: ' || coalesce(v_err, 'success');
  v_err := pg_temp.erro_sr(format(
    'insert into financeiro_atribuicoes (conta_id, membro_id, cliente_id, desde, ate) values (%L, %s, %s, date ''2026-05-10'', date ''2026-05-10'')', v_ws, v_mem, v_cli));
  assert v_err like '23514:%', 'atribuicao with ate = desde accepted: ' || coalesce(v_err, 'success');
  -- a closed atribuicao does not collide with the open one
  v_err := pg_temp.erro_sr(format(
    'insert into financeiro_atribuicoes (conta_id, membro_id, cliente_id, desde, ate) values (%L, %s, %s, date ''2026-05-01'', date ''2026-06-01'')', v_ws, v_mem, v_cli));
  assert v_err is null, 'closed atribuicao rejected: ' || coalesce(v_err, 'success');

  v_err := pg_temp.erro_sr(format(
    'insert into financeiro_entregas_manuais (conta_id, periodo_inicio, membro_id, cliente_id, quantidade) values (%L, date ''2026-10-01'', %s, %s, 9)', v_ws, v_mem, v_cli));
  assert v_err like '23505:%', 'duplicate entregas_manuais key accepted: ' || coalesce(v_err, 'success');
  v_err := pg_temp.erro_sr(format(
    'insert into financeiro_entregas_manuais (conta_id, periodo_inicio, membro_id, cliente_id, quantidade) values (%L, date ''2026-09-01'', %s, %s, -1)', v_ws, v_mem, v_cli));
  assert v_err like '23514:%', 'negative quantidade accepted: ' || coalesce(v_err, 'success');

  v_err := pg_temp.erro_sr(format('insert into financeiro_periodos (conta_id, inicio, fim) values (%L, date ''2026-11-01'', date ''2026-11-01'')', v_ws));
  assert v_err like '23514:%', 'periodo with fim = inicio accepted: ' || coalesce(v_err, 'success');
  v_err := pg_temp.erro_sr(format('insert into financeiro_periodos (conta_id, inicio, fim, status) values (%L, date ''2026-11-01'', date ''2026-12-01'', ''fechado'')', v_ws));
  assert v_err like '23514:%', 'closed periodo without snapshot accepted: ' || coalesce(v_err, 'success');
  v_err := pg_temp.erro_sr(format('insert into financeiro_periodos (conta_id, inicio, fim, status) values (%L, date ''2026-11-01'', date ''2026-12-01'', ''pendente'')', v_ws));
  assert v_err like '23514:%', 'unknown periodo status accepted: ' || coalesce(v_err, 'success');
  v_err := pg_temp.erro_sr(format('insert into financeiro_periodos (conta_id, inicio, fim, status, snapshot) values (%L, date ''2026-11-01'', date ''2026-12-01'', ''fechado'', ''{}''::jsonb)', v_ws));
  assert v_err is null, 'closed periodo with snapshot rejected: ' || coalesce(v_err, 'success');
  v_err := pg_temp.erro_sr(format('insert into financeiro_periodos (conta_id, inicio, fim) values (%L, date ''2026-10-01'', date ''2026-11-01'')', v_ws));
  assert v_err like '23505:%', 'duplicate (conta, inicio) periodo accepted: ' || coalesce(v_err, 'success');
  raise notice 'PASS constraints';

  -- ON DELETE: removing a funcao nulls only funcao_id (conta_id stays); removing a client or member cascades
  delete from financeiro_funcoes where id = v_fn;
  select count(*) into v_n from financeiro_acordo_versoes where membro_id = v_mem and funcao_id is null and conta_id = v_ws;
  assert v_n = 1, 'deleting a funcao did not null funcao_id (or nulled conta_id): ' || v_n;
  delete from clientes where id = v_cli;
  assert not exists (select 1 from financeiro_cliente_versoes where cliente_id = v_cli), 'cliente_versoes survived the client';
  assert not exists (select 1 from financeiro_atribuicoes where cliente_id = v_cli), 'atribuicoes survived the client';
  assert not exists (select 1 from financeiro_entregas_manuais where cliente_id = v_cli), 'entregas_manuais survived the client';
  delete from membros where id = v_mem;
  assert not exists (select 1 from financeiro_acordo_versoes where membro_id = v_mem), 'acordo_versoes survived the member';
  delete from workspaces where id = v_ws;
  assert not exists (select 1 from financeiro_config where conta_id = v_ws), 'config survived the workspace';
  assert not exists (select 1 from financeiro_periodos where conta_id = v_ws), 'periodos survived the workspace';
  raise notice 'PASS cascades';

  raise notice 'PASS 99_financeiro_v2_schema';
end $$;
rollback;
