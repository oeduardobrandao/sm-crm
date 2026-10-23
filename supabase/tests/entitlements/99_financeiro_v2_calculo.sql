\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Financeiro v2 calculation (20261025000003_financeiro_v2_calculo.sql).
-- Section 1: period helpers (financeiro_periodo_fim / _inicio_de / _rotulo / _fator).
-- Later sections (allocation core) are appended below by the following tasks.

begin;

do $$
begin
  assert public.financeiro_periodo_fim('2026-10-01', 1) = date '2026-11-01', 'fim: day 1 full month';
  assert public.financeiro_periodo_fim('2026-10-15', 15) = date '2026-11-15', 'fim: day 15 full month';
  assert public.financeiro_periodo_fim('2026-02-28', 28) = date '2026-03-28', 'fim: feb 28';
  assert public.financeiro_periodo_fim('2026-11-01', 15) = date '2026-11-15', 'fim: transition';
  assert public.financeiro_periodo_fim('2026-12-20', 15) = date '2027-01-15', 'fim: year rollover';
  raise notice 'PASS periodo_fim';
end $$;

do $$
begin
  assert public.financeiro_periodo_inicio_de('2026-10-10', 15) = date '2026-09-15', 'inicio_de: before day';
  assert public.financeiro_periodo_inicio_de('2026-10-15', 15) = date '2026-10-15', 'inicio_de: on day';
  assert public.financeiro_periodo_inicio_de('2026-10-20', 15) = date '2026-10-15', 'inicio_de: after day';
  assert public.financeiro_periodo_inicio_de('2026-01-10', 15) = date '2025-12-15', 'inicio_de: year rollback';
  assert public.financeiro_periodo_inicio_de('2026-10-17', 1) = date '2026-10-01', 'inicio_de: day 1';
  raise notice 'PASS periodo_inicio_de';
end $$;

do $$
begin
  assert public.financeiro_periodo_rotulo('2026-10-01', '2026-11-01') = 'out 2026', 'rotulo: full calendar month';
  assert public.financeiro_periodo_rotulo('2026-10-15', '2026-11-15') = '15 out a 14 nov', 'rotulo: mid-month period';
  assert public.financeiro_periodo_rotulo('2026-11-01', '2026-11-15') = '1 nov a 14 nov', 'rotulo: transition period';
  assert public.financeiro_periodo_rotulo('2026-12-15', '2027-01-15') = '15 dez 2026 a 14 jan 2027', 'rotulo: across years';
  assert public.financeiro_periodo_rotulo('2026-01-01', '2026-02-01') = 'jan 2026', 'rotulo: jan';
  assert public.financeiro_periodo_rotulo('2026-03-01', '2026-04-01') = 'mar 2026', 'rotulo: mar';
  assert public.financeiro_periodo_rotulo('2026-12-01', '2027-01-01') = 'dez 2026', 'rotulo: dez';
  raise notice 'PASS periodo_rotulo';
end $$;

do $$
begin
  assert public.financeiro_periodo_fator('2026-10-01', '2026-11-01') = 1, 'fator: full period is 1';
  assert public.financeiro_periodo_fator('2026-10-15', '2026-11-15') = 1, 'fator: full mid-month period is 1';
  assert round(public.financeiro_periodo_fator('2026-11-01', '2026-11-15'), 4) = round(14 / 30.0, 4), 'fator: transition pro-rata';
  assert round(public.financeiro_periodo_fator('2026-02-01', '2026-02-15'), 4) = round(14 / 28.0, 4), 'fator: february';
  raise notice 'PASS periodo_fator';
end $$;

do $$
begin
  assert not has_function_privilege('anon', 'public.financeiro_periodo_fim(date,int)', 'execute'), 'anon cannot execute fim';
  assert not has_function_privilege('public', 'public.financeiro_periodo_fim(date,int)', 'execute'), 'PUBLIC cannot execute fim';
  assert has_function_privilege('authenticated', 'public.financeiro_periodo_fim(date,int)', 'execute'), 'authenticated executes fim';
  assert has_function_privilege('service_role', 'public.financeiro_periodo_rotulo(date,date)', 'execute'), 'service_role executes rotulo';
  raise notice 'PASS periodo_grants';
end $$;

rollback;

-- ============ Section 2: allocation core and read RPCs ============
-- _financeiro_calcular(conta, inicio) is the single calculation behind the live
-- screens and the frozen snapshots; financeiro_rentabilidade() wraps it with the
-- flag / visibility / seeded checks. The fixture is the owner's spreadsheet:
-- 15 clients, 5 members, one open period (out 2026). Every test builds its own
-- workspace so the mutating tests never see each other's changes.
begin;

-- New workspace on 'max' (feature_financial) with feature_financeiro_v2 on and an owner.
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

