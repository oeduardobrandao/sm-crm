\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Agenda sub-project 3 (20261007000001_agenda_hub.sql): events shared with the
-- client in the Hub. Blocks: (1) visibility through agenda_hub_listar /
-- agenda_hub_ocorrencia, (2) client responses and the effective answer,
-- (3) reschedule requests (create, resolve, substituida before every delete),
-- (4) the e-mail queue (snapshot, merge, lease, claim, mark, tick), (5) team
-- notifications, (6) digest reminder RPCs, (7) composite FKs, (8) grants,
-- (9) agenda_listar's four new columns, (10) deleting the cliente of a shared
-- event.
--
-- Fixtures are built from current_date (the Hub filters on the real now()),
-- app.agenda_hoje is pinned to current_date. now() is frozen for the whole
-- transaction, so queue items are made due and leases expired with direct
-- UPDATEs, never by waiting.

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
-- runs p_sql (one jsonb value) as p_user (authenticated)
create or replace function pg_temp.como(p_user uuid, p_sql text) returns jsonb language plpgsql as $f$
declare v jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  execute p_sql into v;
  execute 'reset role';
  perform pg_temp.sem_claims();
  return v;
end $f$;
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
create or replace function pg_temp.listar(c uuid, cl bigint, ai timestamptz default null, aid bigint default null, lim int default 100)
returns jsonb language sql as $f$
  select pg_temp.svc(format('select public.agenda_hub_listar(%L::uuid, %s, %L::timestamptz, %L::bigint, %s)', c, cl, ai, aid, lim));
$f$;
create or replace function pg_temp.hub_oc(c uuid, cl bigint, oc bigint) returns jsonb language sql as $f$
  select pg_temp.svc(format('select public.agenda_hub_ocorrencia(%L::uuid, %s, %s)', c, cl, oc));
$f$;
create or replace function pg_temp.responder(c uuid, cl bigint, oc bigint, r text, visto timestamptz) returns jsonb language sql as $f$
  select pg_temp.svc(format('select public.agenda_hub_responder(%L::uuid, %s, %s, %L, %L::timestamptz)', c, cl, oc, r, visto));
$f$;
create or replace function pg_temp.remarcar(c uuid, cl bigint, oc bigint, d date, h time, m text) returns jsonb language sql as $f$
  select pg_temp.svc(format('select public.agenda_hub_remarcar(%L::uuid, %s, %s, %L::date, %L::time, %L)', c, cl, oc, d, h, m));
$f$;
create or replace function pg_temp.cancelar(c uuid, cl bigint, rid bigint) returns jsonb language sql as $f$
  select pg_temp.svc(format('select ''{}''::jsonb from public.agenda_hub_cancelar_remarcacao(%L::uuid, %s, %s)', c, cl, rid));
$f$;
-- the ids of the items of a listar payload, in order
create or replace function pg_temp.ids(p jsonb) returns bigint[] language sql as $f$
  select coalesce(array_agg((x->>'ocorrencia_id')::bigint order by n), '{}')
    from jsonb_array_elements(p->'itens') with ordinality as t(x, n);
$f$;
-- the queue items of (cliente, evento), oldest first
create or replace function pg_temp.fila(p_cliente bigint, p_evento bigint) returns setof agenda_emails_cliente language sql as $f$
  select * from agenda_emails_cliente where cliente_id = p_cliente and evento_id = p_evento order by id;
$f$;
-- ocorrencia ids of a snapshot, by inicio
create or replace function pg_temp.snap_ids(p jsonb) returns bigint[] language sql as $f$
  select coalesce(array_agg((x->>'ocorrencia_id')::bigint order by (x->>'inicio')::timestamptz, (x->>'ocorrencia_id')::bigint), '{}')
    from jsonb_array_elements(p) x;
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
grant execute on all functions in schema pg_temp to authenticated, service_role;

-- deleted agenda_remarcacoes rows, with the status they had when deleted (block 3)
create temp table remarcacoes_apagadas (id bigint, status text);
grant all on remarcacoes_apagadas to authenticated, service_role;
create or replace function pg_temp.registrar_apagada() returns trigger language plpgsql as $f$
begin
  insert into pg_temp.remarcacoes_apagadas values (OLD.id, OLD.status);
  return OLD;
end $f$;
create trigger remarcacoes_apagadas_tg after delete on public.agenda_remarcacoes
  for each row execute function pg_temp.registrar_apagada();

-- ============ block 1: visibility ============
do $$
declare
  f jsonb := pg_temp.fx();
  v_ws uuid := (f->>'ws')::uuid; v_ws2 uuid := (f->>'ws2')::uuid;
  v_o uuid := (f->>'o')::uuid; v_x uuid := (f->>'x')::uuid;
  v_ca bigint := (f->>'ca')::bigint; v_cb bigint := (f->>'cb')::bigint; v_cx bigint := (f->>'cx')::bigint;
  v_s1 bigint; v_s2 bigint; v_s3 bigint; v_interno bigint; v_x1 bigint; v_passado bigint; v_antigo bigint;
  v jsonb; v_it jsonb; v_ids bigint[]; v_err text;
begin
  v_s1 := pg_temp.criar(v_o, pg_temp.diaria(5, 3, jsonb_build_object('titulo', 'Gravação de reels',
    'descricao', 'Roteiro', 'local', 'Estúdio', 'link_reuniao', 'https://meet.example.com/x',
    'cliente_id', v_ca, 'compartilhado_cliente', true)));
  v_s2 := pg_temp.nth(v_s1, 2); v_s3 := pg_temp.nth(v_s1, 3);
  assert (select compartilhado_cliente from agenda_eventos where id = pg_temp.ev(v_s1)), 'criar did not store compartilhado_cliente';
  -- with cliente but not shared: internal
  v_interno := pg_temp.criar(v_o, pg_temp.p(jsonb_build_object('titulo', 'Planejamento interno', 'cliente_id', v_ca)));
  assert not (select compartilhado_cliente from agenda_eventos where id = pg_temp.ev(v_interno)), 'default compartilhado_cliente is not false';
  -- without cliente: sharing is stored false
  perform pg_temp.criar(v_o, pg_temp.p('{"titulo":"Sem cliente","compartilhado_cliente":true}'));
  assert (select not compartilhado_cliente from agenda_eventos e join agenda_ocorrencias o on o.evento_id = e.id
           where e.titulo = 'Sem cliente' and e.conta_id = v_ws), 'sharing without cliente was stored true';
  -- private + shared: rejected
  v_err := pg_temp.erro(v_o, format('select public.agenda_evento_criar(%L::jsonb, %L::uuid[])',
    pg_temp.p(jsonb_build_object('cliente_id', v_ca, 'compartilhado_cliente', true, 'privado', true)), '{}'));
  assert v_err = 'P0001:agenda: evento privado não pode ser compartilhado com o cliente.', format('private + shared: %s', coalesce(v_err, 'succeeded'));
  -- past (inside the 30-day window) and too old
  v_passado := pg_temp.criar(v_o, pg_temp.p(jsonb_build_object('titulo', 'Há 10 dias', 'cliente_id', v_ca, 'compartilhado_cliente', true,
    'inicio_local', pg_temp.dia(-10), 'fim_local', pg_temp.dia(-10, '15:00:00'))));
  v_antigo := pg_temp.criar(v_o, pg_temp.p(jsonb_build_object('titulo', 'Há 40 dias', 'cliente_id', v_ca, 'compartilhado_cliente', true,
    'inicio_local', pg_temp.dia(-40), 'fim_local', pg_temp.dia(-40, '15:00:00'))));
  -- another workspace
  v_x1 := pg_temp.criar(v_x, pg_temp.p(jsonb_build_object('cliente_id', v_cx, 'compartilhado_cliente', true)));
  -- cancel the second occurrence
  v_err := pg_temp.erro(v_o, format('select public.agenda_evento_excluir(%s, %L)', v_s2, 'esta'));
  assert v_err is null, format('excluir esta: %s', v_err);

  v := pg_temp.listar(v_ws, v_ca);
  assert v->>'estado' = 'ok', format('listar: %s', v);
  v_ids := pg_temp.ids(v);
  assert v_ids = array[v_passado, v_s1, v_s3], format('listar A: %s (expected %s)', v_ids, array[v_passado, v_s1, v_s3]);
  assert v->'proximo' = 'null'::jsonb, format('proximo with everything on one page: %s', v->'proximo');
  assert pg_temp.ids(pg_temp.listar(v_ws, v_cb)) = '{}', 'cliente B sees A''s events';
  assert pg_temp.ids(pg_temp.listar(v_ws2, v_ca)) = '{}', 'another workspace with A''s id sees A''s events';
  assert pg_temp.ids(pg_temp.listar(v_ws2, v_cx)) = array[v_x1], 'ws2 cliente does not see its own event';
  assert pg_temp.ids(pg_temp.listar(v_ws, v_cx)) = '{}', 'ws sees ws2''s cliente events';

  -- item shape
  v_it := v->'itens'->1;
  assert (select array_agg(k order by k) from jsonb_object_keys(v_it) k)
       = array['data_fim_local','data_inicio_local','descricao','dia_inteiro','fim','inicio','link_reuniao','local',
               'ocorrencia_id','remarcacao','resposta','sequencia','titulo','tz'],
    format('item keys: %s', v_it);
  assert v_it->>'titulo' = 'Gravação de reels' and v_it->>'descricao' = 'Roteiro' and v_it->>'local' = 'Estúdio'
     and v_it->>'link_reuniao' = 'https://meet.example.com/x' and v_it->>'tz' = 'America/Sao_Paulo'
     and v_it->'dia_inteiro' = 'false'::jsonb and v_it->'resposta' = 'null'::jsonb and v_it->'remarcacao' = 'null'::jsonb,
    format('item content: %s', v_it);
  assert (v_it->>'inicio')::timestamptz = pg_temp.ts(5) and (v_it->>'fim')::timestamptz = pg_temp.ts(5, '15:00:00'),
    format('item inicio/fim: %s', v_it);
  assert v_it->>'data_inicio_local' = to_char(current_date + 5, 'YYYY-MM-DD')
     and v_it->>'data_fim_local' = to_char(current_date + 6, 'YYYY-MM-DD'), format('item local dates: %s', v_it);
  assert (v_it->>'sequencia')::int = 1, format('sequencia after the convite: %s', v_it);

  -- pagination: 2 per page
  v := pg_temp.listar(v_ws, v_ca, null, null, 2);
  assert pg_temp.ids(v) = array[v_passado, v_s1], format('page 1: %s', pg_temp.ids(v));
  assert (v->'proximo'->>'id')::bigint = v_s1 and (v->'proximo'->>'inicio')::timestamptz = pg_temp.ini(v_s1),
    format('proximo: %s', v->'proximo');
  v := pg_temp.listar(v_ws, v_ca, (v->'proximo'->>'inicio')::timestamptz, (v->'proximo'->>'id')::bigint, 2);
  assert pg_temp.ids(v) = array[v_s3] and v->'proximo' = 'null'::jsonb, format('page 2: %s', v);
  -- p_limite is clamped to 1..100
  assert jsonb_array_length(pg_temp.listar(v_ws, v_ca, null, null, 0)->'itens') = 1, 'p_limite 0 not clamped to 1';
  assert jsonb_array_length(pg_temp.listar(v_ws, v_ca, null, null, 1000)->'itens') = 3, 'p_limite 1000 broke the list';

  -- deep link
  assert (pg_temp.hub_oc(v_ws, v_ca, v_s3)->>'ocorrencia_id')::bigint = v_s3, 'agenda_hub_ocorrencia did not return the item';
  assert pg_temp.hub_oc(v_ws, v_cb, v_s3) is null, 'agenda_hub_ocorrencia returned A''s item to B';
  assert pg_temp.hub_oc(v_ws, v_ca, v_s2) is null, 'agenda_hub_ocorrencia returned a cancelled occurrence';
  assert pg_temp.hub_oc(v_ws, v_ca, v_interno) is null, 'agenda_hub_ocorrencia returned an unshared event';
  assert pg_temp.hub_oc(v_ws2, v_cx, v_s1) is null, 'agenda_hub_ocorrencia crossed workspaces';

  -- archived cliente: refused
  update clientes set status = 'encerrado' where id = v_ca;
  v := pg_temp.responder(v_ws, v_ca, v_s3, 'sim', pg_temp.ini(v_s3));
  assert v->>'erro' = 'P0001:agenda_hub:nao_encontrado', format('responder for an archived cliente: %s', v);
  v := pg_temp.listar(v_ws, v_ca);
  assert v->>'erro' = 'P0001:agenda_hub:nao_encontrado', format('listar for an archived cliente: %s', v);
  update clientes set status = 'pausado' where id = v_ca;
  v := pg_temp.remarcar(v_ws, v_ca, v_s3, current_date + 20, '10:00', null);
  assert v->>'erro' = 'P0001:agenda_hub:nao_encontrado', format('remarcar for a paused cliente: %s', v);
  update clientes set status = 'ativo' where id = v_ca;

  -- flag off
  update plans set feature_agenda = false;
  v := pg_temp.listar(v_ws, v_ca);
  assert v->>'estado' = 'desligado' and v->'itens' = '[]'::jsonb, format('listar with the flag off: %s', v);
  v := pg_temp.responder(v_ws, v_ca, v_s3, 'sim', pg_temp.ini(v_s3));
  assert v->>'erro' = 'P0001:agenda_hub:desligado', format('responder with the flag off: %s', v);
  v := pg_temp.hub_oc(v_ws, v_ca, v_s3);
  assert v->>'erro' = 'P0001:agenda_hub:desligado', format('ocorrencia with the flag off: %s', v);
  update plans set feature_agenda = true;

  -- unknown occurrence
  v := pg_temp.responder(v_ws, v_ca, -1, 'sim', now());
  assert v->>'erro' = 'P0001:agenda_hub:nao_encontrado', format('responder to an unknown occurrence: %s', v);
  v := pg_temp.responder(v_ws, v_cb, v_s3, 'sim', pg_temp.ini(v_s3));
  assert v->>'erro' = 'P0001:agenda_hub:nao_encontrado', format('B responded to A''s occurrence: %s', v);

  raise notice 'PASS 99_agenda_hub (visibility)';
