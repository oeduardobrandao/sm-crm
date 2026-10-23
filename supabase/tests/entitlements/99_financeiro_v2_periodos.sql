\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Financeiro v2 period close job, reopen and close (20261027000006_financeiro_v2_periodos_job.sql).
-- financeiro_rolar_periodos(p_hoje) closes every ended 'aberto' latest period with a
-- frozen snapshot, opens the next one and writes the versions effective at the new
-- open period through to the legacy columns. financeiro_periodo_reabrir /
-- financeiro_periodo_fechar move a period fechado -> reaberto -> fechado (owner/admin).
-- Fixture: the owner's spreadsheet (same as 99_financeiro_v2_escrita), one open period
-- out 2026. Every test builds its own workspace. The whole file is ONE transaction, so
-- each roll also rolls the workspaces of earlier blocks: assertions stay scoped to
-- the block's own workspace.
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

-- The spreadsheet (copied from 99_financeiro_v2_escrita). The config row goes in last.
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
create or replace function pg_temp.mid(p_ws uuid, p_nome text) returns bigint language sql as $f$
  select id from membros where conta_id = p_ws and nome = p_nome
$f$;
create or replace function pg_temp.cid(p_ws uuid, p_nome text) returns bigint language sql as $f$
  select id from clientes where conta_id = p_ws and nome = p_nome
$f$;
create or replace function pg_temp.per(p_ws uuid, p_inicio date) returns financeiro_periodos language sql as $f$
  select * from financeiro_periodos where conta_id = p_ws and inicio = p_inicio
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
-- rolar_closes_and_opens_next
do $$
declare v_ws uuid := pg_temp.novo_ws(); v_out financeiro_periodos; v_nov financeiro_periodos;
begin
  perform pg_temp.fixture_planilha(v_ws);
  -- not ended yet: nothing happens
  perform public.financeiro_rolar_periodos(date '2026-10-31');
  assert (pg_temp.per(v_ws, date '2026-10-01')).status = 'aberto', 'rolar: Oct closed before its end';
  assert (select count(*) from financeiro_periodos where conta_id = v_ws) = 1, 'rolar: next period opened early';

  perform public.financeiro_rolar_periodos(date '2026-11-01');
  v_out := pg_temp.per(v_ws, date '2026-10-01');
  assert v_out.status = 'fechado' and v_out.fechado_em is not null, 'rolar: Oct not fechado ' || row_to_json(v_out)::text;
  assert v_out.snapshot->'periodo'->>'status' = 'fechado', 'rolar: stored snapshot status ' || (v_out.snapshot->'periodo'->>'status');
  assert v_out.snapshot->'periodo'->>'inicio' = '2026-10-01', 'rolar: snapshot periodo';
  assert (pg_temp.c(v_out.snapshot, 'Talitha')->>'receita')::numeric = 2500, 'rolar: Talitha in the snapshot';
  assert jsonb_array_length(v_out.snapshot->'clientes') = 15, 'rolar: 15 clients in the snapshot';
  v_nov := pg_temp.per(v_ws, date '2026-11-01');
  assert v_nov.status = 'aberto' and v_nov.fim = date '2026-12-01' and not v_nov.transicao and v_nov.snapshot is null,
    'rolar: Nov row ' || coalesce(row_to_json(v_nov)::text, 'missing');
  assert (select count(*) from financeiro_periodos where conta_id = v_ws) = 2, 'rolar: exactly two rows';
  raise notice 'PASS rolar_closes_and_opens_next';
end $$;

-- rolar_twice_noop
do $$
declare v_ws uuid := pg_temp.novo_ws(); v_snap jsonb;
begin
  perform pg_temp.fixture_planilha(v_ws);
  perform public.financeiro_rolar_periodos(date '2026-11-01');
  -- now() is frozen inside the transaction: stamp sentinels so a second close would show
  update financeiro_periodos set fechado_em = timestamptz '2000-01-01 00:00Z'
   where conta_id = v_ws and inicio = date '2026-10-01';
  v_snap := (pg_temp.per(v_ws, date '2026-10-01')).snapshot;
  -- change a fee in Oct directly: a re-close would freeze it into the snapshot
  update financeiro_cliente_versoes set valor_mensal = 9999
   where conta_id = v_ws and cliente_id = pg_temp.cid(v_ws, 'Cinara') and vale_desde = date '2026-10-01';
  perform public.financeiro_rolar_periodos(date '2026-11-01');
  perform public.financeiro_rolar_periodos(date '2026-11-20');
  assert (select count(*) from financeiro_periodos where conta_id = v_ws and inicio = date '2026-11-01') = 1, 'twice: one Nov row';
  assert (select count(*) from financeiro_periodos where conta_id = v_ws) = 2, 'twice: two rows';
  assert (pg_temp.per(v_ws, date '2026-10-01')).fechado_em = timestamptz '2000-01-01 00:00Z', 'twice: Oct fechado_em changed';
  assert (pg_temp.per(v_ws, date '2026-10-01')).snapshot = v_snap, 'twice: Oct snapshot changed';
  assert (pg_temp.per(v_ws, date '2026-11-01')).status = 'aberto', 'twice: Nov still aberto';
  raise notice 'PASS rolar_twice_noop';