-- The spreadsheet. Versions and assignments start at 2026-10-01. The config row
-- (seeded) goes in LAST, after clientes/membros, so a future legacy write-through
-- trigger cannot race the fixture's own versions.
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

  -- everyone on every client, except Caio not on Talitha and Lia only on Talitha
  insert into financeiro_atribuicoes (conta_id, membro_id, cliente_id, desde)
    select p_ws, m.id, c.id, date '2026-10-01'
      from membros m cross join clientes c
     where m.conta_id = p_ws and c.conta_id = p_ws
       and not (m.id = v_caio and c.id = v_talitha)
       and not (m.id = v_lia and c.id <> v_talitha);

  insert into financeiro_periodos (conta_id, inicio, fim) values (p_ws, date '2026-10-01', date '2026-11-01');
  insert into financeiro_config (conta_id, seeded_at) values (p_ws, now());
end $f$;

-- Lookups into a result
create or replace function pg_temp.c(p_r jsonb, p_nome text) returns jsonb language sql as $f$
  select e from jsonb_array_elements(p_r->'clientes') e where e->>'nome' = p_nome
$f$;
create or replace function pg_temp.m(p_r jsonb, p_nome text) returns jsonb language sql as $f$
  select e from jsonb_array_elements(p_r->'membros') e where e->>'nome' = p_nome
$f$;
create or replace function pg_temp.fid(p_ws uuid, p_nome text) returns text language sql as $f$
  select id::text from financeiro_funcoes where conta_id = p_ws and nome = p_nome
$f$;
create or replace function pg_temp.mid(p_ws uuid, p_nome text) returns bigint language sql as $f$
  select id from membros where conta_id = p_ws and nome = p_nome
$f$;
create or replace function pg_temp.cid(p_ws uuid, p_nome text) returns bigint language sql as $f$
  select id from clientes where conta_id = p_ws and nome = p_nome
$f$;

-- financeiro_rentabilidade(p_inicio) as p_user (authenticated); the error as 'SQLSTATE:message'
create or replace function pg_temp.rent(p_user uuid, p_inicio date default null) returns jsonb language plpgsql as $f$
declare v jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v := public.financeiro_rentabilidade(p_inicio);
  execute 'reset role';
  return v;
end $f$;
create or replace function pg_temp.rent_erro(p_user uuid, p_inicio date default null) returns text language plpgsql as $f$
begin
  perform pg_temp.rent(p_user, p_inicio);
  return null;
exception when others then
  execute 'reset role';
  return sqlstate || ':' || sqlerrm;
end $f$;
-- any RPC (sql text returning jsonb) as p_user
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

-- planilha_contract: the shape the CRM types mirror
do $$
declare v_ws uuid := pg_temp.novo_ws(); r jsonb; v_cin jsonb; v_tal jsonb;
begin
  perform pg_temp.fixture_planilha(v_ws);
  r := public._financeiro_calcular(v_ws, date '2026-10-01');

  assert (select array_agg(k order by k) from jsonb_object_keys(r) k)
       = array['clientes','funcoes','incompleto','membros','meta_margem','periodo','seeded','totais'],
    'contract: top-level keys ' || (select string_agg(k, ',') from jsonb_object_keys(r) k);
  assert r->'seeded' = 'true'::jsonb, 'contract: seeded';
  assert r->'periodo' = jsonb_build_object('inicio', '2026-10-01', 'fim', '2026-11-01', 'rotulo', 'out 2026',
                                           'status', 'aberto', 'transicao', false, 'fator', 1),
    'contract: periodo ' || (r->'periodo')::text;
  assert r->'meta_margem' = '55'::jsonb, 'contract: meta_margem ' || (r->'meta_margem')::text;
  assert (select array_agg(e->>'nome' order by o) from jsonb_array_elements(r->'funcoes') with ordinality x(e, o))
       = array['Videomaker','Design','Edição de vídeo','Gestão de projetos','Copy'], 'contract: funcoes order';
  assert (select array_agg(k order by k) from jsonb_object_keys(r->'funcoes'->0) k) = array['id','nome','ordem'],
    'contract: funcao keys';
  assert jsonb_array_length(r->'clientes') = 15, 'contract: 15 clients';
  assert (r->'clientes'->0->>'nome') = 'Beatriz', 'contract: clients ordered by nome';
  assert (select array_agg(e->>'nome' order by o) from jsonb_array_elements(r->'membros') with ordinality x(e, o))
       = array['Caio','Lia','Ana','Bruno','Duda'], 'contract: membros order (funcao ordem, then nome)';

  v_cin := pg_temp.c(r, 'Cinara');
  assert (select array_agg(k order by k) from jsonb_object_keys(v_cin) k)
       = array['a_informar','cliente_id','custo','lucro','margem','nome','pessoas','por_funcao','receita','status'],
    'contract: client keys ' || (select string_agg(k, ',') from jsonb_object_keys(v_cin) k);
  assert (v_cin->>'cliente_id')::bigint = pg_temp.cid(v_ws, 'Cinara'), 'contract: cliente_id';
  assert v_cin->>'status' = 'ativo', 'contract: status';
  assert (select array_agg(e->>'nome' order by o) from jsonb_array_elements(v_cin->'pessoas') with ordinality x(e, o))
       = array['Caio','Ana','Bruno','Duda'], 'contract: Cinara pessoas order';
  assert (select array_agg(k order by k) from jsonb_object_keys(v_cin->'pessoas'->0) k)
       = array['funcao_id','membro_id','n_clientes','nome','quantidade','regra','total','valor','valor_unitario'],
    'contract: pessoa keys';
  assert v_cin->'pessoas'->0 = jsonb_build_object('membro_id', pg_temp.mid(v_ws, 'Caio'), 'nome', 'Caio',
      'funcao_id', pg_temp.fid(v_ws, 'Videomaker')::bigint, 'regra', 'rateio', 'valor', 165, 'total', 2310,
      'n_clientes', 14, 'quantidade', null, 'valor_unitario', null),
    'contract: Caio on Cinara ' || (v_cin->'pessoas'->0)::text;

  v_tal := pg_temp.c(r, 'Talitha');
  assert (select count(*) from jsonb_object_keys(v_tal->'por_funcao')) = 5, 'contract: por_funcao has every funcao';
  assert (v_tal->'por_funcao'->>pg_temp.fid(v_ws, 'Copy'))::numeric = 0, 'contract: Copy column is 0';
  assert v_tal->'a_informar' = 'false'::jsonb, 'contract: a_informar false';

  assert (select array_agg(k order by k) from jsonb_object_keys(pg_temp.m(r, 'Duda')) k)
       = array['a_informar','custo','funcao_id','limite_clientes','membro_id','modelo','n_clientes','nome','por_cliente'],
    'contract: membro keys';
  assert pg_temp.m(r, 'Duda')->>'modelo' = 'mensal_limite', 'contract: Duda modelo';
  assert (pg_temp.m(r, 'Duda')->>'limite_clientes')::int = 20, 'contract: Duda limite 20';
  assert pg_temp.m(r, 'Ana')->'limite_clientes' = 'null'::jsonb, 'contract: Ana limite null';
  assert (pg_temp.m(r, 'Duda')->>'por_cliente')::numeric = 160, 'contract: Duda por_cliente';

  assert (select array_agg(k order by k) from jsonb_object_keys(r->'totais') k)
       = array['custo_clientes','custo_sem_cliente','custo_total','lucro','margem','por_funcao','receita'],
    'contract: totais keys';
  assert (select count(*) from jsonb_object_keys(r->'totais'->'por_funcao')) = 5, 'contract: totais.por_funcao every funcao';
  assert (r->'totais'->'por_funcao'->>pg_temp.fid(v_ws, 'Videomaker'))::numeric = 2860, 'contract: totais Videomaker 2860';
  assert (r->'totais'->'margem') = '0.5977'::jsonb, 'contract: totais margem 0.5977, got ' || (r->'totais'->'margem')::text;
  assert r->'incompleto' = 'false'::jsonb, 'contract: incompleto false';
  raise notice 'PASS planilha_contract';
