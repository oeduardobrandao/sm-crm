\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Acesso por cliente, Financeiro (20261117000009_acesso_por_cliente_e_financeiro.sql): a
-- restricted member's Financeiro covers only the clients assigned to him.
--   * _financeiro_calcular is untouched (single rateio; the pg_cron roll snapshots run
--     through it): its prosrc md5 is pinned, and so is financeiro_rolar_periodos'.
--   * financeiro_rentabilidade (live period AND closed-period snapshot): clients outside his
--     list are dropped; member costs and expenses with no client do not count; members and
--     their totals are only the share prorated to his clients; totals are over his clients.
--   * owner / todos: byte-identical to _financeiro_calcular (and to the stored snapshot),
--     zero per-row scope calls.
--   * every financeiro_*_salvar refuses a row of a client he can't access, and every write
--     with no client or whose effect spreads across clients (acordo, atribuicoes, a client
--     status change, config, funcao, seed, period close/reopen) refuses him:
--     client_scope_restricted (42501). pessoas[]: regra / total / n_clientes over his
--     clients only.
--   * direct reads: financeiro_cliente_versoes / _atribuicoes / _entregas_manuais by client;
--     financeiro_acordo_versoes, financeiro_periodos (full snapshots) and
--     transacoes_recorrentes not at all; membros_v.custo_mensal NULL; transacoes and
--     contratos read/write by client, strict (no "é dele", NULL client hidden).
-- Spec: docs/superpowers/specs/2026-11-03-acesso-por-cliente-design.md ("Financeiro restrito")

begin;
-- mirror production grants: financeiro_* are SELECT-only for authenticated, membros/clientes
-- carry column allowlists, workspace_member_clientes is SELECT-only
select et_grant_hosted_parity(array[
  'financeiro_acordo_versoes', 'financeiro_atribuicoes', 'financeiro_cliente_versoes',
  'financeiro_config', 'financeiro_entregas_manuais', 'financeiro_funcoes', 'financeiro_periodos',
  'membros', 'clientes', 'workspace_member_clientes']);

-- count(*) of a query as p_user (authenticated)
create or replace function pg_temp.n_as(p_user uuid, p_sql text) returns bigint language plpgsql as $f$
declare v bigint;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  execute p_sql into v;
  execute 'reset role';
  return v;
end $f$;
-- jsonb result of a query as p_user
create or replace function pg_temp.j_as(p_user uuid, p_sql text) returns jsonb language plpgsql as $f$
declare v jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  execute p_sql into v;
  execute 'reset role';
  return v;
end $f$;
-- error message raised by a statement as p_user, or NULL on success
create or replace function pg_temp.errm_as(p_user uuid, p_sql text) returns text language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    execute p_sql;
  exception when others then
    execute 'reset role';
    return sqlerrm;
  end;
  execute 'reset role';
  return null;
end $f$;
create or replace function pg_temp.err_as(p_user uuid, p_sql text) returns text language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    execute p_sql;
  exception when others then
    execute 'reset role';
    return sqlstate;
  end;
  execute 'reset role';
  return null;
end $f$;

-- =============================================================
-- untouched functions (prosrc pinned; values taken before this feature)
-- =============================================================
do $$
begin
  assert (select md5(prosrc) from pg_proc where oid = 'public._financeiro_calcular(uuid,date)'::regprocedure)
         = '789040fb34f6921cddefc65a66ddf5df', 'financeiro_calcular_untouched';
  assert (select md5(prosrc) from pg_proc where oid = 'public.financeiro_rolar_periodos(date)'::regprocedure)
         = '0aaa9a870d875d4bc80d4f36962170e8', 'rolar_periodos_untouched';
end $$;

