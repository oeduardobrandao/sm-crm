\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Agenda sub-project 2 (20261006000001_agenda_feed.sql): the personal iCal feed.
-- Block 1: the token RPCs (agenda_feed_obter / gerar / desativar), per-user
-- isolation and the grant surface. Block 2: what agenda_feed_eventos returns
-- ("my events" inside the window, overrides, shape), then the flag-off,
-- lost-permission and removed-member paths.
--
-- The feed filters on the real now(), so every fixture is built from
-- current_date and app.agenda_hoje is pinned to current_date too. Never use a
-- literal date here: the suite would start failing once that date passes.

begin;
-- Agenda rollout flag (feature_agenda): on for every plan inside this
-- transaction; block 2 switches it off on purpose.
update plans set feature_agenda = true;
select et_grant_hosted_parity(array['agenda_eventos','agenda_ocorrencias','agenda_participantes','agenda_respostas','agenda_feed_tokens']);
revoke all on public.agenda_eventos, public.agenda_ocorrencias, public.agenda_participantes, public.agenda_respostas from anon, authenticated;
grant select on public.agenda_eventos, public.agenda_ocorrencias, public.agenda_participantes, public.agenda_respostas to authenticated;
grant all on public.agenda_eventos, public.agenda_ocorrencias, public.agenda_participantes, public.agenda_respostas to service_role;
revoke all on public.agenda_feed_tokens from anon, authenticated;
grant all on public.agenda_feed_tokens to service_role;

-- 'YYYY-MM-DD"T"HH:MI:SS' for current_date + p_dias at p_hora
create or replace function pg_temp.dia(p_dias int, p_hora text default '14:00:00') returns text language sql as $f$
  select to_char(current_date + p_dias, 'YYYY-MM-DD') || 'T' || p_hora;
$f$;
-- base create payload (every key present, as the form sends it) merged with overrides
create or replace function pg_temp.p(p jsonb default '{}') returns jsonb language sql as $f$
  select jsonb_build_object(
    'titulo', 'Evento', 'descricao', null, 'local', null, 'link_reuniao', null,
    'tipo', 'reuniao', 'cor', null, 'cliente_id', null, 'privado', false, 'dia_inteiro', false,
    'tz', 'America/Sao_Paulo', 'inicio_local', pg_temp.dia(5), 'fim_local', pg_temp.dia(5, '15:00:00'),
    'lembretes', jsonb_build_array(), 'regra', null) || p;
$f$;
-- daily series of p_n occurrences starting at current_date + p_dias
create or replace function pg_temp.diaria(p_dias int, p_n int, p jsonb default '{}') returns jsonb language sql as $f$
  select pg_temp.p(jsonb_build_object(
    'inicio_local', pg_temp.dia(p_dias), 'fim_local', pg_temp.dia(p_dias, '15:00:00'),
    'regra', jsonb_build_object('freq','daily','intervalo',1,'dias_semana',null,'mensal_modo',null,
                                'mensal_ordinal',null,'ate',null,'contagem',p_n)) || p);
$f$;
-- create an event as p_user; returns its first occurrence id
create or replace function pg_temp.criar(p_user uuid, p jsonb, parts uuid[]) returns bigint language plpgsql as $f$
declare v bigint;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select c.ocorrencia_id into v from public.agenda_evento_criar(p, parts) c;
  execute 'reset role';
  return v;
end $f$;
-- the p_n-th (1-based) occurrence of the series that holds p_oc
create or replace function pg_temp.nth(p_oc bigint, p_n int) returns bigint language sql as $f$
  select o.id from agenda_ocorrencias o
   where o.evento_id = (select evento_id from agenda_ocorrencias where id = p_oc)
   order by o.data_original offset p_n - 1 limit 1;
$f$;
-- runs p_sql as p_user (authenticated); 'SQLSTATE:message' of the error, or NULL on success
create or replace function pg_temp.erro(p_user uuid, p_sql text) returns text language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  execute p_sql;
  execute 'reset role';
  return null;
exception when others then
  return sqlstate || ':' || sqlerrm;
end $f$;
-- runs p_sql (one text value) as p_user (authenticated) and returns the value
create or replace function pg_temp.valor(p_user uuid, p_sql text) returns text language plpgsql as $f$
declare v text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  execute p_sql into v;
  execute 'reset role';
  return v;