end $$;

-- rolar_late_closes_two_in_order
do $$
declare v_ws uuid := pg_temp.novo_ws(); v_set financeiro_periodos; v_out financeiro_periodos; v_nov financeiro_periodos;
begin
  perform pg_temp.fixture_planilha(v_ws);
  -- the open period is Sep (no version starts before Oct, so Sep lists no client)
  delete from financeiro_periodos where conta_id = v_ws;
  insert into financeiro_periodos (conta_id, inicio, fim) values (v_ws, date '2026-09-01', date '2026-10-01');
  perform public.financeiro_rolar_periodos(date '2026-11-02');
  v_set := pg_temp.per(v_ws, date '2026-09-01');
  v_out := pg_temp.per(v_ws, date '2026-10-01');
  v_nov := pg_temp.per(v_ws, date '2026-11-01');
  assert v_set.status = 'fechado' and jsonb_array_length(v_set.snapshot->'clientes') = 0,
    'late: Sep fechado with its own (empty) content ' || coalesce(v_set.snapshot::text, 'null');
  assert v_set.snapshot->'periodo'->>'inicio' = '2026-09-01' and v_set.snapshot->'periodo'->>'status' = 'fechado', 'late: Sep snapshot periodo';
  assert v_out.status = 'fechado' and (pg_temp.c(v_out.snapshot, 'Talitha')->>'receita')::numeric = 2500,
    'late: Oct fechado with Talitha ' || coalesce(row_to_json(v_out)::text, 'missing');
  assert v_out.fim = date '2026-11-01' and not v_out.transicao, 'late: Oct row shape';
  assert v_out.snapshot->'periodo'->>'inicio' = '2026-10-01' and v_out.snapshot->'periodo'->>'status' = 'fechado', 'late: Oct snapshot periodo';
  assert v_nov.status = 'aberto' and v_nov.fim = date '2026-12-01', 'late: Nov aberto ' || coalesce(row_to_json(v_nov)::text, 'missing');
  assert (select count(*) from financeiro_periodos where conta_id = v_ws) = 3, 'late: three rows';
  raise notice 'PASS rolar_late_closes_two_in_order';
end $$;

-- rolar_applies_future_version
do $$
declare v_ws uuid := pg_temp.novo_ws(); v_tal bigint; v_ana bigint;
begin
  perform pg_temp.fixture_planilha(v_ws);
  v_tal := pg_temp.cid(v_ws, 'Talitha');
  v_ana := pg_temp.mid(v_ws, 'Ana');
  perform pg_temp.ok(pg_temp.dono(v_ws), format(
    'select public.financeiro_cliente_salvar(%s, %L, 2800, 12, %L)', v_tal, '2026-11-01', 'ativo'));
  perform pg_temp.ok(pg_temp.dono(v_ws), format(
    'select public.financeiro_acordo_salvar(%s, %L, %L::jsonb)', v_ana, '2026-11-01',
    '{"funcao_id":' || (select funcao_id from financeiro_acordo_versoes where membro_id = v_ana) || ',"modelo":"mensal_meta","valor":4200,"dia_pagamento":5}'));
  assert (select valor_mensal from clientes where id = v_tal) = 2500, 'future: legacy still 2500 before the roll';
  assert (select custo_mensal from membros where id = v_ana) = 3900, 'future: legacy custo still 3900 before the roll';

  perform public.financeiro_rolar_periodos(date '2026-11-01');
  assert (select valor_mensal from clientes where id = v_tal) = 2800, 'future: legacy valor_mensal is the Nov value';
  assert (select data_pagamento from clientes where id = v_tal) = 12, 'future: legacy data_pagamento is the Nov value';
  assert (select custo_mensal from membros where id = v_ana) = 4200, 'future: legacy custo_mensal is the Nov value';
  assert (select data_pagamento from membros where id = v_ana) = 5, 'future: legacy membro data_pagamento';
  -- the write-through fired the legacy triggers; the compare-and-skip guard held
  assert (select count(*) from financeiro_cliente_versoes where cliente_id = v_tal) = 2, 'future: Talitha versions duplicated';
  assert (select count(*) from financeiro_acordo_versoes where membro_id = v_ana) = 2, 'future: Ana versions duplicated';
  -- the closed Oct keeps the old values
  assert (pg_temp.c((pg_temp.per(v_ws, date '2026-10-01')).snapshot, 'Talitha')->>'receita')::numeric = 2500, 'future: Oct snapshot 2500';
  -- unrelated clients untouched
  assert (select valor_mensal from clientes where id = pg_temp.cid(v_ws, 'Cinara')) = 2000, 'future: Cinara legacy';
  raise notice 'PASS rolar_applies_future_version';
end $$;

