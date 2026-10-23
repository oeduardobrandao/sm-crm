\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Financeiro v2 seed and legacy capture (20261025000005_financeiro_v2_seed_legado.sql).
-- financeiro_seed ("Montar a partir dos dados atuais") builds v2 from today's
-- clientes.valor_mensal / membros.custo_mensal in one idempotent step. The triggers
-- on clientes / membros turn a legacy write (old screens, CSV import, lead
-- conversion, MCP) into a version at the current open period; v2's own
-- write-through compares equal and does nothing (the loop guard).
-- Fixture: legacy data only (no v2 rows), so every v2 row here comes from the seed
-- or the triggers. The seeded period is the one containing today (Sao Paulo).
begin;
-- the old screens write clientes / membros as authenticated, the MCP and imports as
-- service_role: mirror the hosted ACL for those tables, keep the v2 tables' own grants
select et_grant_hosted_parity(array[
  'financeiro_config','financeiro_funcoes','financeiro_cliente_versoes','financeiro_acordo_versoes',
  'financeiro_atribuicoes','financeiro_entregas_manuais','financeiro_periodos']);

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

-- start of the period containing today in Sao Paulo, for a start day
create or replace function pg_temp.ini(p_dia int default 1) returns date language sql as $f$
  select public.financeiro_periodo_inicio_de((now() at time zone 'America/Sao_Paulo')::date, p_dia)
$f$;

-- Legacy data only. Clients cover every legacy shape the seed maps: a null fee,
-- a null payment day, the three statuses and a null status. Members cover cargo
-- matching (exact after accent/case/trim normalization only) and a null custo.
create or replace function pg_temp.fixture_legado(p_ws uuid) returns void language plpgsql as $f$
declare v_owner uuid := pg_temp.dono(p_ws);
begin
  insert into clientes (user_id, conta_id, nome, sigla, cor, valor_mensal, data_pagamento, status) values
    (v_owner, p_ws, 'Talitha', 'Ta', '#000', 2500, 10, 'ativo'),
    (v_owner, p_ws, 'Cinara',  'Ci', '#000', 2000, 5,  'ativo'),
    (v_owner, p_ws, 'Roberta', 'Ro', '#000', null, null, 'pausado'),
    (v_owner, p_ws, 'Gabriel', 'Ga', '#000', 2100, 20, 'encerrado'),
    (v_owner, p_ws, 'Yasmin',  'Ya', '#000', 1800, 15, null);
  insert into membros (user_id, conta_id, nome, cargo, tipo, custo_mensal, data_pagamento, avatar_url) values
    (v_owner, p_ws, 'Ana',   'Design',          'clt', 3900, 5,    ''),
    (v_owner, p_ws, 'Bia',   'designer',        'clt', 1200, null, ''),
    (v_owner, p_ws, 'Bruno', 'edição de vídeo', 'clt', 3150, 10,   ''),
    (v_owner, p_ws, 'Caio',  'Videomaker',      'clt', null, 7,    ''),
    (v_owner, p_ws, 'Duda',  null,              'clt', 2400, 25,   '');
end $f$;

create or replace function pg_temp.fid(p_ws uuid, p_nome text) returns bigint language sql as $f$
  select id from financeiro_funcoes where conta_id = p_ws and nome = p_nome
$f$;
create or replace function pg_temp.mid(p_ws uuid, p_nome text) returns bigint language sql as $f$
  select id from membros where conta_id = p_ws and nome = p_nome
$f$;
create or replace function pg_temp.cid(p_ws uuid, p_nome text) returns bigint language sql as $f$
  select id from clientes where conta_id = p_ws and nome = p_nome
$f$;
create or replace function pg_temp.nver(p_ws uuid) returns bigint language sql as $f$
  select count(*) from financeiro_cliente_versoes where conta_id = p_ws
$f$;
create or replace function pg_temp.nacordo(p_ws uuid) returns bigint language sql as $f$
  select count(*) from financeiro_acordo_versoes where conta_id = p_ws
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
create or replace function pg_temp.ok(p_user uuid, p_sql text) returns void language plpgsql as $f$
declare v_err text;
begin
  v_err := pg_temp.exec_as(p_user, p_sql);
  if v_err is not null then
    raise exception 'unexpected error from %: %', p_sql, v_err;
  end if;
end $f$;
create or replace function pg_temp.rpc(p_user uuid, p_sql text) returns jsonb language plpgsql as $f$
declare v jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  execute p_sql into v;
  execute 'reset role';
  return v;
end $f$;
-- Run p_sql as service_role (the MCP, imports, edge functions). Must succeed.
create or replace function pg_temp.sr(p_sql text) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  execute 'set local role service_role';
  execute p_sql;
  execute 'reset role';
exception when others then
  execute 'reset role';
  raise exception 'unexpected error from % as service_role: % %', p_sql, sqlstate, sqlerrm;
end $f$;
grant execute on all functions in schema pg_temp to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- seed_creates_everything
do $$
declare v_ws uuid := pg_temp.novo_ws(); v_dono uuid; r jsonb; v_ini date := pg_temp.ini(1);
        v_cfg record; v_v record; v_a record; v_p record;
