\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Financeiro v2 write RPCs (20261025000004_financeiro_v2_escrita.sql).
-- Every change is effective-dated ("vale a partir de" = an editable period start)
-- and the version effective at the current open period is written through to the
-- legacy columns (clientes.valor_mensal/data_pagamento/status, membros.custo_mensal/
-- data_pagamento). Fixture: the owner's spreadsheet (same as 99_financeiro_v2_calculo),
-- one open period out 2026; editable starts are 2026-10-01 (aberto), 2026-11-01 and
-- 2026-12-01 (futuro). Every test builds its own workspace.
begin;

create or replace function pg_temp.novo_ws() returns uuid language plpgsql as $f$
declare v_ws uuid; v_owner uuid := gen_random_uuid();
begin
  v_ws := et_make_workspace('max');
  insert into workspace_plan_overrides (workspace_id, feature_overrides) values (v_ws, '{"feature_financeiro_v2": true}'::jsonb);
  insert into auth.users (id) values (v_owner);
  insert into workspace_members (user_id, workspace_id, role) values (v_owner, v_ws, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_owner;
  return v_ws;
end $f$;

create or replace function pg_temp.dono(p_ws uuid) returns uuid language sql as $f$
  select user_id from workspace_members where workspace_id = p_ws and role = 'owner' limit 1
$f$;

-- The spreadsheet (copied from 99_financeiro_v2_calculo). The config row goes in last.
create or replace function pg_temp.fixture_planilha(p_ws uuid) returns void language plpgsql as $f$
declare
  v_owner uuid := pg_temp.dono(p_ws);
  v_fn_video bigint; v_fn_design bigint; v_fn_edicao bigint; v_fn_gestao bigint;
  v_cli record; v_id bigint;
  v_caio bigint; v_lia bigint; v_ana bigint; v_bruno bigint; v_duda bigint;
  v_talitha bigint;
begin
  insert into financeiro_funcoes (conta_id, nome, ordem) values (p_ws, 'Videomaker', 0) returning id into v_fn_video;
  insert into financeiro_funcoes (conta_id, nome, ordem) values (p_ws, 'Design', 1) returning id into v_fn_design;
  insert into financeiro_funcoes (conta_id, nome, ordem) values (p_ws, 'Edição de vídeo', 2) returning id into v_fn_edicao;
  insert into financeiro_funcoes (conta_id, nome, ordem) values (p_ws, 'Gestão de projetos', 3) returning id into v_fn_gestao;
  insert into financeiro_funcoes (conta_id, nome, ordem) values (p_ws, 'Copy', 4);

  for v_cli in select * from (values
      ('Cinara', 2000), ('Roberta', 2000), ('Tyciana', 1500), ('Gabriel', 2100), ('Maria Paula', 2000),
      ('Yasmin', 2000), ('Vanessa', 2200), ('Crícia', 1500), ('Talitha', 2500), ('Matheus', 2000),
      ('Beatriz', 2000), ('Marina', 2000), ('Richelle', 2200), ('Deborah', 2300), ('Larissa', 2300)) as t(nome, valor)
  loop
    insert into clientes (user_id, conta_id, nome, sigla, cor, valor_mensal)
      values (v_owner, p_ws, v_cli.nome, left(v_cli.nome, 2), '#000', v_cli.valor) returning id into v_id;
    insert into financeiro_cliente_versoes (conta_id, cliente_id, vale_desde, valor_mensal, status)
      values (p_ws, v_id, date '2026-10-01', v_cli.valor, 'ativo');
    if v_cli.nome = 'Talitha' then v_talitha := v_id; end if;
  end loop;

  insert into membros (user_id, conta_id, nome, cargo, tipo, custo_mensal, avatar_url) values (v_owner, p_ws, 'Caio', 'Videomaker', 'clt', 2310, '') returning id into v_caio;
  insert into membros (user_id, conta_id, nome, cargo, tipo, custo_mensal, avatar_url) values (v_owner, p_ws, 'Lia', 'Videomaker', 'clt', 550, '') returning id into v_lia;
  insert into membros (user_id, conta_id, nome, cargo, tipo, custo_mensal, avatar_url) values (v_owner, p_ws, 'Ana', 'Design', 'clt', 3900, '') returning id into v_ana;
  insert into membros (user_id, conta_id, nome, cargo, tipo, custo_mensal, avatar_url) values (v_owner, p_ws, 'Bruno', 'Edição', 'clt', 3150, '') returning id into v_bruno;
  insert into membros (user_id, conta_id, nome, cargo, tipo, custo_mensal, avatar_url) values (v_owner, p_ws, 'Duda', 'Gestão', 'clt', 2400, '') returning id into v_duda;

  insert into financeiro_acordo_versoes (conta_id, membro_id, vale_desde, funcao_id, modelo, valor, limite_clientes) values
    (p_ws, v_caio,  date '2026-10-01', v_fn_video,  'mensal_meta',   2310, null),
    (p_ws, v_lia,   date '2026-10-01', v_fn_video,  'mensal_meta',    550, null),
    (p_ws, v_ana,   date '2026-10-01', v_fn_design, 'mensal_meta',   3900, null),
    (p_ws, v_bruno, date '2026-10-01', v_fn_edicao, 'mensal_meta',   3150, null),
    (p_ws, v_duda,  date '2026-10-01', v_fn_gestao, 'mensal_limite', 2400, 20);

  -- everyone on every client, except Caio not on Talitha and Lia only on Talitha (60 rows)
  insert into financeiro_atribuicoes (conta_id, membro_id, cliente_id, desde)
    select p_ws, m.id, c.id, date '2026-10-01'
      from membros m cross join clientes c
     where m.conta_id = p_ws and c.conta_id = p_ws
       and not (m.id = v_caio and c.id = v_talitha)
       and not (m.id = v_lia and c.id <> v_talitha);

  insert into financeiro_periodos (conta_id, inicio, fim) values (p_ws, date '2026-10-01', date '2026-11-01');
  insert into financeiro_config (conta_id, seeded_at) values (p_ws, now());
end $f$;

create or replace function pg_temp.c(p_r jsonb, p_nome text) returns jsonb language sql as $f$
  select e from jsonb_array_elements(p_r->'clientes') e where e->>'nome' = p_nome
$f$;
create or replace function pg_temp.m(p_r jsonb, p_nome text) returns jsonb language sql as $f$
  select e from jsonb_array_elements(p_r->'membros') e where e->>'nome' = p_nome
$f$;
create or replace function pg_temp.fid(p_ws uuid, p_nome text) returns bigint language sql as $f$
  select id from financeiro_funcoes where conta_id = p_ws and nome = p_nome
$f$;
create or replace function pg_temp.mid(p_ws uuid, p_nome text) returns bigint language sql as $f$
  select id from membros where conta_id = p_ws and nome = p_nome
$f$;
create or replace function pg_temp.cid(p_ws uuid, p_nome text) returns bigint language sql as $f$
  select id from clientes where conta_id = p_ws and nome = p_nome
$f$;
-- is member p_mem listed in client p_cli's pessoas in result p_r?
create or replace function pg_temp.atende(p_r jsonb, p_cli text, p_mem text) returns boolean language sql as $f$
  select exists (select 1 from jsonb_array_elements(pg_temp.c(p_r, p_cli)->'pessoas') e where e->>'nome' = p_mem)
$f$;

-- Run p_sql as p_user (authenticated). NULL on success, else 'SQLSTATE:message'.
create or replace function pg_temp.exec_as(p_user uuid, p_sql text) returns text language plpgsql as $f$
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
-- Same, but the call must succeed.
create or replace function pg_temp.ok(p_user uuid, p_sql text) returns void language plpgsql as $f$
declare v_err text;
begin
  v_err := pg_temp.exec_as(p_user, p_sql);
  if v_err is not null then
    raise exception 'unexpected error from %: %', p_sql, v_err;
  end if;
end $f$;
-- A jsonb-returning RPC as p_user.
create or replace function pg_temp.rpc(p_user uuid, p_sql text) returns jsonb language plpgsql as $f$
declare v jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  execute p_sql into v;
  execute 'reset role';
  return v;
end $f$;
grant execute on all functions in schema pg_temp to authenticated;

-- ---------------------------------------------------------------------------
-- cliente_versao_and_legado
do $$
declare v_ws uuid := pg_temp.novo_ws(); v_tal bigint; v_ver record;
begin
  perform pg_temp.fixture_planilha(v_ws);
  v_tal := pg_temp.cid(v_ws, 'Talitha');
  perform pg_temp.ok(pg_temp.dono(v_ws), format(
    'select public.financeiro_cliente_salvar(%s, %L, 2800, 10, %L)', v_tal, '2026-10-01', 'ativo'));
  select * into v_ver from financeiro_cliente_versoes where cliente_id = v_tal and vale_desde = date '2026-10-01';
  assert v_ver.valor_mensal = 2800 and v_ver.dia_pagamento = 10 and v_ver.status = 'ativo',
    'cliente_versao: version row ' || row_to_json(v_ver)::text;
  assert v_ver.created_by = pg_temp.dono(v_ws), 'cliente_versao: created_by';
  assert (select count(*) from financeiro_cliente_versoes where cliente_id = v_tal) = 1, 'cliente_versao: upserted, not duplicated';
  assert (select valor_mensal from clientes where id = v_tal) = 2800, 'cliente_versao: legacy valor_mensal';
  assert (select data_pagamento from clientes where id = v_tal) = 10, 'cliente_versao: legacy data_pagamento';
  assert (pg_temp.c(public._financeiro_calcular(v_ws, date '2026-10-01'), 'Talitha')->>'receita')::numeric = 2800,
    'cliente_versao: live receita';
  raise notice 'PASS cliente_versao_and_legado';
end $$;

-- future_version_no_legado_yet
do $$
declare v_ws uuid := pg_temp.novo_ws(); v_tal bigint; r jsonb;
begin
  perform pg_temp.fixture_planilha(v_ws);
  v_tal := pg_temp.cid(v_ws, 'Talitha');
  perform pg_temp.ok(pg_temp.dono(v_ws), format(
    'select public.financeiro_cliente_salvar(%s, %L, 2800, null, %L)', v_tal, '2026-11-01', 'ativo'));
  assert (select valor_mensal from clientes where id = v_tal) = 2500, 'future_version: legacy still 2500';
  assert (select count(*) from financeiro_cliente_versoes where cliente_id = v_tal) = 2, 'future_version: two versions';
  r := pg_temp.rpc(pg_temp.dono(v_ws), 'select public.financeiro_rentabilidade(''2026-11-01'')');
  assert (pg_temp.c(r, 'Talitha')->>'receita')::numeric = 2800, 'future_version: next period shows 2800';
  r := pg_temp.rpc(pg_temp.dono(v_ws), 'select public.financeiro_rentabilidade(''2026-10-01'')');
  assert (pg_temp.c(r, 'Talitha')->>'receita')::numeric = 2500, 'future_version: current period unchanged';
  raise notice 'PASS future_version_no_legado_yet';
end $$;

-- closed_period_rejected
do $$
declare v_ws uuid := pg_temp.novo_ws(); v_tal bigint; v_err text; v_dono uuid;
begin
  perform pg_temp.fixture_planilha(v_ws);
  v_dono := pg_temp.dono(v_ws);
  v_tal := pg_temp.cid(v_ws, 'Talitha');
  insert into financeiro_periodos (conta_id, inicio, fim, status, snapshot, fechado_em)
    values (v_ws, date '2026-09-01', date '2026-10-01', 'fechado', '{}'::jsonb, now());
  v_err := pg_temp.exec_as(v_dono, format(
    'select public.financeiro_cliente_salvar(%s, %L, 2800, null, %L)', v_tal, '2026-09-01', 'ativo'));
  assert v_err = 'P0001:periodo_fechado', 'closed_period: cliente ' || coalesce(v_err, 'success');
  v_err := pg_temp.exec_as(v_dono, format(
    'select public.financeiro_acordo_salvar(%s, %L, %L::jsonb)', pg_temp.mid(v_ws, 'Ana'), '2026-09-01',
    '{"modelo":"mensal_meta","valor":4000}'));
  assert v_err = 'P0001:periodo_fechado', 'closed_period: acordo ' || coalesce(v_err, 'success');
  v_err := pg_temp.exec_as(v_dono, format(
    'select public.financeiro_atribuicoes_salvar(%L, %L::jsonb)', '2026-09-01',
    jsonb_build_array(jsonb_build_object('membro_id', pg_temp.mid(v_ws, 'Caio'), 'cliente_id', v_tal, 'ativo', true))));
  assert v_err = 'P0001:periodo_fechado', 'closed_period: atribuicoes ' || coalesce(v_err, 'success');
  v_err := pg_temp.exec_as(v_dono, format(
    'select public.financeiro_entregas_salvar(%L, %s, %L::jsonb)', '2026-09-01', pg_temp.mid(v_ws, 'Ana'),
    jsonb_build_array(jsonb_build_object('cliente_id', v_tal, 'quantidade', 3))));
  assert v_err = 'P0001:periodo_fechado', 'closed_period: entregas ' || coalesce(v_err, 'success');
  -- not a period start at all, a third projected start, and null
  v_err := pg_temp.exec_as(v_dono, format(
    'select public.financeiro_cliente_salvar(%s, %L, 2800, null, %L)', v_tal, '2026-10-15', 'ativo'));
  assert v_err = 'P0001:periodo_fechado', 'closed_period: mid-period date ' || coalesce(v_err, 'success');
  v_err := pg_temp.exec_as(v_dono, format(
    'select public.financeiro_cliente_salvar(%s, %L, 2800, null, %L)', v_tal, '2027-01-01', 'ativo'));
  assert v_err = 'P0001:periodo_fechado', 'closed_period: 3rd projected start ' || coalesce(v_err, 'success');
  v_err := pg_temp.exec_as(v_dono, format(
    'select public.financeiro_cliente_salvar(%s, null, 2800, null, %L)', v_tal, 'ativo'));
  assert v_err = 'P0001:periodo_fechado', 'closed_period: null date ' || coalesce(v_err, 'success');
  -- an ended period still marked aberto (close job late) is no longer the current one
  insert into financeiro_periodos (conta_id, inicio, fim) values (v_ws, date '2026-11-01', date '2026-12-01');
  v_err := pg_temp.exec_as(v_dono, format(
    'select public.financeiro_cliente_salvar(%s, %L, 2800, null, %L)', v_tal, '2026-10-01', 'ativo'));
  assert v_err = 'P0001:periodo_fechado', 'closed_period: stale aberto ' || coalesce(v_err, 'success');
  -- a reaberto period is editable
  update financeiro_periodos set status = 'reaberto', snapshot = null, fechado_em = null
   where conta_id = v_ws and inicio = date '2026-09-01';
  perform pg_temp.ok(v_dono, format(
    'select public.financeiro_cliente_salvar(%s, %L, 2700, null, %L)', v_tal, '2026-09-01', 'ativo'));
  assert (select count(*) from financeiro_cliente_versoes where cliente_id = v_tal and vale_desde = date '2026-09-01') = 1,
    'closed_period: reaberto accepted';
  assert (select count(*) from financeiro_cliente_versoes where cliente_id = v_tal and valor_mensal = 2800) = 0,
    'closed_period: a rejected write landed';
  raise notice 'PASS closed_period_rejected';
end $$;

-- _financeiro_inicio_editavel agrees with financeiro_periodos_editaveis()
do $$
declare v_ws uuid := pg_temp.novo_ws(); r jsonb; e jsonb; d date;
begin
  perform pg_temp.fixture_planilha(v_ws);
  insert into financeiro_periodos (conta_id, inicio, fim, status, snapshot, fechado_em) values
    (v_ws, date '2026-08-01', date '2026-09-01', 'fechado', '{}'::jsonb, now()),
    (v_ws, date '2026-09-01', date '2026-10-01', 'reaberto', null, null);
  update financeiro_config set periodo_dia = 15 where conta_id = v_ws;
  r := pg_temp.rpc(pg_temp.dono(v_ws), 'select public.financeiro_periodos_editaveis()');
  assert jsonb_array_length(r) = 4, 'inicio_editavel: editaveis ' || r::text;
  for e in select * from jsonb_array_elements(r) loop
    assert public._financeiro_inicio_editavel(v_ws, (e->>'inicio')::date), 'inicio_editavel: rejects offered ' || e::text;
  end loop;
  foreach d in array array[date '2026-08-01', date '2026-10-15', date '2026-11-14', date '2026-12-01', date '2026-12-15'] loop
    assert not public._financeiro_inicio_editavel(v_ws, d), 'inicio_editavel: accepts ' || d;
  end loop;
  assert public._financeiro_inicio_editavel(v_ws, null) is false, 'inicio_editavel: null';
  assert public._financeiro_inicio_editavel(null, date '2026-10-01') is false, 'inicio_editavel: null conta';
  raise notice 'PASS inicio_editavel_matches_editaveis';
end $$;

-- cross_tenant_rejected
do $$
declare
  v_ws uuid := pg_temp.novo_ws(); v_outro uuid := pg_temp.novo_ws(); v_dono uuid; v_err text;
  v_ana bigint; v_tal bigint; v_x_cli bigint; v_x_mem bigint; v_x_fn bigint;
begin
  perform pg_temp.fixture_planilha(v_ws);
  perform pg_temp.fixture_planilha(v_outro);
  v_dono := pg_temp.dono(v_ws);
  v_ana := pg_temp.mid(v_ws, 'Ana'); v_tal := pg_temp.cid(v_ws, 'Talitha');
  v_x_cli := pg_temp.cid(v_outro, 'Talitha'); v_x_mem := pg_temp.mid(v_outro, 'Ana'); v_x_fn := pg_temp.fid(v_outro, 'Design');

  v_err := pg_temp.exec_as(v_dono, format(
    'select public.financeiro_cliente_salvar(%s, %L, 2800, null, %L)', v_x_cli, '2026-10-01', 'ativo'));
  assert v_err = 'P0002:not_found', 'cross_tenant: cliente ' || coalesce(v_err, 'success');
  v_err := pg_temp.exec_as(v_dono, format(
    'select public.financeiro_cliente_salvar(%s, %L, 2800, null, %L)', 999999999, '2026-10-01', 'ativo'));
  assert v_err = 'P0002:not_found', 'cross_tenant: unknown cliente ' || coalesce(v_err, 'success');
  v_err := pg_temp.exec_as(v_dono, format(
    'select public.financeiro_acordo_salvar(%s, %L, %L::jsonb)', v_x_mem, '2026-10-01', '{"modelo":"mensal_meta","valor":1}'));
  assert v_err = 'P0002:not_found', 'cross_tenant: acordo membro ' || coalesce(v_err, 'success');
  v_err := pg_temp.exec_as(v_dono, format(
    'select public.financeiro_acordo_salvar(%s, %L, %L::jsonb)', v_ana, '2026-10-01',
    jsonb_build_object('modelo', 'mensal_meta', 'valor', 1, 'funcao_id', v_x_fn)));
  assert v_err = 'P0002:not_found', 'cross_tenant: acordo funcao ' || coalesce(v_err, 'success');
  v_err := pg_temp.exec_as(v_dono, format(
    'select public.financeiro_atribuicoes_salvar(%L, %L::jsonb)', '2026-10-01',
    jsonb_build_array(jsonb_build_object('membro_id', v_ana, 'cliente_id', v_x_cli, 'ativo', true))));
  assert v_err = 'P0002:not_found', 'cross_tenant: atribuicao cliente ' || coalesce(v_err, 'success');
  v_err := pg_temp.exec_as(v_dono, format(
    'select public.financeiro_atribuicoes_salvar(%L, %L::jsonb)', '2026-10-01',
    jsonb_build_array(jsonb_build_object('membro_id', v_x_mem, 'cliente_id', v_tal, 'ativo', true))));
  assert v_err = 'P0002:not_found', 'cross_tenant: atribuicao membro ' || coalesce(v_err, 'success');
  v_err := pg_temp.exec_as(v_dono, format(
    'select public.financeiro_entregas_salvar(%L, %s, %L::jsonb)', '2026-10-01', v_x_mem,
    jsonb_build_array(jsonb_build_object('cliente_id', v_tal, 'quantidade', 1))));
  assert v_err = 'P0002:not_found', 'cross_tenant: entregas membro ' || coalesce(v_err, 'success');
  v_err := pg_temp.exec_as(v_dono, format(
    'select public.financeiro_entregas_salvar(%L, %s, %L::jsonb)', '2026-10-01', v_ana,
    jsonb_build_array(jsonb_build_object('cliente_id', v_x_cli, 'quantidade', null))));
  assert v_err = 'P0002:not_found', 'cross_tenant: entregas cliente ' || coalesce(v_err, 'success');
  v_err := pg_temp.exec_as(v_dono, format('select public.financeiro_funcao_salvar(%s, %L, 0)', v_x_fn, 'Hack'));
  assert v_err = 'P0002:not_found', 'cross_tenant: funcao_salvar ' || coalesce(v_err, 'success');
  v_err := pg_temp.exec_as(v_dono, format('select public.financeiro_funcao_excluir(%s)', v_x_fn));
  assert v_err = 'P0002:not_found', 'cross_tenant: funcao_excluir ' || coalesce(v_err, 'success');

  -- the other workspace is untouched
  assert (select count(*) from financeiro_cliente_versoes where cliente_id = v_x_cli) = 1, 'cross_tenant: foreign versions';
  assert (select nome from financeiro_funcoes where id = v_x_fn) = 'Design', 'cross_tenant: foreign funcao';
  assert (select count(*) from financeiro_atribuicoes where conta_id = v_outro) = 60, 'cross_tenant: foreign assignments';
  raise notice 'PASS cross_tenant_rejected';
end $$;

-- encerrado_ends_assignments (from the current period: same-period rows are deleted)
do $$
declare v_ws uuid := pg_temp.novo_ws(); v_tal bigint; r jsonb;
begin
  perform pg_temp.fixture_planilha(v_ws);
  v_tal := pg_temp.cid(v_ws, 'Talitha');
  assert (pg_temp.m(public._financeiro_calcular(v_ws, date '2026-10-01'), 'Ana')->>'n_clientes')::int = 15, 'encerrado: Ana starts at 15';
  perform pg_temp.ok(pg_temp.dono(v_ws), format(
    'select public.financeiro_cliente_salvar(%s, %L, 2500, null, %L)', v_tal, '2026-10-01', 'encerrado'));
  assert not exists (select 1 from financeiro_atribuicoes where cliente_id = v_tal
                      and desde <= date '2026-10-01' and (ate is null or ate > date '2026-10-01')),
    'encerrado: an assignment of Talitha is still active';
  assert not exists (select 1 from financeiro_atribuicoes where cliente_id = v_tal), 'encerrado: same-period rows deleted';
  r := public._financeiro_calcular(v_ws, date '2026-10-01');
  assert (pg_temp.m(r, 'Ana')->>'n_clientes')::int = 14, 'encerrado: Ana n_clientes ' || (pg_temp.m(r, 'Ana')->>'n_clientes');
  assert (pg_temp.m(r, 'Lia')->>'n_clientes')::int = 0, 'encerrado: Lia lost her only client';
  assert pg_temp.c(r, 'Talitha') is null, 'encerrado: Talitha still listed';
  assert (select status from clientes where id = v_tal) = 'encerrado', 'encerrado: legacy status';
  raise notice 'PASS encerrado_ends_assignments';
end $$;

-- encerrado from a later period: assignments end at that start, the current period is unchanged
do $$
declare v_ws uuid := pg_temp.novo_ws(); v_tal bigint; v_cin bigint; r jsonb;
begin
  perform pg_temp.fixture_planilha(v_ws);
  v_tal := pg_temp.cid(v_ws, 'Talitha'); v_cin := pg_temp.cid(v_ws, 'Cinara');
  -- a pair that starts after the end date is removed; one closed past the end date is cut back
  insert into financeiro_atribuicoes (conta_id, membro_id, cliente_id, desde)
    values (v_ws, pg_temp.mid(v_ws, 'Caio'), v_tal, date '2026-12-01');
  update financeiro_atribuicoes set ate = date '2027-01-01'
   where cliente_id = v_tal and membro_id = pg_temp.mid(v_ws, 'Lia');
  perform pg_temp.ok(pg_temp.dono(v_ws), format(
    'select public.financeiro_cliente_salvar(%s, %L, 2500, null, %L)', v_tal, '2026-11-01', 'encerrado'));
  assert not exists (select 1 from financeiro_atribuicoes where cliente_id = v_tal and (ate is null or ate > date '2026-11-01')),
    'encerrado_later: an assignment outlives the end';
  assert (select count(*) from financeiro_atribuicoes where cliente_id = v_tal and ate = date '2026-11-01') = 4,
    'encerrado_later: Lia, Ana, Bruno, Duda end at 2026-11-01';
  assert not exists (select 1 from financeiro_atribuicoes where cliente_id = v_tal and desde = date '2026-12-01'),
    'encerrado_later: future assignment deleted';
  assert (select count(*) from financeiro_atribuicoes where cliente_id = v_cin and ate is null) = 4, 'encerrado_later: other clients untouched';
  r := public._financeiro_calcular(v_ws, date '2026-10-01');
  assert (pg_temp.m(r, 'Ana')->>'n_clientes')::int = 15 and pg_temp.c(r, 'Talitha')->>'status' = 'ativo', 'encerrado_later: October unchanged';
  r := public._financeiro_calcular(v_ws, date '2026-11-01');
  assert (pg_temp.m(r, 'Ana')->>'n_clientes')::int = 14 and pg_temp.c(r, 'Talitha') is null, 'encerrado_later: November';
  assert (select status from clientes where id = v_tal) is distinct from 'encerrado', 'encerrado_later: legacy status waits for November';
  raise notice 'PASS encerrado_later_sets_ate';
end $$;

-- atribuicao_toggle_same_period_deletes
do $$
declare v_ws uuid := pg_temp.novo_ws(); v_caio bigint; v_tal bigint; v_dono uuid;
begin
  perform pg_temp.fixture_planilha(v_ws);
  v_dono := pg_temp.dono(v_ws);
  v_caio := pg_temp.mid(v_ws, 'Caio'); v_tal := pg_temp.cid(v_ws, 'Talitha');
  perform pg_temp.ok(v_dono, format('select public.financeiro_atribuicoes_salvar(%L, %L::jsonb)', '2026-10-01',
    jsonb_build_array(jsonb_build_object('membro_id', v_caio, 'cliente_id', v_tal, 'ativo', true))));
  assert (select count(*) from financeiro_atribuicoes where membro_id = v_caio and cliente_id = v_tal
           and desde = date '2026-10-01' and ate is null) = 1, 'toggle_same: on inserts desde = vale_desde';
  assert pg_temp.atende(public._financeiro_calcular(v_ws, date '2026-10-01'), 'Talitha', 'Caio'), 'toggle_same: Caio serves Talitha';
  -- on again is a no-op
  perform pg_temp.ok(v_dono, format('select public.financeiro_atribuicoes_salvar(%L, %L::jsonb)', '2026-10-01',
    jsonb_build_array(jsonb_build_object('membro_id', v_caio, 'cliente_id', v_tal, 'ativo', true))));
  assert (select count(*) from financeiro_atribuicoes where membro_id = v_caio and cliente_id = v_tal) = 1, 'toggle_same: on twice';
  perform pg_temp.ok(v_dono, format('select public.financeiro_atribuicoes_salvar(%L, %L::jsonb)', '2026-10-01',
    jsonb_build_array(jsonb_build_object('membro_id', v_caio, 'cliente_id', v_tal, 'ativo', false))));
  assert not exists (select 1 from financeiro_atribuicoes where membro_id = v_caio and cliente_id = v_tal),
    'toggle_same: a row is left';
  raise notice 'PASS atribuicao_toggle_same_period_deletes';
end $$;

-- atribuicao_toggle_later_sets_ate (and turning it back on from the current period reopens it)
do $$
declare v_ws uuid := pg_temp.novo_ws(); v_ana bigint; v_cin bigint; v_dono uuid; r jsonb;
begin
  perform pg_temp.fixture_planilha(v_ws);
  v_dono := pg_temp.dono(v_ws);
  v_ana := pg_temp.mid(v_ws, 'Ana'); v_cin := pg_temp.cid(v_ws, 'Cinara');
  perform pg_temp.ok(v_dono, format('select public.financeiro_atribuicoes_salvar(%L, %L::jsonb)', '2026-11-01',
    jsonb_build_array(jsonb_build_object('membro_id', v_ana, 'cliente_id', v_cin, 'ativo', false))));
  assert (select ate from financeiro_atribuicoes where membro_id = v_ana and cliente_id = v_cin) = date '2026-11-01',
    'toggle_later: ate = next inicio';
  assert (select desde from financeiro_atribuicoes where membro_id = v_ana and cliente_id = v_cin) = date '2026-10-01',
    'toggle_later: desde kept';
  r := public._financeiro_calcular(v_ws, date '2026-10-01');
  assert (pg_temp.m(r, 'Ana')->>'n_clientes')::int = 15 and pg_temp.atende(r, 'Cinara', 'Ana'), 'toggle_later: current period unchanged';
  r := public._financeiro_calcular(v_ws, date '2026-11-01');
  assert (pg_temp.m(r, 'Ana')->>'n_clientes')::int = 14 and not pg_temp.atende(r, 'Cinara', 'Ana'), 'toggle_later: next period';
  -- back on from the current period: the interval reopens instead of a second row
  perform pg_temp.ok(v_dono, format('select public.financeiro_atribuicoes_salvar(%L, %L::jsonb)', '2026-10-01',
    jsonb_build_array(jsonb_build_object('membro_id', v_ana, 'cliente_id', v_cin, 'ativo', true))));
  assert (select count(*) from financeiro_atribuicoes where membro_id = v_ana and cliente_id = v_cin) = 1, 'toggle_later: reopen merges';
  assert (select ate from financeiro_atribuicoes where membro_id = v_ana and cliente_id = v_cin) is null, 'toggle_later: reopened';
  raise notice 'PASS atribuicao_toggle_later_sets_ate';
end $$;

-- more assignment cases: future-open pulled back, off before a future start, batch atomicity, bad payload
do $$
declare v_ws uuid := pg_temp.novo_ws(); v_caio bigint; v_lia bigint; v_tal bigint; v_cin bigint; v_dono uuid; v_err text;
begin
  perform pg_temp.fixture_planilha(v_ws);
  v_dono := pg_temp.dono(v_ws);
  v_caio := pg_temp.mid(v_ws, 'Caio'); v_lia := pg_temp.mid(v_ws, 'Lia');
  v_tal := pg_temp.cid(v_ws, 'Talitha'); v_cin := pg_temp.cid(v_ws, 'Cinara');
  -- on from December, then on from October: one open interval from October
  perform pg_temp.ok(v_dono, format('select public.financeiro_atribuicoes_salvar(%L, %L::jsonb)', '2026-12-01',
    jsonb_build_array(jsonb_build_object('membro_id', v_caio, 'cliente_id', v_tal, 'ativo', true))));
  perform pg_temp.ok(v_dono, format('select public.financeiro_atribuicoes_salvar(%L, %L::jsonb)', '2026-10-01',
    jsonb_build_array(jsonb_build_object('membro_id', v_caio, 'cliente_id', v_tal, 'ativo', true))));
  assert (select array_agg(desde::text || '/' || coalesce(ate::text, '-')) from financeiro_atribuicoes
           where membro_id = v_caio and cliente_id = v_tal) = array['2026-10-01/-'], 'atrib: future open pulled back';
  -- on from December, then off from November: the not-yet-started row is deleted
  perform pg_temp.ok(v_dono, format('select public.financeiro_atribuicoes_salvar(%L, %L::jsonb)', '2026-12-01',
    jsonb_build_array(jsonb_build_object('membro_id', v_lia, 'cliente_id', v_cin, 'ativo', true))));
  perform pg_temp.ok(v_dono, format('select public.financeiro_atribuicoes_salvar(%L, %L::jsonb)', '2026-11-01',
    jsonb_build_array(jsonb_build_object('membro_id', v_lia, 'cliente_id', v_cin, 'ativo', false))));
  assert not exists (select 1 from financeiro_atribuicoes where membro_id = v_lia and cliente_id = v_cin), 'atrib: future row deleted';
  -- off for a pair that was never assigned is a no-op
  perform pg_temp.ok(v_dono, format('select public.financeiro_atribuicoes_salvar(%L, %L::jsonb)', '2026-10-01',
    jsonb_build_array(jsonb_build_object('membro_id', v_lia, 'cliente_id', v_cin, 'ativo', false))));
  -- one bad entry rolls the whole batch back
  v_err := pg_temp.exec_as(v_dono, format('select public.financeiro_atribuicoes_salvar(%L, %L::jsonb)', '2026-10-01',
    jsonb_build_array(jsonb_build_object('membro_id', v_lia, 'cliente_id', v_cin, 'ativo', true),
                      jsonb_build_object('membro_id', v_lia, 'cliente_id', 999999999, 'ativo', true))));
  assert v_err = 'P0002:not_found', 'atrib batch: ' || coalesce(v_err, 'success');
  assert not exists (select 1 from financeiro_atribuicoes where membro_id = v_lia and cliente_id = v_cin), 'atrib batch: partial write';
  v_err := pg_temp.exec_as(v_dono, format('select public.financeiro_atribuicoes_salvar(%L, %L::jsonb)', '2026-10-01',
    '{"membro_id": 1}'));
  assert v_err = 'P0001:mudancas_invalidas', 'atrib: non-array payload ' || coalesce(v_err, 'success');
  v_err := pg_temp.exec_as(v_dono, format('select public.financeiro_atribuicoes_salvar(%L, %L::jsonb)', '2026-10-01',
    jsonb_build_array(jsonb_build_object('membro_id', v_lia, 'cliente_id', v_cin))));
  assert v_err = 'P0001:mudancas_invalidas', 'atrib: missing ativo ' || coalesce(v_err, 'success');
  raise notice 'PASS atribuicoes_edge_cases';
end $$;

-- ativo_on_encerrado_client_rejected: turning a member on for a client that is encerrado at v
do $$
declare v_ws uuid := pg_temp.novo_ws(); v_dono uuid; v_tal bigint; v_caio bigint; v_ana bigint; v_cin bigint; v_err text;
begin
  perform pg_temp.fixture_planilha(v_ws);
  v_dono := pg_temp.dono(v_ws);
  v_tal := pg_temp.cid(v_ws, 'Talitha'); v_cin := pg_temp.cid(v_ws, 'Cinara');
  v_caio := pg_temp.mid(v_ws, 'Caio'); v_ana := pg_temp.mid(v_ws, 'Ana');
  perform pg_temp.ok(v_dono, format(
    'select public.financeiro_cliente_salvar(%s, %L, 2500, null, %L)', v_tal, '2026-10-01', 'encerrado'));
  v_err := pg_temp.exec_as(v_dono, format('select public.financeiro_atribuicoes_salvar(%L, %L::jsonb)', '2026-10-01',
    jsonb_build_array(jsonb_build_object('membro_id', v_caio, 'cliente_id', v_tal, 'ativo', true))));
  assert v_err = 'P0001:cliente_encerrado', 'encerrado_rejected: same start ' || coalesce(v_err, 'success');
  -- the encerrado version carries forward to later starts
  v_err := pg_temp.exec_as(v_dono, format('select public.financeiro_atribuicoes_salvar(%L, %L::jsonb)', '2026-11-01',
    jsonb_build_array(jsonb_build_object('membro_id', v_caio, 'cliente_id', v_tal, 'ativo', true))));
  assert v_err = 'P0001:cliente_encerrado', 'encerrado_rejected: later start ' || coalesce(v_err, 'success');
  -- the whole batch rolls back, including a valid entry before the rejected one
  v_err := pg_temp.exec_as(v_dono, format('select public.financeiro_atribuicoes_salvar(%L, %L::jsonb)', '2026-11-01',
    jsonb_build_array(jsonb_build_object('membro_id', v_ana, 'cliente_id', v_cin, 'ativo', false),
                      jsonb_build_object('membro_id', v_ana, 'cliente_id', v_tal, 'ativo', true))));
  assert v_err = 'P0001:cliente_encerrado', 'encerrado_rejected: batch ' || coalesce(v_err, 'success');
  assert (select ate from financeiro_atribuicoes where membro_id = v_ana and cliente_id = v_cin) is null, 'encerrado_rejected: partial write';
  assert not exists (select 1 from financeiro_atribuicoes where cliente_id = v_tal), 'encerrado_rejected: a row was written';
  -- turning someone off is still allowed (a no-op here)
  perform pg_temp.ok(v_dono, format('select public.financeiro_atribuicoes_salvar(%L, %L::jsonb)', '2026-10-01',
    jsonb_build_array(jsonb_build_object('membro_id', v_caio, 'cliente_id', v_tal, 'ativo', false))));
  raise notice 'PASS ativo_on_encerrado_client_rejected';
end $$;

-- ativo_clamped_before_future_encerrado: an assignment turned on before a future encerrado ends at it,
-- and does not come back when the client is reactivated later
do $$
declare v_ws uuid := pg_temp.novo_ws(); v_dono uuid; v_tal bigint; v_caio bigint; v_ana bigint; v_lia bigint; r jsonb;
begin
  perform pg_temp.fixture_planilha(v_ws);
  v_dono := pg_temp.dono(v_ws);
  v_tal := pg_temp.cid(v_ws, 'Talitha');
  v_caio := pg_temp.mid(v_ws, 'Caio'); v_ana := pg_temp.mid(v_ws, 'Ana'); v_lia := pg_temp.mid(v_ws, 'Lia');
  perform pg_temp.ok(v_dono, format(
    'select public.financeiro_cliente_salvar(%s, %L, 2500, null, %L)', v_tal, '2026-11-01', 'encerrado'));
  -- Caio on (insert), Ana off then on (insert after delete), Lia on (already covers October)
  perform pg_temp.ok(v_dono, format('select public.financeiro_atribuicoes_salvar(%L, %L::jsonb)', '2026-10-01',
    jsonb_build_array(jsonb_build_object('membro_id', v_caio, 'cliente_id', v_tal, 'ativo', true),
                      jsonb_build_object('membro_id', v_ana, 'cliente_id', v_tal, 'ativo', false),
                      jsonb_build_object('membro_id', v_ana, 'cliente_id', v_tal, 'ativo', true),
                      jsonb_build_object('membro_id', v_lia, 'cliente_id', v_tal, 'ativo', true))));
  assert (select ate from financeiro_atribuicoes where membro_id = v_caio and cliente_id = v_tal) = date '2026-11-01',
    'clamped: Caio ate ' || coalesce((select ate::text from financeiro_atribuicoes where membro_id = v_caio and cliente_id = v_tal), 'null');
  assert (select ate from financeiro_atribuicoes where membro_id = v_ana and cliente_id = v_tal) = date '2026-11-01', 'clamped: Ana ate';
  assert (select ate from financeiro_atribuicoes where membro_id = v_lia and cliente_id = v_tal) = date '2026-11-01', 'clamped: Lia ate';
  assert not exists (select 1 from financeiro_atribuicoes where cliente_id = v_tal and (ate is null or ate > date '2026-11-01')),
    'clamped: an assignment outlives the encerrado start';
  r := public._financeiro_calcular(v_ws, date '2026-10-01');
  assert pg_temp.atende(r, 'Talitha', 'Caio') and pg_temp.atende(r, 'Talitha', 'Ana'), 'clamped: active in October';
  -- reactivated two periods later: nobody comes back on their own
  perform pg_temp.ok(v_dono, format(
    'select public.financeiro_cliente_salvar(%s, %L, 2500, null, %L)', v_tal, '2026-12-01', 'ativo'));
  r := public._financeiro_calcular(v_ws, date '2026-12-01');
  assert pg_temp.c(r, 'Talitha')->>'status' = 'ativo', 'clamped: Talitha listed again in December';
  assert not pg_temp.atende(r, 'Talitha', 'Caio') and not pg_temp.atende(r, 'Talitha', 'Ana'),
    'clamped: Caio or Ana came back in December';
  assert jsonb_array_length(pg_temp.c(r, 'Talitha')->'pessoas') = 0, 'clamped: December pessoas ' || (pg_temp.c(r, 'Talitha')->'pessoas')::text;
  -- turned on again from December (after the cutoff, no later encerrado): open-ended
  perform pg_temp.ok(v_dono, format('select public.financeiro_atribuicoes_salvar(%L, %L::jsonb)', '2026-12-01',
    jsonb_build_array(jsonb_build_object('membro_id', v_caio, 'cliente_id', v_tal, 'ativo', true))));
  assert (select count(*) from financeiro_atribuicoes where membro_id = v_caio and cliente_id = v_tal and desde = date '2026-12-01' and ate is null) = 1,
    'clamped: December assignment is open';
  raise notice 'PASS ativo_clamped_before_future_encerrado';
end $$;

-- acordo_por_entrega_legacy_null
do $$
declare v_ws uuid := pg_temp.novo_ws(); v_ana bigint; v_av record; v_dono uuid; r jsonb;
begin
  perform pg_temp.fixture_planilha(v_ws);
  v_dono := pg_temp.dono(v_ws);
  v_ana := pg_temp.mid(v_ws, 'Ana');
  perform pg_temp.ok(v_dono, format('select public.financeiro_acordo_salvar(%s, %L, %L::jsonb)', v_ana, '2026-10-01',
    jsonb_build_object('funcao_id', pg_temp.fid(v_ws, 'Design'), 'modelo', 'por_entrega', 'valor', 45,
                       'unidade', 'arte', 'dia_pagamento', 5, 'vigencia_inicio', '2026-01-01', 'arquivo_path', 'acordos/ana.pdf')));
  select * into v_av from financeiro_acordo_versoes where membro_id = v_ana and vale_desde = date '2026-10-01';
  assert v_av.modelo = 'por_entrega' and v_av.valor = 45 and v_av.unidade = 'arte' and v_av.dia_pagamento = 5
     and v_av.vigencia_inicio = date '2026-01-01' and v_av.arquivo_path = 'acordos/ana.pdf'
     and v_av.funcao_id = pg_temp.fid(v_ws, 'Design') and v_av.created_by = v_dono,
    'acordo: version row ' || row_to_json(v_av)::text;
  assert (select count(*) from financeiro_acordo_versoes where membro_id = v_ana) = 1, 'acordo: upserted';
  assert (select custo_mensal from membros where id = v_ana) is null, 'acordo: legacy custo_mensal not null';
  assert (select data_pagamento from membros where id = v_ana) = 5, 'acordo: legacy data_pagamento';
  r := public._financeiro_calcular(v_ws, date '2026-10-01');
  assert pg_temp.m(r, 'Ana')->>'modelo' = 'por_entrega', 'acordo: live modelo';
  -- back to monthly from November: legacy waits; an omitted key becomes null
  perform pg_temp.ok(v_dono, format('select public.financeiro_acordo_salvar(%s, %L, %L::jsonb)', v_ana, '2026-11-01',
    '{"modelo":"mensal_limite","valor":4200,"limite_clientes":12,"meta_quantidade":100,"meta_periodo":"mes"}'));
  select * into v_av from financeiro_acordo_versoes where membro_id = v_ana and vale_desde = date '2026-11-01';
  assert v_av.funcao_id is null and v_av.limite_clientes = 12 and v_av.meta_quantidade = 100 and v_av.meta_periodo = 'mes',
    'acordo nov: ' || row_to_json(v_av)::text;
  assert (select custo_mensal from membros where id = v_ana) is null, 'acordo nov: legacy still null';
  -- a monthly version for the current period writes valor through
  perform pg_temp.ok(v_dono, format('select public.financeiro_acordo_salvar(%s, %L, %L::jsonb)', v_ana, '2026-10-01',
    jsonb_build_object('funcao_id', pg_temp.fid(v_ws, 'Design'), 'modelo', 'mensal_meta', 'valor', 4000)));
  assert (select custo_mensal from membros where id = v_ana) = 4000, 'acordo: legacy custo_mensal 4000';
  assert (select data_pagamento from membros where id = v_ana) is null, 'acordo: legacy data_pagamento follows the version';
  raise notice 'PASS acordo_por_entrega_legacy_null';
end $$;

-- acordo payload validation
do $$
declare v_ws uuid := pg_temp.novo_ws(); v_dono uuid; v_err text; v_ana bigint;
begin
  perform pg_temp.fixture_planilha(v_ws);
  v_dono := pg_temp.dono(v_ws); v_ana := pg_temp.mid(v_ws, 'Ana');
  v_err := pg_temp.exec_as(v_dono, format('select public.financeiro_acordo_salvar(%s, %L, %L::jsonb)', v_ana, '2026-10-01', '[1]'));
  assert v_err = 'P0001:acordo_invalido', 'acordo: array payload ' || coalesce(v_err, 'success');
  v_err := pg_temp.exec_as(v_dono, format('select public.financeiro_acordo_salvar(%s, %L, null)', v_ana, '2026-10-01'));
  assert v_err = 'P0001:acordo_invalido', 'acordo: null payload ' || coalesce(v_err, 'success');
  v_err := pg_temp.exec_as(v_dono, format('select public.financeiro_acordo_salvar(%s, %L, %L::jsonb)', v_ana, '2026-10-01',
    '{"modelo":"freela","valor":1}'));
  assert v_err like '23514:%', 'acordo: bad modelo ' || coalesce(v_err, 'success');
  assert (select valor from financeiro_acordo_versoes where membro_id = v_ana) = 3900, 'acordo: rejected write landed';
  raise notice 'PASS acordo_payload_validation';
end $$;

-- entregas_salvar: upsert, null deletes; entregas_without_assignment_rejected
do $$
declare v_ws uuid := pg_temp.novo_ws(); v_dono uuid; v_ana bigint; v_caio bigint; v_cin bigint; v_rob bigint; v_tal bigint; v_err text; r jsonb;
begin
  perform pg_temp.fixture_planilha(v_ws);
  v_dono := pg_temp.dono(v_ws);
  v_ana := pg_temp.mid(v_ws, 'Ana'); v_caio := pg_temp.mid(v_ws, 'Caio');
  v_cin := pg_temp.cid(v_ws, 'Cinara'); v_rob := pg_temp.cid(v_ws, 'Roberta'); v_tal := pg_temp.cid(v_ws, 'Talitha');
  update financeiro_acordo_versoes set modelo = 'por_entrega', valor = 45 where membro_id = v_ana;
  perform pg_temp.ok(v_dono, format('select public.financeiro_entregas_salvar(%L, %s, %L::jsonb)', '2026-10-01', v_ana,
    jsonb_build_array(jsonb_build_object('cliente_id', v_cin, 'quantidade', 10),
                      jsonb_build_object('cliente_id', v_rob, 'quantidade', 4))));
  assert (select quantidade from financeiro_entregas_manuais where membro_id = v_ana and cliente_id = v_cin
           and periodo_inicio = date '2026-10-01' and conta_id = v_ws) = 10, 'entregas: inserted';
  perform pg_temp.ok(v_dono, format('select public.financeiro_entregas_salvar(%L, %s, %L::jsonb)', '2026-10-01', v_ana,
    jsonb_build_array(jsonb_build_object('cliente_id', v_cin, 'quantidade', 12),
                      jsonb_build_object('cliente_id', v_rob, 'quantidade', null))));
  assert (select quantidade from financeiro_entregas_manuais where membro_id = v_ana and cliente_id = v_cin) = 12, 'entregas: upserted';
  assert not exists (select 1 from financeiro_entregas_manuais where membro_id = v_ana and cliente_id = v_rob), 'entregas: null deletes';
  r := public._financeiro_calcular(v_ws, date '2026-10-01');
  assert (pg_temp.m(r, 'Ana')->>'custo')::numeric = 540, 'entregas: live cost ' || (pg_temp.m(r, 'Ana')->>'custo');
  -- entregas_without_assignment_rejected: Caio does not serve Talitha
  v_err := pg_temp.exec_as(v_dono, format('select public.financeiro_entregas_salvar(%L, %s, %L::jsonb)', '2026-10-01', v_caio,
    jsonb_build_array(jsonb_build_object('cliente_id', v_tal, 'quantidade', 3))));
  assert v_err = 'P0001:sem_atribuicao', 'entregas_without_assignment: ' || coalesce(v_err, 'success');
  -- an assignment that ended before the period does not count either; the batch is atomic
  update financeiro_atribuicoes set desde = date '2026-09-01', ate = date '2026-10-01' where membro_id = v_ana and cliente_id = v_rob;
  v_err := pg_temp.exec_as(v_dono, format('select public.financeiro_entregas_salvar(%L, %s, %L::jsonb)', '2026-10-01', v_ana,
    jsonb_build_array(jsonb_build_object('cliente_id', v_cin, 'quantidade', 99),
                      jsonb_build_object('cliente_id', v_rob, 'quantidade', 1))));
  assert v_err = 'P0001:sem_atribuicao', 'entregas ended assignment: ' || coalesce(v_err, 'success');
  assert (select quantidade from financeiro_entregas_manuais where membro_id = v_ana and cliente_id = v_cin) = 12, 'entregas: batch atomic';
  -- clearing a quantity needs no assignment
  insert into financeiro_entregas_manuais (conta_id, periodo_inicio, membro_id, cliente_id, quantidade)
    values (v_ws, date '2026-10-01', v_caio, v_tal, 2);
  perform pg_temp.ok(v_dono, format('select public.financeiro_entregas_salvar(%L, %s, %L::jsonb)', '2026-10-01', v_caio,
    jsonb_build_array(jsonb_build_object('cliente_id', v_tal, 'quantidade', null))));
  assert not exists (select 1 from financeiro_entregas_manuais where membro_id = v_caio and cliente_id = v_tal), 'entregas: clear unassigned';
  v_err := pg_temp.exec_as(v_dono, format('select public.financeiro_entregas_salvar(%L, %s, %L::jsonb)', '2026-10-01', v_ana, '{}'));
  assert v_err = 'P0001:itens_invalidos', 'entregas: non-array ' || coalesce(v_err, 'success');
  raise notice 'PASS entregas_salvar_upsert_delete';
  raise notice 'PASS entregas_without_assignment_rejected';
end $$;

-- config_salvar: the current period keeps its fim; the new day shapes the next one
do $$
declare v_ws uuid := pg_temp.novo_ws(); v_dono uuid; r jsonb; v_cfg record;
begin
  perform pg_temp.fixture_planilha(v_ws);
  v_dono := pg_temp.dono(v_ws);
  perform pg_temp.ok(v_dono, 'select public.financeiro_config_salvar(15, 60)');
  select * into v_cfg from financeiro_config where conta_id = v_ws;
  assert v_cfg.periodo_dia = 15 and v_cfg.meta_margem = 60 and v_cfg.updated_at is not null and v_cfg.seeded_at is not null,
    'config: row ' || row_to_json(v_cfg)::text;
  assert (select fim from financeiro_periodos where conta_id = v_ws and inicio = date '2026-10-01') = date '2026-11-01',
    'config: current fim untouched';
  r := pg_temp.rpc(v_dono, 'select public.financeiro_periodos_editaveis()');
  assert r->1->>'inicio' = '2026-11-01' and r->1->>'fim' = '2026-11-15' and r->1->'transicao' = 'true'::jsonb,
    'config: next period is a transition ' || r::text;
  assert public._financeiro_calcular(v_ws, date '2026-10-01')->'meta_margem' = '60'::jsonb, 'config: meta_margem live';
  -- null keeps the current value
  perform pg_temp.ok(v_dono, 'select public.financeiro_config_salvar(null, 50)');
  assert (select periodo_dia from financeiro_config where conta_id = v_ws) = 15, 'config: null keeps periodo_dia';
  assert (select meta_margem from financeiro_config where conta_id = v_ws) = 50, 'config: meta_margem 50';
  assert pg_temp.exec_as(v_dono, 'select public.financeiro_config_salvar(29, null)') like '23514:%', 'config: periodo_dia 29';
  raise notice 'PASS config_salvar';
end $$;

-- write RPCs on an unseeded workspace: nao_configurado, except config_salvar, which creates the row unseeded
do $$
declare v_ws uuid := pg_temp.novo_ws(); v_dono uuid; v_err text; v_sql text; v_cli bigint; v_cfg record;
begin
  v_dono := pg_temp.dono(v_ws);
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (v_dono, v_ws, 'Solo', 'So', '#000') returning id into v_cli;
  foreach v_sql in array array[
    format('select public.financeiro_cliente_salvar(%s, current_date, 1, null, %L)', v_cli, 'ativo'),
    'select public.financeiro_acordo_salvar(1, current_date, ''{}''::jsonb)',
    'select public.financeiro_atribuicoes_salvar(current_date, ''[]''::jsonb)',
    'select public.financeiro_entregas_salvar(current_date, 1, ''[]''::jsonb)',
    'select public.financeiro_funcao_salvar(null, ''Design'', 0)',
    'select public.financeiro_funcao_excluir(1)'] loop
    v_err := pg_temp.exec_as(v_dono, v_sql);
    assert v_err = 'P0001:nao_configurado', 'unseeded: ' || v_sql || ' -> ' || coalesce(v_err, 'success');
  end loop;
  perform pg_temp.ok(v_dono, 'select public.financeiro_config_salvar(10, null)');
  select * into v_cfg from financeiro_config where conta_id = v_ws;
  assert v_cfg.periodo_dia = 10 and v_cfg.meta_margem = 55 and v_cfg.seeded_at is null, 'unseeded: config row ' || row_to_json(v_cfg)::text;
  -- an unseeded config row still blocks the other writes
  v_err := pg_temp.exec_as(v_dono, 'select public.financeiro_funcao_salvar(null, ''Design'', 0)');
  assert v_err = 'P0001:nao_configurado', 'unseeded with row: ' || coalesce(v_err, 'success');
  raise notice 'PASS write_unseeded';
end $$;

-- write_requires_editar (and the flag checks come first)
do $$
declare v_ws uuid := pg_temp.novo_ws(); v_ver uuid := gen_random_uuid(); v_role uuid; v_err text; v_sql text; v_sqls text[];
begin
  perform pg_temp.fixture_planilha(v_ws);
  insert into auth.users (id) values (v_ver);
  insert into workspace_roles (conta_id, nome, permissions)
    values (v_ws, 'Financeiro leitura', '{"financeiro":"ver"}'::jsonb) returning id into v_role;
  insert into workspace_members (user_id, workspace_id, role, role_id) values (v_ver, v_ws, 'agent', v_role);
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_ver;
  -- the role really can read
  assert jsonb_typeof(pg_temp.rpc(v_ver, 'select public.financeiro_rentabilidade()')->'clientes') = 'array', 'editar: ver can read';
  v_sqls := array[
    format('select public.financeiro_cliente_salvar(%s, %L, 1, null, %L)', pg_temp.cid(v_ws, 'Talitha'), '2026-10-01', 'ativo'),
    format('select public.financeiro_acordo_salvar(%s, %L, %L::jsonb)', pg_temp.mid(v_ws, 'Ana'), '2026-10-01', '{"modelo":"mensal_meta","valor":1}'),
    'select public.financeiro_atribuicoes_salvar(''2026-10-01'', ''[]''::jsonb)',
    format('select public.financeiro_entregas_salvar(%L, %s, %L::jsonb)', '2026-10-01', pg_temp.mid(v_ws, 'Ana'), '[]'),
    'select public.financeiro_config_salvar(15, 60)',
    'select public.financeiro_funcao_salvar(null, ''Nova'', 9)',
    format('select public.financeiro_funcao_excluir(%s)', pg_temp.fid(v_ws, 'Copy'))];
  foreach v_sql in array v_sqls loop
    v_err := pg_temp.exec_as(v_ver, v_sql);
    assert v_err = '42501:financial_access_denied', 'write_requires_editar: ' || v_sql || ' -> ' || coalesce(v_err, 'success');
  end loop;
  assert (select periodo_dia from financeiro_config where conta_id = v_ws) = 1, 'write_requires_editar: config changed';
  -- flags precede the permission check
  update workspace_plan_overrides set feature_overrides = '{"feature_financeiro_v2": false}'::jsonb where workspace_id = v_ws;
  foreach v_sql in array v_sqls loop
    v_err := pg_temp.exec_as(pg_temp.dono(v_ws), v_sql);
    assert v_err = 'P0001:feature_disabled:feature_financeiro_v2', 'write flag v2 off: ' || v_sql || ' -> ' || coalesce(v_err, 'success');
    v_err := pg_temp.exec_as(v_ver, v_sql);
    assert v_err = 'P0001:feature_disabled:feature_financeiro_v2', 'write flag before permission: ' || coalesce(v_err, 'success');
  end loop;
  update workspace_plan_overrides set feature_overrides = '{"feature_financeiro_v2": true, "feature_financial": false}'::jsonb where workspace_id = v_ws;
  foreach v_sql in array v_sqls loop
    v_err := pg_temp.exec_as(pg_temp.dono(v_ws), v_sql);
    assert v_err = 'P0001:feature_disabled:feature_financial', 'write flag financial off: ' || v_sql || ' -> ' || coalesce(v_err, 'success');
  end loop;
  raise notice 'PASS write_requires_editar';
end $$;

-- funcao_salvar / funcao_excluir
do $$
declare v_ws uuid := pg_temp.novo_ws(); v_dono uuid; v_id bigint; v_err text; v_design bigint;
begin
  perform pg_temp.fixture_planilha(v_ws);
  v_dono := pg_temp.dono(v_ws);
  v_id := (pg_temp.rpc(v_dono, 'select to_jsonb(public.financeiro_funcao_salvar(null, ''  Social media  '', null))'))::text::bigint;
  assert (select nome from financeiro_funcoes where id = v_id and conta_id = v_ws) = 'Social media', 'funcao: inserted trimmed';
  assert (select ordem from financeiro_funcoes where id = v_id) = 5, 'funcao: default ordem goes last';
  assert (pg_temp.rpc(v_dono, format('select to_jsonb(public.financeiro_funcao_salvar(%s, %L, 2))', v_id, 'Social')))::text::bigint = v_id,
    'funcao: update returns the id';
  assert (select nome || '/' || ordem from financeiro_funcoes where id = v_id) = 'Social/2', 'funcao: updated';
  perform pg_temp.ok(v_dono, format('select public.financeiro_funcao_salvar(%s, %L, null)', v_id, 'Social'));
  assert (select ordem from financeiro_funcoes where id = v_id) = 2, 'funcao: null ordem keeps it';
  v_err := pg_temp.exec_as(v_dono, 'select public.financeiro_funcao_salvar(null, ''design'', 0)');
  assert v_err = 'P0001:funcao_duplicada', 'funcao: duplicate name ' || coalesce(v_err, 'success');
  v_err := pg_temp.exec_as(v_dono, format('select public.financeiro_funcao_salvar(%s, %L, 0)', v_id, 'Copy'));
  assert v_err = 'P0001:funcao_duplicada', 'funcao: duplicate rename ' || coalesce(v_err, 'success');
  -- excluir: acordos keep their rows, funcao_id goes null
  v_design := pg_temp.fid(v_ws, 'Design');
  perform pg_temp.ok(v_dono, format('select public.financeiro_funcao_excluir(%s)', v_design));
  assert not exists (select 1 from financeiro_funcoes where id = v_design), 'funcao_excluir: row gone';
  assert (select funcao_id from financeiro_acordo_versoes where membro_id = pg_temp.mid(v_ws, 'Ana')) is null, 'funcao_excluir: acordo funcao_id null';
  assert (select conta_id from financeiro_acordo_versoes where membro_id = pg_temp.mid(v_ws, 'Ana')) = v_ws, 'funcao_excluir: conta_id kept';
  v_err := pg_temp.exec_as(v_dono, format('select public.financeiro_funcao_excluir(%s)', v_design));
  assert v_err = 'P0002:not_found', 'funcao_excluir: twice ' || coalesce(v_err, 'success');
  raise notice 'PASS funcao_salvar_excluir';
end $$;

-- the write-through only touches rows whose legacy values differ (an UPDATE moves the ctid)
do $$
declare v_ws uuid := pg_temp.novo_ws(); v_tal bigint; v_cin bigint; v_ana bigint; v_caio bigint;
        v_ct_cin tid; v_ct_tal tid; v_ct_caio tid; v_ct_ana tid;
begin
  perform pg_temp.fixture_planilha(v_ws);
  v_tal := pg_temp.cid(v_ws, 'Talitha'); v_cin := pg_temp.cid(v_ws, 'Cinara');
  v_ana := pg_temp.mid(v_ws, 'Ana'); v_caio := pg_temp.mid(v_ws, 'Caio');
  -- settle every legacy row first (the fixture's legacy status may differ from 'ativo')
  perform public._financeiro_sincronizar_legado(v_ws, date '2026-10-01');
  select ctid into v_ct_cin from clientes where id = v_cin;
  select ctid into v_ct_tal from clientes where id = v_tal;
  select ctid into v_ct_caio from membros where id = v_caio;
  select ctid into v_ct_ana from membros where id = v_ana;
  perform public._financeiro_sincronizar_legado(v_ws, date '2026-10-01');
  assert (select ctid from clientes where id = v_cin) = v_ct_cin, 'sync: idempotent run rewrote Cinara';
  assert (select ctid from membros where id = v_caio) = v_ct_caio, 'sync: idempotent run rewrote Caio';
  update financeiro_cliente_versoes set valor_mensal = 2900 where cliente_id = v_tal;
  update financeiro_acordo_versoes set valor = 4100 where membro_id = v_ana;
  perform public._financeiro_sincronizar_legado(v_ws, date '2026-10-01');
  assert (select ctid from clientes where id = v_cin) = v_ct_cin, 'sync: rewrote an unchanged client';
  assert (select ctid from membros where id = v_caio) = v_ct_caio, 'sync: rewrote an unchanged member';
  assert (select ctid from clientes where id = v_tal) <> v_ct_tal and (select valor_mensal from clientes where id = v_tal) = 2900,
    'sync: Talitha not updated';
  assert (select ctid from membros where id = v_ana) <> v_ct_ana and (select custo_mensal from membros where id = v_ana) = 4100,
    'sync: Ana not updated';
  -- versions effective at a later start are not written
  insert into financeiro_cliente_versoes (conta_id, cliente_id, vale_desde, valor_mensal, status)
    values (v_ws, v_cin, date '2026-11-01', 9999, 'pausado');
  perform public._financeiro_sincronizar_legado(v_ws, date '2026-10-01');
  assert (select valor_mensal from clientes where id = v_cin) = 2000, 'sync: future version leaked';
  perform public._financeiro_sincronizar_legado(v_ws, date '2026-11-01');
  assert (select valor_mensal = 9999 and status = 'pausado' from clientes where id = v_cin), 'sync: November version';
  raise notice 'PASS sincronizar_legado_only_changed_rows';
end $$;

-- no aberto period row: the version is saved, the write-through is skipped
do $$
declare v_ws uuid := pg_temp.novo_ws(); v_tal bigint;
begin
  perform pg_temp.fixture_planilha(v_ws);
  v_tal := pg_temp.cid(v_ws, 'Talitha');
  update financeiro_periodos set status = 'reaberto' where conta_id = v_ws;
  perform pg_temp.ok(pg_temp.dono(v_ws), format(
    'select public.financeiro_cliente_salvar(%s, %L, 2800, null, %L)', v_tal, '2026-10-01', 'ativo'));
  assert (select valor_mensal from financeiro_cliente_versoes where cliente_id = v_tal) = 2800, 'no_open: version saved';
  assert (select valor_mensal from clientes where id = v_tal) = 2500, 'no_open: legacy written without an aberto period';
  raise notice 'PASS write_through_skipped_without_open_period';
end $$;

-- versao_efetiva_boundaries: the effective version is the greatest vale_desde <= inicio, and an
-- assignment is active when desde <= inicio < ate
do $$
declare v_ws uuid := pg_temp.novo_ws(); v_tal bigint; v_ana bigint; v_caio bigint; v_cin bigint; r jsonb;
begin
  perform pg_temp.fixture_planilha(v_ws);
  v_tal := pg_temp.cid(v_ws, 'Talitha'); v_cin := pg_temp.cid(v_ws, 'Cinara');
  v_ana := pg_temp.mid(v_ws, 'Ana'); v_caio := pg_temp.mid(v_ws, 'Caio');
  insert into financeiro_cliente_versoes (conta_id, cliente_id, vale_desde, valor_mensal, status) values
    (v_ws, v_tal, date '2026-08-01', 1000, 'ativo'),
    (v_ws, v_tal, date '2026-11-01', 2800, 'ativo');
  insert into financeiro_acordo_versoes (conta_id, membro_id, vale_desde, funcao_id, modelo, valor) values
    (v_ws, v_ana, date '2026-08-01', pg_temp.fid(v_ws, 'Design'), 'mensal_meta', 1000),
    (v_ws, v_ana, date '2026-11-01', pg_temp.fid(v_ws, 'Design'), 'mensal_meta', 4500);
  -- Ana on Cinara ends on 2026-10-02 (still active in October); Caio on Talitha starts 2026-11-01
  update financeiro_atribuicoes set ate = date '2026-10-02' where membro_id = v_ana and cliente_id = v_cin;
  insert into financeiro_atribuicoes (conta_id, membro_id, cliente_id, desde) values (v_ws, v_caio, v_tal, date '2026-11-01');

  r := public._financeiro_calcular(v_ws, date '2026-10-01');
  assert (pg_temp.c(r, 'Talitha')->>'receita')::numeric = 2500, 'boundaries oct: Talitha receita ' || (pg_temp.c(r, 'Talitha')->>'receita');
  assert (pg_temp.m(r, 'Ana')->>'custo')::numeric = 3900, 'boundaries oct: Ana custo ' || (pg_temp.m(r, 'Ana')->>'custo');
  assert pg_temp.atende(r, 'Cinara', 'Ana') and (pg_temp.m(r, 'Ana')->>'n_clientes')::int = 15, 'boundaries oct: ate-pair active';
  assert not pg_temp.atende(r, 'Talitha', 'Caio') and (pg_temp.m(r, 'Caio')->>'n_clientes')::int = 14, 'boundaries oct: desde-pair inactive';

  r := public._financeiro_calcular(v_ws, date '2026-11-01');
  assert (pg_temp.c(r, 'Talitha')->>'receita')::numeric = 2800, 'boundaries nov: Talitha receita ' || (pg_temp.c(r, 'Talitha')->>'receita');
  assert (pg_temp.m(r, 'Ana')->>'custo')::numeric = 4500, 'boundaries nov: Ana custo ' || (pg_temp.m(r, 'Ana')->>'custo');
  assert not pg_temp.atende(r, 'Cinara', 'Ana') and (pg_temp.m(r, 'Ana')->>'n_clientes')::int = 14, 'boundaries nov: ate-pair ended';
  assert pg_temp.atende(r, 'Talitha', 'Caio') and (pg_temp.m(r, 'Caio')->>'n_clientes')::int = 15, 'boundaries nov: desde-pair active';

  r := public._financeiro_calcular(v_ws, date '2026-09-01');
  assert (pg_temp.c(r, 'Talitha')->>'receita')::numeric = 1000 and (pg_temp.m(r, 'Ana')->>'custo')::numeric = 1000,
    'boundaries sep: the older versions';
  raise notice 'PASS versao_efetiva_boundaries';
end $$;

-- grants: the write RPCs are authenticated + service_role and DEFINER; the internals service_role only
do $$
declare v_fn text;
begin
  foreach v_fn in array array[
      'public.financeiro_config_salvar(int, numeric)',
      'public.financeiro_funcao_salvar(bigint, text, int)',
      'public.financeiro_funcao_excluir(bigint)',
      'public.financeiro_cliente_salvar(bigint, date, numeric, int, text)',
      'public.financeiro_acordo_salvar(bigint, date, jsonb)',
      'public.financeiro_atribuicoes_salvar(date, jsonb)',
      'public.financeiro_entregas_salvar(date, bigint, jsonb)'] loop
    assert not has_function_privilege('anon', v_fn, 'execute'), 'anon executes ' || v_fn;
    assert not has_function_privilege('public', v_fn, 'execute'), 'PUBLIC executes ' || v_fn;
    assert has_function_privilege('authenticated', v_fn, 'execute'), 'authenticated cannot execute ' || v_fn;
    assert has_function_privilege('service_role', v_fn, 'execute'), 'service_role cannot execute ' || v_fn;
    assert (select prosecdef from pg_proc where oid = v_fn::regprocedure), v_fn || ' is not SECURITY DEFINER';
    assert (select proconfig from pg_proc where oid = v_fn::regprocedure) @> array['search_path=public, pg_temp'],
      v_fn || ' search_path ' || coalesce((select proconfig::text from pg_proc where oid = v_fn::regprocedure), 'null');
  end loop;
  foreach v_fn in array array['public._financeiro_sincronizar_legado(uuid, date)', 'public._financeiro_inicio_editavel(uuid, date)'] loop
    assert not has_function_privilege('anon', v_fn, 'execute'), 'anon executes ' || v_fn;
    assert not has_function_privilege('authenticated', v_fn, 'execute'), 'authenticated executes ' || v_fn;
    assert has_function_privilege('service_role', v_fn, 'execute'), 'service_role lost ' || v_fn;
    assert (select prosecdef from pg_proc where oid = v_fn::regprocedure), v_fn || ' is not SECURITY DEFINER';
  end loop;
  raise notice 'PASS write_grants';
end $$;

rollback;