-- rolar_transicao_after_day_change
do $$
declare v_ws uuid := pg_temp.novo_ws(); v_p financeiro_periodos;
begin
  perform pg_temp.fixture_planilha(v_ws);
  perform pg_temp.ok(pg_temp.dono(v_ws), 'select public.financeiro_config_salvar(15, null)');
  perform public.financeiro_rolar_periodos(date '2026-11-01');
  assert (pg_temp.per(v_ws, date '2026-10-01')).fim = date '2026-11-01', 'transicao: Oct fim untouched';
  v_p := pg_temp.per(v_ws, date '2026-11-01');
  assert v_p.status = 'aberto' and v_p.fim = date '2026-11-15' and v_p.transicao,
    'transicao: Nov transition row ' || coalesce(row_to_json(v_p)::text, 'missing');
  perform public.financeiro_rolar_periodos(date '2026-11-14');
  assert (pg_temp.per(v_ws, date '2026-11-01')).status = 'aberto', 'transicao: closed a day early';
  perform public.financeiro_rolar_periodos(date '2026-11-15');
  assert (pg_temp.per(v_ws, date '2026-11-01')).status = 'fechado', 'transicao: transition period closed';
  assert (pg_temp.per(v_ws, date '2026-11-01')).snapshot->'periodo'->>'transicao' = 'true', 'transicao: snapshot keeps transicao';
  v_p := pg_temp.per(v_ws, date '2026-11-15');
  assert v_p.status = 'aberto' and v_p.fim = date '2026-12-15' and not v_p.transicao,
    'transicao: regular row after ' || coalesce(row_to_json(v_p)::text, 'missing');
  raise notice 'PASS rolar_transicao_after_day_change';
end $$;

-- snapshot_keeps_names
do $$
declare v_ws uuid := pg_temp.novo_ws(); r jsonb;
begin
  perform pg_temp.fixture_planilha(v_ws);
  perform public.financeiro_rolar_periodos(date '2026-11-01');
  delete from clientes where id = pg_temp.cid(v_ws, 'Talitha');
  delete from membros where id = pg_temp.mid(v_ws, 'Lia');
  delete from financeiro_funcoes where conta_id = v_ws and nome = 'Videomaker';
  r := pg_temp.rpc(pg_temp.dono(v_ws), 'select public.financeiro_rentabilidade(''2026-10-01'')');
  assert r::text like '%"nome": "Talitha"%', 'keeps_names: Talitha gone from the snapshot';
  assert pg_temp.m(r, 'Lia') is not null, 'keeps_names: Lia gone from the snapshot';
  assert exists (select 1 from jsonb_array_elements(r->'funcoes') e where e->>'nome' = 'Videomaker'), 'keeps_names: funcao gone';
  -- the live Nov no longer has them
  r := pg_temp.rpc(pg_temp.dono(v_ws), 'select public.financeiro_rentabilidade(''2026-11-01'')');
  assert pg_temp.c(r, 'Talitha') is null, 'keeps_names: live Nov still lists Talitha';
  raise notice 'PASS snapshot_keeps_names';
end $$;

-- snapshot_status_overlay
do $$
declare v_ws uuid := pg_temp.novo_ws(); v_dono uuid; r jsonb;
begin
  perform pg_temp.fixture_planilha(v_ws);
  v_dono := pg_temp.dono(v_ws);
  perform public.financeiro_rolar_periodos(date '2026-12-01');
  perform pg_temp.ok(v_dono, 'select public.financeiro_periodo_reabrir(''2026-11-01'')');
  -- a snapshot frozen without the overlay still reports the row's real status
  update financeiro_periodos set snapshot = jsonb_set(snapshot, '{periodo,status}', '"aberto"')
   where conta_id = v_ws and inicio = date '2026-10-01';
  r := pg_temp.rpc(v_dono, 'select public.financeiro_rentabilidade(''2026-10-01'')');
  assert r->'periodo'->>'status' = 'fechado', 'overlay: fechado reads ' || (r->'periodo'->>'status');
  r := pg_temp.rpc(v_dono, 'select public.financeiro_rentabilidade(''2026-11-01'')');
  assert r->'periodo'->>'status' = 'reaberto', 'overlay: reaberto reads ' || (r->'periodo'->>'status');
  r := pg_temp.rpc(v_dono, 'select public.financeiro_rentabilidade(''2026-12-01'')');
  assert r->'periodo'->>'status' = 'aberto', 'overlay: aberto reads ' || (r->'periodo'->>'status');
  r := pg_temp.rpc(v_dono, 'select public.financeiro_rentabilidade()');
  assert r->'periodo'->>'inicio' = '2026-12-01' and r->'periodo'->>'status' = 'aberto', 'overlay: default period';
  raise notice 'PASS snapshot_status_overlay';
end $$;

-- reabrir_fechar_cycle
do $$
declare
  v_ws uuid := pg_temp.novo_ws(); v_dono uuid; v_tal bigint; v_ana bigint; v_err text; r jsonb;
  v_nov_snap jsonb; v_out financeiro_periodos; v_ed jsonb;