end $$;

do $$
declare v_ws uuid := pg_temp.novo_ws(); r jsonb; v_tal jsonb; v_lia jsonb;
begin
  perform pg_temp.fixture_planilha(v_ws);
  r := public._financeiro_calcular(v_ws, date '2026-10-01');
  v_tal := pg_temp.c(r, 'Talitha');
  assert (v_tal->>'receita')::numeric = 2500, 'planilha_talitha: receita ' || (v_tal->>'receita');
  assert (v_tal->>'custo')::numeric = 1180, 'planilha_talitha: custo ' || (v_tal->>'custo');
  assert (v_tal->>'lucro')::numeric = 1320, 'planilha_talitha: lucro ' || (v_tal->>'lucro');
  assert round((v_tal->>'margem')::numeric, 3) = 0.528, 'planilha_talitha: margem ' || (v_tal->>'margem');
  select e into v_lia from jsonb_array_elements(v_tal->'pessoas') e where e->>'nome' = 'Lia';
  assert v_lia->>'regra' = 'exclusivo', 'planilha_talitha: Lia regra ' || coalesce(v_lia->>'regra', 'missing');
  assert (v_lia->>'valor')::numeric = 550 and (v_lia->>'n_clientes')::int = 1, 'planilha_talitha: Lia 550 on 1 client';
  assert (v_tal->'por_funcao'->>pg_temp.fid(v_ws, 'Videomaker'))::numeric = 550, 'planilha_talitha: Videomaker 550';
  assert not exists (select 1 from jsonb_array_elements(v_tal->'pessoas') e where e->>'nome' = 'Caio'),
    'planilha_talitha: Caio is not on Talitha';
  raise notice 'PASS planilha_talitha';
end $$;

do $$
declare v_ws uuid := pg_temp.novo_ws(); r jsonb; v_cin jsonb;
begin
  perform pg_temp.fixture_planilha(v_ws);
  r := public._financeiro_calcular(v_ws, date '2026-10-01');
  assert (pg_temp.m(r, 'Ana')->>'por_cliente')::numeric = 260, 'planilha_rateio: Ana por_cliente';
  assert (pg_temp.m(r, 'Ana')->>'n_clientes')::int = 15, 'planilha_rateio: Ana n_clientes';
  assert (pg_temp.m(r, 'Caio')->>'por_cliente')::numeric = 165, 'planilha_rateio: Caio por_cliente';
  assert (pg_temp.m(r, 'Caio')->>'n_clientes')::int = 14, 'planilha_rateio: Caio n_clientes';
  v_cin := pg_temp.c(r, 'Cinara');
  assert (v_cin->'por_funcao'->>pg_temp.fid(v_ws, 'Design'))::numeric = 260, 'planilha_rateio: Cinara Design';
  assert (v_cin->>'custo')::numeric = 795, 'planilha_rateio: Cinara custo ' || (v_cin->>'custo');
  raise notice 'PASS planilha_rateio';