-- =============================================================
-- fixture
--   clients A 2000, B 3000 (ativo), C 1000 (ativo, assigned to nobody's scope)
--   funcoes F1 Video, F2 Design
--   M1 mensal 1000 F1 on A and B  -> 500 each (rateio)
--   M2 mensal  900 F1 on B only   -> exclusivo on B (vanishes for the restricted)
--   M3 por_entrega 100 F2 on A, B -> A qty 3 = 300, B qty missing (a_informar only on B)
--   M4 mensal  700 no funcao      -> cost with no client
--   M5 mensal  600 F2 on C only
--   periods: 2026-09-01 fechado (snapshot), 2026-10-01 aberto
--   restr: admin with financial access, scope atribuidos = {A}
--   zero:  admin with financial access, scope atribuidos = {}
--   todos: admin with financial access, scope todos
-- =============================================================
do $$
declare
  v_ws uuid := et_make_workspace('max');
  v_owner uuid := gen_random_uuid();
  v_todos uuid := gen_random_uuid();
  v_restr uuid := gen_random_uuid();
  v_zero uuid := gen_random_uuid();
  v_ca bigint; v_cb bigint; v_cc bigint;
  v_f1 bigint; v_f2 bigint;
  v_m1 bigint; v_m2 bigint; v_m3 bigint; v_m4 bigint; v_m5 bigint;
begin
  insert into workspace_plan_overrides (workspace_id, feature_overrides) values (v_ws, '{"feature_financeiro_v2": true}'::jsonb);
  insert into auth.users (id, email) values
    (v_owner, 'owner@acfin.test'), (v_todos, 'todos@acfin.test'), (v_restr, 'restr@acfin.test'), (v_zero, 'zero@acfin.test');
  insert into workspace_members (user_id, workspace_id, role, can_see_financials) values
    (v_owner, v_ws, 'owner', true), (v_todos, v_ws, 'admin', true), (v_restr, v_ws, 'admin', true), (v_zero, v_ws, 'admin', true);
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id in (v_owner, v_todos, v_restr, v_zero);

  insert into clientes (user_id, conta_id, nome, sigla, cor, status, valor_mensal) values (v_owner, v_ws, 'A', 'A', '#111', 'ativo', 2000) returning id into v_ca;
  insert into clientes (user_id, conta_id, nome, sigla, cor, status, valor_mensal) values (v_owner, v_ws, 'B', 'B', '#222', 'ativo', 3000) returning id into v_cb;
  insert into clientes (user_id, conta_id, nome, sigla, cor, status, valor_mensal) values (v_owner, v_ws, 'C', 'C', '#333', 'ativo', 1000) returning id into v_cc;
  update workspace_members set client_scope = 'atribuidos' where workspace_id = v_ws and user_id in (v_restr, v_zero);
  insert into workspace_member_clientes (workspace_id, user_id, cliente_id) values (v_ws, v_restr, v_ca);

  insert into financeiro_funcoes (conta_id, nome, ordem) values (v_ws, 'Video', 0) returning id into v_f1;
  insert into financeiro_funcoes (conta_id, nome, ordem) values (v_ws, 'Design', 1) returning id into v_f2;
  insert into membros (user_id, conta_id, nome, cargo, tipo, custo_mensal, data_pagamento, avatar_url) values (v_owner, v_ws, 'M1', 'Video', 'clt', 1000, 5, '') returning id into v_m1;
  insert into membros (user_id, conta_id, nome, cargo, tipo, custo_mensal, avatar_url) values (v_owner, v_ws, 'M2', 'Video', 'clt', 900, '') returning id into v_m2;
  insert into membros (user_id, conta_id, nome, cargo, tipo, custo_mensal, avatar_url) values (v_owner, v_ws, 'M3', 'Design', 'clt', null, '') returning id into v_m3;
  insert into membros (user_id, conta_id, nome, cargo, tipo, custo_mensal, avatar_url) values (v_owner, v_ws, 'M4', 'Outro', 'clt', 700, '') returning id into v_m4;
  insert into membros (user_id, conta_id, nome, cargo, tipo, custo_mensal, avatar_url) values (v_owner, v_ws, 'M5', 'Design', 'clt', 600, '') returning id into v_m5;

  insert into financeiro_cliente_versoes (conta_id, cliente_id, vale_desde, valor_mensal, status) values
    (v_ws, v_ca, date '2026-09-01', 2000, 'ativo'), (v_ws, v_cb, date '2026-09-01', 3000, 'ativo'),
    (v_ws, v_cc, date '2026-09-01', 1000, 'ativo');
  insert into financeiro_acordo_versoes (conta_id, membro_id, vale_desde, funcao_id, modelo, valor) values
    (v_ws, v_m1, date '2026-09-01', v_f1, 'mensal_meta', 1000),
    (v_ws, v_m2, date '2026-09-01', v_f1, 'mensal_meta', 900),
    (v_ws, v_m3, date '2026-09-01', v_f2, 'por_entrega', 100),
    (v_ws, v_m4, date '2026-09-01', null, 'mensal_meta', 700),
    (v_ws, v_m5, date '2026-09-01', v_f2, 'mensal_meta', 600);
  insert into financeiro_atribuicoes (conta_id, membro_id, cliente_id, desde) values
    (v_ws, v_m1, v_ca, date '2026-09-01'), (v_ws, v_m1, v_cb, date '2026-09-01'),
    (v_ws, v_m2, v_cb, date '2026-09-01'),
    (v_ws, v_m3, v_ca, date '2026-09-01'), (v_ws, v_m3, v_cb, date '2026-09-01'),
    (v_ws, v_m5, v_cc, date '2026-09-01');
  insert into financeiro_entregas_manuais (conta_id, periodo_inicio, membro_id, cliente_id, quantidade) values
    (v_ws, date '2026-09-01', v_m3, v_ca, 2), (v_ws, date '2026-09-01', v_m3, v_cb, 4),
    (v_ws, date '2026-10-01', v_m3, v_ca, 3);
  insert into financeiro_periodos (conta_id, inicio, fim) values (v_ws, date '2026-09-01', date '2026-10-01');
  insert into financeiro_periodos (conta_id, inicio, fim) values (v_ws, date '2026-10-01', date '2026-11-01');
  update financeiro_periodos
     set snapshot = jsonb_set(public._financeiro_calcular(v_ws, date '2026-09-01'), '{periodo,status}', '"fechado"'),
         status = 'fechado', fechado_em = now()
   where conta_id = v_ws and inicio = date '2026-09-01';
  insert into financeiro_config (conta_id, seeded_at) values (v_ws, now());

  -- legacy tables: one row on A, one on B, one with no client
  insert into transacoes (user_id, conta_id, data, descricao, tipo, valor, cliente_id) values
    (v_owner, v_ws, '2026-10-05', 'tA', 'entrada', 2000, v_ca),
    (v_owner, v_ws, '2026-10-05', 'tB', 'entrada', 3000, v_cb),
    (v_owner, v_ws, '2026-10-05', 'tN', 'saida', 700, null);
  insert into transacoes_recorrentes (conta_id, user_id, tipo, descricao, valor, dia, inicio) values
    (v_ws, v_owner, 'saida', 'aluguel', 1500, 10, date '2026-10-01');
  insert into contratos (user_id, conta_id, cliente_id, titulo, data_inicio, data_fim, valor_total) values
    (v_owner, v_ws, v_ca, 'kA', '2026-01-01', '2026-12-31', 24000),
    (v_owner, v_ws, v_cb, 'kB', '2026-01-01', '2026-12-31', 36000),
    (v_owner, v_ws, null, 'kN', '2026-01-01', '2026-12-31', 1000);
end $$;

-- =============================================================
-- rentabilidade
-- =============================================================
do $$
declare
  v_ws uuid := (select active_workspace_id from profiles where id = (select id from auth.users where email = 'owner@acfin.test'));
  v_owner uuid := (select id from auth.users where email = 'owner@acfin.test');
  v_todos uuid := (select id from auth.users where email = 'todos@acfin.test');
  v_restr uuid := (select id from auth.users where email = 'restr@acfin.test');
  v_zero uuid := (select id from auth.users where email = 'zero@acfin.test');
  v_ca bigint; v_cb bigint;
  v_m1 bigint; v_m3 bigint;
  v_f1 text; v_f2 text;
  v_full jsonb; v_snap jsonb; v_r jsonb; v_m jsonb; v_p jsonb;
begin
  select id into v_ca from clientes where conta_id = v_ws and nome = 'A';
  select id into v_cb from clientes where conta_id = v_ws and nome = 'B';
  select id into v_m1 from membros where conta_id = v_ws and nome = 'M1';
  select id into v_m3 from membros where conta_id = v_ws and nome = 'M3';
  select id::text into v_f1 from financeiro_funcoes where conta_id = v_ws and nome = 'Video';
  select id::text into v_f2 from financeiro_funcoes where conta_id = v_ws and nome = 'Design';

  v_full := public._financeiro_calcular(v_ws, date '2026-10-01');
  -- the fixture is what the comments say (full workspace)
  assert (v_full->'totais'->>'receita')::numeric = 6000, 'fixture receita: ' || (v_full->'totais')::text;
  assert (v_full->'totais'->>'custo_total')::numeric = 3500, 'fixture custo_total: ' || (v_full->'totais')::text;
  assert (v_full->'totais'->>'custo_sem_cliente')::numeric = 700, 'fixture sem cliente: ' || (v_full->'totais')::text;
  assert (v_full->>'incompleto')::boolean, 'fixture incompleto (M3 on B has no quantity)';

  -- todos_totals_unchanged / owner: byte-identical to the calculation
  v_r := pg_temp.j_as(v_todos, 'select financeiro_rentabilidade(''2026-10-01'')');
  assert v_r = v_full, 'todos_totals_unchanged (live period)';
  v_r := pg_temp.j_as(v_owner, 'select financeiro_rentabilidade(''2026-10-01'')');
  assert v_r = v_full, 'owner_totals_unchanged (live period)';
  select jsonb_set(p.snapshot, '{periodo,status}', '"fechado"') into v_snap
    from financeiro_periodos p where p.conta_id = v_ws and p.inicio = date '2026-09-01';
  v_r := pg_temp.j_as(v_todos, 'select financeiro_rentabilidade(''2026-09-01'')');
  assert v_r = v_snap, 'todos_totals_unchanged (closed snapshot)';

  -- restricted_rentabilidade_only_assigned
  v_r := pg_temp.j_as(v_restr, 'select financeiro_rentabilidade(''2026-10-01'')');
  assert jsonb_array_length(v_r->'clientes') = 1
     and (v_r->'clientes'->0->>'cliente_id')::bigint = v_ca, 'restricted_rentabilidade_only_assigned: ' || (v_r->'clientes')::text;
  assert (v_r->'clientes'->0) - 'pessoas' = (select c - 'pessoas' from jsonb_array_elements(v_full->'clientes') c
                                             where (c->>'cliente_id')::bigint = v_ca),
    'restricted client row equals the full row (receita, custo, por_funcao): ' || (v_r->'clientes'->0)::text;
  assert v_r->'periodo' = v_full->'periodo' and v_r->'funcoes' = v_full->'funcoes'
     and v_r->'meta_margem' = v_full->'meta_margem' and v_r->'seeded' = v_full->'seeded',
    'restricted keeps periodo / funcoes / meta_margem';

  -- restricted_total_excludes_unassigned_revenue
  assert (v_r->'totais'->>'receita')::numeric = 2000, 'restricted_total_excludes_unassigned_revenue: ' || (v_r->'totais')::text;
  -- restricted_excludes_unallocated_costs: only the shares on A (M1 500 + M3 300)
  assert (v_r->'totais'->>'custo_clientes')::numeric = 800
     and (v_r->'totais'->>'custo_sem_cliente')::numeric = 0
     and (v_r->'totais'->>'custo_total')::numeric = 800
     and (v_r->'totais'->>'lucro')::numeric = 1200
     and (v_r->'totais'->>'margem')::numeric = 0.6, 'restricted_excludes_unallocated_costs: ' || (v_r->'totais')::text;
  assert (v_r->'totais'->'por_funcao'->>v_f1)::numeric = 500
     and (v_r->'totais'->'por_funcao'->>v_f2)::numeric = 300, 'restricted totais.por_funcao: ' || (v_r->'totais'->'por_funcao')::text;
  assert not (v_r->>'incompleto')::boolean, 'restricted incompleto only over his clients';

  -- members: only those on his clients, with the share on his clients
  assert jsonb_array_length(v_r->'membros') = 2, 'restricted members only on his clients: ' || (v_r->'membros')::text;
  select m into v_m from jsonb_array_elements(v_r->'membros') m where (m->>'membro_id')::bigint = v_m1;
  assert (v_m->>'custo')::numeric = 500 and (v_m->>'n_clientes')::int = 1 and (v_m->>'por_cliente')::numeric = 500,
    'restricted member share prorated to his clients: ' || v_m::text;
  select m into v_m from jsonb_array_elements(v_r->'membros') m where (m->>'membro_id')::bigint = v_m3;
  assert (v_m->>'custo')::numeric = 300 and not (v_m->>'a_informar')::boolean,
    'restricted por_entrega member only his deliveries: ' || v_m::text;
  select p into v_p from jsonb_array_elements(v_r->'clientes'->0->'pessoas') p where (p->>'membro_id')::bigint = v_m1;
  assert (v_p->>'total')::numeric = 500 and (v_p->>'n_clientes')::int = 1 and (v_p->>'valor')::numeric = 500,
    'restricted pessoa total/n_clientes do not reveal hidden clients: ' || v_p::text;
  -- regra comes from his clients only: M1 serves only A among them, so exclusivo (rateio would
  -- reveal that M1 also works on a hidden client)
  assert v_p->>'regra' = 'exclusivo', 'restricted_pessoa_regra_from_his_clients: ' || v_p::text;
  select p into v_p from jsonb_array_elements(v_r->'clientes'->0->'pessoas') p where (p->>'membro_id')::bigint = v_m3;
  assert v_p->>'regra' = 'entrega' and (v_p->>'n_clientes')::int = 1 and (v_p->>'total')::numeric = 300,
    'restricted por_entrega pessoa over his clients: ' || v_p::text;
  -- no per-member number in the restricted output exceeds the member's share on his clients
  assert not exists (
    select 1 from jsonb_array_elements(v_r->'clientes') c, jsonb_array_elements(c->'pessoas') p
     where p->>'regra' = 'rateio' or (p->>'total')::numeric > 500 or (p->>'n_clientes')::int > 1),
    'restricted_pessoas_never_reveal_hidden_clients: ' || (v_r->'clientes')::text;
  assert not exists (
    select 1 from jsonb_array_elements(v_r->'membros') m
     where (m->>'custo')::numeric > 500 or (m->>'n_clientes')::int > 1 or (m->>'por_cliente')::numeric > 500),
    'restricted_membros_never_reveal_full_cost: ' || (v_r->'membros')::text;

  -- the closed period is filtered the same way (snapshot path)
  v_r := pg_temp.j_as(v_restr, 'select financeiro_rentabilidade(''2026-09-01'')');
  assert v_r->'periodo'->>'status' = 'fechado', 'restricted closed period status';
  assert jsonb_array_length(v_r->'clientes') = 1 and (v_r->'clientes'->0->>'cliente_id')::bigint = v_ca
     and (v_r->'totais'->>'receita')::numeric = 2000
     and (v_r->'totais'->>'custo_total')::numeric = 700
     and (v_r->'totais'->>'custo_sem_cliente')::numeric = 0, 'restricted_closed_snapshot_filtered: ' || (v_r->'totais')::text;
  assert not exists (
    select 1 from jsonb_array_elements(v_r->'clientes') c, jsonb_array_elements(c->'pessoas') p
     where p->>'regra' = 'rateio' or (p->>'n_clientes')::int > 1),
    'restricted_closed_pessoas_never_reveal_hidden_clients: ' || (v_r->'clientes')::text;

  -- restricted with an empty list sees zero clients, never all
  v_r := pg_temp.j_as(v_zero, 'select financeiro_rentabilidade(''2026-10-01'')');
  assert v_r->'clientes' = '[]'::jsonb and v_r->'membros' = '[]'::jsonb
     and (v_r->'totais'->>'receita')::numeric = 0 and (v_r->'totais'->>'custo_total')::numeric = 0
     and v_r->'totais'->'margem' = 'null'::jsonb, 'restricted_empty_list_sees_nothing: ' || v_r::text;

  -- period lists carry no client numbers: same for everyone
  assert pg_temp.j_as(v_restr, 'select financeiro_periodos_listar()') = pg_temp.j_as(v_owner, 'select financeiro_periodos_listar()'),
    'periodos_listar unchanged for restricted';
  assert pg_temp.j_as(v_restr, 'select financeiro_periodos_editaveis()') = pg_temp.j_as(v_owner, 'select financeiro_periodos_editaveis()'),
    'periodos_editaveis unchanged for restricted';

  raise notice 'PASS rentabilidade';
end $$;

-- =============================================================
-- direct reads
-- =============================================================
do $$
declare
  v_ws uuid := (select active_workspace_id from profiles where id = (select id from auth.users where email = 'owner@acfin.test'));
  v_todos uuid := (select id from auth.users where email = 'todos@acfin.test');
  v_restr uuid := (select id from auth.users where email = 'restr@acfin.test');
  v_t text; v_n bigint; v_e bigint;
begin
  -- tables with a client: only his rows; todos = superuser count
  foreach v_t in array array['financeiro_cliente_versoes', 'financeiro_atribuicoes', 'financeiro_entregas_manuais',
                             'transacoes', 'contratos'] loop
    execute format('select count(*) from %I where conta_id = $1', v_t) into v_e using v_ws;
    v_n := pg_temp.n_as(v_todos, format('select count(*) from %I', v_t));
    assert v_n = v_e, format('todos_counts_unchanged %s: %s <> %s', v_t, v_n, v_e);
    execute format('select count(*) from %I x join clientes c on c.id = x.cliente_id where x.conta_id = $1 and c.nome = ''A''', v_t)
      into v_e using v_ws;
    v_n := pg_temp.n_as(v_restr, format('select count(*) from %I', v_t));
    assert v_n = v_e and v_e > 0, format('restricted_direct_read_only_assigned %s: %s <> %s', v_t, v_n, v_e);
  end loop;

  -- no client: member costs, recurring expenses, full snapshots
  foreach v_t in array array['financeiro_acordo_versoes', 'financeiro_periodos', 'transacoes_recorrentes'] loop
    execute format('select count(*) from %I where conta_id = $1', v_t) into v_e using v_ws;
    v_n := pg_temp.n_as(v_todos, format('select count(*) from %I', v_t));
    assert v_n = v_e and v_e > 0, format('todos_counts_unchanged %s: %s <> %s', v_t, v_n, v_e);
    v_n := pg_temp.n_as(v_restr, format('select count(*) from %I', v_t));
    assert v_n = 0, format('restricted_no_client_rows_hidden %s: %s', v_t, v_n);
  end loop;

  -- config and funcoes carry no amounts: unchanged
  assert pg_temp.n_as(v_restr, 'select count(*) from financeiro_funcoes') = 2, 'funcoes readable';
  assert pg_temp.n_as(v_restr, 'select count(*) from financeiro_config') = 1, 'config readable';

  -- member cost (legacy column): hidden for the restricted, unchanged for todos
  v_n := pg_temp.n_as(v_restr, 'select count(*) from membros_v where custo_mensal is not null');
  assert v_n = 0, 'restricted_membros_v_custo_hidden: ' || v_n;
  v_n := pg_temp.n_as(v_todos, 'select count(*) from membros_v where custo_mensal is not null');
  assert v_n = 4, 'todos_membros_v_custo_unchanged: ' || v_n;
  assert pg_temp.n_as(v_restr, 'select count(*) from membros_v') = 5, 'restricted still lists members';
  -- view options and grants kept
  assert (select reloptions from pg_class where oid = 'public.membros_v'::regclass) = '{security_barrier=true}',
    'membros_v stays security_barrier';
  assert has_table_privilege('authenticated', 'public.membros_v', 'select'), 'membros_v select grant kept';

  raise notice 'PASS direct reads';
end $$;

-- =============================================================
-- legacy writes (transacoes, contratos, recorrentes, membros cost)
-- =============================================================
do $$
declare
  v_ws uuid := (select active_workspace_id from profiles where id = (select id from auth.users where email = 'owner@acfin.test'));
  v_todos uuid := (select id from auth.users where email = 'todos@acfin.test');
  v_restr uuid := (select id from auth.users where email = 'restr@acfin.test');
  v_ca bigint; v_cb bigint; v_ta bigint; v_tb bigint; v_ka bigint; v_m1 bigint; v_err text; v_n bigint;
begin
  select id into v_ca from clientes where conta_id = v_ws and nome = 'A';
  select id into v_cb from clientes where conta_id = v_ws and nome = 'B';
  select id into v_ta from transacoes where conta_id = v_ws and descricao = 'tA';
  select id into v_tb from transacoes where conta_id = v_ws and descricao = 'tB';
  select id into v_ka from contratos where conta_id = v_ws and titulo = 'kA';
  select id into v_m1 from membros where conta_id = v_ws and nome = 'M1';

  -- transacoes
  v_err := pg_temp.err_as(v_restr, format('insert into transacoes (user_id, conta_id, data, tipo, valor, cliente_id) values (%L, %L, ''2026-10-06'', ''entrada'', 1, %s)', v_restr, v_ws, v_cb));
  assert v_err = '42501', 'restricted_insert_transacao_hidden_client_denied: ' || coalesce(v_err, 'inserted');
  v_err := pg_temp.err_as(v_restr, format('insert into transacoes (user_id, conta_id, data, tipo, valor) values (%L, %L, ''2026-10-06'', ''saida'', 1)', v_restr, v_ws));
  assert v_err = '42501', 'restricted_insert_transacao_no_client_denied: ' || coalesce(v_err, 'inserted');
  v_err := pg_temp.err_as(v_restr, format('insert into transacoes (user_id, conta_id, data, tipo, valor, cliente_id) values (%L, %L, ''2026-10-06'', ''entrada'', 1, %s)', v_restr, v_ws, v_ca));
  assert v_err is null, 'restricted_insert_transacao_assigned_ok: ' || coalesce(v_err, '');
  v_err := pg_temp.err_as(v_restr, format('update transacoes set cliente_id = %s where id = %s', v_cb, v_ta));
  assert v_err = '42501', 'restricted_move_transacao_to_hidden_denied: ' || coalesce(v_err, 'moved');
  v_err := pg_temp.err_as(v_restr, format('update transacoes set cliente_id = null where id = %s', v_ta));
  assert v_err = '42501', 'restricted_detach_transacao_denied: ' || coalesce(v_err, 'detached');
  v_n := pg_temp.n_as(v_restr, format('with d as (delete from transacoes where id = %s returning 1) select count(*) from d', v_tb));
  assert v_n = 0, 'restricted_delete_transacao_hidden_noop: ' || v_n;
  v_n := pg_temp.n_as(v_restr, format('with u as (update transacoes set valor = 1 where id = %s returning 1) select count(*) from u', v_tb));
  assert v_n = 0, 'restricted_update_transacao_hidden_noop: ' || v_n;
  v_err := pg_temp.err_as(v_todos, format('insert into transacoes (user_id, conta_id, data, tipo, valor) values (%L, %L, ''2026-10-06'', ''saida'', 1)', v_todos, v_ws));
  assert v_err is null, 'todos_insert_transacao_no_client_ok: ' || coalesce(v_err, '');

  -- contratos
  v_err := pg_temp.err_as(v_restr, format('insert into contratos (user_id, conta_id, cliente_id, titulo, data_inicio, data_fim, valor_total) values (%L, %L, %s, ''x'', ''2026-01-01'', ''2026-12-31'', 1)', v_restr, v_ws, v_cb));
  assert v_err = '42501', 'restricted_insert_contrato_hidden_client_denied: ' || coalesce(v_err, 'inserted');
  v_err := pg_temp.err_as(v_restr, format('insert into contratos (user_id, conta_id, titulo, data_inicio, data_fim, valor_total) values (%L, %L, ''x'', ''2026-01-01'', ''2026-12-31'', 1)', v_restr, v_ws));
  assert v_err = '42501', 'restricted_insert_contrato_no_client_denied: ' || coalesce(v_err, 'inserted');
  v_err := pg_temp.err_as(v_restr, format('update contratos set cliente_id = %s where id = %s', v_cb, v_ka));
  assert v_err = '42501', 'restricted_move_contrato_to_hidden_denied: ' || coalesce(v_err, 'moved');
  v_err := pg_temp.err_as(v_restr, format('update contratos set valor_total = 1 where id = %s', v_ka));
  assert v_err is null, 'restricted_update_contrato_assigned_ok: ' || coalesce(v_err, '');

  -- recorrentes: no client
  v_err := pg_temp.err_as(v_restr, format('insert into transacoes_recorrentes (conta_id, user_id, tipo, descricao, valor, dia, inicio) values (%L, %L, ''saida'', ''x'', 1, 1, ''2026-10-01'')', v_ws, v_restr));
  assert v_err = '42501', 'restricted_insert_recorrente_denied: ' || coalesce(v_err, 'inserted');
  v_err := pg_temp.err_as(v_todos, format('insert into transacoes_recorrentes (conta_id, user_id, tipo, descricao, valor, dia, inicio) values (%L, %L, ''saida'', ''x'', 1, 1, ''2026-10-01'')', v_ws, v_todos));
  assert v_err is null, 'todos_insert_recorrente_ok: ' || coalesce(v_err, '');

  -- client status through the legacy column: same rule as financeiro_cliente_salvar
  v_err := pg_temp.errm_as(v_restr, format('update clientes set status = ''pausado'' where id = %s', v_ca));
  assert v_err = 'client_scope_restricted', 'restricted_legacy_status_change_denied: ' || coalesce(v_err, 'written');
  v_err := pg_temp.errm_as(v_restr, format('update clientes set valor_mensal = 2050 where id = %s', v_ca));
  assert v_err is null, 'restricted_legacy_fee_change_ok: ' || coalesce(v_err, '');
  v_err := pg_temp.errm_as(v_todos, format('update clientes set status = ''ativo'', valor_mensal = 2000 where id = %s', v_ca));
  assert v_err is null, 'todos_legacy_status_ok: ' || coalesce(v_err, '');

  -- member cost (legacy column): a restricted member can't change what he can't see
  v_err := pg_temp.errm_as(v_restr, format('update membros set custo_mensal = null where id = %s', v_m1));
  assert v_err = 'client_scope_restricted', 'restricted_write_member_cost_denied: ' || coalesce(v_err, 'written');
  v_err := pg_temp.errm_as(v_restr, format('update membros set nome = ''M1x'' where id = %s', v_m1));
  assert v_err is null, 'restricted_member_other_fields_ok: ' || coalesce(v_err, '');
  v_err := pg_temp.errm_as(v_todos, format('update membros set custo_mensal = 1001 where id = %s', v_m1));
  assert v_err is null, 'todos_write_member_cost_ok: ' || coalesce(v_err, '');

  raise notice 'PASS legacy writes';
end $$;

-- =============================================================
-- financeiro_*_salvar (authenticated)
-- =============================================================
do $$
declare
  v_ws uuid := (select active_workspace_id from profiles where id = (select id from auth.users where email = 'owner@acfin.test'));
  v_todos uuid := (select id from auth.users where email = 'todos@acfin.test');
  v_restr uuid := (select id from auth.users where email = 'restr@acfin.test');
  v_ca bigint; v_cb bigint; v_m1 bigint; v_m2 bigint; v_m3 bigint; v_f1 bigint; v_err text; v_sql text;
begin
  select id into v_ca from clientes where conta_id = v_ws and nome = 'A';
  select id into v_cb from clientes where conta_id = v_ws and nome = 'B';
  select id into v_m1 from membros where conta_id = v_ws and nome in ('M1', 'M1x');
  select id into v_m2 from membros where conta_id = v_ws and nome = 'M2';
  select id into v_m3 from membros where conta_id = v_ws and nome = 'M3';
  select id into v_f1 from financeiro_funcoes where conta_id = v_ws and nome = 'Video';

  -- restricted_save_hidden_client_denied
  v_err := pg_temp.errm_as(v_restr, format('select financeiro_cliente_salvar(%s, ''2026-10-01'', 3100, 5, ''ativo'')', v_cb));
  assert v_err = 'client_scope_restricted', 'restricted_save_hidden_client_denied: ' || coalesce(v_err, 'saved');
  v_err := pg_temp.errm_as(v_restr, format('select financeiro_cliente_salvar(%s, ''2026-10-01'', 2100, 5, ''ativo'')', v_ca));
  assert v_err is null, 'restricted_save_assigned_client_ok: ' || coalesce(v_err, '');

  v_err := pg_temp.errm_as(v_restr, format('select financeiro_atribuicoes_salvar(''2026-10-01'', %L::jsonb)',
    jsonb_build_array(jsonb_build_object('membro_id', v_m1, 'cliente_id', v_ca, 'ativo', true),
                      jsonb_build_object('membro_id', v_m1, 'cliente_id', v_cb, 'ativo', false))));
  assert v_err = 'client_scope_restricted', 'restricted_atribuicoes_hidden_client_denied: ' || coalesce(v_err, 'saved');
  -- an assignment change on his own client still shifts the rateio on hidden clients
  v_err := pg_temp.errm_as(v_restr, format('select financeiro_atribuicoes_salvar(''2026-10-01'', %L::jsonb)',
    jsonb_build_array(jsonb_build_object('membro_id', v_m2, 'cliente_id', v_ca, 'ativo', true))));
  assert v_err = 'client_scope_restricted', 'restricted_atribuicoes_own_client_denied: ' || coalesce(v_err, 'saved');
  v_err := pg_temp.errm_as(v_todos, format('select financeiro_atribuicoes_salvar(''2026-10-01'', %L::jsonb)',
    jsonb_build_array(jsonb_build_object('membro_id', v_m2, 'cliente_id', v_ca, 'ativo', true))));
  assert v_err is null, 'todos_atribuicoes_same_change_ok: ' || coalesce(v_err, '');
  -- a client status change moves the members' rateio to/from the other clients: all-clients-only;
  -- the fee alone only touches his client
  v_err := pg_temp.errm_as(v_restr, format('select financeiro_cliente_salvar(%s, ''2026-10-01'', 2100, 5, ''pausado'')', v_ca));
  assert v_err = 'client_scope_restricted', 'restricted_cliente_status_change_denied: ' || coalesce(v_err, 'saved');
  v_err := pg_temp.errm_as(v_restr, format('select financeiro_cliente_salvar(%s, ''2026-10-01'', 2200, 6, ''ativo'')', v_ca));
  assert v_err is null, 'restricted_cliente_fee_change_ok: ' || coalesce(v_err, '');

  v_err := pg_temp.errm_as(v_restr, format('select financeiro_entregas_salvar(''2026-10-01'', %s, %L::jsonb)', v_m3,
    jsonb_build_array(jsonb_build_object('cliente_id', v_cb, 'quantidade', 1))));
  assert v_err = 'client_scope_restricted', 'restricted_entregas_hidden_client_denied: ' || coalesce(v_err, 'saved');
  v_err := pg_temp.errm_as(v_restr, format('select financeiro_entregas_salvar(''2026-10-01'', %s, %L::jsonb)', v_m3,
    jsonb_build_array(jsonb_build_object('cliente_id', v_ca, 'quantidade', 4))));
  assert v_err is null, 'restricted_entregas_assigned_ok: ' || coalesce(v_err, '');

  -- writes with no client: refused for the restricted
  foreach v_sql in array array[
    format('select financeiro_acordo_salvar(%s, ''2026-10-01'', ''{"modelo":"mensal_meta","valor":1}''::jsonb)', v_m1),
    'select financeiro_config_salvar(null, 60)',
    'select financeiro_funcao_salvar(null, ''Nova'', null)',
    format('select financeiro_funcao_excluir(%s)', v_f1),
    'select financeiro_seed(1)',
    'select financeiro_periodo_reabrir(''2026-09-01'')',
    'select financeiro_periodo_fechar(''2026-09-01'')'] loop
    v_err := pg_temp.errm_as(v_restr, v_sql);
    assert v_err = 'client_scope_restricted', 'restricted_no_client_write_denied: ' || v_sql || ' -> ' || coalesce(v_err, 'ok');
  end loop;

  -- todos unchanged
  v_err := pg_temp.errm_as(v_todos, format('select financeiro_cliente_salvar(%s, ''2026-10-01'', 3100, 5, ''ativo'')', v_cb));
  assert v_err is null, 'todos_save_any_client_ok: ' || coalesce(v_err, '');
  v_err := pg_temp.errm_as(v_todos, 'select financeiro_config_salvar(null, 60)');
  assert v_err is null, 'todos_config_ok: ' || coalesce(v_err, '');

  raise notice 'PASS salvar';
end $$;

-- =============================================================
-- status re-check inside the locked section (_financeiro_cliente_salvar_core)
-- =============================================================
do $$
declare
  v_ws uuid := (select active_workspace_id from profiles where id = (select id from auth.users where email = 'owner@acfin.test'));
  v_todos uuid := (select id from auth.users where email = 'todos@acfin.test');
  v_restr uuid := (select id from auth.users where email = 'restr@acfin.test');
  v_ca bigint := (select id from clientes where conta_id = v_ws and nome = 'A');
  v_src text := (select prosrc from pg_proc where oid = 'public._financeiro_cliente_salvar_core(uuid,uuid,bigint,date,numeric,integer,text)'::regprocedure);
  v_err text;
begin
  -- structural: shared conta lock, then the client row lock, then the status check
  assert position('pg_advisory_xact_lock_shared' in v_src) > 0
     and position('FOR NO KEY UPDATE' in v_src) > position('pg_advisory_xact_lock_shared' in v_src)
     and position('_financeiro_status_muda' in v_src) > position('FOR NO KEY UPDATE' in v_src),
    'core_rechecks_status_under_lock';
  -- the core itself refuses a restricted actor's status change (whatever the wrapper saw)
  begin
    perform public._financeiro_cliente_salvar_core(v_ws, v_restr, v_ca, date '2026-10-01', 2000, 5, 'pausado');
    v_err := null;
  exception when others then v_err := sqlerrm;
  end;
  assert v_err = 'client_scope_restricted', 'core_restricted_status_change_denied: ' || coalesce(v_err, 'saved');
  begin
    perform public._financeiro_cliente_salvar_core(v_ws, v_todos, v_ca, date '2026-10-01', 2000, 5, 'ativo');
    v_err := null;
  exception when others then v_err := sqlerrm;
  end;
  assert v_err is null, 'core_todos_ok: ' || coalesce(v_err, '');
  raise notice 'PASS status recheck';
end $$;

-- =============================================================
-- storage: financeiro-acordos (contracts of every member: full cost)
-- =============================================================
create or replace function pg_temp.obj_n(p_user uuid) returns bigint language plpgsql as $f$
declare v bigint;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v from storage.objects where bucket_id = 'financeiro-acordos';
  execute 'reset role';
  return v;
end $f$;
do $$
declare
  v_ws uuid := (select active_workspace_id from profiles where id = (select id from auth.users where email = 'owner@acfin.test'));
  v_owner uuid := (select id from auth.users where email = 'owner@acfin.test');
  v_todos uuid := (select id from auth.users where email = 'todos@acfin.test');
  v_restr uuid := (select id from auth.users where email = 'restr@acfin.test');
  v_zero uuid := (select id from auth.users where email = 'zero@acfin.test');
  v_cb bigint := (select id from clientes where conta_id = v_ws and nome = 'B');
  v_ca bigint := (select id from clientes where conta_id = v_ws and nome = 'A');
  v_m1 bigint := (select id from membros where conta_id = v_ws and nome in ('M1', 'M1x'));
  v_m2 bigint := (select id from membros where conta_id = v_ws and nome = 'M2');
  v_err text;
begin
  insert into storage.objects (bucket_id, name) values
    ('financeiro-acordos', v_ws || '/' || v_m1 || '/a.pdf'), ('financeiro-acordos', v_ws || '/' || v_m2 || '/b.pdf');
  assert pg_temp.obj_n(v_restr) = 0, 'restricted_lists_no_contract: ' || pg_temp.obj_n(v_restr);
  assert pg_temp.obj_n(v_zero) = 0, 'zero_assignment_lists_no_contract';
  assert pg_temp.obj_n(v_todos) = 2, 'todos_contracts_unchanged: ' || pg_temp.obj_n(v_todos);
  assert pg_temp.obj_n(v_owner) = 2, 'owner_contracts_unchanged';
  v_err := pg_temp.err_as(v_restr, format('insert into storage.objects (bucket_id, name) values (''financeiro-acordos'', %L)', v_ws || '/' || v_m2 || '/c.pdf'));
  assert v_err = '42501', 'restricted_upload_contract_denied: ' || coalesce(v_err, 'uploaded');
  v_err := pg_temp.err_as(v_todos, format('insert into storage.objects (bucket_id, name) values (''financeiro-acordos'', %L)', v_ws || '/' || v_m2 || '/d.pdf'));
  assert v_err is null, 'todos_upload_contract_ok: ' || coalesce(v_err, '');

  -- avatars: client photo writes already follow clientes RLS (Task 3) through the policy's
  -- subquery; pinned here
  v_err := pg_temp.err_as(v_restr, format('insert into storage.objects (bucket_id, name) values (''avatars'', %L)', 'clientes/' || v_cb || '/p.png'));
  assert v_err = '42501', 'restricted_hidden_client_photo_denied: ' || coalesce(v_err, 'uploaded');
  v_err := pg_temp.err_as(v_restr, format('insert into storage.objects (bucket_id, name) values (''avatars'', %L)', 'clientes/' || v_ca || '/p.png'));
  assert v_err is null, 'restricted_own_client_photo_ok: ' || coalesce(v_err, '');
  raise notice 'PASS storage';
end $$;

-- =============================================================
-- storage: public buckets no longer list across workspaces
-- (20261117000015_acesso_por_cliente_k_storage_listagem.sql)
-- =============================================================
create or replace function pg_temp.bucket_n(p_role text, p_user uuid, p_bucket text) returns bigint language plpgsql as $f$
declare v bigint;
begin
  perform set_config('request.jwt.claims', case when p_user is null then json_build_object('role', 'anon')
    else json_build_object('sub', p_user, 'role', 'authenticated') end::text, true);
  execute format('set local role %I', p_role);
  select count(*) into v from storage.objects where bucket_id = p_bucket and name like '%-k.%';
  execute 'reset role';
  return v;
end $f$;
create or replace function pg_temp.upd_rows_as(p_user uuid, p_sql text) returns bigint language plpgsql as $f$
declare v bigint;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  execute p_sql;
  get diagnostics v = row_count;
  execute 'reset role';
  return v;
end $f$;
do $$
declare
  v_ws uuid := (select active_workspace_id from profiles where id = (select id from auth.users where email = 'owner@acfin.test'));
  v_owner uuid := (select id from auth.users where email = 'owner@acfin.test');
  v_restr uuid := (select id from auth.users where email = 'restr@acfin.test');
  v_cb bigint := (select id from clientes where conta_id = v_ws and nome = 'B');
  v_ca bigint := (select id from clientes where conta_id = v_ws and nome = 'A');
  v_other uuid := gen_random_uuid();
begin
  insert into storage.objects (bucket_id, name) values
    ('avatars', 'workspaces/' || v_ws || '/logo-k.png'),
    ('avatars', 'workspaces/' || v_other || '/logo-k.png'),
    ('avatars', 'clientes/' || v_ca || '/a-k.png'),
    ('avatars', 'clientes/' || v_cb || '/b-k.png'),
    ('avatars', 'profiles/' || v_restr || '/p-k.jpg'),
    ('avatars', 'profiles/' || v_owner || '/p-k.jpg'),
    ('post-media', v_ws || '/x-k.jpg'),
    ('post-media', v_other || '/y-k.jpg'),
    ('tiktok-posts', 'v1-k.jpg');

  assert pg_temp.bucket_n('anon', null, 'avatars') = 0, 'anon_lists_no_avatars';
  assert pg_temp.bucket_n('anon', null, 'post-media') = 0, 'anon_lists_no_post_media';
  assert pg_temp.bucket_n('anon', null, 'tiktok-posts') = 0, 'anon_lists_no_tiktok_posts';
  assert pg_temp.bucket_n('authenticated', v_owner, 'tiktok-posts') = 0, 'member_lists_no_tiktok_posts';
  assert pg_temp.bucket_n('authenticated', v_owner, 'post-media') = 1,
    'owner_lists_only_own_post_media: ' || pg_temp.bucket_n('authenticated', v_owner, 'post-media');
  -- owner: own logo, both clients, own profile
  assert pg_temp.bucket_n('authenticated', v_owner, 'avatars') = 4,
    'owner_lists_own_workspace_avatars: ' || pg_temp.bucket_n('authenticated', v_owner, 'avatars');
  -- restricted: own logo, client A only, own profile
  assert pg_temp.bucket_n('authenticated', v_restr, 'avatars') = 3,
    'restricted_lists_assigned_client_photos: ' || pg_temp.bucket_n('authenticated', v_restr, 'avatars');

  -- the logo upsert (storage-api overwrite: UPDATE ... RETURNING, which needs SELECT on the
  -- row) still works for the owner, and finds nothing on another workspace's logo
  assert pg_temp.upd_rows_as(v_owner, format(
    'update storage.objects set updated_at = now() where bucket_id = ''avatars'' and name = %L returning id',
    'workspaces/' || v_ws || '/logo-k.png')) = 1, 'owner_logo_overwrite_ok';
  assert pg_temp.upd_rows_as(v_owner, format(
    'update storage.objects set updated_at = now() where bucket_id = ''avatars'' and name = %L returning id',
    'workspaces/' || v_other || '/logo-k.png')) = 0, 'other_workspace_logo_overwrite_denied';
  raise notice 'PASS storage listing';
end $$;

-- =============================================================
-- zero scope calls for todos / owner (pg_stat_xact_user_functions)
-- =============================================================
set local track_functions = 'all';
create or replace function pg_temp.scope_calls() returns bigint language sql as $f$
  select coalesce(sum(calls), 0)::bigint from pg_stat_xact_user_functions
   where funcname in ('can_access_cliente', 'actor_cliente_ids', '_financeiro_filtrar_clientes');
$f$;
do $$
declare
  v_owner uuid := (select id from auth.users where email = 'owner@acfin.test');
  v_todos uuid := (select id from auth.users where email = 'todos@acfin.test');
  v_restr uuid := (select id from auth.users where email = 'restr@acfin.test');
  c0 bigint; c1 bigint; c2 bigint;
begin
  c0 := pg_temp.scope_calls();
  perform pg_temp.j_as(v_todos, 'select financeiro_rentabilidade(''2026-10-01'')');
  perform pg_temp.j_as(v_owner, 'select financeiro_rentabilidade(''2026-09-01'')');
  perform pg_temp.n_as(v_todos, 'select count(*) from transacoes');
  perform pg_temp.n_as(v_todos, 'select count(*) from financeiro_cliente_versoes');
  perform pg_temp.n_as(v_todos, 'select count(*) from contratos');
  c1 := pg_temp.scope_calls();
  assert c1 - c0 = 0, 'todos_pays_zero_scope_calls: ' || (c1 - c0);
  perform pg_temp.j_as(v_restr, 'select financeiro_rentabilidade(''2026-10-01'')');
  perform pg_temp.n_as(v_restr, 'select count(*) from transacoes');
  c2 := pg_temp.scope_calls();
  assert c2 > c1, 'track_functions is counting the scope helpers: ' || c2;
  raise notice 'PASS zero scope calls';
end $$;
reset track_functions;

-- =============================================================
-- rolar_periodos_snapshot_unchanged: the pg_cron roll (no JWT) closes the open period with
-- the plain calculation, never a filtered one
-- =============================================================
do $$
declare
  v_ws uuid := (select active_workspace_id from profiles where id = (select id from auth.users where email = 'owner@acfin.test'));
  v_before jsonb; v_snap jsonb;
begin
  perform set_config('request.jwt.claims', '', true);
  v_before := jsonb_set(public._financeiro_calcular(v_ws, date '2026-10-01'), '{periodo,status}', '"fechado"');
  perform public.financeiro_rolar_periodos(date '2026-11-02');
  select p.snapshot into v_snap from financeiro_periodos p where p.conta_id = v_ws and p.inicio = date '2026-10-01';
  assert v_snap is not null and v_snap = v_before, 'rolar_periodos_snapshot_unchanged';
  assert jsonb_array_length(v_snap->'clientes') = 3, 'snapshot keeps every client';
  raise notice 'PASS rolar_periodos';
end $$;

-- =============================================================
-- function privileges
-- =============================================================
do $$
declare v_f text;
begin
  foreach v_f in array array[
    'public._financeiro_filtrar_clientes(jsonb,bigint[])',
    'public._financeiro_exigir_clientes(uuid,uuid,bigint[])',
    'public.actor_client_scope_all(uuid,uuid)',
    'public.actor_cliente_ids(uuid,uuid)',
    'public._financeiro_status_muda(uuid,bigint,date,text)',
    'public._financeiro_rentabilidade_core(uuid,uuid,date,bigint[])'] loop
    assert not has_function_privilege('anon', v_f, 'execute'), v_f || ': anon can execute';
    assert not has_function_privilege('authenticated', v_f, 'execute'), v_f || ': authenticated can execute';
    assert has_function_privilege('service_role', v_f, 'execute'), v_f || ': service_role cannot execute';
  end loop;
  assert to_regprocedure('public._financeiro_rentabilidade_core(uuid,uuid,date)') is null,
    'old 3-arg _financeiro_rentabilidade_core dropped (no overload)';
  raise notice 'PASS grants';
end $$;

rollback;