begin
  perform pg_temp.fixture_planilha(v_ws);
  v_dono := pg_temp.dono(v_ws);
  v_tal := pg_temp.cid(v_ws, 'Talitha');
  v_ana := pg_temp.mid(v_ws, 'Ana');
  perform public.financeiro_rolar_periodos(date '2026-12-01');
  v_nov_snap := (pg_temp.per(v_ws, date '2026-11-01')).snapshot;
  update financeiro_periodos set fechado_em = timestamptz '2000-01-01 00:00Z'
   where conta_id = v_ws and inicio = date '2026-10-01';

  -- closed: edits from Oct are rejected
  v_err := pg_temp.exec_as(v_dono, format(
    'select public.financeiro_cliente_salvar(%s, %L, 2800, null, %L)', v_tal, '2026-10-01', 'ativo'));
  assert v_err = 'P0001:periodo_fechado', 'cycle: closed Oct accepted an edit ' || coalesce(v_err, 'success');

  perform pg_temp.ok(v_dono, 'select public.financeiro_periodo_reabrir(''2026-10-01'')');
  v_out := pg_temp.per(v_ws, date '2026-10-01');
  assert v_out.status = 'reaberto' and v_out.snapshot is not null, 'cycle: reaberto keeps the snapshot ' || row_to_json(v_out)::text;
  assert (select count(*) from audit_log where conta_id = v_ws and action = 'financeiro-periodo-reabrir'
            and resource_type = 'financeiro_periodo' and resource_id = '2026-10-01' and actor_user_id = v_dono) = 1,
    'cycle: reabrir audit row';
  v_ed := pg_temp.rpc(v_dono, 'select public.financeiro_periodos_editaveis()');
  assert exists (select 1 from jsonb_array_elements(v_ed) e where e->>'inicio' = '2026-10-01' and e->>'status' = 'reaberto'),
    'cycle: editaveis lists the reaberto Oct ' || v_ed::text;

  -- reaberto: edits from Oct are accepted and Oct recomputes live
  perform pg_temp.ok(v_dono, format(
    'select public.financeiro_cliente_salvar(%s, %L, 2800, null, %L)', v_tal, '2026-10-01', 'ativo'));
  perform pg_temp.ok(v_dono, format(
    'select public.financeiro_acordo_salvar(%s, %L, %L::jsonb)', v_ana, '2026-10-01',
    '{"funcao_id":' || (select funcao_id from financeiro_acordo_versoes where membro_id = v_ana) || ',"modelo":"mensal_meta","valor":4500}'));
  r := pg_temp.rpc(v_dono, 'select public.financeiro_rentabilidade(''2026-10-01'')');
  assert r->'periodo'->>'status' = 'reaberto', 'cycle: live Oct status';
  assert (pg_temp.c(r, 'Talitha')->>'receita')::numeric = 2800, 'cycle: live Oct Talitha ' || (pg_temp.c(r, 'Talitha')->>'receita');
  assert (pg_temp.m(r, 'Ana')->>'custo')::numeric = 4500, 'cycle: live Oct Ana ' || (pg_temp.m(r, 'Ana')->>'custo');
  -- Nov is still fechado: its snapshot is untouched and it still rejects edits
  assert (pg_temp.per(v_ws, date '2026-11-01')).snapshot = v_nov_snap, 'cycle: Nov snapshot changed';
  r := pg_temp.rpc(v_dono, 'select public.financeiro_rentabilidade(''2026-11-01'')');
  assert (pg_temp.c(r, 'Talitha')->>'receita')::numeric = 2500 and (pg_temp.m(r, 'Ana')->>'custo')::numeric = 3900,
    'cycle: Nov reads its snapshot';
  v_err := pg_temp.exec_as(v_dono, format(
    'select public.financeiro_cliente_salvar(%s, %L, 2900, null, %L)', v_tal, '2026-11-01', 'ativo'));
  assert v_err = 'P0001:periodo_fechado', 'cycle: fechado Nov accepted an edit ' || coalesce(v_err, 'success');

  -- wrong states and missing periods
  v_err := pg_temp.exec_as(v_dono, 'select public.financeiro_periodo_reabrir(''2026-10-01'')');
  assert v_err = 'P0001:periodo_estado_invalido', 'cycle: reopen a reaberto ' || coalesce(v_err, 'success');
  v_err := pg_temp.exec_as(v_dono, 'select public.financeiro_periodo_reabrir(''2026-12-01'')');
  assert v_err = 'P0001:periodo_estado_invalido', 'cycle: reopen an aberto ' || coalesce(v_err, 'success');
  v_err := pg_temp.exec_as(v_dono, 'select public.financeiro_periodo_fechar(''2026-12-01'')');
  assert v_err = 'P0001:periodo_estado_invalido', 'cycle: close an aberto ' || coalesce(v_err, 'success');
  v_err := pg_temp.exec_as(v_dono, 'select public.financeiro_periodo_fechar(''2026-11-01'')');
  assert v_err = 'P0001:periodo_estado_invalido', 'cycle: close a fechado ' || coalesce(v_err, 'success');
  v_err := pg_temp.exec_as(v_dono, 'select public.financeiro_periodo_reabrir(''2025-01-01'')');
  assert v_err = 'P0002:not_found', 'cycle: reopen missing ' || coalesce(v_err, 'success');
  v_err := pg_temp.exec_as(v_dono, 'select public.financeiro_periodo_fechar(''2025-01-01'')');
  assert v_err = 'P0002:not_found', 'cycle: close missing ' || coalesce(v_err, 'success');
  v_err := pg_temp.exec_as(v_dono, 'select public.financeiro_periodo_reabrir(null)');
  assert v_err = 'P0002:not_found', 'cycle: reopen null ' || coalesce(v_err, 'success');

  -- close again: a fresh snapshot with the new values
  perform pg_temp.ok(v_dono, 'select public.financeiro_periodo_fechar(''2026-10-01'')');
  v_out := pg_temp.per(v_ws, date '2026-10-01');
  assert v_out.status = 'fechado', 'cycle: Oct fechado again';
  assert v_out.fechado_em <> timestamptz '2000-01-01 00:00Z', 'cycle: fechado_em not refreshed';
  assert v_out.snapshot->'periodo'->>'status' = 'fechado', 'cycle: fresh snapshot status ' || (v_out.snapshot->'periodo'->>'status');
  assert (pg_temp.c(v_out.snapshot, 'Talitha')->>'receita')::numeric = 2800, 'cycle: fresh snapshot Talitha';
  assert (pg_temp.m(v_out.snapshot, 'Ana')->>'custo')::numeric = 4500, 'cycle: fresh snapshot Ana';
  r := pg_temp.rpc(v_dono, 'select public.financeiro_rentabilidade(''2026-10-01'')');
  assert r = v_out.snapshot, 'cycle: rentabilidade returns the fresh snapshot';
  assert (select count(*) from audit_log where conta_id = v_ws and action = 'financeiro-periodo-fechar'
            and resource_type = 'financeiro_periodo' and resource_id = '2026-10-01' and actor_user_id = v_dono) = 1,
    'cycle: fechar audit row';
  v_err := pg_temp.exec_as(v_dono, format(
    'select public.financeiro_cliente_salvar(%s, %L, 3000, null, %L)', v_tal, '2026-10-01', 'ativo'));
  assert v_err = 'P0001:periodo_fechado', 'cycle: re-closed Oct accepted an edit ' || coalesce(v_err, 'success');
  raise notice 'PASS reabrir_fechar_cycle';