begin
  perform pg_temp.fixture_legado(v_ws);
  v_dono := pg_temp.dono(v_ws);
  r := pg_temp.rpc(v_dono, 'select public.financeiro_seed(1)');
  assert r = '{"seeded": true, "ja_existia": false}'::jsonb, 'seed: result ' || r::text;

  select * into v_cfg from financeiro_config where conta_id = v_ws;
  assert v_cfg.periodo_dia = 1 and v_cfg.meta_margem = 55 and v_cfg.seeded_at is not null,
    'seed: config ' || row_to_json(v_cfg)::text;

  assert (select array_agg(nome order by ordem) from financeiro_funcoes where conta_id = v_ws)
         = array['Videomaker','Design','Edição de vídeo','Copy','Gestão de projetos'],
    'seed: funcoes ' || (select array_agg(nome || ':' || ordem order by ordem) from financeiro_funcoes where conta_id = v_ws)::text;
  assert (select array_agg(ordem order by ordem) from financeiro_funcoes where conta_id = v_ws) = array[0,1,2,3,4],
    'seed: funcoes ordem';

  -- one version per client, all at the period start
  assert pg_temp.nver(v_ws) = 5, 'seed: versions ' || pg_temp.nver(v_ws);
  assert not exists (select 1 from financeiro_cliente_versoes where conta_id = v_ws and vale_desde <> v_ini),
    'seed: every version vale_desde is the period start';
  select * into v_v from financeiro_cliente_versoes where cliente_id = pg_temp.cid(v_ws, 'Talitha');
  assert v_v.valor_mensal = 2500 and v_v.dia_pagamento = 10 and v_v.status = 'ativo' and v_v.created_by = v_dono,
    'seed: Talitha ' || row_to_json(v_v)::text;
  select * into v_v from financeiro_cliente_versoes where cliente_id = pg_temp.cid(v_ws, 'Roberta');
  assert v_v.valor_mensal = 0 and v_v.dia_pagamento is null and v_v.status = 'pausado',
    'seed: Roberta (null fee -> 0, null day stays null) ' || row_to_json(v_v)::text;
  assert (select status from financeiro_cliente_versoes where cliente_id = pg_temp.cid(v_ws, 'Gabriel')) = 'encerrado',
    'seed: encerrado maps 1:1';
  assert (select status from financeiro_cliente_versoes where cliente_id = pg_temp.cid(v_ws, 'Yasmin')) = 'ativo',
    'seed: null status maps to ativo';

  -- one mensal_meta acordo per member
  assert pg_temp.nacordo(v_ws) = 5, 'seed: acordos ' || pg_temp.nacordo(v_ws);
  assert not exists (select 1 from financeiro_acordo_versoes where conta_id = v_ws
                      and (vale_desde <> v_ini or modelo <> 'mensal_meta')),
    'seed: every acordo is mensal_meta at the period start';
  select * into v_a from financeiro_acordo_versoes where membro_id = pg_temp.mid(v_ws, 'Ana');
  assert v_a.valor = 3900 and v_a.dia_pagamento = 5 and v_a.funcao_id = pg_temp.fid(v_ws, 'Design')
         and v_a.limite_clientes is null and v_a.created_by = v_dono,
    'seed: Ana ' || row_to_json(v_a)::text;
  select * into v_a from financeiro_acordo_versoes where membro_id = pg_temp.mid(v_ws, 'Caio');
  assert v_a.valor = 0 and v_a.dia_pagamento = 7 and v_a.funcao_id = pg_temp.fid(v_ws, 'Videomaker'),
    'seed: Caio (null custo -> 0) ' || row_to_json(v_a)::text;
  assert (select funcao_id from financeiro_acordo_versoes where membro_id = pg_temp.mid(v_ws, 'Duda')) is null,
    'seed: null cargo -> no funcao';

  -- the first period, and nothing else
  assert (select count(*) from financeiro_periodos where conta_id = v_ws) = 1, 'seed: one period';
  select * into v_p from financeiro_periodos where conta_id = v_ws;
  assert v_p.inicio = v_ini and v_p.fim = (v_ini + interval '1 month')::date and v_p.status = 'aberto',
    'seed: period ' || row_to_json(v_p)::text;
  assert not exists (select 1 from financeiro_atribuicoes where conta_id = v_ws), 'seed: no assignments';
  assert not exists (select 1 from financeiro_entregas_manuais where conta_id = v_ws), 'seed: no deliveries';
  -- the seed reads the legacy columns, it does not write them
  assert (select valor_mensal from clientes where id = pg_temp.cid(v_ws, 'Roberta')) is null, 'seed: legacy untouched';
  -- and the read RPC works right away
  r := pg_temp.rpc(v_dono, 'select public.financeiro_rentabilidade()');
  assert (select (e->>'receita')::numeric from jsonb_array_elements(r->'clientes') e where e->>'nome' = 'Talitha') = 2500,
    'seed: rentabilidade shows Talitha 2500 ' || r::text;
  raise notice 'PASS seed_creates_everything';
end $$;

-- seed_idempotent
do $$
declare v_ws uuid := pg_temp.novo_ws(); v_dono uuid; r jsonb; v_seeded timestamptz;
begin
  perform pg_temp.fixture_legado(v_ws);
  v_dono := pg_temp.dono(v_ws);
  perform pg_temp.rpc(v_dono, 'select public.financeiro_seed(1)');
  select seeded_at into v_seeded from financeiro_config where conta_id = v_ws;
  r := pg_temp.rpc(v_dono, 'select public.financeiro_seed(15)');
  assert r = '{"seeded": true, "ja_existia": true}'::jsonb, 'idempotent: result ' || r::text;
  assert (select periodo_dia from financeiro_config where conta_id = v_ws) = 1, 'idempotent: periodo_dia unchanged';
  assert (select seeded_at from financeiro_config where conta_id = v_ws) = v_seeded, 'idempotent: seeded_at unchanged';
  assert (select count(*) from financeiro_funcoes where conta_id = v_ws) = 5, 'idempotent: funcoes';
  assert pg_temp.nver(v_ws) = 5, 'idempotent: versions';
  assert pg_temp.nacordo(v_ws) = 5, 'idempotent: acordos';
  assert (select count(*) from financeiro_periodos where conta_id = v_ws) = 1, 'idempotent: periods';
  -- an invalid day on an already seeded workspace is still rejected (validation comes first)
  assert pg_temp.exec_as(v_dono, 'select public.financeiro_seed(0)') = 'P0001:periodo_dia_invalido',
    'idempotent: invalid day rejected';
  raise notice 'PASS seed_idempotent';
end $$;

-- seed_locks_legacy_rows: the seed locks the workspace's clientes / membros FOR SHARE before
-- copying them, so a legacy UPDATE that lands mid-seed waits for the commit (its trigger then
-- sees seeded_at). Pinned on the function body: a single session cannot race itself, the RI
-- checks of the copies already take RowShareLock (FOR KEY SHARE, which does not block an
-- UPDATE of valor_mensal), so pg_locks cannot tell the two apart, and the stack has neither
-- dblink nor pgrowlocks.
do $$
declare v_def text := pg_get_functiondef('public.financeiro_seed(int)'::regprocedure);
        v_cli int; v_mem int; v_ins int;
begin
  v_cli := strpos(v_def, 'FROM public.clientes c WHERE c.conta_id = v_conta FOR SHARE');
  v_mem := strpos(v_def, 'FROM public.membros m WHERE m.conta_id = v_conta FOR SHARE');
  v_ins := strpos(v_def, 'INSERT INTO public.financeiro_cliente_versoes');
  assert v_cli > 0, 'seed_locks: clientes not locked FOR SHARE';
  assert v_mem > 0, 'seed_locks: membros not locked FOR SHARE';
  assert v_cli < v_ins and v_mem < v_ins, 'seed_locks: the lock comes after the copy';
  assert strpos(v_def, 'RETURN jsonb_build_object(''seeded'', true, ''ja_existia'', true)') < v_cli,
    'seed_locks: an already seeded workspace should not lock its rows';
  raise notice 'PASS seed_locks_legacy_rows';
