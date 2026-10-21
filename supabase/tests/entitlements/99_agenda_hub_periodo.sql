\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Agenda sub-project 4, migration A (20261008000001_agenda_hub_periodo.sql):
-- agenda_hub_periodo (the Hub calendar's date-range read) and agenda_hub_visivel
-- (the visibility predicate it shares with agenda_hub_listar). Blocks:
-- (1) window overlap and visibility filters, (2) the gate (flag, inactive
-- cliente) and window validation, (3) the 300-item cap, (4) grants.
-- agenda_hub_listar must be unchanged: 99_agenda_hub.sql covers it in depth,
-- block 1 here pins the one difference (the 30-day floor) on a shared fixture.
--
-- Fixtures are built from current_date (the Hub filters on the real now()).

begin;
update plans set feature_agenda = true;
select et_grant_hosted_parity(array['agenda_eventos','agenda_ocorrencias','agenda_participantes','agenda_respostas',
  'agenda_respostas_cliente','agenda_remarcacoes','agenda_emails_cliente']);
revoke all on public.agenda_eventos, public.agenda_ocorrencias, public.agenda_participantes, public.agenda_respostas from anon, authenticated;
grant select on public.agenda_eventos, public.agenda_ocorrencias, public.agenda_participantes, public.agenda_respostas to authenticated;
grant all on public.agenda_eventos, public.agenda_ocorrencias, public.agenda_participantes, public.agenda_respostas to service_role;

-- 'YYYY-MM-DD"T"HH:MI:SS' for current_date + p_dias at p_hora
create or replace function pg_temp.dia(p_dias int, p_hora text default '14:00:00') returns text language sql as $f$
  select to_char(current_date + p_dias, 'YYYY-MM-DD') || 'T' || p_hora;
$f$;
-- the instant of that wall clock in Sao Paulo
create or replace function pg_temp.ts(p_dias int, p_hora text default '14:00:00') returns timestamptz language sql as $f$
  select pg_temp.dia(p_dias, p_hora)::timestamp at time zone 'America/Sao_Paulo';
$f$;
-- base create payload merged with overrides
create or replace function pg_temp.p(p jsonb default '{}') returns jsonb language sql as $f$
  select jsonb_build_object(
    'titulo', 'Gravação', 'descricao', null, 'local', null, 'link_reuniao', null,
    'tipo', 'gravacao', 'cor', null, 'cliente_id', null, 'privado', false, 'dia_inteiro', false,
    'tz', 'America/Sao_Paulo', 'inicio_local', pg_temp.dia(5), 'fim_local', pg_temp.dia(5, '15:00:00'),
    'lembretes', jsonb_build_array(), 'regra', null) || p;
$f$;
-- daily rule of p_n occurrences (contagem)
create or replace function pg_temp.regra(p_n int) returns jsonb language sql as $f$
  select jsonb_build_object('freq','daily','intervalo',1,'dias_semana',null,'mensal_modo',null,
                            'mensal_ordinal',null,'ate',null,'contagem',p_n);
$f$;
-- daily series of p_n occurrences starting at current_date + p_dias, 14:00-15:00
create or replace function pg_temp.diaria(p_dias int, p_n int, p jsonb default '{}') returns jsonb language sql as $f$
  select pg_temp.p(jsonb_build_object(
    'inicio_local', pg_temp.dia(p_dias), 'fim_local', pg_temp.dia(p_dias, '15:00:00'),
    'regra', pg_temp.regra(p_n)) || p);
$f$;
create or replace function pg_temp.sem_claims() returns void language sql as $f$
  select set_config('request.jwt.claims', '', true);
$f$;
-- create an event as p_user; returns its first occurrence id
create or replace function pg_temp.criar(p_user uuid, p jsonb, parts uuid[] default '{}') returns bigint language plpgsql as $f$
declare v bigint;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select c.ocorrencia_id into v from public.agenda_evento_criar(p, parts) c;
  execute 'reset role';
  perform pg_temp.sem_claims();
  return v;
end $f$;
-- the p_n-th (1-based) occurrence of the series that holds p_oc
create or replace function pg_temp.nth(p_oc bigint, p_n int) returns bigint language sql as $f$
  select o.id from agenda_ocorrencias o
   where o.evento_id = (select evento_id from agenda_ocorrencias where id = p_oc)
   order by o.data_original offset p_n - 1 limit 1;
$f$;
create or replace function pg_temp.ev(p_oc bigint) returns bigint language sql as $f$
  select evento_id from agenda_ocorrencias where id = p_oc;
$f$;
create or replace function pg_temp.ini(p_oc bigint) returns timestamptz language sql as $f$
  select inicio from agenda_ocorrencias where id = p_oc;
$f$;
-- runs p_sql (one jsonb value) as service_role (the edge functions' role);
-- an error comes back as {"erro": "SQLSTATE:message"}
create or replace function pg_temp.svc(p_sql text) returns jsonb language plpgsql as $f$
declare v jsonb;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  execute 'set local role service_role';
  execute p_sql into v;
  execute 'reset role';
  perform pg_temp.sem_claims();
  return v;
exception when others then
  perform pg_temp.sem_claims();
  return jsonb_build_object('erro', sqlstate || ':' || sqlerrm);
end $f$;
-- the ids of the items of a listar payload, in order
create or replace function pg_temp.ids(p jsonb) returns bigint[] language sql as $f$
  select coalesce(array_agg((x->>'ocorrencia_id')::bigint order by n), '{}')
    from jsonb_array_elements(p->'itens') with ordinality as t(x, n);
$f$;
-- fixture: ws (max) with owner O, admin AD, agent AG and clientes A, B; ws2 with X and cliente CX
create or replace function pg_temp.fx() returns jsonb language plpgsql as $f$
declare
  v_ws uuid := et_make_workspace('max');
  v_ws2 uuid := et_make_workspace('max');
  v_o uuid := gen_random_uuid(); v_ad uuid := gen_random_uuid(); v_ag uuid := gen_random_uuid(); v_x uuid := gen_random_uuid();
  v_ca bigint; v_cb bigint; v_cx bigint;
begin
  perform pg_temp.sem_claims();
  perform set_config('app.agenda_hoje', current_date::text, true);
  insert into auth.users (id) values (v_o), (v_ad), (v_ag), (v_x);
  insert into workspace_members (user_id, workspace_id, role) values
    (v_o, v_ws, 'owner'), (v_ad, v_ws, 'admin'), (v_ag, v_ws, 'agent'), (v_x, v_ws2, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id in (v_o, v_ad, v_ag);
  update profiles set conta_id = v_ws2, active_workspace_id = v_ws2 where id = v_x;
  update profiles set nome = 'Olga Dona' where id = v_o;
  update workspaces set name = 'Agência Teste', brand_color = '#123456', logo_url = 'https://cdn.example.com/logo.png' where id = v_ws;
  insert into clientes (user_id, conta_id, nome, sigla, cor, email) values (v_o, v_ws, 'Clínica A', 'CA', '#000', 'a@example.com') returning id into v_ca;
  insert into clientes (user_id, conta_id, nome, sigla, cor, email) values (v_o, v_ws, 'Clínica B', 'CB', '#000', 'b@example.com') returning id into v_cb;
  insert into clientes (user_id, conta_id, nome, sigla, cor, email) values (v_x, v_ws2, 'Clínica X', 'CX', '#000', 'x@example.com') returning id into v_cx;
  return jsonb_build_object('ws', v_ws, 'ws2', v_ws2, 'o', v_o, 'ad', v_ad, 'ag', v_ag, 'x', v_x,
                            'ca', v_ca, 'cb', v_cb, 'cx', v_cx);
end $f$;

-- runs p_sql as p_user (authenticated); 'SQLSTATE:message' of the error, or NULL on success
create or replace function pg_temp.erro(p_user uuid, p_sql text) returns text language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  execute p_sql;
  execute 'reset role';
  perform pg_temp.sem_claims();
  return null;
exception when others then
  perform pg_temp.sem_claims();
  return sqlstate || ':' || sqlerrm;
end $f$;
create or replace function pg_temp.listar(c uuid, cl bigint, ai timestamptz default null, aid bigint default null, lim int default 100)
returns jsonb language sql as $f$
  select pg_temp.svc(format('select public.agenda_hub_listar(%L::uuid, %s, %L::timestamptz, %L::bigint, %s)', c, cl, ai, aid, lim));
$f$;
create or replace function pg_temp.periodo(c uuid, cl bigint, de timestamptz, ate timestamptz) returns jsonb language sql as $f$
  select pg_temp.svc(format('select public.agenda_hub_periodo(%L::uuid, %s, %L::timestamptz, %L::timestamptz)', c, cl, de, ate));
$f$;
create or replace function pg_temp.responder(c uuid, cl bigint, oc bigint, r text, visto timestamptz) returns jsonb language sql as $f$
  select pg_temp.svc(format('select public.agenda_hub_responder(%L::uuid, %s, %s, %L, %L::timestamptz)', c, cl, oc, r, visto));
$f$;
grant execute on all functions in schema pg_temp to authenticated, service_role;

-- ============ block 1: window overlap and visibility ============
do $$
declare
  f jsonb := pg_temp.fx();
  v_ws uuid := (f->>'ws')::uuid; v_ws2 uuid := (f->>'ws2')::uuid;
  v_o uuid := (f->>'o')::uuid; v_x uuid := (f->>'x')::uuid;
  v_ca bigint := (f->>'ca')::bigint; v_cb bigint := (f->>'cb')::bigint; v_cx bigint := (f->>'cx')::bigint;
  v_antigo bigint; v_s1 bigint; v_s2 bigint; v_s3 bigint; v_multi bigint; v_interno bigint; v_outro_cli bigint;
  v_privado bigint; v_x1 bigint;
  v jsonb; v_it jsonb; v_ids bigint[]; v_err text;
begin
  -- shared with A: 40 days ago, a 3-occurrence daily series from +5, a 3-day all-day event from +20
  v_antigo := pg_temp.criar(v_o, pg_temp.p(jsonb_build_object('titulo', 'Há 40 dias', 'cliente_id', v_ca,
    'compartilhado_cliente', true, 'inicio_local', pg_temp.dia(-40), 'fim_local', pg_temp.dia(-40, '15:00:00'))));
  v_s1 := pg_temp.criar(v_o, pg_temp.diaria(5, 3, jsonb_build_object('titulo', 'Gravação de reels',
    'descricao', 'Roteiro', 'local', 'Estúdio', 'link_reuniao', 'https://meet.example.com/x',
    'cliente_id', v_ca, 'compartilhado_cliente', true)));
  v_s2 := pg_temp.nth(v_s1, 2); v_s3 := pg_temp.nth(v_s1, 3);
  v_multi := pg_temp.criar(v_o, pg_temp.p(jsonb_build_object('titulo', 'Imersão', 'cliente_id', v_ca,
    'compartilhado_cliente', true, 'dia_inteiro', true,
    'inicio_local', pg_temp.dia(20, '00:00:00'), 'fim_local', pg_temp.dia(23, '00:00:00'))));
  -- absent: not shared, another client's, private, cancelled, another workspace
  v_interno := pg_temp.criar(v_o, pg_temp.p(jsonb_build_object('titulo', 'Interno', 'cliente_id', v_ca)));
  v_outro_cli := pg_temp.criar(v_o, pg_temp.p(jsonb_build_object('titulo', 'Do B', 'cliente_id', v_cb, 'compartilhado_cliente', true)));
  -- private + shared is refused by a CHECK, so a private event is never shared: it is hidden by sharing alone
  v_privado := pg_temp.criar(v_o, pg_temp.p(jsonb_build_object('titulo', 'Privado', 'cliente_id', v_ca, 'privado', true)));
  v_x1 := pg_temp.criar(v_x, pg_temp.p(jsonb_build_object('cliente_id', v_cx, 'compartilhado_cliente', true)));
  v_err := pg_temp.erro(v_o, format('select public.agenda_evento_excluir(%s, %L)', v_s2, 'esta'));
  assert v_err is null, format('excluir esta: %s', v_err);

  -- an occurrence 40 days ago appears in a period covering it (listar floors at now() - 30 days)
  v := pg_temp.periodo(v_ws, v_ca, pg_temp.ts(-41), pg_temp.ts(-38));
  assert v->>'estado' = 'ok' and pg_temp.ids(v) = array[v_antigo], format('period over the old occurrence: %s', v);
  assert not (pg_temp.ids(pg_temp.listar(v_ws, v_ca)) @> array[v_antigo]), 'listar returns the 40-day-old occurrence';

  -- the whole range: everything A may see, ordered by inicio; none of the absent ones
  v := pg_temp.periodo(v_ws, v_ca, pg_temp.ts(-45), pg_temp.ts(-45) + interval '45 days');
  assert pg_temp.ids(v) = array[v_antigo], format('window -45d..0: %s', pg_temp.ids(v));
  v := pg_temp.periodo(v_ws, v_ca, pg_temp.ts(0), pg_temp.ts(0) + interval '45 days');
  v_ids := pg_temp.ids(v);
  assert v_ids = array[v_s1, v_s3, v_multi], format('window 0..45d: %s (expected %s)', v_ids, array[v_s1, v_s3, v_multi]);
  assert not (v_ids && array[v_s2, v_interno, v_outro_cli, v_privado, v_x1]), format('a hidden occurrence leaked: %s', v_ids);
  assert v->'itens'->0->>'ocorrencia_id' = v_s1::text, 'items not ordered by inicio';

  -- the same Item as agenda_hub_listar, key for key
  assert v->'itens'->0 = (select x from jsonb_array_elements(pg_temp.listar(v_ws, v_ca)->'itens') x
                           where x->>'ocorrencia_id' = v_s1::text),
    format('periodo item differs from the listar item: %s', v->'itens'->0);
  assert (select array_agg(k order by k) from jsonb_object_keys(v->'itens'->0) k)
       = array['data_fim_local','data_inicio_local','descricao','dia_inteiro','fim','inicio','link_reuniao','local',
               'ocorrencia_id','remarcacao','resposta','sequencia','titulo','tz'], format('item keys: %s', v->'itens'->0);
  assert not (v ? 'proximo'), 'periodo carries a cursor';
  -- the effective answer is part of the item
  perform pg_temp.responder(v_ws, v_ca, v_s1, 'sim', pg_temp.ini(v_s1));
  assert pg_temp.periodo(v_ws, v_ca, pg_temp.ts(0), pg_temp.ts(0) + interval '45 days')->'itens'->0->>'resposta' = 'sim',
    'the period item does not carry the answer';

  -- multi-day all-day: appears when the window only touches its tail ...
  v_it := pg_temp.periodo(v_ws, v_ca, pg_temp.ts(22, '12:00:00'), pg_temp.ts(30))->'itens'->0;
  assert (v_it->>'ocorrencia_id')::bigint = v_multi, format('multi-day overlapping the window start: %s', v_it);
  assert v_it->'dia_inteiro' = 'true'::jsonb and v_it->>'data_inicio_local' = to_char(current_date + 20, 'YYYY-MM-DD')
     and v_it->>'data_fim_local' = to_char(current_date + 23, 'YYYY-MM-DD'), format('multi-day local dates: %s', v_it);
  -- ... or its head
  assert pg_temp.ids(pg_temp.periodo(v_ws, v_ca, pg_temp.ts(10), pg_temp.ts(20, '06:00:00'))) = array[v_multi],
    'multi-day overlapping the window end';
  -- the window is half-open: ending at its inicio or starting at its fim excludes it
  assert pg_temp.ids(pg_temp.periodo(v_ws, v_ca, pg_temp.ts(10), (select inicio from agenda_ocorrencias where id = v_multi))) = '{}',
    'window ending exactly at inicio still returned the event';
  assert pg_temp.ids(pg_temp.periodo(v_ws, v_ca, (select fim from agenda_ocorrencias where id = v_multi), pg_temp.ts(40))) = '{}',
    'window starting exactly at fim still returned the event';
  -- a timed occurrence is found by a window that starts mid-way through it
  assert pg_temp.ids(pg_temp.periodo(v_ws, v_ca, pg_temp.ts(5, '14:30:00'), pg_temp.ts(5, '16:00:00'))) = array[v_s1],
    'window starting mid-occurrence';

  -- scoping
  assert pg_temp.ids(pg_temp.periodo(v_ws, v_cb, pg_temp.ts(0), pg_temp.ts(30))) = array[v_outro_cli], 'B does not see only its own event';
  assert pg_temp.ids(pg_temp.periodo(v_ws2, v_ca, pg_temp.ts(0), pg_temp.ts(30))) = '{}', 'another workspace with A''s id sees A''s events';
  assert pg_temp.ids(pg_temp.periodo(v_ws2, v_cx, pg_temp.ts(0), pg_temp.ts(30))) = array[v_x1], 'ws2 does not see its own event';
  assert pg_temp.ids(pg_temp.periodo(v_ws, v_cx, pg_temp.ts(0), pg_temp.ts(30))) = '{}', 'ws sees ws2''s cliente events';

  -- agenda_hub_listar is unchanged: same visibility, 30-day floor, no gaps
  assert pg_temp.ids(pg_temp.listar(v_ws, v_ca)) = array[v_s1, v_s3, v_multi],
    format('listar after the helper swap: %s', pg_temp.ids(pg_temp.listar(v_ws, v_ca)));
  assert pg_temp.listar(v_ws, v_ca)->>'estado' = 'ok' and pg_temp.listar(v_ws, v_ca) ? 'proximo', 'listar envelope changed';
  assert pg_temp.ids(pg_temp.listar(v_ws, v_cb)) = array[v_outro_cli], 'listar B';

  -- the shared predicate, one condition at a time (private + shared cannot be stored, so build the rows)
  declare
    e agenda_eventos; o agenda_ocorrencias;
  begin
    select * into e from agenda_eventos where id = pg_temp.ev(v_s1);
    select * into o from agenda_ocorrencias where id = v_s1;
    assert agenda_hub_visivel(e, o, v_ca), 'predicate: the shared occurrence is not visible';
    assert not agenda_hub_visivel(e, o, v_cb), 'predicate: visible to another cliente';
    assert not agenda_hub_visivel(e, o, null), 'predicate: visible to a null cliente';
    assert not agenda_hub_visivel(jsonb_populate_record(e, '{"privado":true,"compartilhado_cliente":false}'), o, v_ca), 'predicate: private';
    assert not agenda_hub_visivel(jsonb_populate_record(e, '{"privado":true}'), o, v_ca), 'predicate: private flag alone';
    assert not agenda_hub_visivel(jsonb_populate_record(e, '{"compartilhado_cliente":false}'), o, v_ca), 'predicate: not shared';
    assert not agenda_hub_visivel(jsonb_populate_record(e, '{"cliente_id":null}'), o, v_ca), 'predicate: no cliente';
    assert not agenda_hub_visivel(e, jsonb_populate_record(o, '{"cancelada":true}'), v_ca), 'predicate: cancelled';
  end;

  raise notice 'PASS 99_agenda_hub_periodo (window and visibility)';
end $$;

-- ============ block 2: gate and window validation ============
do $$
declare
  f jsonb := pg_temp.fx();
  v_ws uuid := (f->>'ws')::uuid; v_o uuid := (f->>'o')::uuid;
  v_ca bigint := (f->>'ca')::bigint;
  v_s1 bigint; v jsonb;
begin
  v_s1 := pg_temp.criar(v_o, pg_temp.p(jsonb_build_object('cliente_id', v_ca, 'compartilhado_cliente', true)));

  -- window validation: positive, at most 45 days
  v := pg_temp.periodo(v_ws, v_ca, pg_temp.ts(0), pg_temp.ts(0));
  assert v->>'erro' = 'P0001:agenda_hub:periodo_invalido', format('ate = de: %s', v);
  v := pg_temp.periodo(v_ws, v_ca, pg_temp.ts(3), pg_temp.ts(0));
  assert v->>'erro' = 'P0001:agenda_hub:periodo_invalido', format('ate < de: %s', v);
  v := pg_temp.periodo(v_ws, v_ca, now(), now() + interval '46 days');
  assert v->>'erro' = 'P0001:agenda_hub:periodo_invalido', format('46 days: %s', v);
  v := pg_temp.periodo(v_ws, v_ca, now(), now() + interval '45 days 1 second');
  assert v->>'erro' = 'P0001:agenda_hub:periodo_invalido', format('45 days and a second: %s', v);
  v := pg_temp.periodo(v_ws, v_ca, now(), now() + interval '45 days');
  assert v->>'estado' = 'ok' and pg_temp.ids(v) = array[v_s1], format('exactly 45 days: %s', v);
  v := pg_temp.svc(format('select public.agenda_hub_periodo(%L::uuid, %s, null, now())', v_ws, v_ca));
  assert v->>'erro' = 'P0001:agenda_hub:periodo_invalido', format('null de: %s', v);
  v := pg_temp.svc(format('select public.agenda_hub_periodo(%L::uuid, %s, now(), null)', v_ws, v_ca));
  assert v->>'erro' = 'P0001:agenda_hub:periodo_invalido', format('null ate: %s', v);

  -- inactive cliente: refused like agenda_hub_listar (estado is only ok | desligado)
  update clientes set status = 'encerrado' where id = v_ca;
  v := pg_temp.periodo(v_ws, v_ca, pg_temp.ts(0), pg_temp.ts(10));
  assert v->>'erro' = 'P0001:agenda_hub:nao_encontrado', format('encerrado: %s', v);
  update clientes set status = 'pausado' where id = v_ca;
  v := pg_temp.periodo(v_ws, v_ca, pg_temp.ts(0), pg_temp.ts(10));
  assert v->>'erro' = 'P0001:agenda_hub:nao_encontrado', format('pausado: %s', v);
  update clientes set status = 'ativo' where id = v_ca;
  assert pg_temp.ids(pg_temp.periodo(v_ws, v_ca, pg_temp.ts(0), pg_temp.ts(10))) = array[v_s1], 'ativo again';
  -- a cliente id that does not exist has nothing shared, no error
  v := pg_temp.periodo(v_ws, -1, pg_temp.ts(0), pg_temp.ts(10));
  assert v->>'estado' = 'ok' and v->'itens' = '[]'::jsonb, format('unknown cliente: %s', v);

  -- flag off: desligado with no items, not an error
  update plans set feature_agenda = false;
  v := pg_temp.periodo(v_ws, v_ca, pg_temp.ts(0), pg_temp.ts(10));
  assert v->>'estado' = 'desligado' and v->'itens' = '[]'::jsonb, format('flag off: %s', v);
  v := pg_temp.periodo(v_ws, v_ca, pg_temp.ts(0), pg_temp.ts(0));
  assert v->>'erro' = 'P0001:agenda_hub:periodo_invalido', format('flag off, bad window: %s', v);
  update plans set feature_agenda = true;
  assert pg_temp.periodo(v_ws, v_ca, pg_temp.ts(0), pg_temp.ts(10))->>'estado' = 'ok', 'flag back on';

  raise notice 'PASS 99_agenda_hub_periodo (gate and validation)';
end $$;

-- ============ block 3: the 300-item cap ============
do $$
declare
  f jsonb := pg_temp.fx();
  v_ws uuid := (f->>'ws')::uuid; v_o uuid := (f->>'o')::uuid;
  v_ca bigint := (f->>'ca')::bigint;
  v_s1 bigint; v_ev bigint; v jsonb; v_ids bigint[];
begin
  v_s1 := pg_temp.criar(v_o, pg_temp.p(jsonb_build_object('cliente_id', v_ca, 'compartilhado_cliente', true)));
  v_ev := pg_temp.ev(v_s1);
  -- 300 more occurrences of the same series, one minute apart from +6 days (301 in all)
  insert into agenda_ocorrencias (conta_id, evento_id, data_original, inicio, fim)
  select v_ws, v_ev, current_date + 1000 + n, pg_temp.ts(6) + n * interval '1 minute', pg_temp.ts(6) + n * interval '1 minute' + interval '30 minutes'
    from generate_series(1, 300) n;
  assert (select count(*) from agenda_ocorrencias where evento_id = v_ev) = 301, 'fixture: not 301 occurrences';

  v := pg_temp.periodo(v_ws, v_ca, pg_temp.ts(0), pg_temp.ts(0) + interval '45 days');
  assert v->>'estado' = 'ok' and jsonb_array_length(v->'itens') = 300, format('301 occurrences returned %s items', jsonb_array_length(v->'itens'));
  v_ids := pg_temp.ids(v);
  assert v_ids[1] = v_s1, 'the cap did not keep the earliest first';
  assert v_ids = (select array_agg(id order by inicio, id) from (select id, inicio from agenda_ocorrencias where evento_id = v_ev order by inicio, id limit 300) z),
    'the 300 kept are not the 300 earliest';

  raise notice 'PASS 99_agenda_hub_periodo (cap)';
end $$;

-- ============ block 4: grants ============
do $$
declare
  f jsonb := pg_temp.fx();
  v_o uuid := (f->>'o')::uuid; v_ws uuid := (f->>'ws')::uuid; v_ca bigint := (f->>'ca')::bigint;
  v_fn text; v_err text;
begin
  foreach v_fn in array array[
    'public.agenda_hub_periodo(uuid, bigint, timestamptz, timestamptz)',
    'public.agenda_hub_visivel(public.agenda_eventos, public.agenda_ocorrencias, bigint)',
    'public.agenda_hub_listar(uuid, bigint, timestamptz, bigint, int)'] loop
    assert not has_function_privilege('anon', v_fn, 'EXECUTE'), format('%s: anon can execute', v_fn);
    assert not has_function_privilege('authenticated', v_fn, 'EXECUTE'), format('%s: authenticated can execute', v_fn);
    assert has_function_privilege('service_role', v_fn, 'EXECUTE'), format('%s: service_role cannot execute', v_fn);
  end loop;
  v_err := pg_temp.erro(v_o, format('select public.agenda_hub_periodo(%L::uuid, %s, now(), now() + interval ''1 day'')', v_ws, v_ca));
  assert v_err like '42501:%', format('an authenticated call to agenda_hub_periodo: %s', coalesce(v_err, 'succeeded'));
  assert (select p.prosecdef and p.provolatile = 's' from pg_proc p where p.oid = 'public.agenda_hub_periodo(uuid, bigint, timestamptz, timestamptz)'::regprocedure),
    'agenda_hub_periodo is not STABLE SECURITY DEFINER';

  raise notice 'PASS 99_agenda_hub_periodo (grants)';
end $$;

rollback;