end $$;

do $$
declare v_ws uuid := pg_temp.novo_ws(); v_outro uuid := pg_temp.novo_ws(); r jsonb;
begin
  perform pg_temp.fixture_planilha(v_ws);
  perform pg_temp.fixture_planilha(v_outro);   -- a second tenant must not leak in
  r := public._financeiro_calcular(v_ws, date '2026-10-01');
  assert (r->'totais'->>'receita')::numeric = 30600, 'planilha_totais: receita ' || (r->'totais'->>'receita');
  assert (r->'totais'->>'custo_total')::numeric = 12310, 'planilha_totais: custo_total ' || (r->'totais'->>'custo_total');
  assert (r->'totais'->>'custo_clientes')::numeric = 12310, 'planilha_totais: custo_clientes';
  assert (r->'totais'->>'custo_sem_cliente')::numeric = 0, 'planilha_totais: custo_sem_cliente';
  assert (r->'totais'->>'lucro')::numeric = 18290, 'planilha_totais: lucro ' || (r->'totais'->>'lucro');
  assert jsonb_array_length(r->'clientes') = 15 and jsonb_array_length(r->'membros') = 5, 'planilha_totais: tenant leak';
  assert jsonb_array_length(r->'funcoes') = 5, 'planilha_totais: funcoes tenant leak';
  raise notice 'PASS planilha_totais';
end $$;

do $$
declare v_ws uuid := pg_temp.novo_ws(); r jsonb;
begin
  perform pg_temp.fixture_planilha(v_ws);
  -- Bruno's assignments ended at the start of October (ate > desde forces an earlier desde)
  update financeiro_atribuicoes set desde = date '2026-09-01', ate = date '2026-10-01'
   where conta_id = v_ws and membro_id = pg_temp.mid(v_ws, 'Bruno');
  r := public._financeiro_calcular(v_ws, date '2026-10-01');
  assert (r->'totais'->>'custo_sem_cliente')::numeric = 3150, 'zero_clients: custo_sem_cliente ' || (r->'totais'->>'custo_sem_cliente');
  assert (r->'totais'->>'custo_total')::numeric = 12310, 'zero_clients: custo_total ' || (r->'totais'->>'custo_total');
  assert (r->'totais'->>'custo_clientes')::numeric = 9160, 'zero_clients: custo_clientes ' || (r->'totais'->>'custo_clientes');
  assert (pg_temp.c(r, 'Cinara')->>'custo')::numeric = 585, 'zero_clients: Cinara custo ' || (pg_temp.c(r, 'Cinara')->>'custo');
  assert (pg_temp.m(r, 'Bruno')->>'n_clientes')::int = 0, 'zero_clients: Bruno n_clientes';
  assert pg_temp.m(r, 'Bruno')->'por_cliente' = 'null'::jsonb, 'zero_clients: Bruno por_cliente null';
  assert (pg_temp.m(r, 'Bruno')->>'custo')::numeric = 3150, 'zero_clients: Bruno custo';
  assert (r->'totais'->'por_funcao'->>pg_temp.fid(v_ws, 'Edição de vídeo'))::numeric = 0, 'zero_clients: Edição column 0';
  raise notice 'PASS zero_clients_goes_sem_cliente';
end $$;

do $$
declare v_ws uuid := pg_temp.novo_ws(); r jsonb;
begin
  perform pg_temp.fixture_planilha(v_ws);
  update financeiro_acordo_versoes set funcao_id = null where conta_id = v_ws;
  r := public._financeiro_calcular(v_ws, date '2026-10-01');
  assert not exists (select 1 from jsonb_array_elements(r->'clientes') e where (e->>'custo')::numeric <> 0),
    'all_sem_funcao: a client has cost';
  assert not exists (select 1 from jsonb_array_elements(r->'clientes') e where jsonb_array_length(e->'pessoas') <> 0),
    'all_sem_funcao: a client lists pessoas';
  assert (r->'totais'->>'custo_sem_cliente')::numeric = 12310, 'all_sem_funcao: custo_sem_cliente ' || (r->'totais'->>'custo_sem_cliente');
  assert (r->'totais'->>'custo_total')::numeric = 12310, 'all_sem_funcao: custo_total';
  assert (r->'totais'->>'custo_clientes')::numeric = 0, 'all_sem_funcao: custo_clientes';
  assert not exists (select 1 from jsonb_each_text(r->'totais'->'por_funcao') x where x.value::numeric <> 0),
    'all_sem_funcao: totais.por_funcao not all zero';
  assert (select array_agg(e->>'nome' order by o) from jsonb_array_elements(r->'membros') with ordinality x(e, o))
       = array['Ana','Bruno','Caio','Duda','Lia'], 'all_sem_funcao: members without funcao ordered by nome';
  assert pg_temp.m(r, 'Ana')->'funcao_id' = 'null'::jsonb and pg_temp.m(r, 'Ana')->'por_cliente' = 'null'::jsonb,
    'all_sem_funcao: Ana funcao_id / por_cliente null';
  raise notice 'PASS all_sem_funcao';