end $$;

-- seed_matches_cargo
do $$
declare v_ws uuid := pg_temp.novo_ws();
begin
  perform pg_temp.fixture_legado(v_ws);
  perform pg_temp.rpc(pg_temp.dono(v_ws), 'select public.financeiro_seed(1)');
  assert (select funcao_id from financeiro_acordo_versoes where membro_id = pg_temp.mid(v_ws, 'Bia')) is null,
    'cargo: designer does not match Design';
  assert (select funcao_id from financeiro_acordo_versoes where membro_id = pg_temp.mid(v_ws, 'Ana')) = pg_temp.fid(v_ws, 'Design'),
    'cargo: Design';
  assert (select funcao_id from financeiro_acordo_versoes where membro_id = pg_temp.mid(v_ws, 'Bruno'))
         = pg_temp.fid(v_ws, 'Edição de vídeo'),
    'cargo: edição de vídeo -> Edição de vídeo';
  assert public._financeiro_normalizar('  Edição de VÍDEO  ') = 'edicao de video', 'normalizar: accents, case, trim';
  assert public._financeiro_normalizar('Gestão de Projetos') = public._financeiro_normalizar('gestao de projetos'), 'normalizar: equal';
  assert public._financeiro_normalizar(null) is null, 'normalizar: null';
  raise notice 'PASS seed_matches_cargo';
end $$;

-- seed_existing_funcoes_kept: a workspace that already has funcoes keeps them; cargo matches against them
do $$
declare v_ws uuid := pg_temp.novo_ws(); v_id bigint;
begin
  perform pg_temp.fixture_legado(v_ws);
  insert into financeiro_funcoes (conta_id, nome, ordem) values (v_ws, 'Designer', 0) returning id into v_id;
  perform pg_temp.rpc(pg_temp.dono(v_ws), 'select public.financeiro_seed(1)');
  assert (select count(*) from financeiro_funcoes where conta_id = v_ws) = 1, 'existing funcoes: no defaults added';
  assert (select funcao_id from financeiro_acordo_versoes where membro_id = pg_temp.mid(v_ws, 'Bia')) = v_id,
    'existing funcoes: designer matches Designer';
  assert (select funcao_id from financeiro_acordo_versoes where membro_id = pg_temp.mid(v_ws, 'Ana')) is null,
    'existing funcoes: Design has no match';
  raise notice 'PASS seed_existing_funcoes_kept';
end $$;

-- seed_preserves_data_pagamento: the write-through rewrites every client's and member's
-- legacy payment day from the versions, so the seed must have copied them
do $$
declare v_ws uuid := pg_temp.novo_ws(); v_dono uuid; v_ini date := pg_temp.ini(1);
        v_cli_antes jsonb; v_mem_antes jsonb; v_cin bigint; v_ana bigint;
begin
  perform pg_temp.fixture_legado(v_ws);
  v_dono := pg_temp.dono(v_ws);
  perform pg_temp.rpc(v_dono, 'select public.financeiro_seed(1)');
  v_cin := pg_temp.cid(v_ws, 'Cinara');
  v_ana := pg_temp.mid(v_ws, 'Ana');
  assert not exists (select 1 from clientes c join financeiro_cliente_versoes v on v.cliente_id = c.id
                      where c.conta_id = v_ws and v.dia_pagamento is distinct from c.data_pagamento),
    'data_pagamento: every client version carries the legacy day';
  assert not exists (select 1 from membros m join financeiro_acordo_versoes a on a.membro_id = m.id
                      where m.conta_id = v_ws and a.dia_pagamento is distinct from m.data_pagamento),
    'data_pagamento: every acordo carries the legacy day';
  select jsonb_object_agg(id, data_pagamento) into v_cli_antes from clientes where conta_id = v_ws and id <> v_cin;
  select jsonb_object_agg(id, data_pagamento) into v_mem_antes from membros where conta_id = v_ws;

  perform pg_temp.ok(v_dono, format('select public.financeiro_cliente_salvar(%s, %L, 2200, 6, %L)', v_cin, v_ini, 'ativo'));
  assert (select valor_mensal from clientes where id = v_cin) = 2200 and (select data_pagamento from clientes where id = v_cin) = 6,
    'data_pagamento: the saved client is written through';
  assert (select jsonb_object_agg(id, data_pagamento) from clientes where conta_id = v_ws and id <> v_cin) = v_cli_antes,
    'data_pagamento: other clients changed ' || (select jsonb_object_agg(id, data_pagamento) from clientes where conta_id = v_ws)::text;
  assert (select jsonb_object_agg(id, data_pagamento) from membros where conta_id = v_ws) = v_mem_antes,
    'data_pagamento: members changed ' || (select jsonb_object_agg(id, data_pagamento) from membros where conta_id = v_ws)::text;
  assert (select data_pagamento from clientes where id = pg_temp.cid(v_ws, 'Roberta')) is null, 'data_pagamento: null stays null';

  -- an acordo save rewrites every member: the others keep their day too
  select jsonb_object_agg(id, data_pagamento) into v_mem_antes from membros where conta_id = v_ws and id <> v_ana;
  perform pg_temp.ok(v_dono, format('select public.financeiro_acordo_salvar(%s, %L, %L::jsonb)', v_ana, v_ini,
    jsonb_build_object('modelo', 'mensal_meta', 'valor', 4000, 'dia_pagamento', 5, 'funcao_id', pg_temp.fid(v_ws, 'Design'))));
  assert (select custo_mensal from membros where id = v_ana) = 4000, 'data_pagamento: acordo written through';
  assert (select jsonb_object_agg(id, data_pagamento) from membros where conta_id = v_ws and id <> v_ana) = v_mem_antes,
    'data_pagamento: other members changed after acordo save';
  raise notice 'PASS seed_preserves_data_pagamento';
end $$;

-- seed_checks: flags, permission, day validation; an unseeded config row is completed, not rejected
do $$
declare v_ws uuid := pg_temp.novo_ws(); v_dono uuid; v_ver uuid := gen_random_uuid(); v_role uuid; v_err text; r jsonb;
        v_cfg record;