end $f$;
-- agenda_feed_eventos(p_token) as service_role (the edge function's role)
create or replace function pg_temp.feed(p_token text) returns jsonb language plpgsql as $f$
declare v jsonb;
begin
  -- no user claims leak into the service-role call (the edge function has none)
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  execute 'set local role service_role';
  v := public.agenda_feed_eventos(p_token);
  execute 'reset role';
  return v;
end $f$;
-- occurrence ids in a feed payload, in payload order
create or replace function pg_temp.ids(p_feed jsonb) returns bigint[] language sql as $f$
  select coalesce(array_agg((x->>'ocorrencia_id')::bigint order by n), '{}')
    from jsonb_array_elements(p_feed->'eventos') with ordinality as t(x, n);
$f$;
-- the feed item of one occurrence
create or replace function pg_temp.item(p_feed jsonb, p_oc bigint) returns jsonb language sql as $f$
  select x from jsonb_array_elements(p_feed->'eventos') as t(x) where (x->>'ocorrencia_id')::bigint = p_oc;
$f$;
grant execute on all functions in schema pg_temp to authenticated, service_role;

-- ============ block 1: token RPCs, isolation, grants ============
do $$
declare
  v_ws uuid;
  v_a uuid := gen_random_uuid();     -- admin
  v_b uuid := gen_random_uuid();     -- owner
  v_t1 text; v_t2 text; v_tb text; v_v text;
  v_err text;
  v_fn text;
begin
  perform set_config('app.agenda_hoje', current_date::text, true);
  v_ws := et_make_workspace('max');
  insert into auth.users (id) values (v_a), (v_b);
  insert into workspace_members (user_id, workspace_id, role) values (v_a, v_ws, 'admin'), (v_b, v_ws, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id in (v_a, v_b);

  -- grants: the table is reachable only through the RPCs
  assert not has_table_privilege('authenticated', 'public.agenda_feed_tokens', 'SELECT'), 'authenticated has SELECT on agenda_feed_tokens';
  assert not has_table_privilege('anon', 'public.agenda_feed_tokens', 'SELECT'), 'anon has SELECT on agenda_feed_tokens';
  assert not has_table_privilege('authenticated', 'public.agenda_feed_tokens', 'INSERT'), 'authenticated has INSERT on agenda_feed_tokens';
  assert has_table_privilege('service_role', 'public.agenda_feed_tokens', 'SELECT'), 'service_role lacks SELECT on agenda_feed_tokens';
  assert (select relrowsecurity from pg_class where oid = 'public.agenda_feed_tokens'::regclass), 'agenda_feed_tokens has RLS off';
  v_err := pg_temp.erro(v_a, 'select count(*) from public.agenda_feed_tokens');
  assert v_err like '42501:%', format('authenticated read agenda_feed_tokens directly: %s', coalesce(v_err, 'succeeded'));

  foreach v_fn in array array['public.agenda_feed_obter()', 'public.agenda_feed_gerar()', 'public.agenda_feed_desativar()'] loop
    assert has_function_privilege('authenticated', v_fn, 'EXECUTE'), format('authenticated must execute %s', v_fn);
    assert has_function_privilege('service_role', v_fn, 'EXECUTE'), format('service_role must execute %s', v_fn);
    assert not has_function_privilege('anon', v_fn, 'EXECUTE'), format('anon executes %s', v_fn);
  end loop;
  assert not has_function_privilege('anon', 'public.agenda_feed_eventos(text)', 'EXECUTE'), 'anon executes agenda_feed_eventos';
  assert not has_function_privilege('authenticated', 'public.agenda_feed_eventos(text)', 'EXECUTE'), 'authenticated executes agenda_feed_eventos';
  assert has_function_privilege('service_role', 'public.agenda_feed_eventos(text)', 'EXECUTE'), 'service_role must execute agenda_feed_eventos';
  assert not has_function_privilege('anon', 'public.agenda_feed_contexto()', 'EXECUTE'), 'anon executes agenda_feed_contexto';
  assert not has_function_privilege('authenticated', 'public.agenda_feed_contexto()', 'EXECUTE'), 'authenticated executes agenda_feed_contexto';
  assert has_function_privilege('service_role', 'public.agenda_feed_contexto()', 'EXECUTE'), 'service_role must execute agenda_feed_contexto';
  v_err := pg_temp.erro(v_a, 'select public.agenda_feed_eventos(''x'')');
  assert v_err like '42501:%', format('authenticated called agenda_feed_eventos: %s', coalesce(v_err, 'succeeded'));

  -- obter before any gerar: NULL
  v_v := pg_temp.valor(v_a, 'select public.agenda_feed_obter()');
  assert v_v is null, format('obter before gerar: %s', v_v);

  -- gerar: 64 lowercase hex, obter returns the same
  v_t1 := pg_temp.valor(v_a, 'select public.agenda_feed_gerar()');
  assert v_t1 ~ '^[0-9a-f]{64}$', format('gerar returned %s', v_t1);
  assert pg_temp.valor(v_a, 'select public.agenda_feed_obter()') = v_t1, 'obter does not return the generated token';
  -- A has no events yet: an ok feed with an empty array, never NULL eventos
  assert pg_temp.feed(v_t1) = jsonb_build_object('estado', 'ok', 'workspace_nome', 'ET test ws', 'eventos', '[]'::jsonb),
    format('feed with no events: %s', pg_temp.feed(v_t1));
  perform 1 from agenda_feed_tokens where user_id = v_a and conta_id = v_ws and token = v_t1;
  assert found, 'gerar stored no row for (user, workspace)';

  -- gerar again: a new token replaces the old one, which stops resolving
  v_t2 := pg_temp.valor(v_a, 'select public.agenda_feed_gerar()');
  assert v_t2 ~ '^[0-9a-f]{64}$' and v_t2 <> v_t1, format('second gerar: %s (first %s)', v_t2, v_t1);
  assert pg_temp.valor(v_a, 'select public.agenda_feed_obter()') = v_t2, 'obter after the swap is not the new token';
  assert pg_temp.feed(v_t1) is null, 'the replaced token still resolves';
  assert pg_temp.feed(v_t2) is not null, 'the new token does not resolve';
  assert (select count(*) from agenda_feed_tokens where user_id = v_a) = 1, 'the swap left two rows';

  -- another user: own token, never A's
  assert pg_temp.valor(v_b, 'select public.agenda_feed_obter()') is null, 'B obter returned a token before B generated one';
  v_tb := pg_temp.valor(v_b, 'select public.agenda_feed_gerar()');
  assert v_tb ~ '^[0-9a-f]{64}$' and v_tb <> v_t2, format('B gerar: %s', v_tb);
  assert pg_temp.valor(v_b, 'select public.agenda_feed_obter()') = v_tb, 'B obter is not B''s token';
  assert pg_temp.valor(v_a, 'select public.agenda_feed_obter()') = v_t2, 'A''s token changed when B generated';

  -- unknown and malformed tokens: NULL, no raise
  assert pg_temp.feed(repeat('0', 64)) is null, 'an unknown token resolved';
  assert pg_temp.feed('') is null, 'an empty token resolved';
  assert pg_temp.feed(null) is null, 'a NULL token resolved';

  -- desativar: obter NULL, feed NULL; B untouched
  v_err := pg_temp.erro(v_a, 'select public.agenda_feed_desativar()');
  assert v_err is null, format('desativar: %s', v_err);
  assert pg_temp.valor(v_a, 'select public.agenda_feed_obter()') is null, 'obter after desativar is not NULL';
  assert pg_temp.feed(v_t2) is null, 'the token still resolves after desativar';
  assert pg_temp.feed(v_tb) is not null, 'A''s desativar removed B''s token';
  -- desativar with nothing to remove is a no-op
  v_err := pg_temp.erro(v_a, 'select public.agenda_feed_desativar()');
  assert v_err is null, format('desativar twice: %s', v_err);

  raise notice 'PASS 99_agenda_feed (token RPCs, isolation, grants)';
end $$;

-- ============ block 2: feed contents, then flag off, lost permission, removed member ============
do $$
declare
  v_ws uuid; v_ws2 uuid;
  v_a uuid := gen_random_uuid();     -- admin, the feed's owner
  v_b uuid := gen_random_uuid();     -- owner, organizes most events
  v_c uuid := gen_random_uuid();     -- agent, invited with A on one event
  v_d uuid := gen_random_uuid();     -- custom role, loses calendario later
  v_x uuid := gen_random_uuid();     -- owner of another workspace
  v_role uuid;
  v_ta text; v_ta2 text; v_td text; v_tx text;
  v_a_ws2 bigint;
  v_feed jsonb; v_it jsonb; v_ids bigint[];
  v_err text;
  v_flag constant text := 'P0001:feature_disabled:feature_agenda';
  -- included
  v_meu bigint; v_convidado bigint; v_privado bigint; v_passado bigint; v_inteiro bigint;
  v_s1 bigint; v_s3 bigint;            -- series with A's per-occurrence decline (2nd)
  v_c1 bigint; v_c3 bigint;            -- series with a cancelled occurrence (2nd) and an override (3rd)
  -- excluded
  v_alheio bigint; v_s2 bigint; v_recusado bigint; v_c2 bigint; v_antigo bigint; v_longe bigint; v_outro_ws bigint;
  v_ultimo timestamptz;
begin
  perform set_config('app.agenda_hoje', current_date::text, true);
  v_ws := et_make_workspace('max');
  v_ws2 := et_make_workspace('max');
  insert into auth.users (id) values (v_a), (v_b), (v_c), (v_d), (v_x);
  insert into workspace_roles (conta_id, nome, permissions)
    values (v_ws, 'Só vê a agenda', '{"calendario":"ver"}') returning id into v_role;
  insert into workspace_members (user_id, workspace_id, role) values
    (v_a, v_ws, 'admin'), (v_b, v_ws, 'owner'), (v_c, v_ws, 'agent'), (v_x, v_ws2, 'owner');
  insert into workspace_members (user_id, workspace_id, role, role_id) values (v_d, v_ws, 'agent', v_role);
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id in (v_a, v_b, v_c, v_d);
  update profiles set conta_id = v_ws2, active_workspace_id = v_ws2 where id = v_x;

  -- ---- fixtures ----
  v_meu := pg_temp.criar(v_a, pg_temp.p(jsonb_build_object('titulo', 'Meu evento',
    'descricao', 'Pauta', 'local', 'Sala 2', 'link_reuniao', 'https://meet.example.com/abc')), '{}');
  v_convidado := pg_temp.criar(v_b, pg_temp.p(jsonb_build_object('titulo', 'Convite do B',
    'inicio_local', pg_temp.dia(6), 'fim_local', pg_temp.dia(6, '15:00:00'))), array[v_a, v_c]);
  v_privado := pg_temp.criar(v_b, pg_temp.p(jsonb_build_object('titulo', 'Consulta privada', 'privado', true,
    'descricao', 'Detalhe privado', 'inicio_local', pg_temp.dia(7), 'fim_local', pg_temp.dia(7, '15:00:00'))), array[v_a]);
  v_alheio := pg_temp.criar(v_b, pg_temp.p(jsonb_build_object('titulo', 'Sem o A',
    'inicio_local', pg_temp.dia(8), 'fim_local', pg_temp.dia(8, '15:00:00'))), array[v_c]);
  -- declined at series level (one-off: escopo esta becomes todas)
  v_recusado := pg_temp.criar(v_b, pg_temp.p(jsonb_build_object('titulo', 'Recusado',
    'inicio_local', pg_temp.dia(9), 'fim_local', pg_temp.dia(9, '15:00:00'))), array[v_a]);
  v_err := pg_temp.erro(v_a, format('select public.agenda_responder(%s, %L, %L)', v_recusado, 'nao', 'todas'));
  assert v_err is null, format('responder (series): %s', v_err);
  -- declined for one occurrence of a series
  v_s1 := pg_temp.criar(v_b, pg_temp.diaria(10, 3, '{"titulo":"Série recusa"}'), array[v_a]);
  v_s2 := pg_temp.nth(v_s1, 2); v_s3 := pg_temp.nth(v_s1, 3);
  assert v_s2 is not null and v_s3 is not null, 'decline series: fewer than 3 occurrences';
  v_err := pg_temp.erro(v_a, format('select public.agenda_responder(%s, %L, %L)', v_s2, 'nao', 'esta'));
  assert v_err is null, format('responder (esta): %s', v_err);
  -- a talvez answer does not exclude
  v_err := pg_temp.erro(v_a, format('select public.agenda_responder(%s, %L, %L)', v_s3, 'talvez', 'esta'));
  assert v_err is null, format('responder (talvez): %s', v_err);
  -- cancelled occurrence + per-occurrence title override
  v_c1 := pg_temp.criar(v_b, pg_temp.diaria(15, 3, '{"titulo":"Série base"}'), array[v_a]);
  v_c2 := pg_temp.nth(v_c1, 2); v_c3 := pg_temp.nth(v_c1, 3);
  v_err := pg_temp.erro(v_b, format('select public.agenda_evento_excluir(%s, %L)', v_c2, 'esta'));
  assert v_err is null, format('excluir (esta): %s', v_err);
  assert (select cancelada from agenda_ocorrencias where id = v_c2), 'excluir esta did not cancel the occurrence';
  v_err := pg_temp.erro(v_b, format('select public.agenda_evento_editar(%s, %L, %L::jsonb)', v_c3, 'esta', '{"titulo":"Título trocado"}'));
  assert v_err is null, format('editar (esta): %s', v_err);
  assert (select 'titulo' = any (campos_sobrescritos) from agenda_ocorrencias where id = v_c3), 'editar esta did not override titulo';
  -- window edges
  v_passado := pg_temp.criar(v_a, pg_temp.p(jsonb_build_object('titulo', 'Há 20 dias',
    'inicio_local', pg_temp.dia(-20), 'fim_local', pg_temp.dia(-20, '15:00:00'))), '{}');
  v_antigo := pg_temp.criar(v_a, pg_temp.p(jsonb_build_object('titulo', 'Há 31 dias',
    'inicio_local', pg_temp.dia(-31), 'fim_local', pg_temp.dia(-31, '15:00:00'))), '{}');
  v_longe := pg_temp.criar(v_a, pg_temp.p(jsonb_build_object('titulo', 'Daqui a 13 meses',
    'inicio_local', to_char((current_date + interval '13 months')::date, 'YYYY-MM-DD') || 'T14:00:00',
    'fim_local', to_char((current_date + interval '13 months')::date, 'YYYY-MM-DD') || 'T15:00:00')), '{}');
  assert v_antigo is not null and v_longe is not null, 'window-edge fixtures have no occurrence';
  -- all-day, two days (exclusive end)
  v_inteiro := pg_temp.criar(v_a, pg_temp.p(jsonb_build_object('titulo', 'Dia inteiro', 'dia_inteiro', true,
    'inicio_local', pg_temp.dia(20, '00:00:00'), 'fim_local', pg_temp.dia(22, '00:00:00'))), '{}');
  -- another workspace's event
  v_outro_ws := pg_temp.criar(v_x, pg_temp.p('{"titulo":"Outro workspace"}'), '{}');

  v_ta := pg_temp.valor(v_a, 'select public.agenda_feed_gerar()');
  v_feed := pg_temp.feed(v_ta);

  -- ---- envelope ----
  assert v_feed->>'estado' = 'ok', format('estado: %s', v_feed->>'estado');
  assert v_feed->>'workspace_nome' = 'ET test ws', format('workspace_nome: %s', v_feed->>'workspace_nome');
  assert jsonb_typeof(v_feed->'eventos') = 'array', 'eventos is not an array';
  v_ids := pg_temp.ids(v_feed);

  -- ---- included ----
  assert v_meu = any (v_ids), 'feed lacks the event A organizes';
  assert v_convidado = any (v_ids), 'feed lacks B''s event A is invited to';
  assert v_privado = any (v_ids), 'feed lacks B''s private event A attends';
  assert v_s1 = any (v_ids) and v_s3 = any (v_ids), 'feed lacks the series occurrences A did not decline';
  assert v_c1 = any (v_ids), 'feed lacks the first occurrence of the series with a cancellation';
  assert v_c3 = any (v_ids), 'feed lacks the overridden occurrence';
  assert v_passado = any (v_ids), 'feed lacks the event 20 days ago';
  assert v_inteiro = any (v_ids), 'feed lacks the all-day event';
  -- ---- excluded ----
  assert not (v_alheio = any (v_ids)), 'feed has B''s event without A';
  assert not (v_recusado = any (v_ids)), 'feed has the event A declined for the series';
  assert not (v_s2 = any (v_ids)), 'feed has the occurrence A declined';
  assert not (v_c2 = any (v_ids)), 'feed has the cancelled occurrence';
  assert not (v_antigo = any (v_ids)), 'feed has the event 31 days ago';
  assert not (v_longe = any (v_ids)), 'feed has the event 13 months out';
  assert not (v_outro_ws = any (v_ids)), 'feed has another workspace''s event';
  assert cardinality(v_ids) = 9, format('feed has %s items, expected 9: %s', cardinality(v_ids), v_ids);
  -- ordered by inicio
  assert v_ids = (select array_agg(o.id order by o.inicio, o.id) from agenda_ocorrencias o where o.id = any (v_ids)),
    format('feed not ordered by inicio: %s', v_ids);

  -- ---- item shape and content ----
  v_it := pg_temp.item(v_feed, v_meu);
  assert (select array_agg(k order by k) from jsonb_object_keys(v_it) k)
       = array['data_fim_local','data_inicio_local','data_original','descricao','dia_inteiro','evento_id','fim',
               'inicio','link_reuniao','local','ocorrencia_id','sequencia','titulo','tz'],
    format('item keys: %s', v_it);
  -- sequencia (20261007000001_agenda_hub.sql): 0 until the client is e-mailed about it
  assert v_it->'sequencia' = '0'::jsonb, format('sequencia: %s', v_it);
  assert v_it->>'titulo' = 'Meu evento' and v_it->>'descricao' = 'Pauta' and v_it->>'local' = 'Sala 2'
     and v_it->>'link_reuniao' = 'https://meet.example.com/abc' and v_it->>'tz' = 'America/Sao_Paulo',
    format('own event content: %s', v_it);
  assert (v_it->>'evento_id')::bigint = (select evento_id from agenda_ocorrencias where id = v_meu), format('evento_id: %s', v_it);
  assert v_it->'dia_inteiro' = 'false'::jsonb, format('dia_inteiro: %s', v_it);
  assert (v_it->>'inicio')::timestamptz = (pg_temp.dia(5)::timestamp at time zone 'America/Sao_Paulo')
     and (v_it->>'fim')::timestamptz = (pg_temp.dia(5, '15:00:00')::timestamp at time zone 'America/Sao_Paulo'),
    format('inicio/fim: %s', v_it);
  assert v_it->>'data_original' = to_char(current_date + 5, 'YYYY-MM-DD')
     and v_it->>'data_inicio_local' = to_char(current_date + 5, 'YYYY-MM-DD')
     and v_it->>'data_fim_local' = to_char(current_date + 6, 'YYYY-MM-DD'),
    format('local dates of a timed event: %s', v_it);
  v_it := pg_temp.item(v_feed, v_inteiro);
  assert v_it->'dia_inteiro' = 'true'::jsonb
     and v_it->>'data_inicio_local' = to_char(current_date + 20, 'YYYY-MM-DD')
     and v_it->>'data_fim_local' = to_char(current_date + 22, 'YYYY-MM-DD'),
    format('all-day local dates: %s', v_it);
  -- private event A attends: real details, never "Ocupado"
  v_it := pg_temp.item(v_feed, v_privado);
  assert v_it->>'titulo' = 'Consulta privada' and v_it->>'descricao' = 'Detalhe privado',
    format('private event A attends was masked: %s', v_it);
  -- per-occurrence override wins; the siblings keep the series title
  assert pg_temp.item(v_feed, v_c3)->>'titulo' = 'Título trocado', format('override: %s', pg_temp.item(v_feed, v_c3));
  assert pg_temp.item(v_feed, v_c1)->>'titulo' = 'Série base', format('series title: %s', pg_temp.item(v_feed, v_c1));

  -- nothing at or past the 12-month bound
  select max(o.inicio) into v_ultimo from agenda_ocorrencias o where o.id = any (v_ids);
  assert v_ultimo < now() + interval '12 months', 'an item beyond 12 months';

  -- ---- flag off: RPCs raise, the feed answers desligado with no events ----
  update plans set feature_agenda = false;
  v_err := pg_temp.erro(v_a, 'select public.agenda_feed_obter()');
  assert v_err = v_flag, format('obter with the flag off: %s', coalesce(v_err, 'succeeded'));
  v_err := pg_temp.erro(v_a, 'select public.agenda_feed_gerar()');
  assert v_err = v_flag, format('gerar with the flag off: %s', coalesce(v_err, 'succeeded'));
  v_err := pg_temp.erro(v_a, 'select public.agenda_feed_desativar()');
  assert v_err = v_flag, format('desativar with the flag off: %s', coalesce(v_err, 'succeeded'));
  assert exists (select 1 from agenda_feed_tokens where token = v_ta), 'the token row changed with the flag off';
  v_feed := pg_temp.feed(v_ta);
  assert v_feed = jsonb_build_object('estado', 'desligado', 'workspace_nome', 'ET test ws', 'eventos', '[]'::jsonb),
    format('feed with the flag off: %s', v_feed);
  update plans set feature_agenda = true;
  assert pg_temp.feed(v_ta)->>'estado' = 'ok', 'feed did not come back with the flag on';

  -- ---- no calendario: ver: the RPCs raise, an existing token stops resolving ----
  v_td := pg_temp.valor(v_d, 'select public.agenda_feed_gerar()');
  assert pg_temp.feed(v_td) is not null, 'D''s token does not resolve while D can see the agenda';
  update workspace_roles set permissions = '{"clientes":"ver"}' where id = v_role;
  assert pg_temp.feed(v_td) is null, 'the feed resolves for a member without calendario: ver';
  v_err := pg_temp.erro(v_d, 'select public.agenda_feed_gerar()');
  assert v_err = 'P0001:agenda: você não pode ver a agenda', format('gerar without calendario: ver: %s', coalesce(v_err, 'succeeded'));

  -- ---- the session's active workspace scopes the token ----
  v_tx := pg_temp.valor(v_x, 'select public.agenda_feed_gerar()');
  update workspaces set name = 'WS dois' where id = v_ws2;
  v_feed := pg_temp.feed(v_tx);
  assert v_feed->>'workspace_nome' = 'WS dois', format('ws2 feed workspace_nome: %s', v_feed->>'workspace_nome');
  assert pg_temp.ids(v_feed) = array[v_outro_ws], format('X''s feed: %s', v_feed);
  assert (select conta_id from agenda_feed_tokens where token = v_tx) = v_ws2, 'X''s token is not bound to X''s workspace';
  -- A in two workspaces: one token per workspace, each feed sees only its own
  insert into workspace_members (user_id, workspace_id, role) values (v_a, v_ws2, 'admin');
  update profiles set conta_id = v_ws2, active_workspace_id = v_ws2 where id = v_a;
  v_a_ws2 := pg_temp.criar(v_a, pg_temp.p('{"titulo":"A no outro workspace"}'), '{}');
  assert pg_temp.valor(v_a, 'select public.agenda_feed_obter()') is null, 'A has a token in ws2 before generating one';
  v_ta2 := pg_temp.valor(v_a, 'select public.agenda_feed_gerar()');
  assert v_ta2 <> v_ta, 'A got the same token in both workspaces';
  assert pg_temp.ids(pg_temp.feed(v_ta2)) = array[v_a_ws2], format('A''s ws2 feed: %s', pg_temp.feed(v_ta2));
  assert not (v_a_ws2 = any (pg_temp.ids(pg_temp.feed(v_ta)))), 'A''s ws feed has A''s ws2 event';
  assert pg_temp.ids(pg_temp.feed(v_ta)) = v_ids, 'A''s ws feed changed when A generated a ws2 token';
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_a;
  assert pg_temp.valor(v_a, 'select public.agenda_feed_obter()') = v_ta, 'back in ws, obter is not the ws token';

  -- ---- removed member: NULL ----
  delete from workspace_members where user_id = v_a and workspace_id = v_ws;
  assert pg_temp.feed(v_ta) is null, 'the feed resolves for a removed member';
  assert exists (select 1 from agenda_feed_tokens where token = v_ta), 'removing the member deleted the token row (spec keeps it)';
  assert pg_temp.feed(v_ta2) is not null, 'removal from ws broke A''s ws2 feed';

  raise notice 'PASS 99_agenda_feed (contents, flag off, permission, removed member)';
end $$;

rollback;