end $$;

do $$
declare v_ws uuid := pg_temp.novo_ws(); r jsonb; v_ty jsonb;
begin
  perform pg_temp.fixture_planilha(v_ws);
  update financeiro_cliente_versoes set status = 'pausado' where conta_id = v_ws and cliente_id = pg_temp.cid(v_ws, 'Tyciana');
  r := public._financeiro_calcular(v_ws, date '2026-10-01');
  v_ty := pg_temp.c(r, 'Tyciana');
  assert v_ty->>'status' = 'pausado', 'pausado: status';
  assert (v_ty->>'receita')::numeric = 0, 'pausado: receita ' || (v_ty->>'receita');
  assert v_ty->'margem' = 'null'::jsonb, 'pausado: margem ' || (v_ty->'margem')::text;
  assert (v_ty->>'custo')::numeric = 0, 'pausado: custo ' || (v_ty->>'custo');
  assert (pg_temp.m(r, 'Ana')->>'n_clientes')::int = 14, 'pausado: Ana n_clientes';
  assert (pg_temp.m(r, 'Ana')->>'por_cliente')::numeric = 278.57, 'pausado: Ana por_cliente ' || (pg_temp.m(r, 'Ana')->>'por_cliente');
  assert (pg_temp.c(r, 'Cinara')->'por_funcao'->>pg_temp.fid(v_ws, 'Design'))::numeric = 278.57, 'pausado: Cinara Design';
  assert (r->'totais'->>'receita')::numeric = 29100, 'pausado: totais receita';
  -- totals come from unrounded values: the 14 Design shares add up to 3900, not 14 x 278.57
  assert (r->'totais'->>'custo_total')::numeric = 12310 and (r->'totais'->>'custo_sem_cliente')::numeric = 0,
    'pausado: totals reconcile';
  raise notice 'PASS pausado_excluded';
end $$;

do $$
declare v_ws uuid := pg_temp.novo_ws(); r jsonb; v_cin jsonb; v_rob jsonb; v_p jsonb;
begin
  perform pg_temp.fixture_planilha(v_ws);
  update financeiro_acordo_versoes set modelo = 'por_entrega', valor = 45
   where conta_id = v_ws and membro_id = pg_temp.mid(v_ws, 'Ana');
  insert into financeiro_entregas_manuais (conta_id, periodo_inicio, membro_id, cliente_id, quantidade)
    values (v_ws, date '2026-10-01', pg_temp.mid(v_ws, 'Ana'), pg_temp.cid(v_ws, 'Cinara'), 10);
  r := public._financeiro_calcular(v_ws, date '2026-10-01');
  v_cin := pg_temp.c(r, 'Cinara');
  assert (v_cin->'por_funcao'->>pg_temp.fid(v_ws, 'Design'))::numeric = 450, 'por_entrega: Cinara Design';
  assert v_cin->'a_informar' = 'false'::jsonb, 'por_entrega: Cinara has its quantity';
  select e into v_p from jsonb_array_elements(v_cin->'pessoas') e where e->>'nome' = 'Ana';
  assert v_p->>'regra' = 'entrega' and (v_p->>'quantidade')::int = 10 and (v_p->>'valor_unitario')::numeric = 45
     and (v_p->>'valor')::numeric = 450, 'por_entrega: Ana on Cinara ' || coalesce(v_p::text, 'missing');
  v_rob := pg_temp.c(r, 'Roberta');
  assert (v_rob->'por_funcao'->>pg_temp.fid(v_ws, 'Design'))::numeric = 0, 'por_entrega: Roberta Design 0';
  assert v_rob->'a_informar' = 'true'::jsonb, 'por_entrega: Roberta a_informar';
  select e into v_p from jsonb_array_elements(v_rob->'pessoas') e where e->>'nome' = 'Ana';
  assert v_p->>'regra' = 'entrega' and v_p->'quantidade' = 'null'::jsonb and (v_p->>'valor')::numeric = 0,
    'por_entrega: Ana on Roberta ' || coalesce(v_p::text, 'missing');
  assert (select count(*) from jsonb_array_elements(r->'clientes') e where e->'a_informar' = 'true'::jsonb) = 14,
    'por_entrega: 14 clients a_informar';
  assert r->'incompleto' = 'true'::jsonb, 'por_entrega: incompleto';
  assert pg_temp.m(r, 'Ana')->>'modelo' = 'por_entrega' and (pg_temp.m(r, 'Ana')->>'custo')::numeric = 450
     and pg_temp.m(r, 'Ana')->'a_informar' = 'true'::jsonb and pg_temp.m(r, 'Ana')->'por_cliente' = 'null'::jsonb,
    'por_entrega: Ana member ' || pg_temp.m(r, 'Ana')::text;
  assert (r->'totais'->>'custo_total')::numeric = 12310 - 3900 + 450, 'por_entrega: custo_total';
  raise notice 'PASS por_entrega_a_informar';