begin
  perform pg_temp.fixture_legado(v_ws);
  v_dono := pg_temp.dono(v_ws);
  insert into auth.users (id) values (v_ver);
  insert into workspace_roles (conta_id, nome, permissions)
    values (v_ws, 'Financeiro leitura', '{"financeiro":"ver"}'::jsonb) returning id into v_role;
  insert into workspace_members (user_id, workspace_id, role, role_id) values (v_ver, v_ws, 'agent', v_role);
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_ver;

  v_err := pg_temp.exec_as(v_ver, 'select public.financeiro_seed(1)');
  assert v_err = '42501:financial_access_denied', 'seed_checks: ver cannot seed ' || coalesce(v_err, 'success');
  foreach v_err in array array['0', '29', 'null', '-3'] loop
    assert pg_temp.exec_as(v_dono, 'select public.financeiro_seed(' || v_err || ')') = 'P0001:periodo_dia_invalido',
      'seed_checks: day ' || v_err;
  end loop;
  assert not exists (select 1 from financeiro_config where conta_id = v_ws), 'seed_checks: nothing written so far';

  update workspace_plan_overrides set feature_overrides = '{"feature_financeiro_v2": false}'::jsonb where workspace_id = v_ws;
  assert pg_temp.exec_as(v_dono, 'select public.financeiro_seed(1)') = 'P0001:feature_disabled:feature_financeiro_v2',
    'seed_checks: v2 flag off';
  assert pg_temp.exec_as(v_ver, 'select public.financeiro_seed(1)') = 'P0001:feature_disabled:feature_financeiro_v2',
    'seed_checks: flag before permission';
  update workspace_plan_overrides set feature_overrides = '{"feature_financeiro_v2": true, "feature_financial": false}'::jsonb
   where workspace_id = v_ws;
  assert pg_temp.exec_as(v_dono, 'select public.financeiro_seed(1)') = 'P0001:feature_disabled:feature_financial',
    'seed_checks: financial flag off';
  update workspace_plan_overrides set feature_overrides = '{"feature_financeiro_v2": true}'::jsonb where workspace_id = v_ws;

  -- config_salvar may have created the row unseeded: the seed completes it (new day, meta kept)
  perform pg_temp.ok(v_dono, 'select public.financeiro_config_salvar(10, 60)');
  r := pg_temp.rpc(v_dono, 'select public.financeiro_seed(15)');
  assert r = '{"seeded": true, "ja_existia": false}'::jsonb, 'seed_checks: unseeded row seeds ' || r::text;
  select * into v_cfg from financeiro_config where conta_id = v_ws;
  assert v_cfg.periodo_dia = 15 and v_cfg.meta_margem = 60 and v_cfg.seeded_at is not null,
    'seed_checks: config ' || row_to_json(v_cfg)::text;
  assert (select inicio from financeiro_periodos where conta_id = v_ws) = pg_temp.ini(15), 'seed_checks: period on day 15';
  assert (select fim from financeiro_periodos where conta_id = v_ws) = (pg_temp.ini(15) + interval '1 month')::date,
    'seed_checks: fim one month later';
  assert not exists (select 1 from financeiro_cliente_versoes where conta_id = v_ws and vale_desde <> pg_temp.ini(15)),
    'seed_checks: versions at the day-15 start';
  -- the other write RPCs now accept the workspace
  perform pg_temp.ok(v_dono, 'select public.financeiro_funcao_salvar(null, ''Social media'', null)');
  raise notice 'PASS seed_checks';
end $$;

-- legacy_update_creates_version
do $$
declare v_ws uuid := pg_temp.novo_ws(); v_dono uuid; v_ini date := pg_temp.ini(1); v_tal bigint; v_cin bigint; v_v record;
        v_n bigint;
begin
  perform pg_temp.fixture_legado(v_ws);
  v_dono := pg_temp.dono(v_ws);
  perform pg_temp.rpc(v_dono, 'select public.financeiro_seed(1)');
  v_tal := pg_temp.cid(v_ws, 'Talitha');
  v_cin := pg_temp.cid(v_ws, 'Cinara');

  -- service_role (MCP update_client, imports): the version at the current start takes the new fee
  perform pg_temp.sr(format('update clientes set valor_mensal = 2600 where id = %s', v_tal));
  select * into v_v from financeiro_cliente_versoes where cliente_id = v_tal and vale_desde = v_ini;
  assert v_v.valor_mensal = 2600 and v_v.dia_pagamento = 10 and v_v.status = 'ativo',
    'legacy_update: version ' || row_to_json(v_v)::text;
  assert (select count(*) from financeiro_cliente_versoes where cliente_id = v_tal) = 1, 'legacy_update: in place';

  -- a version effective from an earlier start: the legacy write adds one at the current start
  update financeiro_cliente_versoes set vale_desde = (v_ini - interval '1 month')::date where cliente_id = v_cin;
  perform pg_temp.sr(format('update clientes set data_pagamento = 9 where id = %s', v_cin));
  assert (select count(*) from financeiro_cliente_versoes where cliente_id = v_cin) = 2, 'legacy_update: new version row';
  select * into v_v from financeiro_cliente_versoes where cliente_id = v_cin and vale_desde = v_ini;
  assert v_v.valor_mensal = 2000 and v_v.dia_pagamento = 9 and v_v.status = 'ativo' and v_v.created_by is null,
    'legacy_update: new version ' || row_to_json(v_v)::text;
  assert (select dia_pagamento from financeiro_cliente_versoes where cliente_id = v_cin and vale_desde < v_ini) = 5,
    'legacy_update: earlier version untouched';

  -- equal values, or columns the trigger does not watch: nothing
  v_n := pg_temp.nver(v_ws);
  perform pg_temp.sr(format('update clientes set valor_mensal = 2600, data_pagamento = 10 where id = %s', v_tal));
  perform pg_temp.sr(format('update clientes set telefone = %L, nome = %L where id = %s', '11999990000', 'Talitha B', v_tal));
  assert pg_temp.nver(v_ws) = v_n, 'legacy_update: equal values add nothing';
  assert (select valor_mensal from financeiro_cliente_versoes where cliente_id = v_tal) = 2600, 'legacy_update: unchanged';

  -- the old client form (authenticated owner): created_by is the editor
  perform pg_temp.ok(v_dono, format('update clientes set status = %L where id = %s', 'pausado', v_tal));
  select * into v_v from financeiro_cliente_versoes where cliente_id = v_tal and vale_desde = v_ini;
  assert v_v.status = 'pausado' and v_v.valor_mensal = 2600 and v_v.created_by = v_dono,
    'legacy_update: owner edit ' || row_to_json(v_v)::text;
  -- a fee with more than two decimals compares rounded
  perform pg_temp.sr(format('update clientes set valor_mensal = 2600.004 where id = %s', v_tal));
  assert (select valor_mensal = 2600 and created_by = v_dono from financeiro_cliente_versoes
           where cliente_id = v_tal and vale_desde = v_ini),
    'legacy_update: rounded compare writes nothing';
  raise notice 'PASS legacy_update_creates_version';
