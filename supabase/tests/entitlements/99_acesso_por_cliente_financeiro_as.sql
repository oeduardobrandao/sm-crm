\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Acesso por cliente, Financeiro do MCP (20261115000010_acesso_por_cliente_g_financeiro_as.sql):
-- the financeiro_*_as RPCs (service_role, p_user = the actor) apply the same client scope as
-- their authenticated twins, judged for p_user in p_conta:
--   * rentabilidade_as: only the actor's clients (owner / todos: unchanged; no membership:
--     zero clients, never all);
--   * writers: a row of a client the actor can't access, or a row with no client, refused
--     with client_scope_restricted.
-- Today _financeiro_exigir_dono runs first (financeiro:* is owner-only and an owner is never
-- restricted), so callers see no change: case `owner_only_precedence_unchanged`. The scope
-- cases replace _financeiro_exigir_dono with a no-op inside this transaction (rolled back),
-- standing in for a future loosening of the owner rule.

begin;
select et_grant_hosted_parity(array['workspace_member_clientes']);

create or replace function pg_temp.svc(p_sql text) returns text language plpgsql as $f$
declare v text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
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
create or replace function pg_temp.svc_erro(p_sql text) returns text language plpgsql as $f$
begin
  perform pg_temp.svc(p_sql);
  return null;
exception when others then
  return sqlerrm;
end $f$;

-- fixture: clients A 2000, B 3000; M1 mensal 1000 on A and B; M2 mensal 900 on B
do $$
declare
  v_ws uuid := et_make_workspace('max');
  v_other uuid := et_make_workspace('max');
  v_owner uuid := gen_random_uuid();
  v_todos uuid := gen_random_uuid();
  v_restr uuid := gen_random_uuid();
  v_stranger uuid := gen_random_uuid();
  v_ca bigint; v_cb bigint; v_f1 bigint; v_m1 bigint; v_m2 bigint;
