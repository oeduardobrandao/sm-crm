\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Financeiro MCP: atomic lançamento RPCs (20261029000003_financeiro_mcp_lancamentos.sql).
--   financeiro_agendamento_confirmar_as(p_conta, p_user, p_origem, p_id, p_hoje)
--     confirms the current month's projected agendado of a cliente / membro / recorrente
--     as a paid transacoes row, under an advisory lock on its referencia_agendamento.
--   financeiro_recorrente_criar_as(p_conta, p_user, ...)
--     creates the template and, optionally, its first paid occurrence, in one call.
-- Both: feature_financial of p_conta, then p_user must be the owner of p_conta.
-- service_role only. Every confirm test pins p_hoje.
begin;
select et_grant_hosted_parity();

-- A workspace on p_plan with an owner (active workspace = this one).
create or replace function pg_temp.novo_ws(p_plan text default 'max') returns uuid language plpgsql as $f$
declare v_ws uuid; v_owner uuid := gen_random_uuid();
begin
  v_ws := et_make_workspace(p_plan);
  insert into auth.users (id) values (v_owner);
  insert into workspace_members (user_id, workspace_id, role) values (v_owner, v_ws, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_owner;
  return v_ws;
end $f$;

create or replace function pg_temp.dono(p_ws uuid) returns uuid language sql as $f$
  select user_id from workspace_members where workspace_id = p_ws and role = 'owner' limit 1
$f$;

-- An admin of p_ws with financial access.
create or replace function pg_temp.admin(p_ws uuid) returns uuid language plpgsql as $f$
declare v_u uuid := gen_random_uuid();
begin
  insert into auth.users (id) values (v_u);
  insert into workspace_members (user_id, workspace_id, role, can_see_financials) values (v_u, p_ws, 'admin', true);
  update profiles set conta_id = p_ws, active_workspace_id = p_ws where id = v_u;
  return v_u;
end $f$;

create or replace function pg_temp.cliente(p_ws uuid, p_status text, p_dia int, p_valor numeric) returns bigint language plpgsql as $f$
declare v_id bigint;
begin
  insert into clientes (user_id, conta_id, nome, sigla, cor, status, data_pagamento, valor_mensal)
    values (pg_temp.dono(p_ws), p_ws, 'Cliente Teste', 'CT', '#000', p_status, p_dia, p_valor)
    returning id into v_id;
  return v_id;
end $f$;

create or replace function pg_temp.membro(p_ws uuid, p_dia int, p_custo numeric) returns bigint language plpgsql as $f$
declare v_id bigint;
begin
  insert into membros (user_id, conta_id, nome, data_pagamento, custo_mensal)
    values (pg_temp.dono(p_ws), p_ws, 'Membro Teste', p_dia, p_custo)
    returning id into v_id;
  return v_id;
end $f$;

create or replace function pg_temp.recorrente(p_ws uuid, p_inicio date, p_fim date default null) returns bigint language plpgsql as $f$
declare v_id bigint;
begin
  insert into transacoes_recorrentes (user_id, conta_id, tipo, descricao, categoria, valor, dia, inicio, fim)
    values (pg_temp.dono(p_ws), p_ws, 'saida', 'Software', 'Ferramenta', 89.9, 10, p_inicio, p_fim)
    returning id into v_id;
  return v_id;
end $f$;

-- Run p_sql as service_role (the MCP edge function's client) and return its scalar
-- result as text. Raises on error.
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
-- Same, NULL on success, else 'SQLSTATE:message'.
create or replace function pg_temp.svc_erro(p_sql text) returns text language plpgsql as $f$
begin
  perform pg_temp.svc(p_sql);
  return null;
exception when others then
  return sqlstate || ':' || sqlerrm;
end $f$;

create or replace function pg_temp.confirmar(p_ws uuid, p_user uuid, p_origem text, p_id bigint, p_hoje date) returns text language sql as $f$
  select format('select public.financeiro_agendamento_confirmar_as(%L, %L, %L, %s, %L)', p_ws, p_user, p_origem, p_id, p_hoje)
$f$;

create or replace function pg_temp.criar(p_ws uuid, p_user uuid, p_dia int, p_inicio date, p_registrar boolean, p_data date) returns text language sql as $f$
  select format('select public.financeiro_recorrente_criar_as(%L, %L, %L, %L, %L, %s, %s, %L, %L, %L)',
                p_ws, p_user, 'saida', 'Aluguel', 'Outro', 1500, p_dia, p_inicio, p_registrar, p_data)
$f$;

-- ---------------------------------------------------------------------------
-- grants_service_role_only
do $$
declare v_fn text;
begin
  foreach v_fn in array array[
    'public.financeiro_agendamento_confirmar_as(uuid,uuid,text,bigint,date)',
    'public.financeiro_recorrente_criar_as(uuid,uuid,text,text,text,numeric,int,date,boolean,date)'] loop
    assert not has_function_privilege('authenticated', v_fn, 'EXECUTE'), v_fn || ': authenticated can execute';
    assert not has_function_privilege('anon', v_fn, 'EXECUTE'), v_fn || ': anon can execute';
    assert has_function_privilege('service_role', v_fn, 'EXECUTE'), v_fn || ': service_role cannot execute';
    assert (select p.prosecdef from pg_proc p where p.oid = v_fn::regprocedure), v_fn || ': not SECURITY DEFINER';
  end loop;
  raise notice 'PASS grants_service_role_only';
end $$;

-- confirmar_cliente: payment day 31 lands on November 30
do $$
declare v_ws uuid := pg_temp.novo_ws(); v_dono uuid; v_cli bigint; r jsonb; t record;
begin
  v_dono := pg_temp.dono(v_ws);
  v_cli := pg_temp.cliente(v_ws, 'ativo', 31, 1000);
  r := pg_temp.svc(pg_temp.confirmar(v_ws, v_dono, 'cliente', v_cli, '2026-11-15'))::jsonb;
  select * into t from transacoes where conta_id = v_ws;
  assert t.data = '2026-11-30', 'confirmar_cliente: data ' || t.data;
  assert t.referencia_agendamento = format('cliente_%s_2026_11', v_cli), 'confirmar_cliente: ref ' || t.referencia_agendamento;
  assert t.detalhe = 'Agendamento automático' and t.categoria = 'Agendamento', 'confirmar_cliente: detalhe/categoria';
  assert t.tipo = 'entrada' and t.status = 'pago' and t.valor = 1000, 'confirmar_cliente: tipo/status/valor';
  assert t.descricao = 'Cliente Teste' and t.user_id = v_dono and t.cliente_id is null, 'confirmar_cliente: descricao/user/cliente_id';
  -- the return is the inserted row, closed list of fields
  assert (select array_agg(k order by k) from jsonb_object_keys(r) k)
         = array['categoria','data','descricao','detalhe','id','referencia_agendamento','status','tipo','valor'],
    'confirmar_cliente: return keys ' || r::text;
  assert (r->>'id')::bigint = t.id and r->>'data' = '2026-11-30' and (r->>'valor')::numeric = 1000
         and r->>'referencia_agendamento' = t.referencia_agendamento,
    'confirmar_cliente: return values ' || r::text;
  raise notice 'PASS confirmar_cliente';
end $$;

-- confirmar_membro: saida, custo_mensal, February clamp
do $$
declare v_ws uuid := pg_temp.novo_ws(); v_dono uuid; v_m bigint; t record;
begin
  v_dono := pg_temp.dono(v_ws);
  v_m := pg_temp.membro(v_ws, 30, 2500);
  perform pg_temp.svc(pg_temp.confirmar(v_ws, v_dono, 'membro', v_m, '2027-02-03'));
  select * into t from transacoes where conta_id = v_ws;
  assert t.tipo = 'saida' and t.valor = 2500 and t.descricao = 'Membro Teste', 'confirmar_membro: tipo/valor/descricao';
  assert t.referencia_agendamento = format('membro_%s_2027_02', v_m), 'confirmar_membro: ref ' || t.referencia_agendamento;
  assert t.data = '2027-02-28', 'confirmar_membro: data ' || t.data;
  assert t.detalhe = 'Agendamento automático' and t.categoria = 'Agendamento' and t.status = 'pago', 'confirmar_membro: detalhe';
  raise notice 'PASS confirmar_membro';
end $$;

-- confirmar_recorrente: active template (inicio earlier, fim this month)
do $$
declare v_ws uuid := pg_temp.novo_ws(); v_dono uuid; v_r bigint; t record;
begin
  v_dono := pg_temp.dono(v_ws);
  v_r := pg_temp.recorrente(v_ws, '2026-01-01', '2026-11-01');
  perform pg_temp.svc(pg_temp.confirmar(v_ws, v_dono, 'recorrente', v_r, '2026-11-20'));
  select * into t from transacoes where conta_id = v_ws;
  assert t.referencia_agendamento = format('recorrente_%s_2026_11', v_r), 'confirmar_recorrente: ref ' || t.referencia_agendamento;
  assert t.detalhe = 'Recorrente' and t.categoria = 'Ferramenta', 'confirmar_recorrente: detalhe/categoria';
  assert t.tipo = 'saida' and t.valor = 89.9 and t.descricao = 'Software' and t.data = '2026-11-10' and t.status = 'pago',
    'confirmar_recorrente: row';
  raise notice 'PASS confirmar_recorrente';
end $$;

-- confirmar_twice: the second call is refused, one row only
do $$
declare v_ws uuid := pg_temp.novo_ws(); v_dono uuid; v_cli bigint; v_err text;
begin
  v_dono := pg_temp.dono(v_ws);
  v_cli := pg_temp.cliente(v_ws, 'ativo', 5, 800);
  perform pg_temp.svc(pg_temp.confirmar(v_ws, v_dono, 'cliente', v_cli, '2026-11-15'));
  v_err := pg_temp.svc_erro(pg_temp.confirmar(v_ws, v_dono, 'cliente', v_cli, '2026-11-15'));
  assert v_err = 'P0001:ja_confirmado', 'confirmar_twice: ' || coalesce(v_err, 'success');
  assert (select count(*) from transacoes where conta_id = v_ws
           and referencia_agendamento = format('cliente_%s_2026_11', v_cli)) = 1, 'confirmar_twice: one row';
  -- a row the CRM wrote for that month (any status) also counts as confirmed
  v_cli := pg_temp.cliente(v_ws, 'ativo', 5, 800);
  insert into transacoes (user_id, conta_id, data, descricao, tipo, valor, status, referencia_agendamento)
    values (v_dono, v_ws, '2026-11-05', 'x', 'entrada', 800, 'agendado', format('cliente_%s_2026_11', v_cli));
  v_err := pg_temp.svc_erro(pg_temp.confirmar(v_ws, v_dono, 'cliente', v_cli, '2026-11-15'));
  assert v_err = 'P0001:ja_confirmado', 'confirmar_twice: existing CRM row ' || coalesce(v_err, 'success');
  -- next month is a new reference
  perform pg_temp.svc(pg_temp.confirmar(v_ws, v_dono, 'cliente', v_cli, '2026-12-01'));
  raise notice 'PASS confirmar_twice';
end $$;

-- not_eligible
do $$
declare v_ws uuid := pg_temp.novo_ws(); v_dono uuid; v_err text; v_id bigint;
begin
  v_dono := pg_temp.dono(v_ws);
  v_id := pg_temp.cliente(v_ws, 'pausado', 10, 1000);
  v_err := pg_temp.svc_erro(pg_temp.confirmar(v_ws, v_dono, 'cliente', v_id, '2026-11-15'));
  assert v_err = 'P0001:nao_agendado', 'not_eligible: paused client ' || coalesce(v_err, 'success');
  v_id := pg_temp.cliente(v_ws, 'ativo', null, 1000);
  v_err := pg_temp.svc_erro(pg_temp.confirmar(v_ws, v_dono, 'cliente', v_id, '2026-11-15'));
  assert v_err = 'P0001:nao_agendado', 'not_eligible: client without payment day ' || coalesce(v_err, 'success');
  v_id := pg_temp.cliente(v_ws, 'ativo', 10, null);
  v_err := pg_temp.svc_erro(pg_temp.confirmar(v_ws, v_dono, 'cliente', v_id, '2026-11-15'));
  assert v_err = 'P0001:valor_indefinido', 'not_eligible: client without fee ' || coalesce(v_err, 'success');
  v_id := pg_temp.recorrente(v_ws, '2026-12-01');
  v_err := pg_temp.svc_erro(pg_temp.confirmar(v_ws, v_dono, 'recorrente', v_id, '2026-11-15'));
  assert v_err = 'P0001:nao_agendado', 'not_eligible: recorrente starting next month ' || coalesce(v_err, 'success');
  v_id := pg_temp.recorrente(v_ws, '2026-01-01', '2026-10-01');
  v_err := pg_temp.svc_erro(pg_temp.confirmar(v_ws, v_dono, 'recorrente', v_id, '2026-11-15'));
  assert v_err = 'P0001:nao_agendado', 'not_eligible: ended recorrente ' || coalesce(v_err, 'success');
  v_id := pg_temp.membro(v_ws, 10, null);
  v_err := pg_temp.svc_erro(pg_temp.confirmar(v_ws, v_dono, 'membro', v_id, '2026-11-15'));
  assert v_err = 'P0001:valor_indefinido', 'not_eligible: membro without custo ' || coalesce(v_err, 'success');
  v_id := pg_temp.membro(v_ws, 10, 0);
  v_err := pg_temp.svc_erro(pg_temp.confirmar(v_ws, v_dono, 'membro', v_id, '2026-11-15'));
  assert v_err = 'P0001:valor_indefinido', 'not_eligible: membro with custo 0 ' || coalesce(v_err, 'success');
  v_id := pg_temp.membro(v_ws, null, 2000);
  v_err := pg_temp.svc_erro(pg_temp.confirmar(v_ws, v_dono, 'membro', v_id, '2026-11-15'));
  assert v_err = 'P0001:nao_agendado', 'not_eligible: membro without payment day ' || coalesce(v_err, 'success');
  v_err := pg_temp.svc_erro(pg_temp.confirmar(v_ws, v_dono, 'contrato', 1, '2026-11-15'));
  assert v_err = 'P0001:origem_invalida', 'not_eligible: origem ' || coalesce(v_err, 'success');
  assert not exists (select 1 from transacoes where conta_id = v_ws), 'not_eligible: nothing written';
  raise notice 'PASS not_eligible';
end $$;

-- foreign_origin: ids of another workspace are not found
do $$
declare v_a uuid := pg_temp.novo_ws(); v_b uuid := pg_temp.novo_ws(); v_dono uuid; v_err text; v_id bigint;
begin
  v_dono := pg_temp.dono(v_a);
  v_id := pg_temp.cliente(v_b, 'ativo', 10, 1000);
  v_err := pg_temp.svc_erro(pg_temp.confirmar(v_a, v_dono, 'cliente', v_id, '2026-11-15'));
  assert v_err = 'P0002:not_found', 'foreign_origin: cliente ' || coalesce(v_err, 'success');
  v_id := pg_temp.membro(v_b, 10, 1000);
  v_err := pg_temp.svc_erro(pg_temp.confirmar(v_a, v_dono, 'membro', v_id, '2026-11-15'));
  assert v_err = 'P0002:not_found', 'foreign_origin: membro ' || coalesce(v_err, 'success');
  v_id := pg_temp.recorrente(v_b, '2026-01-01');
  v_err := pg_temp.svc_erro(pg_temp.confirmar(v_a, v_dono, 'recorrente', v_id, '2026-11-15'));
  assert v_err = 'P0002:not_found', 'foreign_origin: recorrente ' || coalesce(v_err, 'success');
  assert not exists (select 1 from transacoes where conta_id in (v_a, v_b)), 'foreign_origin: nothing written';
  raise notice 'PASS foreign_origin';
end $$;

-- non_owner_denied: an admin with financial access is refused by both
do $$
declare v_ws uuid := pg_temp.novo_ws(); v_adm uuid; v_err text; v_cli bigint;
begin
  v_adm := pg_temp.admin(v_ws);
  v_cli := pg_temp.cliente(v_ws, 'ativo', 10, 1000);
  v_err := pg_temp.svc_erro(pg_temp.confirmar(v_ws, v_adm, 'cliente', v_cli, '2026-11-15'));
  assert v_err = '42501:owner_only', 'non_owner_denied: confirmar ' || coalesce(v_err, 'success');
  v_err := pg_temp.svc_erro(pg_temp.criar(v_ws, v_adm, 5, '2026-11-01', false, null));
  assert v_err = '42501:owner_only', 'non_owner_denied: criar ' || coalesce(v_err, 'success');
  -- the owner of another workspace is not the owner of this one
  v_err := pg_temp.svc_erro(pg_temp.confirmar(v_ws, pg_temp.dono(pg_temp.novo_ws()), 'cliente', v_cli, '2026-11-15'));
  assert v_err = '42501:owner_only', 'non_owner_denied: foreign owner ' || coalesce(v_err, 'success');
  assert not exists (select 1 from transacoes where conta_id = v_ws)
     and not exists (select 1 from transacoes_recorrentes where conta_id = v_ws), 'non_owner_denied: nothing written';
  raise notice 'PASS non_owner_denied';
end $$;

-- criar_recorrente_atomic
do $$
declare v_ws uuid := pg_temp.novo_ws(); v_dono uuid; r jsonb; v_rid bigint; t record; v_err text;
begin
  v_dono := pg_temp.dono(v_ws);
  r := pg_temp.svc(pg_temp.criar(v_ws, v_dono, 7, '2026-11-01', true, '2026-11-07'))::jsonb;
  v_rid := (r->'recorrente'->>'id')::bigint;
  assert exists (select 1 from transacoes_recorrentes where id = v_rid and conta_id = v_ws and user_id = v_dono
                  and tipo = 'saida' and descricao = 'Aluguel' and categoria = 'Outro' and valor = 1500
                  and dia = 7 and inicio = '2026-11-01' and fim is null), 'criar: template ' || r::text;
  select * into t from transacoes where conta_id = v_ws;
  assert t.referencia_agendamento = format('recorrente_%s_2026_11', v_rid), 'criar: ref ' || coalesce(t.referencia_agendamento, 'null');
  assert t.data = '2026-11-07' and t.detalhe = 'Recorrente' and t.categoria = 'Outro' and t.tipo = 'saida'
         and t.valor = 1500 and t.status = 'pago' and t.descricao = 'Aluguel' and t.user_id = v_dono, 'criar: paid row';
  assert (select array_agg(k order by k) from jsonb_object_keys(r->'recorrente') k)
         = array['categoria','descricao','dia','fim','id','inicio','tipo','valor'], 'criar: recorrente keys ' || r::text;
  assert (select array_agg(k order by k) from jsonb_object_keys(r->'lancamento') k)
         = array['categoria','data','descricao','detalhe','id','referencia_agendamento','status','tipo','valor'],
    'criar: lancamento keys ' || r::text;
  assert (r->'lancamento'->>'id')::bigint = t.id and r->'recorrente'->>'inicio' = '2026-11-01'
         and r->'recorrente'->'fim' = 'null'::jsonb, 'criar: return values ' || r::text;
  -- the month is now confirmed: confirming it again is refused
  v_err := pg_temp.svc_erro(pg_temp.confirmar(v_ws, v_dono, 'recorrente', v_rid, '2026-11-20'));
  assert v_err = 'P0001:ja_confirmado', 'criar: confirm after first paid ' || coalesce(v_err, 'success');

  -- without the first payment: template only, lancamento null
  r := pg_temp.svc(pg_temp.criar(v_ws, v_dono, 12, '2026-12-01', false, null))::jsonb;
  assert r->'lancamento' = 'null'::jsonb and (r->'recorrente'->>'dia')::int = 12, 'criar: no first ' || r::text;
  assert (select count(*) from transacoes where conta_id = v_ws) = 1, 'criar: no extra row';

  -- a CHECK violation leaves neither row
  v_err := pg_temp.svc_erro(pg_temp.criar(v_ws, v_dono, 32, '2027-01-01', true, '2027-01-15'));
  assert left(v_err, 5) = '23514', 'criar: dia 32 ' || coalesce(v_err, 'success');
  -- a first payment outside the starting month is refused too
  v_err := pg_temp.svc_erro(pg_temp.criar(v_ws, v_dono, 15, '2027-01-01', true, '2027-02-15'));
  assert left(v_err, 5) = '23514', 'criar: first payment month ' || coalesce(v_err, 'success');
  assert (select count(*) from transacoes_recorrentes where conta_id = v_ws) = 2, 'criar: failed calls left a template';
  assert (select count(*) from transacoes where conta_id = v_ws) = 1, 'criar: failed calls left a row';
  raise notice 'PASS criar_recorrente_atomic';
end $$;

-- free_plan_denied
do $$
declare v_ws uuid := pg_temp.novo_ws('free'); v_dono uuid; v_err text; v_cli bigint;
begin
  v_dono := pg_temp.dono(v_ws);
  v_cli := pg_temp.cliente(v_ws, 'ativo', 10, 1000);
  v_err := pg_temp.svc_erro(pg_temp.confirmar(v_ws, v_dono, 'cliente', v_cli, '2026-11-15'));
  assert v_err = 'P0001:feature_disabled:feature_financial', 'free_plan_denied: confirmar ' || coalesce(v_err, 'success');
  v_err := pg_temp.svc_erro(pg_temp.criar(v_ws, v_dono, 5, '2026-11-01', true, '2026-11-05'));
  assert v_err = 'P0001:feature_disabled:feature_financial', 'free_plan_denied: criar ' || coalesce(v_err, 'success');
  raise notice 'PASS free_plan_denied';
end $$;

rollback;