end $$;

do $$
declare v_ws uuid := pg_temp.novo_ws(); r jsonb;
begin
  perform pg_temp.fixture_planilha(v_ws);
  insert into financeiro_periodos (conta_id, inicio, fim, transicao) values (v_ws, date '2026-11-01', date '2026-11-15', true);
  -- a per-delivery member is not pro-rated (units x amount)
  update financeiro_acordo_versoes set modelo = 'por_entrega', valor = 45
   where conta_id = v_ws and membro_id = pg_temp.mid(v_ws, 'Bruno');
  insert into financeiro_entregas_manuais (conta_id, periodo_inicio, membro_id, cliente_id, quantidade)
    values (v_ws, date '2026-11-01', pg_temp.mid(v_ws, 'Bruno'), pg_temp.cid(v_ws, 'Talitha'), 4);
  r := public._financeiro_calcular(v_ws, date '2026-11-01');
  assert (pg_temp.c(r, 'Talitha')->>'receita')::numeric = round(2500 * 14 / 30.0, 2),
    'transicao: Talitha receita ' || (pg_temp.c(r, 'Talitha')->>'receita');
  assert (pg_temp.m(r, 'Ana')->>'custo')::numeric = round(3900 * 14 / 30.0, 2), 'transicao: Ana custo pro-rated';
  assert (pg_temp.m(r, 'Bruno')->>'custo')::numeric = 180, 'transicao: per-delivery not pro-rated';
  assert r->'periodo'->'transicao' = 'true'::jsonb and r->'periodo'->>'fim' = '2026-11-15'
     and r->'periodo'->>'rotulo' = '1 nov a 14 nov', 'transicao: periodo ' || (r->'periodo')::text;
  assert round((r->'periodo'->>'fator')::numeric, 4) = round(14 / 30.0, 4), 'transicao: fator';
  raise notice 'PASS transicao_prorata';
end $$;

-- A start with no period row: fim from financeiro_periodo_fim, status 'futuro'
do $$
declare v_ws uuid := pg_temp.novo_ws(); r jsonb;
begin
  perform pg_temp.fixture_planilha(v_ws);
  r := public._financeiro_calcular(v_ws, date '2026-12-01');
  assert r->'periodo' = jsonb_build_object('inicio', '2026-12-01', 'fim', '2027-01-01', 'rotulo', 'dez 2026',
                                           'status', 'futuro', 'transicao', false, 'fator', 1),
    'calcular_sem_linha: periodo ' || (r->'periodo')::text;
  assert (r->'totais'->>'receita')::numeric = 30600, 'calcular_sem_linha: versions carry forward';
  -- before any version: nothing listed, zeros, margem null
  r := public._financeiro_calcular(v_ws, date '2026-09-01');
  assert jsonb_array_length(r->'clientes') = 0 and jsonb_array_length(r->'membros') = 0, 'calcular_antes: nothing listed';
  assert r->'totais'->'margem' = 'null'::jsonb and (r->'totais'->>'custo_total')::numeric = 0, 'calcular_antes: totals';
  raise notice 'PASS calcular_sem_linha';
end $$;

-- Encerrado: not listed and out of the split
do $$
declare v_ws uuid := pg_temp.novo_ws(); r jsonb;
begin
  perform pg_temp.fixture_planilha(v_ws);
  update financeiro_cliente_versoes set status = 'encerrado' where conta_id = v_ws and cliente_id = pg_temp.cid(v_ws, 'Tyciana');
  r := public._financeiro_calcular(v_ws, date '2026-10-01');
  assert pg_temp.c(r, 'Tyciana') is null, 'encerrado: listed';
  assert jsonb_array_length(r->'clientes') = 14, 'encerrado: 14 clients';
  assert (pg_temp.m(r, 'Ana')->>'n_clientes')::int = 14, 'encerrado: Ana n_clientes';
  raise notice 'PASS encerrado_omitted';
end $$;

-- ---- RPC wrapper ----
do $$
declare v_ws uuid := pg_temp.novo_ws(); r jsonb;
begin
  perform pg_temp.fixture_planilha(v_ws);
  r := pg_temp.rent(pg_temp.dono(v_ws));
  assert r = public._financeiro_calcular(v_ws, date '2026-10-01'), 'rpc_live: default period is the open one';
  assert pg_temp.rent(pg_temp.dono(v_ws), date '2026-10-01') = r, 'rpc_live: explicit period';
  raise notice 'PASS rpc_live_default_period';
end $$;