begin
  insert into workspace_plan_overrides (workspace_id, feature_overrides) values (v_ws, '{"feature_financeiro_v2": true}'::jsonb);
  insert into auth.users (id, email) values
    (v_owner, 'owner@acfinas.test'), (v_todos, 'todos@acfinas.test'), (v_restr, 'restr@acfinas.test'),
    (v_stranger, 'stranger@acfinas.test');
  insert into workspace_members (user_id, workspace_id, role) values
    (v_owner, v_ws, 'owner'), (v_todos, v_ws, 'agent'), (v_restr, v_ws, 'agent'), (v_stranger, v_other, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id in (v_owner, v_todos, v_restr);
  update profiles set conta_id = v_other, active_workspace_id = v_other where id = v_stranger;

  insert into clientes (user_id, conta_id, nome, sigla, cor, status, valor_mensal, data_pagamento) values (v_owner, v_ws, 'A', 'A', '#111', 'ativo', 2000, 5) returning id into v_ca;
  insert into clientes (user_id, conta_id, nome, sigla, cor, status, valor_mensal) values (v_owner, v_ws, 'B', 'B', '#222', 'ativo', 3000) returning id into v_cb;
  update workspace_members set client_scope = 'atribuidos' where workspace_id = v_ws and user_id = v_restr;
  insert into workspace_member_clientes (workspace_id, user_id, cliente_id) values (v_ws, v_restr, v_ca);

  insert into financeiro_funcoes (conta_id, nome, ordem) values (v_ws, 'Video', 0) returning id into v_f1;
  insert into membros (user_id, conta_id, nome, cargo, tipo, custo_mensal, avatar_url) values (v_owner, v_ws, 'M1', 'Video', 'clt', 1000, '') returning id into v_m1;
  insert into membros (user_id, conta_id, nome, cargo, tipo, custo_mensal, avatar_url) values (v_owner, v_ws, 'M2', 'Video', 'clt', 900, '') returning id into v_m2;
  insert into financeiro_cliente_versoes (conta_id, cliente_id, vale_desde, valor_mensal, status) values
    (v_ws, v_ca, date '2026-10-01', 2000, 'ativo'), (v_ws, v_cb, date '2026-10-01', 3000, 'ativo');
  insert into financeiro_acordo_versoes (conta_id, membro_id, vale_desde, funcao_id, modelo, valor) values
    (v_ws, v_m1, date '2026-10-01', v_f1, 'mensal_meta', 1000), (v_ws, v_m2, date '2026-10-01', v_f1, 'mensal_meta', 900);
  insert into financeiro_atribuicoes (conta_id, membro_id, cliente_id, desde) values
    (v_ws, v_m1, v_ca, date '2026-10-01'), (v_ws, v_m1, v_cb, date '2026-10-01'), (v_ws, v_m2, v_cb, date '2026-10-01');
  insert into financeiro_periodos (conta_id, inicio, fim) values (v_ws, date '2026-10-01', date '2026-11-01');
  insert into financeiro_config (conta_id, seeded_at) values (v_ws, now());
end $$;

-- actor helpers
do $$
declare
  v_ws uuid := (select active_workspace_id from profiles where id = (select id from auth.users where email = 'owner@acfinas.test'));
  v_ca bigint := (select id from clientes where conta_id = v_ws and nome = 'A');
begin
  assert public.actor_cliente_ids((select id from auth.users where email = 'owner@acfinas.test'), v_ws) is null, 'actor ids: owner = all';
  assert public.actor_cliente_ids((select id from auth.users where email = 'todos@acfinas.test'), v_ws) is null, 'actor ids: todos = all';
  assert public.actor_cliente_ids((select id from auth.users where email = 'restr@acfinas.test'), v_ws) = array[v_ca], 'actor ids: restricted = his';
  assert public.actor_cliente_ids((select id from auth.users where email = 'stranger@acfinas.test'), v_ws) = '{}'::bigint[], 'actor ids: no membership = none, never all';
  assert public.actor_cliente_ids(null, v_ws) = '{}'::bigint[], 'actor ids: NULL user = none';
  assert not public.actor_client_scope_all(null, v_ws), 'actor scope: NULL user is not all';
  raise notice 'PASS actor helpers';
end $$;

-- owner_only_precedence_unchanged: a non-owner still gets owner_only first; the owner reads
-- and writes every client as before
do $$
declare
  v_ws uuid := (select active_workspace_id from profiles where id = (select id from auth.users where email = 'owner@acfinas.test'));
  v_owner uuid := (select id from auth.users where email = 'owner@acfinas.test');
  v_restr uuid := (select id from auth.users where email = 'restr@acfinas.test');
  v_cb bigint := (select id from clientes where conta_id = v_ws and nome = 'B');
  v_err text;
begin
  v_err := pg_temp.svc_erro(format('select financeiro_cliente_salvar_as(%L, %L, %s, ''2026-10-01'', 3100, 5, ''ativo'')', v_ws, v_restr, v_cb));
  assert v_err = 'owner_only', 'owner_only_precedence_unchanged (writer): ' || coalesce(v_err, 'saved');
  v_err := pg_temp.svc_erro(format('select financeiro_rentabilidade_as(%L, %L, ''2026-10-01'')', v_ws, v_restr));
  assert v_err = 'owner_only', 'owner_only_precedence_unchanged (reader): ' || coalesce(v_err, 'read');
  assert pg_temp.svc(format('select financeiro_rentabilidade_as(%L, %L, ''2026-10-01'')', v_ws, v_owner))::jsonb
         = public._financeiro_calcular(v_ws, date '2026-10-01'), 'owner_rentabilidade_as_unchanged';
  v_err := pg_temp.svc_erro(format('select financeiro_cliente_salvar_as(%L, %L, %s, ''2026-10-01'', 3100, 5, ''ativo'')', v_ws, v_owner, v_cb));
  assert v_err is null, 'owner_save_any_client_ok: ' || coalesce(v_err, '');
  raise notice 'PASS owner_only precedence';
end $$;

-- the owner rule loosened (stand-in): the scope check behind it
create or replace function public._financeiro_exigir_dono(p_conta uuid, p_user uuid)
returns void language plpgsql stable security definer set search_path = public as $f$ begin end $f$;

do $$
declare
  v_ws uuid := (select active_workspace_id from profiles where id = (select id from auth.users where email = 'owner@acfinas.test'));
  v_todos uuid := (select id from auth.users where email = 'todos@acfinas.test');
  v_restr uuid := (select id from auth.users where email = 'restr@acfinas.test');
  v_stranger uuid := (select id from auth.users where email = 'stranger@acfinas.test');
  v_ca bigint := (select id from clientes where conta_id = v_ws and nome = 'A');
  v_cb bigint := (select id from clientes where conta_id = v_ws and nome = 'B');
  v_m1 bigint := (select id from membros where conta_id = v_ws and nome = 'M1');
  v_f1 bigint := (select id from financeiro_funcoes where conta_id = v_ws and nome = 'Video');
  v_err text; v_sql text; v_r jsonb;
begin
  -- readers
  v_r := pg_temp.svc(format('select financeiro_rentabilidade_as(%L, %L, ''2026-10-01'')', v_ws, v_restr))::jsonb;
  assert jsonb_array_length(v_r->'clientes') = 1 and (v_r->'clientes'->0->>'cliente_id')::bigint = v_ca
     and (v_r->'totais'->>'receita')::numeric = 2000 and (v_r->'totais'->>'custo_total')::numeric = 500,
    'restricted_actor_rentabilidade_only_assigned: ' || (v_r->'totais')::text;
  v_r := pg_temp.svc(format('select financeiro_rentabilidade_as(%L, %L, ''2026-10-01'')', v_ws, v_stranger))::jsonb;
  assert v_r->'clientes' = '[]'::jsonb and (v_r->'totais'->>'receita')::numeric = 0,
    'non_member_actor_sees_no_client: ' || (v_r->'totais')::text;
  v_r := pg_temp.svc(format('select financeiro_rentabilidade_as(%L, %L, ''2026-10-01'')', v_ws, v_todos))::jsonb;
  assert v_r = public._financeiro_calcular(v_ws, date '2026-10-01'), 'todos_actor_rentabilidade_unchanged';

  -- writers with a client
  v_err := pg_temp.svc_erro(format('select financeiro_cliente_salvar_as(%L, %L, %s, ''2026-10-01'', 3100, 5, ''ativo'')', v_ws, v_restr, v_cb));
  assert v_err = 'client_scope_restricted', 'restricted_actor_save_hidden_client_denied: ' || coalesce(v_err, 'saved');
  v_err := pg_temp.svc_erro(format('select financeiro_cliente_salvar_as(%L, %L, %s, ''2026-10-01'', 2100, 5, ''ativo'')', v_ws, v_restr, v_ca));
  assert v_err is null, 'restricted_actor_save_assigned_ok: ' || coalesce(v_err, '');
  v_err := pg_temp.svc_erro(format('select financeiro_cliente_salvar_as(%L, %L, %s, ''2026-10-01'', 2100, 5, ''ativo'')', v_ws, v_stranger, v_ca));
  assert v_err = 'client_scope_restricted', 'non_member_actor_save_denied: ' || coalesce(v_err, 'saved');
  v_err := pg_temp.svc_erro(format('select financeiro_atribuicoes_salvar_as(%L, %L, ''2026-10-01'', %L::jsonb)', v_ws, v_restr,
    jsonb_build_array(jsonb_build_object('membro_id', v_m1, 'cliente_id', v_cb, 'ativo', false))));
  assert v_err = 'client_scope_restricted', 'restricted_actor_atribuicoes_hidden_denied: ' || coalesce(v_err, 'saved');
  v_err := pg_temp.svc_erro(format('select financeiro_atribuicoes_salvar_as(%L, %L, ''2026-10-01'', %L::jsonb)', v_ws, v_restr,
    jsonb_build_array(jsonb_build_object('membro_id', v_m1, 'cliente_id', v_ca, 'ativo', true))));
  assert v_err is null, 'restricted_actor_atribuicoes_assigned_ok: ' || coalesce(v_err, '');
  v_err := pg_temp.svc_erro(format('select financeiro_entregas_salvar_as(%L, %L, ''2026-10-01'', %s, %L::jsonb)', v_ws, v_restr, v_m1,
    jsonb_build_array(jsonb_build_object('cliente_id', v_cb, 'quantidade', null))));
  assert v_err = 'client_scope_restricted', 'restricted_actor_entregas_hidden_denied: ' || coalesce(v_err, 'saved');

  -- writers with no client
  foreach v_sql in array array[
    format('select financeiro_acordo_salvar_as(%L, %L, %s, ''2026-10-01'', ''{"modelo":"mensal_meta","valor":1}''::jsonb)', v_ws, v_restr, v_m1),
    format('select financeiro_config_salvar_as(%L, %L, null, 60)', v_ws, v_restr),
    format('select financeiro_funcao_salvar_as(%L, %L, null, ''Nova'', null)', v_ws, v_restr),
    format('select financeiro_funcao_excluir_as(%L, %L, %s)', v_ws, v_restr, v_f1),
    format('select financeiro_seed_as(%L, %L, 1)', v_ws, v_restr),
    format('select financeiro_periodo_fechar_as(%L, %L, ''2026-10-01'')', v_ws, v_restr),
    format('select financeiro_periodo_reabrir_as(%L, %L, ''2026-10-01'')', v_ws, v_restr),
    format('select financeiro_agendamento_confirmar_as(%L, %L, ''cliente'', %s, ''2026-10-10'')', v_ws, v_restr, v_ca),
    format('select financeiro_recorrente_criar_as(%L, %L, ''saida'', ''x'', '''', 10, 5, ''2026-10-01'', false, null)', v_ws, v_restr)] loop
    v_err := pg_temp.svc_erro(v_sql);
    assert v_err = 'client_scope_restricted', 'restricted_actor_no_client_write_denied: ' || v_sql || ' -> ' || coalesce(v_err, 'ok');
  end loop;

  -- todos actor unchanged
  v_err := pg_temp.svc_erro(format('select financeiro_cliente_salvar_as(%L, %L, %s, ''2026-10-01'', 3200, 5, ''ativo'')', v_ws, v_todos, v_cb));
  assert v_err is null, 'todos_actor_save_any_client_ok: ' || coalesce(v_err, '');
  v_err := pg_temp.svc_erro(format('select financeiro_config_salvar_as(%L, %L, null, 60)', v_ws, v_todos));
  assert v_err is null, 'todos_actor_config_ok: ' || coalesce(v_err, '');
  raise notice 'PASS actor scope';
end $$;

rollback;