end $$;

-- legacy_insert_new_client
do $$
declare v_ws uuid := pg_temp.novo_ws(); v_dono uuid; v_ini date := pg_temp.ini(1); v_id bigint; v_v record;
begin
  perform pg_temp.fixture_legado(v_ws);
  v_dono := pg_temp.dono(v_ws);
  perform pg_temp.rpc(v_dono, 'select public.financeiro_seed(1)');
  -- old client form, as the owner
  perform pg_temp.ok(v_dono, format(
    'insert into clientes (user_id, conta_id, nome, sigla, cor, valor_mensal, data_pagamento) values (%L, %L, %L, %L, %L, 1700, 12)',
    v_dono, v_ws, 'Nova', 'No', '#000'));
  v_id := pg_temp.cid(v_ws, 'Nova');
  select * into v_v from financeiro_cliente_versoes where cliente_id = v_id;
  assert v_v.vale_desde = v_ini and v_v.valor_mensal = 1700 and v_v.dia_pagamento = 12 and v_v.status = 'ativo',
    'legacy_insert: version ' || row_to_json(v_v)::text;
  -- lead conversion / import without a fee, as service_role
  perform pg_temp.sr(format(
    'insert into clientes (user_id, conta_id, nome, sigla, cor) values (%L, %L, %L, %L, %L)', v_dono, v_ws, 'Lead', 'Le', '#000'));
  select * into v_v from financeiro_cliente_versoes where cliente_id = pg_temp.cid(v_ws, 'Lead');
  assert v_v.valor_mensal = 0 and v_v.dia_pagamento is null and v_v.status = 'ativo', 'legacy_insert: lead ' || row_to_json(v_v)::text;
  raise notice 'PASS legacy_insert_new_client';
end $$;

-- legacy_member_writes: a new member gets a mensal_meta acordo (funcao from cargo); an
-- update changes only valor / dia_pagamento and keeps the acordo's other fields
do $$
declare v_ws uuid := pg_temp.novo_ws(); v_dono uuid; v_ini date := pg_temp.ini(1); v_a record; v_duda bigint; v_ana bigint;
begin
  perform pg_temp.fixture_legado(v_ws);
  v_dono := pg_temp.dono(v_ws);
  perform pg_temp.rpc(v_dono, 'select public.financeiro_seed(1)');
  perform pg_temp.sr(format(
    'insert into membros (user_id, conta_id, nome, cargo, tipo, custo_mensal, data_pagamento, avatar_url) values (%L, %L, %L, %L, %L, 2000, 8, %L)',
    v_dono, v_ws, 'Edu', ' Edição de Vídeo ', 'clt', ''));
  select * into v_a from financeiro_acordo_versoes where membro_id = pg_temp.mid(v_ws, 'Edu');
  assert v_a.vale_desde = v_ini and v_a.modelo = 'mensal_meta' and v_a.valor = 2000 and v_a.dia_pagamento = 8
         and v_a.funcao_id = pg_temp.fid(v_ws, 'Edição de vídeo'),
    'member_insert: acordo ' || row_to_json(v_a)::text;
  perform pg_temp.sr(format(
    'insert into membros (user_id, conta_id, nome, cargo, tipo, avatar_url) values (%L, %L, %L, %L, %L, %L)',
    v_dono, v_ws, 'Fred', 'Estagiário', 'clt', ''));
  select * into v_a from financeiro_acordo_versoes where membro_id = pg_temp.mid(v_ws, 'Fred');
  assert v_a.valor = 0 and v_a.dia_pagamento is null and v_a.funcao_id is null, 'member_insert: no custo, no match ' || row_to_json(v_a)::text;

  -- mensal_limite acordo, then a legacy custo edit: only valor changes
  v_duda := pg_temp.mid(v_ws, 'Duda');
  perform pg_temp.ok(v_dono, format('select public.financeiro_acordo_salvar(%s, %L, %L::jsonb)', v_duda, v_ini,
    jsonb_build_object('modelo', 'mensal_limite', 'valor', 2400, 'limite_clientes', 20, 'dia_pagamento', 25,
                       'funcao_id', pg_temp.fid(v_ws, 'Gestão de projetos'), 'arquivo_path', 'x/contrato.pdf')));
  perform pg_temp.ok(v_dono, format('update membros set custo_mensal = 2600 where id = %s', v_duda));
  select * into v_a from financeiro_acordo_versoes where membro_id = v_duda and vale_desde = v_ini;
  assert v_a.valor = 2600 and v_a.modelo = 'mensal_limite' and v_a.limite_clientes = 20 and v_a.dia_pagamento = 25
         and v_a.funcao_id = pg_temp.fid(v_ws, 'Gestão de projetos') and v_a.arquivo_path = 'x/contrato.pdf',
    'member_update: in place ' || row_to_json(v_a)::text;
  assert (select count(*) from financeiro_acordo_versoes where membro_id = v_duda) = 1, 'member_update: one row';

  -- an acordo effective from an earlier start: the legacy write copies it to the current start
  v_ana := pg_temp.mid(v_ws, 'Ana');
  update financeiro_acordo_versoes set vale_desde = (v_ini - interval '1 month')::date, unidade = 'peça' where membro_id = v_ana;
  perform pg_temp.sr(format('update membros set custo_mensal = 4100, data_pagamento = 6 where id = %s', v_ana));
  assert (select count(*) from financeiro_acordo_versoes where membro_id = v_ana) = 2, 'member_update: copied';
  select * into v_a from financeiro_acordo_versoes where membro_id = v_ana and vale_desde = v_ini;
  assert v_a.valor = 4100 and v_a.dia_pagamento = 6 and v_a.modelo = 'mensal_meta' and v_a.unidade = 'peça'
         and v_a.funcao_id = pg_temp.fid(v_ws, 'Design'),
    'member_update: copy ' || row_to_json(v_a)::text;
  assert (select valor from financeiro_acordo_versoes where membro_id = v_ana and vale_desde < v_ini) = 3900,
    'member_update: earlier acordo untouched';
  -- cargo is not watched
  perform pg_temp.sr(format('update membros set cargo = %L where id = %s', 'Copy', v_ana));
  assert (select count(*) from financeiro_acordo_versoes where membro_id = v_ana) = 2, 'member_update: cargo ignored';
  raise notice 'PASS legacy_member_writes';