end $$;

-- reabrir_cross_tenant: another workspace's owner cannot reopen this workspace's period
do $$
declare v_ws uuid := pg_temp.novo_ws(); v_b uuid := pg_temp.novo_ws(); v_err text;
begin
  perform pg_temp.fixture_planilha(v_ws);
  perform pg_temp.fixture_planilha(v_b);
  delete from financeiro_periodos where conta_id = v_b;
  insert into financeiro_periodos (conta_id, inicio, fim) values (v_b, date '2026-11-01', date '2026-12-01');
  update financeiro_periodos set status = 'fechado', snapshot = '{}'::jsonb, fechado_em = now()
   where conta_id = v_ws and inicio = date '2026-10-01';
  v_err := pg_temp.exec_as(pg_temp.dono(v_b), 'select public.financeiro_periodo_reabrir(''2026-10-01'')');
  assert v_err = 'P0002:not_found', 'cross_tenant: ' || coalesce(v_err, 'success');
  assert (pg_temp.per(v_ws, date '2026-10-01')).status = 'fechado', 'cross_tenant: foreign period reopened';
  raise notice 'PASS reabrir_cross_tenant';
end $$;

-- reabrir_agent_denied (and admin allowed, flags and nao_configurado first)
do $$
declare
  v_ws uuid := pg_temp.novo_ws(); v_dono uuid; v_agent uuid := gen_random_uuid(); v_admin uuid := gen_random_uuid();
  v_ver uuid := gen_random_uuid(); v_role uuid; v_role_ver uuid; v_err text; v_un uuid;