do $$
declare v_ws uuid := pg_temp.novo_ws(); v_err text;
begin
  perform pg_temp.fixture_planilha(v_ws);
  update workspace_plan_overrides set feature_overrides = '{"feature_financeiro_v2": false}'::jsonb where workspace_id = v_ws;
  v_err := pg_temp.rent_erro(pg_temp.dono(v_ws));
  assert v_err = 'P0001:feature_disabled:feature_financeiro_v2', 'rpc_flag_off: ' || coalesce(v_err, 'success');
  update workspace_plan_overrides set feature_overrides = '{"feature_financeiro_v2": true, "feature_financial": false}'::jsonb where workspace_id = v_ws;
  v_err := pg_temp.rent_erro(pg_temp.dono(v_ws));
  assert v_err = 'P0001:feature_disabled:feature_financial', 'rpc_flag_off (financial): ' || coalesce(v_err, 'success');
  -- both checks precede the visibility check and the seeded check
  update workspace_plan_overrides set feature_overrides = '{"feature_financeiro_v2": false}'::jsonb where workspace_id = v_ws;
  delete from financeiro_config where conta_id = v_ws;
  v_err := pg_temp.rent_erro(pg_temp.dono(v_ws));
  assert v_err = 'P0001:feature_disabled:feature_financeiro_v2', 'rpc_flag_off before seeded check: ' || coalesce(v_err, 'success');
  raise notice 'PASS rpc_flag_off';
end $$;

do $$
declare v_ws uuid := pg_temp.novo_ws(); v_admin uuid := gen_random_uuid(); v_err text;
begin
  perform pg_temp.fixture_planilha(v_ws);
  insert into auth.users (id) values (v_admin);
  insert into workspace_members (user_id, workspace_id, role, can_see_financials) values (v_admin, v_ws, 'admin', false);
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_admin;
  v_err := pg_temp.rent_erro(v_admin);
  assert v_err = '42501:financial_access_denied', 'rpc_no_financials: ' || coalesce(v_err, 'success');
  v_err := pg_temp.rent_erro(v_admin, date '2026-10-01');
  assert v_err = '42501:financial_access_denied', 'rpc_no_financials (explicit period): ' || coalesce(v_err, 'success');
  -- the visibility check precedes the seeded check
  delete from financeiro_config where conta_id = v_ws;
  v_err := pg_temp.rent_erro(v_admin);
  assert v_err = '42501:financial_access_denied', 'rpc_no_financials before seeded check: ' || coalesce(v_err, 'success');
  begin
    perform pg_temp.rpc(v_admin, 'select public.financeiro_periodos_listar()');
    assert false, 'rpc_no_financials: periodos_listar did not raise';
  exception when insufficient_privilege then null;
  end;
  begin
    perform pg_temp.rpc(v_admin, 'select public.financeiro_periodos_editaveis()');
    assert false, 'rpc_no_financials: periodos_editaveis did not raise';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS rpc_no_financials';
end $$;

do $$
declare v_ws uuid := pg_temp.novo_ws(); v_sem_ws uuid := gen_random_uuid(); r jsonb; v_err text;
begin
  r := pg_temp.rent(pg_temp.dono(v_ws));
  assert r = '{"seeded": false}'::jsonb, 'rpc_unseeded (no config row): ' || r::text;
  insert into financeiro_config (conta_id) values (v_ws);
  r := pg_temp.rent(pg_temp.dono(v_ws));
  assert r = '{"seeded": false}'::jsonb, 'rpc_unseeded (seeded_at null): ' || r::text;
  -- a session with no active workspace fails closed instead of falling through
  insert into auth.users (id) values (v_sem_ws);
  delete from workspace_members where user_id = v_sem_ws;   -- get_my_conta_id() is now NULL
  v_err := pg_temp.rent_erro(v_sem_ws);
  assert v_err like 'P0001:feature_disabled:%', 'rpc without workspace: ' || coalesce(v_err, 'success');
  raise notice 'PASS rpc_unseeded';
end $$;

do $$
declare v_ws uuid := pg_temp.novo_ws(); r jsonb;
begin
  perform pg_temp.fixture_planilha(v_ws);
  insert into financeiro_periodos (conta_id, inicio, fim, status, snapshot, fechado_em)
    values (v_ws, date '2026-09-01', date '2026-10-01', 'fechado', '{"x": 1}'::jsonb, now());
  r := pg_temp.rent(pg_temp.dono(v_ws), date '2026-09-01');
  assert r = '{"x": 1}'::jsonb, 'rpc_closed_returns_snapshot: ' || r::text;
  -- default still picks the open period, not the newer-or-older closed one
  assert pg_temp.rent(pg_temp.dono(v_ws))->'periodo'->>'inicio' = '2026-10-01', 'rpc_closed: default period';
  -- with every period closed, the default is the latest one
  update financeiro_periodos set status = 'fechado', snapshot = '{"y": 2}'::jsonb where conta_id = v_ws and inicio = date '2026-10-01';
  assert pg_temp.rent(pg_temp.dono(v_ws)) = '{"y": 2}'::jsonb, 'rpc_closed: all closed -> latest snapshot';
  -- a reopened period is computed live
  update financeiro_periodos set status = 'reaberto' where conta_id = v_ws and inicio = date '2026-09-01';
  assert pg_temp.rent(pg_temp.dono(v_ws), date '2026-09-01')->'periodo'->>'status' = 'reaberto', 'rpc_closed: reaberto is live';
  raise notice 'PASS rpc_closed_returns_snapshot';
end $$;