end $$;

-- legacy_custo_ignored_for_por_entrega (ruling R2)
do $$
declare v_ws uuid := pg_temp.novo_ws(); v_dono uuid; v_ini date := pg_temp.ini(1); v_bruno bigint; v_a record;
begin
  perform pg_temp.fixture_legado(v_ws);
  v_dono := pg_temp.dono(v_ws);
  perform pg_temp.rpc(v_dono, 'select public.financeiro_seed(1)');
  v_bruno := pg_temp.mid(v_ws, 'Bruno');
  perform pg_temp.ok(v_dono, format('select public.financeiro_acordo_salvar(%s, %L, %L::jsonb)', v_bruno, v_ini,
    jsonb_build_object('modelo', 'por_entrega', 'valor', 150, 'unidade', 'vídeo', 'dia_pagamento', 10,
                       'funcao_id', pg_temp.fid(v_ws, 'Edição de vídeo'))));
  assert (select custo_mensal from membros where id = v_bruno) is null, 'por_entrega: write-through nulls custo';

  perform pg_temp.sr(format('update membros set custo_mensal = 999 where id = %s', v_bruno));
  select * into v_a from financeiro_acordo_versoes where membro_id = v_bruno and vale_desde = v_ini;
  assert v_a.modelo = 'por_entrega' and v_a.valor = 150 and v_a.dia_pagamento = 10, 'por_entrega: custo ignored ' || row_to_json(v_a)::text;
  assert (select count(*) from financeiro_acordo_versoes where membro_id = v_bruno) = 1, 'por_entrega: no new row';

  perform pg_temp.sr(format('update membros set data_pagamento = 12 where id = %s', v_bruno));
  select * into v_a from financeiro_acordo_versoes where membro_id = v_bruno and vale_desde = v_ini;
  assert v_a.modelo = 'por_entrega' and v_a.valor = 150 and v_a.unidade = 'vídeo' and v_a.dia_pagamento = 12
         and v_a.funcao_id = pg_temp.fid(v_ws, 'Edição de vídeo'),
    'por_entrega: only the day versioned ' || row_to_json(v_a)::text;
  raise notice 'PASS legacy_custo_ignored_for_por_entrega';
end $$;

-- legacy_encerrado_ends_assignments (ruling R12)
do $$
declare v_ws uuid := pg_temp.novo_ws(); v_dono uuid; v_ini date := pg_temp.ini(1); v_prox date; v_tal bigint; v_cin bigint;
        v_ana bigint; v_bruno bigint; v_err text;
begin
  perform pg_temp.fixture_legado(v_ws);
  v_dono := pg_temp.dono(v_ws);
  perform pg_temp.rpc(v_dono, 'select public.financeiro_seed(1)');
  v_prox := (v_ini + interval '1 month')::date;
  v_tal := pg_temp.cid(v_ws, 'Talitha'); v_cin := pg_temp.cid(v_ws, 'Cinara');
  v_ana := pg_temp.mid(v_ws, 'Ana'); v_bruno := pg_temp.mid(v_ws, 'Bruno');
  -- Ana on Talitha since last month (open), Ana on Cinara (control), Bruno on Talitha from next period
  insert into financeiro_atribuicoes (conta_id, membro_id, cliente_id, desde) values
    (v_ws, v_ana, v_tal, (v_ini - interval '1 month')::date),
    (v_ws, v_ana, v_cin, (v_ini - interval '1 month')::date);
  perform pg_temp.ok(v_dono, format('select public.financeiro_atribuicoes_salvar(%L, %L::jsonb)', v_prox,
    jsonb_build_array(jsonb_build_object('membro_id', v_bruno, 'cliente_id', v_tal, 'ativo', true))));

  perform pg_temp.sr(format('update clientes set status = %L where id = %s', 'encerrado', v_tal));
  assert (select status from financeiro_cliente_versoes where cliente_id = v_tal and vale_desde = v_ini) = 'encerrado',
    'encerrado: version';
  assert (select ate from financeiro_atribuicoes where membro_id = v_ana and cliente_id = v_tal) = v_ini,
    'encerrado: open assignment ends at the period start';
  assert not exists (select 1 from financeiro_atribuicoes where membro_id = v_bruno and cliente_id = v_tal),
    'encerrado: later assignment deleted';
  assert (select ate from financeiro_atribuicoes where membro_id = v_ana and cliente_id = v_cin) is null,
    'encerrado: other client untouched';
  -- v2 now sees the client as encerrado
  v_err := pg_temp.exec_as(v_dono, format('select public.financeiro_atribuicoes_salvar(%L, %L::jsonb)', v_ini,
    jsonb_build_array(jsonb_build_object('membro_id', v_bruno, 'cliente_id', v_tal, 'ativo', true))));
  assert v_err = 'P0001:cliente_encerrado', 'encerrado: v2 rejects new assignment ' || coalesce(v_err, 'success');
  -- back to ativo through the legacy form: version follows, assignments are not restored
  perform pg_temp.sr(format('update clientes set status = %L where id = %s', 'ativo', v_tal));
  assert (select status from financeiro_cliente_versoes where cliente_id = v_tal and vale_desde = v_ini) = 'ativo',
    'encerrado: reactivated version';
  assert not exists (select 1 from financeiro_atribuicoes where cliente_id = v_tal and (ate is null or ate > v_ini)),
    'encerrado: assignments not restored';
  raise notice 'PASS legacy_encerrado_ends_assignments';
end $$;

-- v2_write_through_no_loop: a v2 save writes the legacy columns, the trigger compares
-- equal and writes nothing, so there is exactly one version row per (cliente, vale_desde)
do $$
declare v_ws uuid := pg_temp.novo_ws(); v_dono uuid; v_ini date := pg_temp.ini(1); v_prox date; v_tal bigint; v_ana bigint;
        v_n bigint; v_na bigint; v_v record; v_a record; v_ctids text; v_actids text;