begin
  perform pg_temp.fixture_planilha(v_ws);
  v_dono := pg_temp.dono(v_ws);
  perform public.financeiro_rolar_periodos(date '2026-11-01');
  insert into auth.users (id) values (v_agent), (v_admin), (v_ver);
  -- an agent whose custom role CAN edit financeiro: has_permission passes, the role check denies
  insert into workspace_roles (conta_id, nome, permissions)
    values (v_ws, 'Financeiro edição', '{"financeiro":"editar"}'::jsonb) returning id into v_role;
  insert into workspace_roles (conta_id, nome, permissions)
    values (v_ws, 'Financeiro leitura', '{"financeiro":"ver"}'::jsonb) returning id into v_role_ver;
  insert into workspace_members (user_id, workspace_id, role, role_id) values (v_agent, v_ws, 'agent', v_role);
  insert into workspace_members (user_id, workspace_id, role, role_id) values (v_ver, v_ws, 'agent', v_role_ver);
  insert into workspace_members (user_id, workspace_id, role, can_see_financials) values (v_admin, v_ws, 'admin', true);
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id in (v_agent, v_admin, v_ver);
  -- the agent really can write elsewhere
  perform pg_temp.ok(v_agent, format('select public.financeiro_cliente_salvar(%s, %L, 2600, null, %L)',
    pg_temp.cid(v_ws, 'Talitha'), '2026-11-01', 'ativo'));

  v_err := pg_temp.exec_as(v_agent, 'select public.financeiro_periodo_reabrir(''2026-10-01'')');
  assert v_err = '42501:financial_access_denied', 'agent: reabrir ' || coalesce(v_err, 'success');
  assert (pg_temp.per(v_ws, date '2026-10-01')).status = 'fechado', 'agent: period changed';
  v_err := pg_temp.exec_as(v_ver, 'select public.financeiro_periodo_reabrir(''2026-10-01'')');
  assert v_err = '42501:financial_access_denied', 'viewer: reabrir ' || coalesce(v_err, 'success');

  -- an admin with financeiro edit may reopen and close
  perform pg_temp.ok(v_admin, 'select public.financeiro_periodo_reabrir(''2026-10-01'')');
  v_err := pg_temp.exec_as(v_agent, 'select public.financeiro_periodo_fechar(''2026-10-01'')');
  assert v_err = '42501:financial_access_denied', 'agent: fechar ' || coalesce(v_err, 'success');
  assert (pg_temp.per(v_ws, date '2026-10-01')).status = 'reaberto', 'agent: fechar changed the period';
  perform pg_temp.ok(v_admin, 'select public.financeiro_periodo_fechar(''2026-10-01'')');
  assert (pg_temp.per(v_ws, date '2026-10-01')).status = 'fechado', 'admin: closed';

  -- flags come before the permission and role checks
  update workspace_plan_overrides set feature_overrides = '{"feature_financeiro_v2": false}'::jsonb where workspace_id = v_ws;
  v_err := pg_temp.exec_as(v_agent, 'select public.financeiro_periodo_reabrir(''2026-10-01'')');
  assert v_err = 'P0001:feature_disabled:feature_financeiro_v2', 'flag v2: agent ' || coalesce(v_err, 'success');
  v_err := pg_temp.exec_as(v_dono, 'select public.financeiro_periodo_fechar(''2026-10-01'')');
  assert v_err = 'P0001:feature_disabled:feature_financeiro_v2', 'flag v2: owner ' || coalesce(v_err, 'success');
  update workspace_plan_overrides set feature_overrides = '{"feature_financeiro_v2": true, "feature_financial": false}'::jsonb where workspace_id = v_ws;
  v_err := pg_temp.exec_as(v_dono, 'select public.financeiro_periodo_reabrir(''2026-10-01'')');
  assert v_err = 'P0001:feature_disabled:feature_financial', 'flag financial: owner ' || coalesce(v_err, 'success');

  -- unseeded workspace: nao_configurado
  v_un := pg_temp.novo_ws();
  v_err := pg_temp.exec_as(pg_temp.dono(v_un), 'select public.financeiro_periodo_reabrir(''2026-10-01'')');
  assert v_err = 'P0001:nao_configurado', 'unseeded: reabrir ' || coalesce(v_err, 'success');
  v_err := pg_temp.exec_as(pg_temp.dono(v_un), 'select public.financeiro_periodo_fechar(''2026-10-01'')');
  assert v_err = 'P0001:nao_configurado', 'unseeded: fechar ' || coalesce(v_err, 'success');
  raise notice 'PASS reabrir_agent_denied';
end $$;

-- job_skips_reaberto
do $$
declare v_ws uuid := pg_temp.novo_ws(); v_dono uuid; v_snap jsonb; v_out financeiro_periodos; v_nov financeiro_periodos;
begin
  perform pg_temp.fixture_planilha(v_ws);
  v_dono := pg_temp.dono(v_ws);
  -- Oct is the LATEST row and fechado (no Nov yet), then reopened
  v_snap := jsonb_set(public._financeiro_calcular(v_ws, date '2026-10-01'), '{periodo,status}', '"fechado"');
  update financeiro_periodos set status = 'fechado', snapshot = v_snap, fechado_em = timestamptz '2000-01-01 00:00Z'
   where conta_id = v_ws and inicio = date '2026-10-01';
  perform pg_temp.ok(v_dono, 'select public.financeiro_periodo_reabrir(''2026-10-01'')');
  perform public.financeiro_rolar_periodos(date '2026-11-01');
  v_out := pg_temp.per(v_ws, date '2026-10-01');
  assert v_out.status = 'reaberto', 'skips_reaberto: Oct ' || v_out.status;
  assert v_out.snapshot = v_snap and v_out.fechado_em = timestamptz '2000-01-01 00:00Z', 'skips_reaberto: Oct re-frozen';
  v_nov := pg_temp.per(v_ws, date '2026-11-01');
  assert v_nov.status = 'aberto' and v_nov.fim = date '2026-12-01', 'skips_reaberto: Nov opened ' || coalesce(row_to_json(v_nov)::text, 'missing');
  -- and a later roll closes Nov but still leaves the reaberto Oct alone
  perform public.financeiro_rolar_periodos(date '2026-12-01');
  assert (pg_temp.per(v_ws, date '2026-10-01')).status = 'reaberto', 'skips_reaberto: Oct after Dec roll';
  assert (pg_temp.per(v_ws, date '2026-11-01')).status = 'fechado', 'skips_reaberto: Nov closed';
  assert (pg_temp.per(v_ws, date '2026-12-01')).status = 'aberto', 'skips_reaberto: Dec opened';
  raise notice 'PASS job_skips_reaberto';