do $$
declare v_ws uuid := pg_temp.novo_ws(); v_err text; r jsonb;
begin
  perform pg_temp.fixture_planilha(v_ws);
  v_err := pg_temp.rent_erro(pg_temp.dono(v_ws), date '2026-07-15');
  assert v_err = 'P0001:periodo_invalido', 'rpc_invalid_period: ' || coalesce(v_err, 'success');
  v_err := pg_temp.rent_erro(pg_temp.dono(v_ws), date '2027-02-01');   -- third projected start: not offered
  assert v_err = 'P0001:periodo_invalido', 'rpc_invalid_period (3rd projected): ' || coalesce(v_err, 'success');
  r := pg_temp.rent(pg_temp.dono(v_ws), date '2026-12-01');            -- second projected start
  assert r->'periodo'->>'status' = 'futuro' and (r->'totais'->>'receita')::numeric = 30600,
    'rpc projected start: ' || (r->'periodo')::text;
  raise notice 'PASS rpc_invalid_period';
end $$;

do $$
declare v_ws uuid := pg_temp.novo_ws(); r jsonb;
begin
  perform pg_temp.fixture_planilha(v_ws);
  insert into financeiro_periodos (conta_id, inicio, fim, status, snapshot, fechado_em) values
    (v_ws, date '2026-08-01', date '2026-09-01', 'fechado', '{}'::jsonb, now()),
    (v_ws, date '2026-09-01', date '2026-10-01', 'reaberto', null, null);
  r := pg_temp.rpc(pg_temp.dono(v_ws), 'select public.financeiro_periodos_listar()');
  assert r = jsonb_build_array(
    jsonb_build_object('inicio', '2026-10-01', 'fim', '2026-11-01', 'rotulo', 'out 2026', 'status', 'aberto', 'transicao', false),
    jsonb_build_object('inicio', '2026-09-01', 'fim', '2026-10-01', 'rotulo', 'set 2026', 'status', 'reaberto', 'transicao', false),
    jsonb_build_object('inicio', '2026-08-01', 'fim', '2026-09-01', 'rotulo', 'ago 2026', 'status', 'fechado', 'transicao', false)),
    'periodos_listar: ' || r::text;
  r := pg_temp.rpc(pg_temp.dono(v_ws), 'select public.financeiro_periodos_editaveis()');
  assert r = jsonb_build_array(
    jsonb_build_object('inicio', '2026-09-01', 'fim', '2026-10-01', 'rotulo', 'set 2026', 'status', 'reaberto', 'transicao', false),
    jsonb_build_object('inicio', '2026-10-01', 'fim', '2026-11-01', 'rotulo', 'out 2026', 'status', 'aberto', 'transicao', false),
    jsonb_build_object('inicio', '2026-11-01', 'fim', '2026-12-01', 'rotulo', 'nov 2026', 'status', 'futuro', 'transicao', false),
    jsonb_build_object('inicio', '2026-12-01', 'fim', '2027-01-01', 'rotulo', 'dez 2026', 'status', 'futuro', 'transicao', false)),
    'periodos_editaveis: ' || r::text;
  -- a changed periodo_dia makes the next projected period a transition
  update financeiro_config set periodo_dia = 15 where conta_id = v_ws;
  r := pg_temp.rpc(pg_temp.dono(v_ws), 'select public.financeiro_periodos_editaveis()');
  assert r->2 = jsonb_build_object('inicio', '2026-11-01', 'fim', '2026-11-15', 'rotulo', '1 nov a 14 nov', 'status', 'futuro', 'transicao', true)
     and r->3->>'inicio' = '2026-11-15', 'periodos_editaveis transition: ' || r::text;
  raise notice 'PASS periodos_listar_editaveis';
end $$;

-- grants: the core is service_role only; the RPCs are authenticated + service_role, never anon
do $$
declare v_fn text;
begin
  assert not has_function_privilege('anon', 'public._financeiro_calcular(uuid,date)', 'execute'), 'anon executes _financeiro_calcular';
  assert not has_function_privilege('authenticated', 'public._financeiro_calcular(uuid,date)', 'execute'), 'authenticated executes _financeiro_calcular';
  assert has_function_privilege('service_role', 'public._financeiro_calcular(uuid,date)', 'execute'), 'service_role lost _financeiro_calcular';
  foreach v_fn in array array['public.financeiro_rentabilidade(date)', 'public.financeiro_periodos_listar()',
                              'public.financeiro_periodos_editaveis()'] loop
    assert not has_function_privilege('anon', v_fn, 'execute'), 'anon executes ' || v_fn;
    assert has_function_privilege('authenticated', v_fn, 'execute'), 'authenticated cannot execute ' || v_fn;
    assert has_function_privilege('service_role', v_fn, 'execute'), 'service_role cannot execute ' || v_fn;
    assert (select prosecdef from pg_proc where oid = v_fn::regprocedure), v_fn || ' is not SECURITY DEFINER';
  end loop;
  assert (select prosecdef from pg_proc where oid = 'public._financeiro_calcular(uuid,date)'::regprocedure),
    '_financeiro_calcular is not SECURITY DEFINER';
  raise notice 'PASS rpc_grants';
end $$;

rollback;