begin
  perform pg_temp.fixture_legado(v_ws);
  v_dono := pg_temp.dono(v_ws);
  perform pg_temp.rpc(v_dono, 'select public.financeiro_seed(1)');
  v_prox := (v_ini + interval '1 month')::date;
  v_tal := pg_temp.cid(v_ws, 'Talitha');
  v_ana := pg_temp.mid(v_ws, 'Ana');
  v_n := pg_temp.nver(v_ws);
  v_na := pg_temp.nacordo(v_ws);
  -- the write-through rewrites the legacy columns of the other clients too (Roberta's
  -- NULL fee becomes 0, Yasmin's NULL status becomes ativo): the trigger fires for
  -- each of them and must leave their version rows physically untouched
  select string_agg(ctid::text, ',' order by id) into v_ctids from financeiro_cliente_versoes
   where conta_id = v_ws and cliente_id <> v_tal;
  -- every save rewrites the members' legacy columns as well (Caio's NULL custo becomes 0)
  select string_agg(ctid::text, ',' order by id) into v_actids from financeiro_acordo_versoes
   where conta_id = v_ws and membro_id <> v_ana;

  perform pg_temp.ok(v_dono, format('select public.financeiro_cliente_salvar(%s, %L, 2700, 11, %L)', v_tal, v_ini, 'ativo'));
  assert (select valor_mensal from clientes where id = pg_temp.cid(v_ws, 'Roberta')) = 0
         and (select status from clientes where id = pg_temp.cid(v_ws, 'Yasmin')) = 'ativo',
    'no_loop: other clients were written through';
  assert (select string_agg(ctid::text, ',' order by id) from financeiro_cliente_versoes
           where conta_id = v_ws and cliente_id <> v_tal) = v_ctids,
    'no_loop: the trigger rewrote another client''s version';
  assert (select custo_mensal from membros where id = pg_temp.mid(v_ws, 'Caio')) = 0, 'no_loop: Caio written through';
  assert (select string_agg(ctid::text, ',' order by id) from financeiro_acordo_versoes
           where conta_id = v_ws and membro_id <> v_ana) = v_actids,
    'no_loop: the trigger rewrote a member''s acordo on a client save';
  assert (select valor_mensal from clientes where id = v_tal) = 2700 and (select data_pagamento from clientes where id = v_tal) = 11,
    'no_loop: legacy written through (the trigger ran)';
  assert (select count(*) from financeiro_cliente_versoes where cliente_id = v_tal and vale_desde = v_ini) = 1,
    'no_loop: one row for (cliente, vale_desde)';
  assert (select count(*) from financeiro_cliente_versoes where cliente_id = v_tal) = 1, 'no_loop: no extra row';
  assert pg_temp.nver(v_ws) = v_n, 'no_loop: workspace count unchanged';
  select * into v_v from financeiro_cliente_versoes where cliente_id = v_tal;
  assert v_v.valor_mensal = 2700 and v_v.dia_pagamento = 11 and v_v.created_by = v_dono, 'no_loop: row ' || row_to_json(v_v)::text;

  -- a future version: legacy stays, still no extra row
  perform pg_temp.ok(v_dono, format('select public.financeiro_cliente_salvar(%s, %L, 2900, 11, %L)', v_tal, v_prox, 'ativo'));
  assert (select count(*) from financeiro_cliente_versoes where cliente_id = v_tal) = 2, 'no_loop: future adds exactly one';
  assert pg_temp.nver(v_ws) = v_n + 1, 'no_loop: workspace count +1';
  assert (select valor_mensal from clientes where id = v_tal) = 2700, 'no_loop: legacy keeps the current value';

  -- encerrado through v2: one row, cutoff applied once
  perform pg_temp.ok(v_dono, format('select public.financeiro_cliente_salvar(%s, %L, 2700, 11, %L)',
    pg_temp.cid(v_ws, 'Cinara'), v_ini, 'encerrado'));
  assert (select count(*) from financeiro_cliente_versoes where cliente_id = pg_temp.cid(v_ws, 'Cinara')) = 1,
    'no_loop: encerrado one row';
  assert (select status from clientes where id = pg_temp.cid(v_ws, 'Cinara')) = 'encerrado', 'no_loop: encerrado written through';

  -- acordos too, mensal and por_entrega
  perform pg_temp.ok(v_dono, format('select public.financeiro_acordo_salvar(%s, %L, %L::jsonb)', v_ana, v_ini,
    jsonb_build_object('modelo', 'mensal_meta', 'valor', 4200, 'dia_pagamento', 3, 'funcao_id', pg_temp.fid(v_ws, 'Design'))));
  assert (select custo_mensal from membros where id = v_ana) = 4200, 'no_loop: acordo written through';
  assert (select count(*) from financeiro_acordo_versoes where membro_id = v_ana) = 1, 'no_loop: one acordo row';
  assert (select string_agg(ctid::text, ',' order by id) from financeiro_acordo_versoes
           where conta_id = v_ws and membro_id <> v_ana) = v_actids,
    'no_loop: the trigger rewrote another member''s acordo on an acordo save';
  select * into v_a from financeiro_acordo_versoes where membro_id = v_ana;
  assert v_a.valor = 4200 and v_a.dia_pagamento = 3 and v_a.created_by = v_dono, 'no_loop: acordo row ' || row_to_json(v_a)::text;
  perform pg_temp.ok(v_dono, format('select public.financeiro_acordo_salvar(%s, %L, %L::jsonb)', pg_temp.mid(v_ws, 'Bia'), v_ini,
    jsonb_build_object('modelo', 'por_entrega', 'valor', 80, 'dia_pagamento', 2)));
  assert (select count(*) from financeiro_acordo_versoes where membro_id = pg_temp.mid(v_ws, 'Bia')) = 1, 'no_loop: por_entrega one row';
  assert (select valor from financeiro_acordo_versoes where membro_id = pg_temp.mid(v_ws, 'Bia')) = 80, 'no_loop: por_entrega valor kept';
  assert pg_temp.nacordo(v_ws) = v_na, 'no_loop: acordo count unchanged';
  raise notice 'PASS v2_write_through_no_loop';
end $$;