end $$;

-- rolar_isolates_failures
-- B (the failing workspace) is the smaller conta_id, so the roll (ORDER BY conta_id)
-- reaches it before A: A only closes if the loop goes on past B's failure. The
-- constraint blocks B's successor INSERT, after its UPDATE to fechado succeeded, so B
-- still aberto with no snapshot proves the partial close was rolled back.
do $$
declare v_x uuid := pg_temp.novo_ws(); v_y uuid := pg_temp.novo_ws(); v_a uuid; v_b uuid; v_tal_b bigint;
  v_oct financeiro_periodos;
begin
  v_b := least(v_x, v_y);
  v_a := greatest(v_x, v_y);
  perform pg_temp.fixture_planilha(v_a);
  perform pg_temp.fixture_planilha(v_b);
  v_tal_b := pg_temp.cid(v_b, 'Talitha');
  -- B has a Nov version: if the failed workspace's sync leaked, its legacy column would move
  insert into financeiro_cliente_versoes (conta_id, cliente_id, vale_desde, valor_mensal, status)
    values (v_b, v_tal_b, date '2026-11-01', 2800, 'ativo');
  execute format('alter table financeiro_periodos add constraint t_block check (conta_id <> %L or inicio <> %L) not valid',
                 v_b, '2026-11-01');
  perform public.financeiro_rolar_periodos(date '2026-11-01');
  v_oct := pg_temp.per(v_b, date '2026-10-01');
  assert v_oct.status = 'aberto' and v_oct.snapshot is null and v_oct.fechado_em is null,
    'isolates: B partial close not rolled back ' || row_to_json(v_oct)::text;
  assert pg_temp.per(v_b, date '2026-11-01') is null
     and (select count(*) from financeiro_periodos where conta_id = v_b) = 1, 'isolates: B got a Nov row';
  assert (select valor_mensal from clientes where id = v_tal_b) = 2500, 'isolates: B legacy written';
  assert (pg_temp.per(v_a, date '2026-10-01')).status = 'fechado', 'isolates: A (after B) not closed';
  assert (pg_temp.per(v_a, date '2026-11-01')).status = 'aberto', 'isolates: A Nov not opened';
  alter table financeiro_periodos drop constraint t_block;
  -- once the fault is gone the next run catches B up
  perform public.financeiro_rolar_periodos(date '2026-11-01');
  assert (pg_temp.per(v_b, date '2026-10-01')).status = 'fechado', 'isolates: B caught up';
  assert (pg_temp.per(v_b, date '2026-11-01')).status = 'aberto', 'isolates: B Nov after catch-up';
  assert (select valor_mensal from clientes where id = v_tal_b) = 2800, 'isolates: B legacy after catch-up';
  raise notice 'PASS rolar_isolates_failures';
end $$;

-- writes_take_shared_lock: v2 writes and the legacy trigger take the workspace key
-- shared, the seed exclusively (a second session can't be driven from here, so this
-- pins the lock itself; pg_locks splits a bigint advisory key into classid/objid).
create or replace function pg_temp.trava(p_ws uuid, p_mode text) returns boolean language sql as $f$
  select exists (
    select 1 from pg_locks l
     where l.locktype = 'advisory' and l.pid = pg_backend_pid() and l.granted and l.objsubid = 1
       and l.mode = p_mode
       and l.classid::bigint = ((public._financeiro_lock_key(p_ws) >> 32) & 4294967295)
       and l.objid::bigint = (public._financeiro_lock_key(p_ws) & 4294967295))