end $$;

-- ============ block 2: client responses ============
do $$
declare
  f jsonb := pg_temp.fx();
  v_ws uuid := (f->>'ws')::uuid;
  v_o uuid := (f->>'o')::uuid;
  v_ca bigint := (f->>'ca')::bigint; v_cb bigint := (f->>'cb')::bigint;
  v_s1 bigint; v_s2 bigint; v_fim bigint; v_agora bigint;
  v jsonb; v_err text;
begin
  v_s1 := pg_temp.criar(v_o, pg_temp.diaria(5, 3, jsonb_build_object('cliente_id', v_ca, 'compartilhado_cliente', true)));
  v_s2 := pg_temp.nth(v_s1, 2);

  v := pg_temp.responder(v_ws, v_ca, v_s1, 'sim', pg_temp.ini(v_s1));
  assert v->>'resposta' = 'sim' and (v->>'ocorrencia_id')::bigint = v_s1, format('responder sim: %s', v);
  assert (select resposta = 'sim' and inicio_respondido = pg_temp.ini(v_s1) and cliente_id = v_ca and conta_id = v_ws
            from agenda_respostas_cliente where ocorrencia_id = v_s1), 'response row not stored';
  -- answers are per occurrence
  assert pg_temp.hub_oc(v_ws, v_ca, v_s2)->'resposta' = 'null'::jsonb, 'the answer leaked to the next occurrence';
  -- can change the answer
  v := pg_temp.responder(v_ws, v_ca, v_s1, 'nao', pg_temp.ini(v_s1));
  assert v->>'resposta' = 'nao', format('responder nao: %s', v);
  -- invalid answer
  v := pg_temp.responder(v_ws, v_ca, v_s1, 'talvez', pg_temp.ini(v_s1));
  assert v ? 'erro', format('responder talvez succeeded: %s', v);

  -- moving inicio reopens the question
  v_err := pg_temp.erro(v_o, format('select public.agenda_evento_editar(%s, %L, %L::jsonb)', v_s1, 'esta',
    jsonb_build_object('inicio_local', pg_temp.dia(5, '16:00:00'), 'fim_local', pg_temp.dia(5, '17:00:00'))));
  assert v_err is null, format('editar esta (inicio): %s', v_err);
  assert pg_temp.hub_oc(v_ws, v_ca, v_s1)->'resposta' = 'null'::jsonb, 'moving inicio kept the answer';
  -- the stale inicio_visto: horario_mudou
  v := pg_temp.responder(v_ws, v_ca, v_s1, 'sim', pg_temp.ts(5));
  assert v->>'erro' = 'P0001:agenda_hub:horario_mudou', format('stale inicio_visto: %s', v);
  v := pg_temp.responder(v_ws, v_ca, v_s1, 'sim', pg_temp.ini(v_s1));
  assert v->>'resposta' = 'sim', format('responder after the move: %s', v);
  -- moving only fim keeps it
  v_err := pg_temp.erro(v_o, format('select public.agenda_evento_editar(%s, %L, %L::jsonb)', v_s1, 'esta',
    jsonb_build_object('inicio_local', pg_temp.dia(5, '16:00:00'), 'fim_local', pg_temp.dia(5, '18:00:00'))));
  assert v_err is null, format('editar esta (fim): %s', v_err);
  assert pg_temp.hub_oc(v_ws, v_ca, v_s1)->>'resposta' = 'sim', 'moving only fim dropped the answer';

  -- ended occurrence: ja_aconteceu (responder and remarcar)
  v_fim := pg_temp.criar(v_o, pg_temp.p(jsonb_build_object('cliente_id', v_ca, 'compartilhado_cliente', true,
    'inicio_local', pg_temp.dia(-2), 'fim_local', pg_temp.dia(-2, '15:00:00'))));
  v := pg_temp.responder(v_ws, v_ca, v_fim, 'sim', pg_temp.ini(v_fim));
  assert v->>'erro' = 'P0001:agenda_hub:ja_aconteceu', format('responder to an ended occurrence: %s', v);
  -- started but not ended: responder allowed, remarcar refused
  v_agora := pg_temp.criar(v_o, pg_temp.p(jsonb_build_object('cliente_id', v_ca, 'compartilhado_cliente', true,
    'inicio_local', to_char((now() - interval '30 minutes') at time zone 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI:SS'),
    'fim_local', to_char((now() + interval '90 minutes') at time zone 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI:SS'))));
  v := pg_temp.responder(v_ws, v_ca, v_agora, 'sim', pg_temp.ini(v_agora));
  assert v->>'resposta' = 'sim', format('responder during the occurrence: %s', v);
  v := pg_temp.remarcar(v_ws, v_ca, v_agora, current_date + 10, '10:00', null);
  assert v->>'erro' = 'P0001:agenda_hub:ja_aconteceu', format('remarcar a started occurrence: %s', v);

  -- switching the series to cliente B (todas) deletes A's answers
  v := pg_temp.responder(v_ws, v_ca, v_s2, 'sim', pg_temp.ini(v_s2));
  assert v->>'resposta' = 'sim', format('responder s2: %s', v);
  v_err := pg_temp.erro(v_o, format('select public.agenda_evento_editar(%s, %L, %L::jsonb)', v_s2, 'todas',
    jsonb_build_object('cliente_id', v_cb)));
  assert v_err is null, format('editar todas (cliente B): %s', v_err);
  assert not exists (select 1 from agenda_respostas_cliente rc join agenda_ocorrencias o on o.id = rc.ocorrencia_id
                      where o.evento_id = pg_temp.ev(v_s2) and rc.cliente_id = v_ca), 'A''s answers survived the cliente switch';
  assert pg_temp.hub_oc(v_ws, v_ca, v_s2) is null, 'A still sees the series';
  assert pg_temp.hub_oc(v_ws, v_cb, v_s2)->'resposta' = 'null'::jsonb, 'B inherited A''s answer';

  raise notice 'PASS 99_agenda_hub (responses)';
end $$;

-- ============ block 3: reschedule requests ============
do $$
declare
  f jsonb := pg_temp.fx();
  v_ws uuid := (f->>'ws')::uuid;
  v_o uuid := (f->>'o')::uuid; v_ag uuid := (f->>'ag')::uuid;
  v_ca bigint := (f->>'ca')::bigint;
  v_s1 bigint; v_s2 bigint; v_s3 bigint; v_di bigint; v_t bigint; v_t2 bigint; v_t3 bigint; v_t4 bigint;
  v_r bigint; v_r2 bigint; v_r3 bigint;
  v jsonb; v_err text; v_n int; r record;
begin
  v_s1 := pg_temp.criar(v_o, pg_temp.diaria(5, 3, jsonb_build_object('cliente_id', v_ca, 'compartilhado_cliente', true)));
  v_s2 := pg_temp.nth(v_s1, 2); v_s3 := pg_temp.nth(v_s1, 3);

  -- create
  v := pg_temp.remarcar(v_ws, v_ca, v_s2, current_date + 10, '10:00', '  Pode ser de manhã?  ');
  assert (v->'remarcacao'->>'id') is not null, format('remarcar: %s', v);
  v_r := (v->'remarcacao'->>'id')::bigint;
  assert (v->'remarcacao'->>'inicio_sugerido')::timestamptz = pg_temp.ts(10, '10:00:00')
     and (v->'remarcacao'->>'fim_sugerido')::timestamptz = pg_temp.ts(10, '11:00:00')
     and v->'remarcacao'->>'mensagem' = 'Pode ser de manhã?', format('remarcar payload: %s', v);
  assert (select status = 'pendente' and cliente_id = v_ca and conta_id = v_ws from agenda_remarcacoes where id = v_r), 'request row';
  -- empty message is NULL
  v := pg_temp.remarcar(v_ws, v_ca, v_s3, current_date + 11, '10:00', '   ');
  assert v->'remarcacao'->'mensagem' = 'null'::jsonb, format('blank mensagem: %s', v);
  v_r3 := (v->'remarcacao'->>'id')::bigint;
  -- the client cancels it
  v := pg_temp.cancelar(v_ws, v_ca, v_r3);
  assert v = '{}'::jsonb, format('cancelar: %s', v);
  assert (select status from agenda_remarcacoes where id = v_r3) = 'cancelada', 'cancelar did not cancel';
  v := pg_temp.cancelar(v_ws, v_ca, v_r3);
  assert v->>'erro' = 'P0001:agenda_hub:ja_resolvido', format('cancelar twice: %s', v);
  assert pg_temp.hub_oc(v_ws, v_ca, v_s3)->'remarcacao' = 'null'::jsonb, 'a cancelled request still shows';
  -- a second pending request on the same occurrence
  v := pg_temp.remarcar(v_ws, v_ca, v_s2, current_date + 12, '10:00', null);
  assert v->>'erro' = 'P0001:agenda_hub:pedido_pendente', format('second request: %s', v);
  -- past suggestion
  v := pg_temp.remarcar(v_ws, v_ca, v_s3, current_date - 1, '10:00', null);
  assert v->>'erro' = 'P0001:agenda_hub:sugestao_passada', format('past suggestion: %s', v);
  -- timed without hora
  v := pg_temp.remarcar(v_ws, v_ca, v_s3, current_date + 12, null, null);
  assert v->>'erro' = 'P0001:agenda_hub:hora_obrigatoria', format('timed without hora: %s', v);
  -- all-day: hora ignored, midnight to midnight, same number of days
  v_di := pg_temp.criar(v_o, pg_temp.p(jsonb_build_object('cliente_id', v_ca, 'compartilhado_cliente', true, 'dia_inteiro', true,
    'inicio_local', pg_temp.dia(7, '00:00:00'), 'fim_local', pg_temp.dia(9, '00:00:00'))));
  v := pg_temp.remarcar(v_ws, v_ca, v_di, current_date + 14, '10:00', null);
  assert (v->'remarcacao'->>'inicio_sugerido')::timestamptz = pg_temp.ts(14, '00:00:00')
     and (v->'remarcacao'->>'fim_sugerido')::timestamptz = pg_temp.ts(16, '00:00:00'), format('all-day suggestion: %s', v);

  -- resolve: only who can edit the event
  v_err := pg_temp.erro(v_ag, format('select public.agenda_remarcacao_resolver(%s, true)', v_r));
  assert v_err = 'P0001:agenda: você não pode editar este evento', format('agent resolved: %s', coalesce(v_err, 'succeeded'));
  -- accept: moves only that occurrence, the client answers sim
  v_err := pg_temp.erro(v_o, format('select public.agenda_remarcacao_resolver(%s, true)', v_r));
  assert v_err is null, format('aceitar: %s', v_err);
  assert pg_temp.ini(v_s2) = pg_temp.ts(10, '10:00:00')
     and (select fim from agenda_ocorrencias where id = v_s2) = pg_temp.ts(10, '11:00:00')
     and (select horario_alterado from agenda_ocorrencias where id = v_s2), 'aceitar did not move the occurrence';
  assert pg_temp.ini(v_s1) = pg_temp.ts(5) and pg_temp.ini(v_s3) = pg_temp.ts(7), 'aceitar moved other occurrences';
  assert (select status = 'aceita' and resolvido_em is not null and resolvido_por = v_o from agenda_remarcacoes where id = v_r), 'status aceita';
  assert (select resposta = 'sim' and inicio_respondido = pg_temp.ini(v_s2) from agenda_respostas_cliente where ocorrencia_id = v_s2),
    'aceitar did not record sim for the new inicio';
  v := pg_temp.hub_oc(v_ws, v_ca, v_s2);
  assert v->>'resposta' = 'sim' and v->'remarcacao' = 'null'::jsonb, format('item after aceitar: %s', v);
  select count(*) into v_n from agenda_emails_cliente where cliente_id = v_ca and tipo = 'remarcacao_aceita'
     and (remarcacao->>'remarcacao_id')::bigint = v_r and pg_temp.snap_ids(ocorrencias) = array[v_s2];
  assert v_n = 1, format('remarcacao_aceita items: %s', v_n);
  assert not exists (select 1 from agenda_emails_cliente where cliente_id = v_ca and tipo = 'alteracao'
                      and pg_temp.ev(v_s1) = evento_id), 'aceitar also enqueued an alteracao';
  -- the GUC does not leak: a later edit is a plain alteracao
  assert coalesce(current_setting('agenda.remarcacao', true), '') = '', 'agenda.remarcacao left set';
  -- second resolve
  v_err := pg_temp.erro(v_o, format('select public.agenda_remarcacao_resolver(%s, false)', v_r));
  assert v_err = 'P0001:agenda: este pedido já foi resolvido.', format('second resolve: %s', coalesce(v_err, 'succeeded'));

  -- decline, with a message
  v := pg_temp.remarcar(v_ws, v_ca, v_s3, current_date + 15, '09:00', null);
  v_r2 := (v->'remarcacao'->>'id')::bigint;
  v_err := pg_temp.erro(v_o, format('select public.agenda_remarcacao_resolver(%s, false, %L)', v_r2, 'Não temos agenda'));
  assert v_err is null, format('recusar: %s', v_err);
  assert (select status = 'recusada' and resposta_equipe = 'Não temos agenda' from agenda_remarcacoes where id = v_r2), 'status recusada';
  assert pg_temp.ini(v_s3) = pg_temp.ts(7), 'recusar moved the occurrence';
  select count(*) into v_n from agenda_emails_cliente where tipo = 'remarcacao_recusada'
     and (remarcacao->>'remarcacao_id')::bigint = v_r2 and remarcacao->>'resposta_equipe' = 'Não temos agenda'
     and pg_temp.snap_ids(ocorrencias) = array[v_s3];
  assert v_n = 1, format('remarcacao_recusada items: %s', v_n);

  -- accepting a suggestion that is now in the past
  v := pg_temp.remarcar(v_ws, v_ca, v_s3, current_date + 16, '09:00', null);
  v_r2 := (v->'remarcacao'->>'id')::bigint;
  update agenda_remarcacoes set inicio_sugerido = now() - interval '1 hour', fim_sugerido = now() where id = v_r2;
  v_err := pg_temp.erro(v_o, format('select public.agenda_remarcacao_resolver(%s, true)', v_r2));
  assert v_err = 'P0001:agenda: esse horário já passou. Combine outro com o cliente.', format('past accept: %s', coalesce(v_err, 'succeeded'));
  assert (select status from agenda_remarcacoes where id = v_r2) = 'pendente', 'past accept changed the status';
  -- the team moves the occurrence by another path: substituida
  v_err := pg_temp.erro(v_o, format('select public.agenda_evento_editar(%s, %L, %L::jsonb)', v_s3, 'esta',
    jsonb_build_object('inicio_local', pg_temp.dia(7, '09:00:00'), 'fim_local', pg_temp.dia(7, '10:00:00'))));
  assert v_err is null, format('editar esta: %s', v_err);
  assert (select status from agenda_remarcacoes where id = v_r2) = 'substituida', 'moving the occurrence did not substitute the request';
  -- a content-only edit keeps a pending request
  v := pg_temp.remarcar(v_ws, v_ca, v_s3, current_date + 16, '09:00', null);
  v_r2 := (v->'remarcacao'->>'id')::bigint;
  v_err := pg_temp.erro(v_o, format('select public.agenda_evento_editar(%s, %L, %L::jsonb)', v_s3, 'esta', '{"titulo":"Outro título"}'));
  assert v_err is null, format('editar esta (titulo): %s', v_err);
  assert (select status from agenda_remarcacoes where id = v_r2) = 'pendente', 'a title edit substituted the request';
  -- excluir esta: the row is cancelled, the request survives as substituida
  v_err := pg_temp.erro(v_o, format('select public.agenda_evento_excluir(%s, %L)', v_s3, 'esta'));
  assert v_err is null, format('excluir esta: %s', v_err);
  assert (select status from agenda_remarcacoes where id = v_r2) = 'substituida', 'excluir esta did not substitute';
  v := pg_temp.cancelar(v_ws, v_ca, v_r2);
  assert v->>'erro' = 'P0001:agenda_hub:ja_resolvido', format('cancelar a substituted request: %s', v);

  -- todas, same dates (duracao_min change): survivors substituida
  v_t := pg_temp.criar(v_o, pg_temp.diaria(20, 3, jsonb_build_object('cliente_id', v_ca, 'compartilhado_cliente', true)));
  v_t2 := pg_temp.nth(v_t, 2);
  v_r := (pg_temp.remarcar(v_ws, v_ca, v_t2, current_date + 30, '10:00', null)->'remarcacao'->>'id')::bigint;
  v_err := pg_temp.erro(v_o, format('select public.agenda_evento_editar(%s, %L, %L::jsonb)', v_t2, 'todas',
    jsonb_build_object('inicio_local', pg_temp.dia(21), 'fim_local', pg_temp.dia(21, '16:00:00'), 'regra', pg_temp.regra(3))));
  assert v_err is null, format('editar todas (duracao): %s', v_err);
  assert (select fim - inicio from agenda_ocorrencias where id = v_t2) = interval '2 hours', 'duracao not applied';
  assert (select status from agenda_remarcacoes where id = v_r) = 'substituida', 'todas regen did not substitute a surviving row';
  -- todas, rule change that drops the day: substituida before the delete
  v_t3 := pg_temp.nth(v_t, 3);
  v_r := (pg_temp.remarcar(v_ws, v_ca, v_t3, current_date + 30, '10:00', null)->'remarcacao'->>'id')::bigint;
  v_err := pg_temp.erro(v_o, format('select public.agenda_evento_editar(%s, %L, %L::jsonb)', v_t, 'todas',
    jsonb_build_object('regra', pg_temp.regra(2))));
  assert v_err is null, format('editar todas (contagem 2): %s', v_err);
  assert not exists (select 1 from agenda_ocorrencias where id = v_t3), 'the third occurrence survived';
  assert (select status from pg_temp.remarcacoes_apagadas where id = v_r) = 'substituida',
    format('regen deleted a request that was %s', (select status from pg_temp.remarcacoes_apagadas where id = v_r));
  -- excluir todas: substituida before the delete
  v_r := (pg_temp.remarcar(v_ws, v_ca, v_t2, current_date + 30, '10:00', null)->'remarcacao'->>'id')::bigint;
  v_err := pg_temp.erro(v_o, format('select public.agenda_evento_excluir(%s, %L)', v_t, 'todas'));
  assert v_err is null, format('excluir todas: %s', v_err);
  assert (select status from pg_temp.remarcacoes_apagadas where id = v_r) = 'substituida',
    format('excluir todas deleted a request that was %s', (select status from pg_temp.remarcacoes_apagadas where id = v_r));

  -- seguintes split: a moved survivor and a deleted row, both substituida
  v_t := pg_temp.criar(v_o, pg_temp.diaria(40, 4, jsonb_build_object('cliente_id', v_ca, 'compartilhado_cliente', true)));
  v_t2 := pg_temp.nth(v_t, 2); v_t3 := pg_temp.nth(v_t, 3); v_t4 := pg_temp.nth(v_t, 4);
  v_r := (pg_temp.remarcar(v_ws, v_ca, v_t3, current_date + 60, '10:00', null)->'remarcacao'->>'id')::bigint;
  v_r2 := (pg_temp.remarcar(v_ws, v_ca, v_t4, current_date + 60, '10:00', null)->'remarcacao'->>'id')::bigint;
  -- from t2: daily with 2 occurrences (t2, t3 survive and move to the new series; t4 is deleted)
  v_err := pg_temp.erro(v_o, format('select public.agenda_evento_editar(%s, %L, %L::jsonb)', v_t2, 'seguintes',
    jsonb_build_object('regra', pg_temp.regra(2))));
  assert v_err is null, format('editar seguintes: %s', v_err);
  assert pg_temp.ev(v_t3) <> pg_temp.ev(v_t), 'the split did not move t3';
  assert (select status from agenda_remarcacoes where id = v_r) = 'substituida', 'split did not substitute a moved row';
  assert not exists (select 1 from agenda_ocorrencias where id = v_t4), 't4 survived the split';
  assert (select status from pg_temp.remarcacoes_apagadas where id = v_r2) = 'substituida',
    format('split deleted a request that was %s', (select status from pg_temp.remarcacoes_apagadas where id = v_r2));
  assert (select compartilhado_cliente and cliente_id = v_ca from agenda_eventos where id = pg_temp.ev(v_t3)),
    'the split series is not shared';
  -- accepting on one-offs (agenda_evento_editar turns esta into todas: the
  -- one-off moves data_original along and regenerates): timed and all-day
  v_t := pg_temp.criar(v_o, pg_temp.p(jsonb_build_object('titulo', 'Avulso', 'cliente_id', v_ca, 'compartilhado_cliente', true,
    'inicio_local', pg_temp.dia(50), 'fim_local', pg_temp.dia(50, '15:30:00'))));
  v_r := (pg_temp.remarcar(v_ws, v_ca, v_t, current_date + 52, '09:00', null)->'remarcacao'->>'id')::bigint;
  v_err := pg_temp.erro(v_o, format('select public.agenda_remarcacao_resolver(%s, true)', v_r));
  assert v_err is null, format('aceitar one-off: %s', v_err);
  select * into r from agenda_ocorrencias where id = v_t;
  assert r.id is not null and r.inicio = pg_temp.ts(52, '09:00:00') and r.fim = pg_temp.ts(52, '10:30:00')
     and r.data_original = current_date + 52, format('one-off after aceitar: %s', to_jsonb(r));
  assert (select resposta = 'sim' and inicio_respondido = r.inicio from agenda_respostas_cliente where ocorrencia_id = v_t),
    'one-off: no sim for the new inicio';
  assert (select count(*) from agenda_emails_cliente where evento_id = pg_temp.ev(v_t) and tipo = 'remarcacao_aceita'
           and (remarcacao->>'remarcacao_id')::bigint = v_r and pg_temp.snap_ids(ocorrencias) = array[v_t]) = 1,
    'one-off: remarcacao_aceita item';
  assert not exists (select 1 from agenda_emails_cliente where evento_id = pg_temp.ev(v_t) and tipo = 'alteracao'),
    'one-off: aceitar enqueued an alteracao';
  assert (select status from agenda_remarcacoes where id = v_r) = 'aceita', 'one-off: status';
  assert coalesce(current_setting('agenda.remarcacao', true), '') = '', 'one-off: agenda.remarcacao left set';
  -- all-day one-off (v_di, 2 days from +7; the earlier request moved nothing yet)
  v_r := (select id from agenda_remarcacoes where ocorrencia_id = v_di and status = 'pendente');
  assert v_r is not null, 'all-day fixture request missing';
  v_err := pg_temp.erro(v_o, format('select public.agenda_remarcacao_resolver(%s, true)', v_r));
  assert v_err is null, format('aceitar all-day: %s', v_err);
  select * into r from agenda_ocorrencias where id = v_di;
  assert r.id is not null and r.inicio = pg_temp.ts(14, '00:00:00') and r.fim = pg_temp.ts(16, '00:00:00')
     and r.data_original = current_date + 14, format('all-day after aceitar: %s', to_jsonb(r));
  assert (select dtstart = (current_date + 14)::timestamp and duracao_dias = 2 from agenda_eventos where id = pg_temp.ev(v_di)),
    'all-day series not moved';
  assert (select resposta = 'sim' and inicio_respondido = r.inicio from agenda_respostas_cliente where ocorrencia_id = v_di),
    'all-day: no sim for the new inicio';
  assert (select count(*) from agenda_emails_cliente where evento_id = pg_temp.ev(v_di) and tipo = 'remarcacao_aceita'
           and (remarcacao->>'remarcacao_id')::bigint = v_r) = 1, 'all-day: remarcacao_aceita item';
  assert not exists (select 1 from agenda_emails_cliente where evento_id = pg_temp.ev(v_di) and tipo = 'alteracao'),
    'all-day: aceitar enqueued an alteracao';

  -- nothing was ever deleted while pending
  assert not exists (select 1 from pg_temp.remarcacoes_apagadas where status = 'pendente'), 'a pending request was cascaded';

  raise notice 'PASS 99_agenda_hub (reschedule)';
end $$;

-- ============ block 4: e-mail queue ============
do $$
declare
  f jsonb := pg_temp.fx();
  v_ws uuid := (f->>'ws')::uuid;
  v_o uuid := (f->>'o')::uuid;
  v_ca bigint := (f->>'ca')::bigint; v_cb bigint := (f->>'cb')::bigint;
  v_s1 bigint; v_ev bigint; v_t bigint; v_t2 bigint; v_alvo bigint;
  q agenda_emails_cliente; q2 agenda_emails_cliente;
  v jsonb; v_err text; v_n int; v_id bigint; v_versao int;
begin
  v_s1 := pg_temp.criar(v_o, pg_temp.diaria(5, 3, jsonb_build_object('titulo', 'Convite', 'cliente_id', v_ca, 'compartilhado_cliente', true)));
  v_ev := pg_temp.ev(v_s1);
  select count(*) into v_n from pg_temp.fila(v_ca, v_ev);
  assert v_n = 1, format('criar enqueued %s items', v_n);
  select * into q from pg_temp.fila(v_ca, v_ev);
  assert q.tipo = 'convite' and q.status = 'pendente' and q.versao = 1 and q.conta_id = v_ws and q.lease_ate is null
     and q.enviar_apos = now() + interval '60 seconds' and q.tentativas = 0 and q.remarcacao is null,
    format('convite item: %s', to_jsonb(q));
  assert jsonb_array_length(q.ocorrencias) = 3 and pg_temp.snap_ids(q.ocorrencias) = array[v_s1, pg_temp.nth(v_s1, 2), pg_temp.nth(v_s1, 3)],
    format('convite snapshot: %s', q.ocorrencias);
  assert (select array_agg(k order by k) from jsonb_object_keys(q.ocorrencias->0) k)
       = array['data_fim_local','data_inicio_local','descricao','dia_inteiro','estado','fim','inicio','link_reuniao','local',
               'ocorrencia_id','sequencia','titulo','tz'], format('snapshot entry keys: %s', q.ocorrencias->0);
  assert q.ocorrencias->0->>'estado' = 'ativa' and q.ocorrencias->0->>'titulo' = 'Convite'
     and (q.ocorrencias->0->>'sequencia')::int = 1, format('snapshot entry: %s', q.ocorrencias->0);
  assert (select bool_and(sequencia = 1) from agenda_ocorrencias where evento_id = v_ev), 'sequencia not bumped to 1';

  -- second edit inside the window: merged into the same item
  v_err := pg_temp.erro(v_o, format('select public.agenda_evento_editar(%s, %L, %L::jsonb)', v_s1, 'todas', '{"titulo":"Convite novo"}'));
  assert v_err is null, format('editar todas: %s', v_err);
  select count(*) into v_n from pg_temp.fila(v_ca, v_ev);
  assert v_n = 1, format('merge created %s items', v_n);
  select * into q from pg_temp.fila(v_ca, v_ev);
  assert q.versao = 2 and q.tipo = 'convite' and q.ocorrencias->0->>'titulo' = 'Convite novo'
     and (q.ocorrencias->0->>'sequencia')::int = 2 and jsonb_array_length(q.ocorrencias) = 3, format('merged item: %s', to_jsonb(q));
  -- an edit that changes nothing the client sees does not touch the queue
  v_err := pg_temp.erro(v_o, format('select public.agenda_evento_editar(%s, %L, %L::jsonb)', v_s1, 'todas', '{"cor":"rosa"}'));
  assert v_err is null, format('editar todas (cor): %s', v_err);
  assert (select versao from agenda_emails_cliente where id = q.id) = 2, 'a colour change touched the queue';

  -- under lease: never touched, a new item instead
  update agenda_emails_cliente set status = 'enviando', lease_ate = now() + interval '2 minutes', tentativas = 1 where id = q.id;
  v_err := pg_temp.erro(v_o, format('select public.agenda_evento_editar(%s, %L, %L::jsonb)', v_s1, 'esta', '{"local":"Estúdio 2"}'));
  assert v_err is null, format('editar esta: %s', v_err);
  select * into q2 from agenda_emails_cliente where id = q.id;
  assert q2.versao = 2 and q2.ocorrencias = q.ocorrencias, 'an item under lease was changed';
  select count(*) into v_n from pg_temp.fila(v_ca, v_ev);
  assert v_n = 2, format('edit under lease: %s items', v_n);
  select * into q2 from pg_temp.fila(v_ca, v_ev) offset 1;
  assert q2.tipo = 'alteracao' and pg_temp.snap_ids(q2.ocorrencias) = array[v_s1] and q2.ocorrencias->0->>'local' = 'Estúdio 2'
     and (q2.ocorrencias->0->>'sequencia')::int = 3, format('alteracao item: %s', to_jsonb(q2));

  -- convite then excluir todas before the send: discarded
  v_t := pg_temp.criar(v_o, pg_temp.diaria(8, 2, jsonb_build_object('cliente_id', v_ca, 'compartilhado_cliente', true)));
  v_id := (select id from pg_temp.fila(v_ca, pg_temp.ev(v_t)));
  v_err := pg_temp.erro(v_o, format('select public.agenda_evento_excluir(%s, %L)', v_t, 'todas'));
  assert v_err is null, format('excluir todas: %s', v_err);
  assert (select status from agenda_emails_cliente where id = v_id) = 'descartado', 'convite + cancel before send not discarded';
  assert (select count(*) from agenda_emails_cliente where cliente_id = v_ca and status = 'pendente'
           and evento_id = (select evento_id from agenda_emails_cliente where id = v_id)) = 0, 'cancel before send left an item';

  -- excluir todas after the send: cancelamento whose snapshot survives the series DELETE
  v_t := pg_temp.criar(v_o, pg_temp.diaria(9, 2, jsonb_build_object('titulo', 'Vai sumir', 'cliente_id', v_ca, 'compartilhado_cliente', true)));
  v_ev := pg_temp.ev(v_t);
  update agenda_emails_cliente set status = 'enviado', enviado_em = now() where evento_id = v_ev;
  v_err := pg_temp.erro(v_o, format('select public.agenda_evento_excluir(%s, %L)', v_t, 'todas'));
  assert v_err is null, format('excluir todas: %s', v_err);
  assert not exists (select 1 from agenda_eventos where id = v_ev), 'the series survived';
  select * into q from agenda_emails_cliente where evento_id = v_ev and status = 'pendente';
  assert q.tipo = 'cancelamento' and jsonb_array_length(q.ocorrencias) = 2
     and (select bool_and(x->>'estado' = 'cancelada' and x->>'titulo' = 'Vai sumir') from jsonb_array_elements(q.ocorrencias) x),
    format('cancelamento item: %s', to_jsonb(q));

  -- excluir esta after the send: cancelamento of one occurrence
  v_t := pg_temp.criar(v_o, pg_temp.diaria(10, 2, jsonb_build_object('cliente_id', v_ca, 'compartilhado_cliente', true)));
  v_ev := pg_temp.ev(v_t);
  update agenda_emails_cliente set status = 'enviado' where evento_id = v_ev;
  v_err := pg_temp.erro(v_o, format('select public.agenda_evento_excluir(%s, %L)', pg_temp.nth(v_t, 2), 'esta'));
  assert v_err is null, format('excluir esta: %s', v_err);
  select * into q from agenda_emails_cliente where evento_id = v_ev and status = 'pendente';
  assert q.tipo = 'cancelamento' and pg_temp.snap_ids(q.ocorrencias) = array[pg_temp.nth(v_t, 2)]
     and q.ocorrencias->0->>'estado' = 'cancelada', format('excluir esta item: %s', to_jsonb(q));

  -- un-share after the send: cancelamento to the client
  v_t := pg_temp.criar(v_o, pg_temp.diaria(11, 2, jsonb_build_object('cliente_id', v_ca, 'compartilhado_cliente', true)));
  v_ev := pg_temp.ev(v_t);
  update agenda_emails_cliente set status = 'enviado' where evento_id = v_ev;
  v_err := pg_temp.erro(v_o, format('select public.agenda_evento_editar(%s, %L, %L::jsonb)', v_t, 'todas', '{"compartilhado_cliente":false}'));
  assert v_err is null, format('un-share: %s', v_err);
  select * into q from agenda_emails_cliente where evento_id = v_ev and status = 'pendente';
  assert q.tipo = 'cancelamento' and q.cliente_id = v_ca and jsonb_array_length(q.ocorrencias) = 2
     and (select bool_and(x->>'estado' = 'cancelada') from jsonb_array_elements(q.ocorrencias) x), format('un-share item: %s', to_jsonb(q));
  -- esta cannot change the sharing
  v_err := pg_temp.erro(v_o, format('select public.agenda_evento_editar(%s, %L, %L::jsonb)', v_t, 'esta', '{"compartilhado_cliente":true}'));
  assert v_err = 'P0001:agenda: este campo vale para toda a série', format('esta share: %s', coalesce(v_err, 'succeeded'));

  -- cliente switch after the send: cancelamento to A, convite to B
  v_t := pg_temp.criar(v_o, pg_temp.diaria(12, 2, jsonb_build_object('cliente_id', v_ca, 'compartilhado_cliente', true)));
  v_ev := pg_temp.ev(v_t);
  update agenda_emails_cliente set status = 'enviado' where evento_id = v_ev;
  v_err := pg_temp.erro(v_o, format('select public.agenda_evento_editar(%s, %L, %L::jsonb)', v_t, 'todas', jsonb_build_object('cliente_id', v_cb)));
  assert v_err is null, format('switch: %s', v_err);
  assert (select tipo from agenda_emails_cliente where evento_id = v_ev and cliente_id = v_ca and status = 'pendente') = 'cancelamento', 'switch: no cancelamento to A';
  assert (select tipo from agenda_emails_cliente where evento_id = v_ev and cliente_id = v_cb and status = 'pendente') = 'convite', 'switch: no convite to B';

  -- seguintes split after the send: enqueued under the new series
  v_t := pg_temp.criar(v_o, pg_temp.diaria(13, 3, jsonb_build_object('cliente_id', v_ca, 'compartilhado_cliente', true)));
  v_ev := pg_temp.ev(v_t); v_t2 := pg_temp.nth(v_t, 2);
  update agenda_emails_cliente set status = 'enviado' where evento_id = v_ev;
  v_err := pg_temp.erro(v_o, format('select public.agenda_evento_editar(%s, %L, %L::jsonb)', v_t2, 'seguintes', '{"titulo":"Cauda"}'));
  assert v_err is null, format('split: %s', v_err);
  v_alvo := pg_temp.ev(v_t2);
  assert v_alvo <> v_ev, 'no split';
  select * into q from agenda_emails_cliente where evento_id = v_alvo and status = 'pendente';
  assert q.tipo = 'alteracao' and q.cliente_id = v_ca and pg_temp.snap_ids(q.ocorrencias) = array[v_t2, pg_temp.nth(v_t2, 2)]
     and q.ocorrencias->0->>'titulo' = 'Cauda', format('split item: %s', to_jsonb(q));
  assert not exists (select 1 from agenda_emails_cliente where evento_id = v_ev and status = 'pendente'), 'split enqueued under the old series';

  -- one live entry per occurrence per cliente: a pending item of the old series loses the moved ids
  v_t := pg_temp.criar(v_o, pg_temp.diaria(14, 3, jsonb_build_object('cliente_id', v_ca, 'compartilhado_cliente', true)));
  v_ev := pg_temp.ev(v_t); v_t2 := pg_temp.nth(v_t, 2);
  update agenda_emails_cliente set status = 'enviado' where evento_id = v_ev;
  v_err := pg_temp.erro(v_o, format('select public.agenda_evento_editar(%s, %L, %L::jsonb)', v_t, 'todas', '{"descricao":"Pauta"}'));
  assert v_err is null, format('todas descricao: %s', v_err);
  assert (select jsonb_array_length(ocorrencias) from agenda_emails_cliente where evento_id = v_ev and status = 'pendente') = 3, 'descricao change not enqueued';
  v_err := pg_temp.erro(v_o, format('select public.agenda_evento_editar(%s, %L, %L::jsonb)', v_t2, 'seguintes', '{"titulo":"Cauda 2"}'));
  assert v_err is null, format('split 2: %s', v_err);
  assert pg_temp.snap_ids((select ocorrencias from agenda_emails_cliente where evento_id = v_ev and status = 'pendente')) = array[v_t],
    format('old item still lists moved ids: %s', (select ocorrencias from agenda_emails_cliente where evento_id = v_ev and status = 'pendente'));

  -- claim: gates, then due items
  perform pg_temp.sem_claims();
  update agenda_emails_cliente set status = 'enviado' where conta_id = v_ws and status = 'pendente';
  v_t := pg_temp.criar(v_o, pg_temp.p(jsonb_build_object('titulo', 'Para A', 'cliente_id', v_ca, 'compartilhado_cliente', true)));
  v_t2 := pg_temp.criar(v_o, pg_temp.p(jsonb_build_object('titulo', 'Para B', 'cliente_id', v_cb, 'compartilhado_cliente', true)));
  update clientes set send_event_email = false where id = v_cb;
  update agenda_emails_cliente set enviar_apos = now() - interval '1 second' where conta_id = v_ws and status = 'pendente';
  v := pg_temp.svc('select public.agenda_cliente_claim_emails(100)');
  assert jsonb_typeof(v) = 'array', format('claim: %s', v);
  select * into q from agenda_emails_cliente where evento_id = pg_temp.ev(v_t2);
  assert q.status = 'descartado', format('send_event_email false: %s', q.status);
  select * into q from agenda_emails_cliente where evento_id = pg_temp.ev(v_t);
  assert q.status = 'enviando' and q.tentativas = 1 and q.lease_ate = now() + interval '2 minutes', format('claimed item: %s', to_jsonb(q));
  select x into v from jsonb_array_elements(v) x where (x->>'id')::bigint = q.id;
  assert v is not null, 'claim did not return the item';
  assert v->>'cliente_email' = 'a@example.com' and v->>'cliente_nome' = 'Clínica A' and v->>'workspace_nome' = 'Agência Teste'
     and v->>'brand_color' = '#123456' and v->>'logo_url' = 'https://cdn.example.com/logo.png'
     and v->>'tipo' = 'convite' and (v->>'versao')::int = 1 and (v->>'cliente_id')::bigint = v_ca
     and (v->>'conta_id')::uuid = v_ws and jsonb_array_length(v->'ocorrencias') = 1 and v->'remarcacao' = 'null'::jsonb,
    format('claim payload: %s', v);
  -- a second claim does not take it again
  v := pg_temp.svc('select public.agenda_cliente_claim_emails(100)');
  assert not exists (select 1 from jsonb_array_elements(v) x where (x->>'id')::bigint = q.id), 'claimed twice under lease';
  -- mark with a stale versao: no-op
  perform pg_temp.svc(format('select ''{}''::jsonb from public.agenda_cliente_marcar_email(%s, %s, true)', q.id, q.versao + 1));
  assert (select status from agenda_emails_cliente where id = q.id) = 'enviando', 'stale versao settled the item';
  -- failure: back to pendente
  perform pg_temp.svc(format('select ''{}''::jsonb from public.agenda_cliente_marcar_email(%s, %s, false, %L)', q.id, q.versao, 'resend 500'));
  select * into q from agenda_emails_cliente where id = q.id;
  assert q.status = 'pendente' and q.lease_ate is null and q.ultimo_erro = 'resend 500', format('failed mark: %s', to_jsonb(q));
  -- expired lease is re-claimed; the third failure is final
  update agenda_emails_cliente set tentativas = 2 where id = q.id;
  perform pg_temp.svc('select public.agenda_cliente_claim_emails(100)');
  assert (select status = 'enviando' and tentativas = 3 from agenda_emails_cliente where id = q.id), 'retry not claimed';
  perform pg_temp.svc(format('select ''{}''::jsonb from public.agenda_cliente_marcar_email(%s, %s, false)', q.id, q.versao));
  assert (select status from agenda_emails_cliente where id = q.id) = 'falhou', 'third failure not final';
  -- ok mark
  v_t := pg_temp.criar(v_o, pg_temp.p(jsonb_build_object('titulo', 'Ok', 'cliente_id', v_ca, 'compartilhado_cliente', true)));
  update agenda_emails_cliente set enviar_apos = now() - interval '1 second' where evento_id = pg_temp.ev(v_t);
  perform pg_temp.svc('select public.agenda_cliente_claim_emails(100)');
  select * into q from agenda_emails_cliente where evento_id = pg_temp.ev(v_t);
  perform pg_temp.svc(format('select ''{}''::jsonb from public.agenda_cliente_marcar_email(%s, %s, true)', q.id, q.versao));
  assert (select status = 'enviado' and enviado_em is not null from agenda_emails_cliente where id = q.id), 'ok mark';
  -- unshared before the send: discarded (not a cancelamento)
  v_t := pg_temp.criar(v_o, pg_temp.p(jsonb_build_object('titulo', 'Desliga', 'cliente_id', v_ca, 'compartilhado_cliente', true)));
  update agenda_eventos set compartilhado_cliente = false where id = pg_temp.ev(v_t);
  update agenda_emails_cliente set enviar_apos = now() - interval '1 second' where evento_id = pg_temp.ev(v_t);
  perform pg_temp.svc('select public.agenda_cliente_claim_emails(100)');
  assert (select status from agenda_emails_cliente where evento_id = pg_temp.ev(v_t)) = 'descartado', 'unshared convite not discarded';
  -- unsubscribed and archived clients, and flag off: discarded
  v_t := pg_temp.criar(v_o, pg_temp.p(jsonb_build_object('titulo', 'Descadastrado', 'cliente_id', v_ca, 'compartilhado_cliente', true)));
  update clientes set event_email_unsub_at = now() where id = v_ca;
  update agenda_emails_cliente set enviar_apos = now() - interval '1 second' where evento_id = pg_temp.ev(v_t);
  perform pg_temp.svc('select public.agenda_cliente_claim_emails(100)');
  assert (select status from agenda_emails_cliente where evento_id = pg_temp.ev(v_t)) = 'descartado', 'unsubscribed not discarded';
  update clientes set event_email_unsub_at = null where id = v_ca;
  v_t := pg_temp.criar(v_o, pg_temp.p(jsonb_build_object('titulo', 'Flag', 'cliente_id', v_ca, 'compartilhado_cliente', true)));
  update agenda_emails_cliente set enviar_apos = now() - interval '1 second' where evento_id = pg_temp.ev(v_t);
  update plans set feature_agenda = false;
  perform pg_temp.svc('select public.agenda_cliente_claim_emails(100)');
  update plans set feature_agenda = true;
  assert (select status from agenda_emails_cliente where evento_id = pg_temp.ev(v_t)) = 'descartado', 'flag off not discarded';

  -- tick: runs without vault secrets (warning only); the cron job exists
  v := pg_temp.svc('select ''{}''::jsonb from public.agenda_cliente_tick()');
  assert v = '{}'::jsonb, format('tick: %s', v);
  assert exists (select 1 from cron.job where jobname = 'agenda-cliente-email' and schedule = '* * * * *'
                  and command like '%agenda_cliente_tick()%'), 'cron job agenda-cliente-email missing';

  raise notice 'PASS 99_agenda_hub (queue)';
end $$;

-- ============ block 5: team notifications ============
do $$
declare
  f jsonb := pg_temp.fx();
  v_ws uuid := (f->>'ws')::uuid;
  v_o uuid := (f->>'o')::uuid; v_ad uuid := (f->>'ad')::uuid; v_ag uuid := (f->>'ag')::uuid;
  v_ca bigint := (f->>'ca')::bigint;
  v_s1 bigint; v_s2 bigint; v_d bigint;
  v jsonb; v_n int; v_meta jsonb; v_link text;
begin
  -- organized by the admin
  v_s1 := pg_temp.criar(v_ad, pg_temp.diaria(5, 2, jsonb_build_object('titulo', 'Reunião', 'cliente_id', v_ca, 'compartilhado_cliente', true)));
  v_s2 := pg_temp.nth(v_s1, 2);
  v := pg_temp.responder(v_ws, v_ca, v_s1, 'sim', pg_temp.ini(v_s1));
  select count(*) into v_n from notifications where type = 'event_client_rsvp' and user_id = v_ad;
  assert v_n = 1, format('rsvp notifications: %s', v_n);
  select metadata, link into v_meta, v_link from notifications where type = 'event_client_rsvp' and user_id = v_ad;
  assert v_link = '/calendario?evento=' || v_s1, format('rsvp link: %s', v_link);
  assert (v_meta->>'evento_id')::bigint = pg_temp.ev(v_s1) and (v_meta->>'ocorrencia_id')::bigint = v_s1
     and v_meta->>'titulo' = 'Reunião' and (v_meta->>'inicio')::timestamptz = pg_temp.ini(v_s1)
     and v_meta->>'cliente_nome' = 'Clínica A' and v_meta->>'resposta' = 'sim'
     and v_meta->'dia_inteiro' = 'false'::jsonb and v_meta->>'data_inicio_local' = to_char(current_date + 5, 'YYYY-MM-DD'),
    format('rsvp metadata: %s', v_meta);
  assert not exists (select 1 from notifications where type = 'event_client_rsvp' and user_id in (v_o, v_ag)), 'rsvp went to others';
  -- same answer twice: one notification
  v := pg_temp.responder(v_ws, v_ca, v_s1, 'sim', pg_temp.ini(v_s1));
  select count(*) into v_n from notifications where type = 'event_client_rsvp' and user_id = v_ad;
  assert v_n = 1, format('same answer twice: %s notifications', v_n);
  v := pg_temp.responder(v_ws, v_ca, v_s1, 'nao', pg_temp.ini(v_s1));
  select count(*) into v_n from notifications where type = 'event_client_rsvp' and user_id = v_ad;
  assert v_n = 2, format('changed answer: %s notifications', v_n);

  -- reschedule request
  v := pg_temp.remarcar(v_ws, v_ca, v_s2, current_date + 9, '10:00', 'Outro dia');
  select metadata, link into v_meta, v_link from notifications where type = 'event_reschedule_requested' and user_id = v_ad;
  assert v_meta is not null, 'no event_reschedule_requested';
  assert v_link = '/calendario?evento=' || v_s2 and v_meta->>'cliente_nome' = 'Clínica A'
     and (v_meta->>'inicio_sugerido')::timestamptz = pg_temp.ts(9, '10:00:00') and (v_meta->>'ocorrencia_id')::bigint = v_s2
     and v_meta->>'data_inicio_local' = to_char(current_date + 6, 'YYYY-MM-DD'),
    format('reschedule metadata: %s (link %s)', v_meta, v_link);

  -- organizer no longer a member: owner and admins
  v_d := pg_temp.criar(v_ad, pg_temp.p(jsonb_build_object('cliente_id', v_ca, 'compartilhado_cliente', true)));
  delete from workspace_members where user_id = v_ad and workspace_id = v_ws;
  v := pg_temp.responder(v_ws, v_ca, v_d, 'sim', pg_temp.ini(v_d));
  assert v->>'resposta' = 'sim', format('responder: %s', v);
  select count(*) into v_n from notifications where type = 'event_client_rsvp' and user_id = v_o and (metadata->>'ocorrencia_id')::bigint = v_d;
  assert v_n = 1, format('owner fallback: %s', v_n);
  assert not exists (select 1 from notifications where type = 'event_client_rsvp' and user_id = v_ag), 'agent got the fallback';
  assert not exists (select 1 from notifications where type = 'event_client_rsvp' and user_id = v_ad
                      and (metadata->>'ocorrencia_id')::bigint = v_d), 'removed organizer notified';

  raise notice 'PASS 99_agenda_hub (notifications)';
end $$;

-- ============ block 6: digest reminder RPCs ============
do $$
declare
  f jsonb := pg_temp.fx();
  v_ws uuid := (f->>'ws')::uuid;
  v_o uuid := (f->>'o')::uuid;
  v_ca bigint := (f->>'ca')::bigint;
  v_oc bigint; v_resp bigint; v_now timestamptz;
  v jsonb; v_err text;
begin
  v_oc := pg_temp.criar(v_o, pg_temp.p(jsonb_build_object('titulo', 'Amanhã', 'cliente_id', v_ca, 'compartilhado_cliente', true,
    'inicio_local', pg_temp.dia(3), 'fim_local', pg_temp.dia(3, '15:00:00'))));
  v_resp := pg_temp.criar(v_o, pg_temp.p(jsonb_build_object('titulo', 'Respondido', 'cliente_id', v_ca, 'compartilhado_cliente', true,
    'inicio_local', pg_temp.dia(3, '16:00:00'), 'fim_local', pg_temp.dia(3, '17:00:00'))));
  v := pg_temp.responder(v_ws, v_ca, v_resp, 'nao', pg_temp.ini(v_resp));
  v_now := pg_temp.ini(v_oc) - interval '24 hours';
  v := pg_temp.svc(format('select public.agenda_cliente_lembretes_pendentes(%L::uuid, %s, %L::timestamptz)', v_ws, v_ca, v_now));
  assert jsonb_array_length(v) = 1 and (v->0->>'ocorrencia_id')::bigint = v_oc, format('pendentes: %s', v);
  assert (select array_agg(k order by k) from jsonb_object_keys(v->0) k)
       = array['data_inicio_local','dia_inteiro','fim','inicio','ocorrencia_id','titulo','tz'], format('pendente keys: %s', v->0);
  assert v->0->>'titulo' = 'Amanhã' and (v->0->>'inicio')::timestamptz = pg_temp.ini(v_oc), format('pendente: %s', v->0);
  -- outside the 1h..48h window
  v := pg_temp.svc(format('select public.agenda_cliente_lembretes_pendentes(%L::uuid, %s, %L::timestamptz)', v_ws, v_ca, pg_temp.ini(v_oc) - interval '49 hours'));
  assert v = '[]'::jsonb, format('49h before: %s', v);
  v := pg_temp.svc(format('select public.agenda_cliente_lembretes_pendentes(%L::uuid, %s, %L::timestamptz)', v_ws, v_ca, pg_temp.ini(v_oc) - interval '30 minutes'));
  assert v = '[]'::jsonb, format('30 min before: %s', v);
  -- marked: gone
  perform pg_temp.svc(format('select ''{}''::jsonb from public.agenda_cliente_lembretes_marcar(%L::uuid, %s, %L::jsonb)', v_ws, v_ca,
    jsonb_build_array(jsonb_build_object('ocorrencia_id', v_oc, 'inicio', pg_temp.ini(v_oc)))));
  assert (select resposta is null and lembrado_inicio = pg_temp.ini(v_oc) and cliente_id = v_ca from agenda_respostas_cliente where ocorrencia_id = v_oc),
    'marcar did not create the row';
  v := pg_temp.svc(format('select public.agenda_cliente_lembretes_pendentes(%L::uuid, %s, %L::timestamptz)', v_ws, v_ca, v_now));
  assert v = '[]'::jsonb, format('after marcar: %s', v);
  -- moved: again
  v_err := pg_temp.erro(v_o, format('select public.agenda_evento_editar(%s, %L, %L::jsonb)', v_oc, 'esta',
    jsonb_build_object('inicio_local', pg_temp.dia(3, '15:00:00'), 'fim_local', pg_temp.dia(3, '16:00:00'))));
  assert v_err is null, format('move: %s', v_err);
  v := pg_temp.svc(format('select public.agenda_cliente_lembretes_pendentes(%L::uuid, %s, %L::timestamptz)', v_ws, v_ca, v_now));
  assert jsonb_array_length(v) = 1 and (v->0->>'ocorrencia_id')::bigint = v_oc, format('after the move: %s', v);
  -- flag off: nothing
  update plans set feature_agenda = false;
  v := pg_temp.svc(format('select public.agenda_cliente_lembretes_pendentes(%L::uuid, %s, %L::timestamptz)', v_ws, v_ca, v_now));
  update plans set feature_agenda = true;
  assert v = '[]'::jsonb, format('flag off: %s', v);

  raise notice 'PASS 99_agenda_hub (digest reminders)';
end $$;

-- ============ block 7: composite FKs ============
do $$
declare
  f jsonb := pg_temp.fx();
  v_ws uuid := (f->>'ws')::uuid; v_ws2 uuid := (f->>'ws2')::uuid;
  v_o uuid := (f->>'o')::uuid;
  v_ca bigint := (f->>'ca')::bigint; v_cx bigint := (f->>'cx')::bigint;
  v_oc bigint; v_ok boolean;
begin
  v_oc := pg_temp.criar(v_o, pg_temp.p(jsonb_build_object('cliente_id', v_ca, 'compartilhado_cliente', true)));
  execute 'set local role service_role';
  v_ok := false;
  begin
    insert into agenda_respostas_cliente (ocorrencia_id, conta_id, cliente_id, resposta, respondido_em, inicio_respondido)
      values (v_oc, v_ws2, v_cx, 'sim', now(), now());
  exception when foreign_key_violation then v_ok := true; end;
  assert v_ok, 'agenda_respostas_cliente accepted an occurrence of another workspace';
  v_ok := false;
  begin
    insert into agenda_respostas_cliente (ocorrencia_id, conta_id, cliente_id) values (v_oc, v_ws, v_cx);
  exception when foreign_key_violation then v_ok := true; end;
  assert v_ok, 'agenda_respostas_cliente accepted a cliente of another workspace';
  v_ok := false;
  begin
    insert into agenda_remarcacoes (conta_id, cliente_id, ocorrencia_id, inicio_sugerido, fim_sugerido)
      values (v_ws2, v_cx, v_oc, now() + interval '1 day', now() + interval '25 hours');
  exception when foreign_key_violation then v_ok := true; end;
  assert v_ok, 'agenda_remarcacoes accepted an occurrence of another workspace';
  v_ok := false;
  begin
    insert into agenda_emails_cliente (conta_id, cliente_id, evento_id, tipo, enviar_apos)
      values (v_ws, v_cx, 1, 'convite', now());
  exception when foreign_key_violation then v_ok := true; end;
  assert v_ok, 'agenda_emails_cliente accepted a cliente of another workspace';
  execute 'reset role';

  raise notice 'PASS 99_agenda_hub (composite FKs)';
end $$;

-- ============ block 8: grants ============
do $$
declare
  v_fn text; v_t text;
begin
  foreach v_fn in array array[
    'public.agenda_hub_listar(uuid, bigint, timestamptz, bigint, int)',
    'public.agenda_hub_ocorrencia(uuid, bigint, bigint)',
    'public.agenda_hub_responder(uuid, bigint, bigint, text, timestamptz)',
    'public.agenda_hub_remarcar(uuid, bigint, bigint, date, time, text)',
    'public.agenda_hub_cancelar_remarcacao(uuid, bigint, bigint)',
    'public.agenda_cliente_enfileirar(uuid, bigint, bigint, text, jsonb, jsonb)',
    'public.agenda_cliente_ocorrencias_snapshot(bigint, text, bigint, date)',
    'public.agenda_cliente_substituir_pedidos(bigint, bigint, date)',
    'public.agenda_cliente_claim_emails(int)',
    'public.agenda_cliente_marcar_email(bigint, int, boolean, text)',
    'public.agenda_cliente_tick()',
    'public.agenda_cliente_lembretes_pendentes(uuid, bigint, timestamptz)',
    'public.agenda_cliente_lembretes_marcar(uuid, bigint, jsonb)'] loop
    assert to_regprocedure(v_fn) is not null, format('%s does not exist', v_fn);
    assert not has_function_privilege('anon', v_fn, 'EXECUTE'), format('anon executes %s', v_fn);
    assert not has_function_privilege('authenticated', v_fn, 'EXECUTE'), format('authenticated executes %s', v_fn);
    assert has_function_privilege('service_role', v_fn, 'EXECUTE'), format('service_role lacks %s', v_fn);
  end loop;
  foreach v_fn in array array['public.agenda_remarcacao_resolver(bigint, boolean, text)',
                              'public.agenda_listar(timestamptz, timestamptz, bigint)'] loop
    assert has_function_privilege('authenticated', v_fn, 'EXECUTE'), format('authenticated lacks %s', v_fn);
    assert has_function_privilege('service_role', v_fn, 'EXECUTE'), format('service_role lacks %s', v_fn);
    assert not has_function_privilege('anon', v_fn, 'EXECUTE'), format('anon executes %s', v_fn);
  end loop;
  foreach v_t in array array['public.agenda_respostas_cliente', 'public.agenda_remarcacoes', 'public.agenda_emails_cliente'] loop
    assert (select relrowsecurity from pg_class where oid = v_t::regclass), format('%s has RLS off', v_t);
    assert not has_table_privilege('anon', v_t, 'SELECT'), format('anon selects %s', v_t);
    assert not has_table_privilege('authenticated', v_t, 'SELECT'), format('authenticated selects %s', v_t);
    assert not has_table_privilege('authenticated', v_t, 'INSERT'), format('authenticated inserts %s', v_t);
    assert has_table_privilege('service_role', v_t, 'SELECT'), format('service_role cannot select %s', v_t);
    assert has_table_privilege('service_role', v_t, 'INSERT'), format('service_role cannot insert %s', v_t);
  end loop;

  raise notice 'PASS 99_agenda_hub (grants)';
end $$;

-- ============ block 9: agenda_listar's new columns ============
do $$
declare
  f jsonb := pg_temp.fx();
  v_ws uuid := (f->>'ws')::uuid;
  v_o uuid := (f->>'o')::uuid; v_ad uuid := (f->>'ad')::uuid;
  v_ca bigint := (f->>'ca')::bigint;
  v_sh bigint; v_int bigint; v_priv bigint; v_r bigint;
  v jsonb;
begin
  v_sh := pg_temp.criar(v_o, pg_temp.p(jsonb_build_object('titulo', 'Compartilhado', 'cliente_id', v_ca, 'compartilhado_cliente', true)));
  v_int := pg_temp.criar(v_o, pg_temp.p(jsonb_build_object('titulo', 'Interno', 'cliente_id', v_ca)));
  v_priv := pg_temp.criar(v_o, pg_temp.p(jsonb_build_object('titulo', 'Privado', 'privado', true)));

  v := pg_temp.como(v_o, format('select to_jsonb(l) from public.agenda_listar(null, null, %s) l', v_sh));
  assert v->'compartilhado_cliente' = 'true'::jsonb and v->>'cliente_resposta' = 'aguardando'
     and v->'remarcacao_pendente' = 'null'::jsonb and (v->>'sequencia')::int = 1, format('shared row: %s', v);
  perform pg_temp.responder(v_ws, v_ca, v_sh, 'sim', pg_temp.ini(v_sh));
  v_r := (pg_temp.remarcar(v_ws, v_ca, v_sh, current_date + 9, '10:00', 'msg')->'remarcacao'->>'id')::bigint;
  v := pg_temp.como(v_o, format('select to_jsonb(l) from public.agenda_listar(null, null, %s) l', v_sh));
  assert v->>'cliente_resposta' = 'sim' and (v->'remarcacao_pendente'->>'id')::bigint = v_r
     and (v->'remarcacao_pendente'->>'inicio_sugerido')::timestamptz = pg_temp.ts(9, '10:00:00')
     and (v->'remarcacao_pendente'->>'fim_sugerido')::timestamptz = pg_temp.ts(9, '11:00:00')
     and v->'remarcacao_pendente'->>'mensagem' = 'msg' and v->'remarcacao_pendente' ? 'criado_em',
    format('answered + pending: %s', v);
  -- the column list keeps the old prefix and appends the four new columns
  v := pg_temp.como(v_o, format('select to_jsonb(l) from public.agenda_listar(null, null, %s) l', v_int));
  assert v->'compartilhado_cliente' = 'false'::jsonb and v->'cliente_resposta' = 'null'::jsonb
     and v->'remarcacao_pendente' = 'null'::jsonb, format('internal row: %s', v);
  assert (select array_agg(p.parameter_name::text order by p.ordinal_position)
            from information_schema.parameters p
            join information_schema.routines r on r.specific_name = p.specific_name
           where r.routine_schema = 'public' and r.routine_name = 'agenda_listar' and p.parameter_mode = 'OUT')
       = array['ocorrencia_id','evento_id','data_original','inicio','fim','dia_inteiro','data_inicio_local','data_fim_local',
               'titulo','descricao','local','link_reuniao','tipo','cor','cliente_id','cliente_nome','privado','mascarado',
               'recorrente','regra','lembretes','organizador_id','participantes','minha_resposta','pode_editar',
               'pode_responder','tz','compartilhado_cliente','cliente_resposta','remarcacao_pendente','sequencia'],
    'agenda_listar column order';
  -- masked for the admin (not a participant): all four NULL
  v := pg_temp.como(v_ad, format('select to_jsonb(l) from public.agenda_listar(null, null, %s) l', v_priv));
  assert v->'mascarado' = 'true'::jsonb and v->'compartilhado_cliente' = 'null'::jsonb and v->'cliente_resposta' = 'null'::jsonb
     and v->'remarcacao_pendente' = 'null'::jsonb and v->'sequencia' = 'null'::jsonb, format('masked row: %s', v);

  raise notice 'PASS 99_agenda_hub (agenda_listar)';
end $$;

-- ============ block 10: deleting the cliente of a shared event ============
do $$
declare
  f jsonb := pg_temp.fx();
  v_ws uuid := (f->>'ws')::uuid;
  v_o uuid := (f->>'o')::uuid;
  v_ca bigint := (f->>'ca')::bigint;
  v_oc bigint; v jsonb;
begin
  v_oc := pg_temp.criar(v_o, pg_temp.diaria(5, 2, jsonb_build_object('cliente_id', v_ca, 'compartilhado_cliente', true)));
  perform pg_temp.responder(v_ws, v_ca, v_oc, 'sim', pg_temp.ini(v_oc));
  perform pg_temp.remarcar(v_ws, v_ca, pg_temp.nth(v_oc, 2), current_date + 9, '10:00', null);
  assert exists (select 1 from agenda_emails_cliente where cliente_id = v_ca), 'fixture: no queue item';
  perform pg_temp.sem_claims();
  delete from clientes where id = v_ca;
  assert (select cliente_id is null and compartilhado_cliente from agenda_eventos where id = pg_temp.ev(v_oc)),
    'deleting the cliente did not null cliente_id';
  v := pg_temp.listar(v_ws, v_ca);
  assert v->>'estado' = 'ok' and v->'itens' = '[]'::jsonb, format('listar for the deleted cliente: %s', v);
  assert not exists (select 1 from agenda_respostas_cliente where cliente_id = v_ca), 'responses survived';
  assert not exists (select 1 from agenda_remarcacoes where cliente_id = v_ca), 'requests survived';
  assert not exists (select 1 from agenda_emails_cliente where cliente_id = v_ca), 'queue items survived';
  -- the event is still editable (the esta guard compares effective sharing)
  assert pg_temp.erro(v_o, format('select public.agenda_evento_editar(%s, %L, %L::jsonb)', v_oc, 'esta', '{"titulo":"Ainda editável"}')) is null,
    'esta edit failed after the cliente was deleted';

  raise notice 'PASS 99_agenda_hub (cliente deleted)';
end $$;

rollback;