-- unseeded_trigger_noop: no config, an unseeded config, or no open period -> no v2 rows
do $$
declare v_ws uuid := pg_temp.novo_ws(); v_dono uuid; v_id bigint;
begin
  v_dono := pg_temp.dono(v_ws);
  perform pg_temp.fixture_legado(v_ws);
  perform pg_temp.sr(format('update clientes set valor_mensal = 3000 where id = %s', pg_temp.cid(v_ws, 'Talitha')));
  perform pg_temp.sr(format('update membros set custo_mensal = 3000 where id = %s', pg_temp.mid(v_ws, 'Ana')));
  assert pg_temp.nver(v_ws) = 0 and pg_temp.nacordo(v_ws) = 0, 'unseeded: no config -> nothing';

  perform pg_temp.ok(v_dono, 'select public.financeiro_config_salvar(1, null)');
  perform pg_temp.sr(format(
    'insert into clientes (user_id, conta_id, nome, sigla, cor, valor_mensal) values (%L, %L, %L, %L, %L, 900)', v_dono, v_ws, 'X', 'X', '#000'));
  perform pg_temp.sr(format('update membros set data_pagamento = 3 where id = %s', pg_temp.mid(v_ws, 'Ana')));
  assert pg_temp.nver(v_ws) = 0 and pg_temp.nacordo(v_ws) = 0, 'unseeded: unseeded config -> nothing';

  -- seeded, but the only period is closed (close job late): nothing either
  perform pg_temp.rpc(v_dono, 'select public.financeiro_seed(1)');
  update financeiro_periodos set status = 'fechado', snapshot = '{}'::jsonb, fechado_em = now() where conta_id = v_ws;
  v_id := pg_temp.nver(v_ws);
  perform pg_temp.sr(format('update clientes set valor_mensal = 3100 where id = %s', pg_temp.cid(v_ws, 'Talitha')));
  perform pg_temp.sr(format(
    'insert into membros (user_id, conta_id, nome, tipo, custo_mensal, avatar_url) values (%L, %L, %L, %L, 100, %L)', v_dono, v_ws, 'Y', 'clt', ''));
  assert pg_temp.nver(v_ws) = v_id and pg_temp.nacordo(v_ws) = 5, 'unseeded: no open period -> nothing';
  raise notice 'PASS unseeded_trigger_noop';
end $$;

-- trigger_acts_with_flag_off: the capture keeps v2 in sync while the flag is off
do $$
declare v_ws uuid := pg_temp.novo_ws(); v_ini date := pg_temp.ini(1);
begin
  perform pg_temp.fixture_legado(v_ws);
  perform pg_temp.rpc(pg_temp.dono(v_ws), 'select public.financeiro_seed(1)');
  update workspace_plan_overrides set feature_overrides = '{"feature_financeiro_v2": false}'::jsonb where workspace_id = v_ws;
  perform pg_temp.sr(format('update clientes set valor_mensal = 2800 where id = %s', pg_temp.cid(v_ws, 'Talitha')));
  assert (select valor_mensal from financeiro_cliente_versoes where cliente_id = pg_temp.cid(v_ws, 'Talitha') and vale_desde = v_ini) = 2800,
    'flag_off: client captured';
  update workspace_plan_overrides set feature_overrides = '{"feature_financeiro_v2": true, "feature_financial": false}'::jsonb
   where workspace_id = v_ws;
  perform pg_temp.sr(format('update membros set custo_mensal = 5000 where id = %s', pg_temp.mid(v_ws, 'Ana')));
  assert (select valor from financeiro_acordo_versoes where membro_id = pg_temp.mid(v_ws, 'Ana') and vale_desde = v_ini) = 5000,
    'flag_off: member captured';
  raise notice 'PASS trigger_acts_with_flag_off';
end $$;

-- legacy_guards_still_work: guard_financial_write still blocks a fee change by a user without editar
do $$
declare v_ws uuid := pg_temp.novo_ws(); v_ver uuid := gen_random_uuid(); v_role uuid; v_err text; v_tal bigint;
begin
  perform pg_temp.fixture_legado(v_ws);
  perform pg_temp.rpc(pg_temp.dono(v_ws), 'select public.financeiro_seed(1)');
  v_tal := pg_temp.cid(v_ws, 'Talitha');
  insert into auth.users (id) values (v_ver);
  insert into workspace_roles (conta_id, nome, permissions)
    values (v_ws, 'Financeiro leitura', '{"financeiro":"ver"}'::jsonb) returning id into v_role;
  insert into workspace_members (user_id, workspace_id, role, role_id) values (v_ver, v_ws, 'agent', v_role);
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_ver;
  v_err := pg_temp.exec_as(v_ver, format('update clientes set valor_mensal = 1 where id = %s', v_tal));
  assert v_err like '%financial_access_denied%', 'guards: fee change blocked ' || coalesce(v_err, 'success');
  assert (select valor_mensal from financeiro_cliente_versoes where cliente_id = v_tal) = 2500, 'guards: version untouched';
  raise notice 'PASS legacy_guards_still_work';
end $$;

-- seed_grants
do $$
declare v_fn text;
begin
  assert not has_function_privilege('anon', 'public.financeiro_seed(int)', 'EXECUTE'), 'grants: anon seed';
  assert has_function_privilege('authenticated', 'public.financeiro_seed(int)', 'EXECUTE'), 'grants: authenticated seed';
  assert has_function_privilege('service_role', 'public.financeiro_seed(int)', 'EXECUTE'), 'grants: service_role seed';
  foreach v_fn in array array['public._financeiro_normalizar(text)',
                              'public._financeiro_encerrar_atribuicoes(uuid,bigint,date)',
                              'public._financeiro_v2_legado_trigger()'] loop
    assert not has_function_privilege('anon', v_fn, 'EXECUTE') and not has_function_privilege('authenticated', v_fn, 'EXECUTE')
           and has_function_privilege('service_role', v_fn, 'EXECUTE'), 'grants: ' || v_fn;
  end loop;
  assert (select prosecdef from pg_proc where oid = 'public.financeiro_seed(int)'::regprocedure), 'grants: seed is definer';
  assert (select prosecdef from pg_proc where oid = 'public._financeiro_v2_legado_trigger()'::regprocedure), 'grants: trigger fn definer';
  assert exists (select 1 from pg_trigger where tgname = 'trg_financeiro_v2_clientes_legado' and tgrelid = 'public.clientes'::regclass),
    'grants: clientes trigger';
  assert exists (select 1 from pg_trigger where tgname = 'trg_financeiro_v2_membros_legado' and tgrelid = 'public.membros'::regclass),
    'grants: membros trigger';
  raise notice 'PASS seed_grants';
end $$;

rollback;