$f$;
do $$
declare v_leg uuid := pg_temp.novo_ws(); v_seed uuid := pg_temp.novo_ws(); v_ws uuid; v_rpc text; v_sql text;
begin
  -- Each of the 7 write RPCs on its own workspace, with the legacy triggers off: the
  -- write-through UPDATE of cliente/acordo_salvar would otherwise fire the trigger,
  -- which takes the same key and would mask a missing lock in the RPC itself.
  alter table clientes disable trigger trg_financeiro_v2_clientes_legado;
  alter table membros disable trigger trg_financeiro_v2_membros_legado;
  foreach v_rpc in array array['config_salvar', 'funcao_salvar', 'funcao_excluir', 'cliente_salvar',
                               'acordo_salvar', 'atribuicoes_salvar', 'entregas_salvar'] loop
    v_ws := pg_temp.novo_ws();
    perform pg_temp.fixture_planilha(v_ws);
    v_sql := case v_rpc
      when 'config_salvar' then 'select public.financeiro_config_salvar(15, null)'
      when 'funcao_salvar' then 'select public.financeiro_funcao_salvar(null, ''Nova'', null)'
      when 'funcao_excluir' then format('select public.financeiro_funcao_excluir(%s)',
        (select id from financeiro_funcoes where conta_id = v_ws and nome = 'Copy'))
      when 'cliente_salvar' then format('select public.financeiro_cliente_salvar(%s, %L, 2800, null, %L)',
        pg_temp.cid(v_ws, 'Talitha'), '2026-10-01', 'ativo')
      when 'acordo_salvar' then format('select public.financeiro_acordo_salvar(%s, %L, %L::jsonb)',
        pg_temp.mid(v_ws, 'Ana'), '2026-10-01', '{"modelo":"mensal_meta","valor":4000}')
      when 'atribuicoes_salvar' then format('select public.financeiro_atribuicoes_salvar(%L, %L::jsonb)', '2026-10-01',
        jsonb_build_array(jsonb_build_object('membro_id', pg_temp.mid(v_ws, 'Caio'), 'cliente_id', pg_temp.cid(v_ws, 'Talitha'), 'ativo', true)))
      when 'entregas_salvar' then format('select public.financeiro_entregas_salvar(%L, %s, %L::jsonb)', '2026-10-01',
        pg_temp.mid(v_ws, 'Ana'), jsonb_build_array(jsonb_build_object('cliente_id', pg_temp.cid(v_ws, 'Talitha'), 'quantidade', 3)))
    end;
    assert not pg_temp.trava(v_ws, 'ShareLock'), 'lock: held before ' || v_rpc;
    perform pg_temp.ok(pg_temp.dono(v_ws), v_sql);
    assert pg_temp.trava(v_ws, 'ShareLock'), 'lock: ' || v_rpc || ' holds no shared advisory lock on the workspace key';
    assert not pg_temp.trava(v_ws, 'ExclusiveLock'), 'lock: ' || v_rpc || ' took it exclusively';
  end loop;
  alter table clientes enable trigger trg_financeiro_v2_clientes_legado;
  alter table membros enable trigger trg_financeiro_v2_membros_legado;

  perform pg_temp.fixture_planilha(v_leg);
  assert not pg_temp.trava(v_leg, 'ShareLock'), 'lock: legacy ws held before';
  update clientes set valor_mensal = 2600 where id = pg_temp.cid(v_leg, 'Talitha');
  assert pg_temp.trava(v_leg, 'ShareLock'), 'lock: legacy trigger holds no shared lock';

  assert not pg_temp.trava(v_seed, 'ExclusiveLock'), 'lock: seed ws held before';
  perform pg_temp.ok(pg_temp.dono(v_seed), 'select public.financeiro_seed(1)');
  assert pg_temp.trava(v_seed, 'ExclusiveLock'), 'lock: seed holds no exclusive lock';
  raise notice 'PASS writes_take_shared_lock';
end $$;

-- grants: reopen/close are authenticated + service_role and DEFINER; the job is service_role only
do $$
declare v_fn text;
begin
  foreach v_fn in array array['public.financeiro_periodo_reabrir(date)', 'public.financeiro_periodo_fechar(date)',
                              'public.financeiro_rentabilidade(date)'] loop
    assert not has_function_privilege('anon', v_fn, 'execute'), 'anon executes ' || v_fn;
    assert not has_function_privilege('public', v_fn, 'execute'), 'PUBLIC executes ' || v_fn;
    assert has_function_privilege('authenticated', v_fn, 'execute'), 'authenticated cannot execute ' || v_fn;
    assert has_function_privilege('service_role', v_fn, 'execute'), 'service_role cannot execute ' || v_fn;
    assert (select prosecdef from pg_proc where oid = v_fn::regprocedure), v_fn || ' is not SECURITY DEFINER';
    assert (select proconfig from pg_proc where oid = v_fn::regprocedure) @> array['search_path=public, pg_temp'],
      v_fn || ' search_path ' || coalesce((select proconfig::text from pg_proc where oid = v_fn::regprocedure), 'null');
  end loop;
  v_fn := 'public.financeiro_rolar_periodos(date)';
  assert not has_function_privilege('anon', v_fn, 'execute'), 'anon executes ' || v_fn;
  assert not has_function_privilege('authenticated', v_fn, 'execute'), 'authenticated executes ' || v_fn;
  assert has_function_privilege('service_role', v_fn, 'execute'), 'service_role lost ' || v_fn;
  assert (select prosecdef from pg_proc where oid = v_fn::regprocedure), v_fn || ' is not SECURITY DEFINER';
  assert (select proconfig from pg_proc where oid = v_fn::regprocedure) @> array['lock_timeout=5s'],
    v_fn || ' lock_timeout ' || coalesce((select proconfig::text from pg_proc where oid = v_fn::regprocedure), 'null');
  -- the cron job exists, hourly, on its own minute
  assert (select schedule from cron.job where jobname = 'financeiro-v2-rolar-periodos') = '29 * * * *',
    'cron: financeiro-v2-rolar-periodos schedule';
  assert (select command from cron.job where jobname = 'financeiro-v2-rolar-periodos') like '%public.financeiro_rolar_periodos()%',
    'cron: command';
  assert (select count(*) from cron.job where jobname <> 'financeiro-v2-rolar-periodos' and schedule ~ '^29 ') = 0,
    'cron: minute 29 shared with another job';
  raise notice 'PASS periodos_grants';
end $$;

rollback;
