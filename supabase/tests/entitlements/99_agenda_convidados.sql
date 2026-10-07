\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Agenda sub-project 4 (20261008000002_agenda_convidados.sql): external guests
-- invited by e-mail. Blocks: (1) payload validation, (2) daily caps,
-- (3) e-mail queue hooks (convite, alteracao, cancelamento, delete, accepted
-- reschedule) and one sequencia bump per write, (4) the seguintes split
-- (same token, answers re-pointed), (5) the recipient-aware claim,
-- (6) the public convite RPCs, (7) agenda_listar.convidados, (8) the advisory
-- lock, (9) grants.
--
-- Fixtures are built from current_date (the convite RPCs filter on the real
-- now()), app.agenda_hoje is pinned to current_date. now() is frozen for the
-- whole transaction: every guest row of the file is "created in the last 24 h",
-- so each block takes a fresh workspace and the platform-cap fixture is
-- deleted at the end of its block.

begin;
update plans set feature_agenda = true;
select et_grant_hosted_parity(array['agenda_eventos','agenda_ocorrencias','agenda_participantes','agenda_respostas',
  'agenda_respostas_cliente','agenda_remarcacoes','agenda_emails_cliente',
  'agenda_convidados','agenda_respostas_convidado','agenda_convidados_bloqueio']);
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
-- daily series of p_n occurrences starting at current_date + p_dias, 14:00-15:00
create or replace function pg_temp.diaria(p_dias int, p_n int, p jsonb default '{}') returns jsonb language sql as $f$
  select pg_temp.p(jsonb_build_object(
    'inicio_local', pg_temp.dia(p_dias), 'fim_local', pg_temp.dia(p_dias, '15:00:00'),
    'regra', jsonb_build_object('freq','daily','intervalo',1,'dias_semana',null,'mensal_modo',null,
                                'mensal_ordinal',null,'ate',null,'contagem',p_n)) || p);
$f$;
-- {"convidados": [{"email": e, "nome": null}, ...]}
create or replace function pg_temp.cv(p_emails text[]) returns jsonb language sql as $f$
  select jsonb_build_object('convidados', coalesce(jsonb_agg(jsonb_build_object('email', e, 'nome', null) order by n), '[]'::jsonb))
    from unnest(p_emails) with ordinality as t(e, n);
$f$;
-- p_n distinct e-mails <prefix>1@ext.com .. <prefix>N@ext.com
create or replace function pg_temp.emails(p_prefix text, p_n int) returns text[] language sql as $f$
  select array_agg(p_prefix || g || '@ext.com' order by g) from generate_series(1, p_n) g;
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
-- edit as p_user; error text or NULL
create or replace function pg_temp.editar(p_user uuid, p_oc bigint, p_escopo text, p jsonb) returns text language sql as $f$
  select pg_temp.erro(p_user, format('select public.agenda_evento_editar(%s, %L, %L::jsonb)', p_oc, p_escopo, p));
$f$;
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
create or replace function pg_temp.ler(p_token text) returns jsonb language sql as $f$
  select pg_temp.svc(format('select public.agenda_convite_ler(%L)', p_token));
$f$;
create or replace function pg_temp.c_oc(p_token text, oc bigint) returns jsonb language sql as $f$
  select pg_temp.svc(format('select public.agenda_convite_ocorrencia(%L, %s)', p_token, oc));
$f$;
create or replace function pg_temp.c_resp(p_token text, oc bigint, r text, visto timestamptz) returns jsonb language sql as $f$
  select pg_temp.svc(format('select public.agenda_convite_responder(%L, %s, %L, %L::timestamptz)', p_token, oc, r, visto));
$f$;
create or replace function pg_temp.remarcar(c uuid, cl bigint, oc bigint, d date, h time, m text) returns jsonb language sql as $f$
  select pg_temp.svc(format('select public.agenda_hub_remarcar(%L::uuid, %s, %s, %L::date, %L::time, %L)', c, cl, oc, d, h, m));
$f$;
-- the active guest row of p_email on the series that holds p_oc
create or replace function pg_temp.g(p_oc bigint, p_email text) returns agenda_convidados language sql as $f$
  select * from agenda_convidados where evento_id = pg_temp.ev(p_oc) and email = p_email and removido_em is null;
$f$;
-- item ids of a convite payload, in order
create or replace function pg_temp.ids(p jsonb) returns bigint[] language sql as $f$
  select coalesce(array_agg((x->>'ocorrencia_id')::bigint order by n), '{}')
    from jsonb_array_elements(p->'itens') with ordinality as t(x, n);
$f$;
-- ocorrencia ids of a snapshot, by inicio
create or replace function pg_temp.snap_ids(p jsonb) returns bigint[] language sql as $f$
  select coalesce(array_agg((x->>'ocorrencia_id')::bigint order by (x->>'inicio')::timestamptz, (x->>'ocorrencia_id')::bigint), '{}')
    from jsonb_array_elements(p) x;
$f$;
-- pending queue items of a series
create or replace function pg_temp.pend(p_evento bigint) returns setof agenda_emails_cliente language sql as $f$
  select * from agenda_emails_cliente where evento_id = p_evento and status = 'pendente' order by id;
$f$;
-- fixture: ws (max) with owner O (e-mail olga@agencia.com), admin AD, agent AG
-- (e-mail stored in mixed case) and cliente A; ws2 with X and cliente CX
create or replace function pg_temp.fx() returns jsonb language plpgsql as $f$
declare
  v_ws uuid := et_make_workspace('max');
  v_ws2 uuid := et_make_workspace('max');
  v_o uuid := gen_random_uuid(); v_ad uuid := gen_random_uuid(); v_ag uuid := gen_random_uuid(); v_x uuid := gen_random_uuid();
  v_ca bigint; v_cx bigint;
  v_tag text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
begin
  perform pg_temp.sem_claims();
  perform set_config('app.agenda_hoje', current_date::text, true);
  insert into auth.users (id, email) values
    (v_o, 'olga.' || v_tag || '@agencia.com'), (v_ad, 'admin.' || v_tag || '@agencia.com'),
    (v_ag, 'Agente.' || v_tag || '@Agencia.com'), (v_x, 'x.' || v_tag || '@outra.com');
  insert into workspace_members (user_id, workspace_id, role) values
    (v_o, v_ws, 'owner'), (v_ad, v_ws, 'admin'), (v_ag, v_ws, 'agent'), (v_x, v_ws2, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id in (v_o, v_ad, v_ag);
  update profiles set conta_id = v_ws2, active_workspace_id = v_ws2 where id = v_x;
  update profiles set nome = 'Olga Dona' where id = v_o;
  update workspaces set name = 'Agência Teste', brand_color = '#123456', logo_url = 'https://cdn.example.com/logo.png' where id = v_ws;
  insert into clientes (user_id, conta_id, nome, sigla, cor, email) values (v_o, v_ws, 'Clínica A', 'CA', '#000', 'a@example.com') returning id into v_ca;
  insert into clientes (user_id, conta_id, nome, sigla, cor, email) values (v_x, v_ws2, 'Clínica X', 'CX', '#000', 'x@example.com') returning id into v_cx;
  return jsonb_build_object('ws', v_ws, 'ws2', v_ws2, 'o', v_o, 'ad', v_ad, 'ag', v_ag, 'x', v_x,
                            'ca', v_ca, 'cx', v_cx, 'tag', v_tag);
end $f$;
grant execute on all functions in schema pg_temp to authenticated, service_role;

-- ============ block 1: validation ============
do $$
declare
  f jsonb := pg_temp.fx();
  v_ws uuid := (f->>'ws')::uuid;
  v_o uuid := (f->>'o')::uuid; v_tag text := f->>'tag';
  v_oc bigint; v_err text; v_n int;
begin
  -- invalid e-mail / not an array / not an object
  v_err := pg_temp.erro(v_o, format('select public.agenda_evento_criar(%L::jsonb, %L::uuid[])', pg_temp.p(pg_temp.cv(array['sem-arroba'])), '{}'));
  assert v_err = 'P0001:agenda: informe e-mails válidos para os convidados.', format('invalid e-mail: %s', coalesce(v_err, 'succeeded'));
  v_err := pg_temp.erro(v_o, format('select public.agenda_evento_criar(%L::jsonb, %L::uuid[])', pg_temp.p('{"convidados":"a@b.com"}'), '{}'));
  assert v_err = 'P0001:agenda: informe e-mails válidos para os convidados.', format('non-array: %s', coalesce(v_err, 'succeeded'));
  v_err := pg_temp.erro(v_o, format('select public.agenda_evento_criar(%L::jsonb, %L::uuid[])', pg_temp.p('{"convidados":["a@b.com"]}'), '{}'));
  assert v_err = 'P0001:agenda: informe e-mails válidos para os convidados.', format('non-object entry: %s', coalesce(v_err, 'succeeded'));
  v_err := pg_temp.erro(v_o, format('select public.agenda_evento_criar(%L::jsonb, %L::uuid[])',
    pg_temp.p(pg_temp.cv(array[repeat('a', 250) || '@b.com'])), '{}'));
  assert v_err = 'P0001:agenda: informe e-mails válidos para os convidados.', format('255-char e-mail: %s', coalesce(v_err, 'succeeded'));
  -- 21 guests
  v_err := pg_temp.erro(v_o, format('select public.agenda_evento_criar(%L::jsonb, %L::uuid[])', pg_temp.p(pg_temp.cv(pg_temp.emails('v', 21))), '{}'));
  assert v_err = 'P0001:agenda: no máximo 20 convidados externos por evento.', format('21 guests: %s', coalesce(v_err, 'succeeded'));
  -- private with guests
  v_err := pg_temp.erro(v_o, format('select public.agenda_evento_criar(%L::jsonb, %L::uuid[])',
    pg_temp.p(pg_temp.cv(array['p@ext.com']) || '{"privado":true}'), '{}'));
  assert v_err = 'P0001:agenda: evento privado não pode ter convidados externos.', format('private + guests: %s', coalesce(v_err, 'succeeded'));
  -- private with an empty list: fine
  perform pg_temp.criar(v_o, pg_temp.p(pg_temp.cv('{}') || '{"privado":true}'));
  -- member e-mail, case-insensitive, with the lower-cased payload e-mail in the message
  v_err := pg_temp.erro(v_o, format('select public.agenda_evento_criar(%L::jsonb, %L::uuid[])',
    pg_temp.p(pg_temp.cv(array['ok@ext.com', 'AGENTE.' || v_tag || '@agencia.COM'])), '{}'));
  assert v_err = format('P0001:agenda: agente.%s@agencia.com já é da equipe. Adicione como participante.', v_tag),
    format('member e-mail: %s', coalesce(v_err, 'succeeded'));
  assert not exists (select 1 from agenda_convidados where conta_id = v_ws), 'a failed create left guest rows';
  -- duplicates collapse to one row (lower/trim), nome trimmed
  v_oc := pg_temp.criar(v_o, pg_temp.p(jsonb_build_object('convidados', jsonb_build_array(
    jsonb_build_object('email', 'Ana@Ext.com', 'nome', '  Ana  '), jsonb_build_object('email', ' ana@ext.com ', 'nome', null)))));
  select count(*) into v_n from agenda_convidados where evento_id = pg_temp.ev(v_oc);
  assert v_n = 1, format('duplicates: %s rows', v_n);
  assert (select email = 'ana@ext.com' and nome = 'Ana' and token ~ '^[0-9a-f]{64}$' and adicionado_por = v_o and removido_em is null
            from agenda_convidados where evento_id = pg_temp.ev(v_oc)), 'guest row content';
  -- making the series private with an active guest
  v_err := pg_temp.editar(v_o, v_oc, 'todas', '{"privado":true}');
  assert v_err = 'P0001:agenda: remova os convidados externos antes de tornar o evento privado.', format('make private: %s', coalesce(v_err, 'succeeded'));
  v_err := pg_temp.editar(v_o, v_oc, 'todas', pg_temp.cv(array['ana@ext.com']) || '{"privado":true}');
  assert v_err = 'P0001:agenda: remova os convidados externos antes de tornar o evento privado.', format('make private + keep: %s', coalesce(v_err, 'succeeded'));
  -- removing them in the same edit is allowed
  v_err := pg_temp.editar(v_o, v_oc, 'todas', pg_temp.cv('{}') || '{"privado":true}');
  assert v_err is null, format('make private + remove all: %s', v_err);
  assert (select privado from agenda_eventos where id = pg_temp.ev(v_oc)), 'not private';
  assert not exists (select 1 from agenda_convidados where evento_id = pg_temp.ev(v_oc) and removido_em is null), 'guest still active';
  -- already private: adding is refused
  v_err := pg_temp.editar(v_o, v_oc, 'todas', pg_temp.cv(array['ana@ext.com']));
  assert v_err = 'P0001:agenda: evento privado não pode ter convidados externos.', format('add to private: %s', coalesce(v_err, 'succeeded'));
  -- esta ignores the key
  v_oc := pg_temp.criar(v_o, pg_temp.diaria(5, 2));
  v_err := pg_temp.editar(v_o, v_oc, 'esta', pg_temp.cv(array['esta@ext.com']) || '{"titulo":"Só esta"}');
  assert v_err is null, format('esta with convidados: %s', v_err);
  assert not exists (select 1 from agenda_convidados where evento_id = pg_temp.ev(v_oc)), 'esta added a guest';

  raise notice 'PASS 99_agenda_convidados (validation)';
end $$;

-- ============ block 2: daily caps ============
do $$
declare
  f jsonb := pg_temp.fx();
  v_ws uuid := (f->>'ws')::uuid; v_ws2 uuid := (f->>'ws2')::uuid;
  v_o uuid := (f->>'o')::uuid; v_x uuid := (f->>'x')::uuid;
  v_e1 bigint; v_e2 bigint; v_e3 bigint; v_c2 bigint; v_x1 bigint; v_err text; v_n int;
  f2 jsonb; v_o2 uuid;
begin
  -- 50 distinct new e-mails in 24 h pass (20 + 20 + 10, the per-series cap is 20)
  v_e1 := pg_temp.criar(v_o, pg_temp.p(pg_temp.cv(pg_temp.emails('a', 20))));
  v_e2 := pg_temp.criar(v_o, pg_temp.p(pg_temp.cv(pg_temp.emails('b', 20))));
  v_e3 := pg_temp.criar(v_o, pg_temp.diaria(5, 3, pg_temp.cv(pg_temp.emails('c', 10))));
  select count(DISTINCT email) into v_n from agenda_convidados where conta_id = v_ws;
  assert v_n = 50, format('fixture: %s distinct', v_n);
  -- the 51st fails (create and edit alike)
  v_err := pg_temp.erro(v_o, format('select public.agenda_evento_criar(%L::jsonb, %L::uuid[])', pg_temp.p(pg_temp.cv(array['novo@ext.com'])), '{}'));
  assert v_err = 'P0001:agenda: limite diário de convites externos atingido. Tente amanhã.', format('51st on create: %s', coalesce(v_err, 'succeeded'));
  v_err := pg_temp.editar(v_o, v_e1, 'todas', pg_temp.cv(pg_temp.emails('a', 19) || array['novo@ext.com']));
  assert v_err = 'P0001:agenda: limite diário de convites externos atingido. Tente amanhã.', format('51st on edit: %s', coalesce(v_err, 'succeeded'));
  -- removal and re-add of the same e-mail on the same event does not count
  v_err := pg_temp.editar(v_o, v_e1, 'todas', pg_temp.cv(pg_temp.emails('a', 19)));
  assert v_err is null, format('remove: %s', v_err);
  v_err := pg_temp.editar(v_o, v_e1, 'todas', pg_temp.cv(pg_temp.emails('a', 20)));
  assert v_err is null, format('re-add: %s', v_err);
  select count(*) into v_n from agenda_convidados where evento_id = pg_temp.ev(v_e1) and email = 'a20@ext.com';
  assert v_n = 2, format('re-add rows: %s', v_n);
  assert (select count(DISTINCT token) from agenda_convidados where evento_id = pg_temp.ev(v_e1) and email = 'a20@ext.com') = 2,
    're-add reused the token';
  -- an e-mail of another event of the workspace is not new either
  v_err := pg_temp.editar(v_o, v_e2, 'todas', pg_temp.cv(pg_temp.emails('b', 19) || array['a1@ext.com']));
  assert v_err is null, format('e-mail already counted: %s', v_err);
  -- split copies do not count (the seguintes edit sends the same list)
  v_c2 := pg_temp.nth(v_e3, 2);
  v_err := pg_temp.editar(v_o, v_c2, 'seguintes', pg_temp.cv(pg_temp.emails('c', 10)) || '{"titulo":"Cauda"}');
  assert v_err is null, format('split with guests at the cap: %s', v_err);
  assert pg_temp.ev(v_c2) <> pg_temp.ev(v_e3), 'no split';
  assert (select count(*) from agenda_convidados where evento_id = pg_temp.ev(v_c2) and removido_em is null) = 10, 'tail guests';

  -- platform cap: 1000 rows of the last 24 h in another workspace
  v_x1 := pg_temp.criar(v_x, pg_temp.p());
  insert into agenda_convidados (conta_id, evento_id, email, token, criado_em)
  select v_ws2, pg_temp.ev(v_x1), 'plat' || g || '@ext.com', md5(g::text) || md5((g + 1)::text), now()
    from generate_series(1, 1000) g;
  f2 := pg_temp.fx(); v_o2 := (f2->>'o')::uuid;
  v_err := pg_temp.erro(v_o2, format('select public.agenda_evento_criar(%L::jsonb, %L::uuid[])', pg_temp.p(pg_temp.cv(array['um@ext.com'])), '{}'));
  assert v_err = 'P0001:agenda: limite diário de convites externos atingido. Tente amanhã.', format('platform cap: %s', coalesce(v_err, 'succeeded'));
  -- rows older than 24 h do not count
  update agenda_convidados set criado_em = now() - interval '25 hours' where evento_id = pg_temp.ev(v_x1);
  v_err := pg_temp.erro(v_o2, format('select public.agenda_evento_criar(%L::jsonb, %L::uuid[])', pg_temp.p(pg_temp.cv(array['um@ext.com'])), '{}'));
  assert v_err is null, format('platform cap with old rows: %s', v_err);
  delete from agenda_convidados where evento_id = pg_temp.ev(v_x1);

  raise notice 'PASS 99_agenda_convidados (caps)';
end $$;

-- ============ block 3: enqueue ============
do $$
declare
  f jsonb := pg_temp.fx();
  v_ws uuid := (f->>'ws')::uuid;
  v_o uuid := (f->>'o')::uuid;
  v_ca bigint := (f->>'ca')::bigint;
  v_oc bigint; v_ev bigint; v_ana bigint; v_bia bigint; v_r bigint;
  q agenda_emails_cliente; v jsonb; v_err text; v_n int;
begin
  -- create, shared, 2 guests: 1 client convite + 2 guest convites, one bump
  v_oc := pg_temp.criar(v_o, pg_temp.diaria(5, 2, jsonb_build_object('titulo', 'Gravação', 'cliente_id', v_ca, 'compartilhado_cliente', true)
    || jsonb_build_object('convidados', jsonb_build_array(jsonb_build_object('email', 'ana@ext.com', 'nome', 'Ana'),
                                                          jsonb_build_object('email', 'bia@ext.com', 'nome', null)))));
  v_ev := pg_temp.ev(v_oc);
  v_ana := (pg_temp.g(v_oc, 'ana@ext.com')).id; v_bia := (pg_temp.g(v_oc, 'bia@ext.com')).id;
  select count(*) into v_n from pg_temp.pend(v_ev) where cliente_id = v_ca and tipo = 'convite' and convidado_id is null;
  assert v_n = 1, format('client convites: %s', v_n);
  select count(*) into v_n from pg_temp.pend(v_ev) where convidado_id is not null and tipo = 'convite' and cliente_id is null;
  assert v_n = 2, format('guest convites: %s', v_n);
  select * into q from pg_temp.pend(v_ev) where convidado_id = v_ana;
  assert q.convidado_email = 'ana@ext.com' and q.remarcacao is null and q.versao = 1
     and pg_temp.snap_ids(q.ocorrencias) = array[v_oc, pg_temp.nth(v_oc, 2)]
     and (q.ocorrencias->0->>'sequencia')::int = 1 and q.ocorrencias->0->>'estado' = 'ativa', format('guest convite: %s', to_jsonb(q));
  assert (select bool_and(sequencia = 1) from agenda_ocorrencias where evento_id = v_ev), 'create did not bump exactly once';
  assert (select count(*) from audit_log where conta_id = v_ws and action = 'agenda_convidado_adicionado'
            and resource_type = 'agenda_evento' and resource_id = v_ev::text and actor_user_id = v_o) = 2, 'audit of the adds';
  assert exists (select 1 from audit_log where action = 'agenda_convidado_adicionado' and resource_id = v_ev::text
                   and metadata->>'email' = 'ana@ext.com'), 'audit metadata';

  -- edit todas title: one alteracao per recipient, sequencia 2
  update agenda_emails_cliente set status = 'enviado' where evento_id = v_ev;
  v_err := pg_temp.editar(v_o, v_oc, 'todas', '{"titulo":"Gravação nova"}');
  assert v_err is null, format('editar todas: %s', v_err);
  select count(*) into v_n from pg_temp.pend(v_ev) where tipo = 'alteracao';
  assert v_n = 3, format('alteracao items: %s', v_n);
  assert (select count(*) from pg_temp.pend(v_ev)) = 3, 'other items queued';
  assert (select bool_and(sequencia = 2) from agenda_ocorrencias where evento_id = v_ev), 'todas did not bump exactly once';
  select * into q from pg_temp.pend(v_ev) where convidado_id = v_bia;
  assert q.ocorrencias->0->>'titulo' = 'Gravação nova' and (q.ocorrencias->0->>'sequencia')::int = 2
     and jsonb_array_length(q.ocorrencias) = 2, format('guest alteracao: %s', to_jsonb(q));
  -- nothing the recipients see: no item, no bump
  update agenda_emails_cliente set status = 'enviado' where evento_id = v_ev;
  v_err := pg_temp.editar(v_o, v_oc, 'todas', '{"cor":"rosa"}');
  assert v_err is null and not exists (select 1 from pg_temp.pend(v_ev)), 'a colour change was enqueued';
  assert (select bool_and(sequencia = 2) from agenda_ocorrencias where evento_id = v_ev), 'a colour change bumped';
  -- esta: the guests hear about it too
  v_err := pg_temp.editar(v_o, pg_temp.nth(v_oc, 2), 'esta', '{"local":"Estúdio 2"}');
  assert v_err is null, format('editar esta: %s', v_err);
  assert (select count(*) from pg_temp.pend(v_ev) where tipo = 'alteracao' and pg_temp.snap_ids(ocorrencias) = array[pg_temp.nth(v_oc, 2)]) = 3,
    'esta: one alteracao per recipient';
  assert (select sequencia from agenda_ocorrencias where id = pg_temp.nth(v_oc, 2)) = 3
     and (select sequencia from agenda_ocorrencias where id = v_oc) = 2, 'esta bump';

  -- remove a guest: cancelamento with the future snapshot, removido_em set
  update agenda_emails_cliente set status = 'enviado' where evento_id = v_ev;
  v_err := pg_temp.editar(v_o, v_oc, 'todas', jsonb_build_object('convidados', jsonb_build_array(jsonb_build_object('email', 'ana@ext.com', 'nome', 'Ana'))));
  assert v_err is null, format('remove guest: %s', v_err);
  assert (select removido_em = now() from agenda_convidados where id = v_bia), 'removido_em not set';
  assert (select removido_em is null from agenda_convidados where id = v_ana), 'kept guest removed';
  select count(*) into v_n from pg_temp.pend(v_ev);
  assert v_n = 1, format('remove enqueued %s items', v_n);
  select * into q from pg_temp.pend(v_ev);
  assert q.convidado_id = v_bia and q.tipo = 'cancelamento' and jsonb_array_length(q.ocorrencias) = 2
     and (select bool_and(x->>'estado' = 'cancelada' and x->>'titulo' = 'Gravação nova') from jsonb_array_elements(q.ocorrencias) x),
    format('removal cancelamento: %s', to_jsonb(q));
  assert exists (select 1 from audit_log where action = 'agenda_convidado_removido' and resource_id = v_ev::text
                   and metadata->>'email' = 'bia@ext.com' and actor_user_id = v_o), 'audit of the removal';

  -- excluir todas: cancelamento per active guest (and the client), surviving the DELETE
  update agenda_emails_cliente set status = 'enviado' where evento_id = v_ev;
  v_err := pg_temp.erro(v_o, format('select public.agenda_evento_excluir(%s, %L)', v_oc, 'todas'));
  assert v_err is null, format('excluir todas: %s', v_err);
  assert not exists (select 1 from agenda_eventos where id = v_ev) and not exists (select 1 from agenda_convidados where evento_id = v_ev),
    'the series or its guests survived';
  select * into q from pg_temp.pend(v_ev) where convidado_id = v_ana;
  assert q.tipo = 'cancelamento' and q.convidado_email = 'ana@ext.com' and jsonb_array_length(q.ocorrencias) = 2
     and (select bool_and(x->>'estado' = 'cancelada') from jsonb_array_elements(q.ocorrencias) x), format('delete cancelamento: %s', to_jsonb(q));
  assert exists (select 1 from pg_temp.pend(v_ev) where cliente_id = v_ca and tipo = 'cancelamento'), 'no client cancelamento';
  assert not exists (select 1 from pg_temp.pend(v_ev) where convidado_id = v_bia), 'removed guest got the delete';

  -- not shared, guests only: convite with sequencia 1
  v_oc := pg_temp.criar(v_o, pg_temp.p(pg_temp.cv(array['so@ext.com'])));
  assert (select sequencia from agenda_ocorrencias where id = v_oc) = 1, 'guest-only create did not bump';
  assert (select count(*) from pg_temp.pend(pg_temp.ev(v_oc))) = 1, 'guest-only create items';

  -- accepted reschedule on a shared series with a guest
  v_oc := pg_temp.criar(v_o, pg_temp.p(jsonb_build_object('cliente_id', v_ca, 'compartilhado_cliente', true) || pg_temp.cv(array['caio@ext.com'])));
  v_ev := pg_temp.ev(v_oc);
  update agenda_emails_cliente set status = 'enviado' where evento_id = v_ev;
  v := pg_temp.remarcar(v_ws, v_ca, v_oc, current_date + 9, '10:00', 'Outro dia');
  v_r := (v->'remarcacao'->>'id')::bigint;
  assert v_r is not null, format('remarcar: %s', v);
  v_err := pg_temp.erro(v_o, format('select public.agenda_remarcacao_resolver(%s, true)', v_r));
  assert v_err is null, format('aceitar: %s', v_err);
  select * into q from pg_temp.pend(v_ev) where convidado_id is not null;
  assert q.tipo = 'alteracao' and q.remarcacao is null and pg_temp.snap_ids(q.ocorrencias) = array[v_oc]
     and (q.ocorrencias->0->>'inicio')::timestamptz = pg_temp.ts(9, '10:00:00'), format('guest item after aceitar: %s', to_jsonb(q));
  select * into q from pg_temp.pend(v_ev) where cliente_id = v_ca;
  assert q.tipo = 'remarcacao_aceita' and (q.remarcacao->>'remarcacao_id')::bigint = v_r and q.remarcacao->>'mensagem' = 'Outro dia',
    format('client item after aceitar: %s', to_jsonb(q));
  assert (select sequencia from agenda_ocorrencias where id = v_oc) = 2, 'aceitar bumped more than once';

  raise notice 'PASS 99_agenda_convidados (enqueue)';
end $$;

-- ============ block 4: seguintes split ============
do $$
declare
  f jsonb := pg_temp.fx();
  v_o uuid := (f->>'o')::uuid;
  v_oc bigint; v_ev bigint; v_o2 bigint; v_o3 bigint; v_alvo bigint;
  v_head agenda_convidados; v_tail agenda_convidados;
  v jsonb; v_err text; v_n int; q agenda_emails_cliente;
begin
  v_oc := pg_temp.criar(v_o, pg_temp.diaria(5, 4, jsonb_build_object('titulo', 'Série')
    || jsonb_build_object('convidados', jsonb_build_array(jsonb_build_object('email', 'carla@ext.com', 'nome', 'Carla')))));
  v_ev := pg_temp.ev(v_oc); v_o2 := pg_temp.nth(v_oc, 2); v_o3 := pg_temp.nth(v_oc, 3);
  v_head := pg_temp.g(v_oc, 'carla@ext.com');
  v := pg_temp.c_resp(v_head.token, v_o3, 'sim', pg_temp.ini(v_o3));
  assert v->>'resposta' = 'sim', format('responder: %s', v);
  update agenda_emails_cliente set status = 'enviado' where evento_id = v_ev;

  v_err := pg_temp.editar(v_o, v_o2, 'seguintes', '{"titulo":"Cauda"}');
  assert v_err is null, format('split: %s', v_err);
  v_alvo := pg_temp.ev(v_o2);
  assert v_alvo <> v_ev and pg_temp.ev(v_o3) = v_alvo, 'no split';
  v_tail := pg_temp.g(v_o2, 'carla@ext.com');
  assert v_tail.id is not null and v_tail.id <> v_head.id and v_tail.token = v_head.token and v_tail.nome = 'Carla'
     and v_tail.criado_em = v_head.criado_em and v_tail.adicionado_por is not distinct from v_head.adicionado_por,
    format('tail guest: %s', to_jsonb(v_tail));
  assert (select removido_em is null from agenda_convidados where id = v_head.id), 'head guest removed by the split';
  assert (select convidado_id from agenda_respostas_convidado where ocorrencia_id = v_o3) = v_tail.id, 'answer not re-pointed';
  -- exactly one guest alteracao, under the tail
  select count(*) into v_n from agenda_emails_cliente where status = 'pendente' and convidado_id in (v_head.id, v_tail.id);
  assert v_n = 1, format('guest items after the split: %s', v_n);
  select * into q from agenda_emails_cliente where status = 'pendente' and convidado_id = v_tail.id;
  assert q.tipo = 'alteracao' and q.evento_id = v_alvo and pg_temp.snap_ids(q.ocorrencias) = array[v_o2, v_o3, pg_temp.nth(v_o2, 3)]
     and q.ocorrencias->0->>'titulo' = 'Cauda', format('split item: %s', to_jsonb(q));
  -- the token lists head and tail, the answer still reads sim
  v := pg_temp.ler(v_head.token);
  assert v->>'estado' = 'ok' and pg_temp.ids(v) = array[v_oc, v_o2, v_o3, pg_temp.nth(v_o2, 3)], format('ler after split: %s', v);
  assert (select x->>'resposta' from jsonb_array_elements(v->'itens') x where (x->>'ocorrencia_id')::bigint = v_o3) = 'sim',
    format('answer after split: %s', v);
  assert (select x->>'titulo' from jsonb_array_elements(v->'itens') x where (x->>'ocorrencia_id')::bigint = v_oc) = 'Série'
     and (select x->>'titulo' from jsonb_array_elements(v->'itens') x where (x->>'ocorrencia_id')::bigint = v_o2) = 'Cauda', 'titles per series';
  assert (v->>'convidado_id')::bigint = v_tail.id, format('envelope convidado_id: %s', v->>'convidado_id');
  -- removing the guest on the tail keeps the head
  update agenda_emails_cliente set status = 'enviado' where evento_id in (v_ev, v_alvo);
  v_err := pg_temp.editar(v_o, v_o2, 'todas', pg_temp.cv('{}'));
  assert v_err is null, format('remove on tail: %s', v_err);
  assert (select removido_em is not null from agenda_convidados where id = v_tail.id)
     and (select removido_em is null from agenda_convidados where id = v_head.id), 'tail removal';
  assert pg_temp.ids(pg_temp.ler(v_head.token)) = array[v_oc], 'ler after the tail removal';

  raise notice 'PASS 99_agenda_convidados (split)';
end $$;

-- ============ block 5: claim ============
do $$
declare
  f jsonb := pg_temp.fx();
  v_ws uuid := (f->>'ws')::uuid;
  v_o uuid := (f->>'o')::uuid; v_tag text := f->>'tag';
  v_ca bigint := (f->>'ca')::bigint;
  v_t1 bigint; v_t2 bigint; v_t3 bigint; v_t4 bigint; v_t5 bigint;
  v_dora agenda_convidados; v_eva agenda_convidados; v_gil agenda_convidados;
  v jsonb; v_it jsonb; v_err text; q agenda_emails_cliente;
begin
  update agenda_emails_cliente set status = 'enviado' where status = 'pendente';
  -- shared, with a guest
  v_t1 := pg_temp.criar(v_o, pg_temp.p(jsonb_build_object('titulo', 'Para todos', 'cliente_id', v_ca, 'compartilhado_cliente', true)
    || jsonb_build_object('convidados', jsonb_build_array(jsonb_build_object('email', 'dora@ext.com', 'nome', 'Dora')))));
  v_dora := pg_temp.g(v_t1, 'dora@ext.com');
  -- a removed guest
  v_t2 := pg_temp.criar(v_o, pg_temp.p(pg_temp.cv(array['eva@ext.com'])));
  v_eva := pg_temp.g(v_t2, 'eva@ext.com');
  update agenda_emails_cliente set status = 'enviado' where evento_id = pg_temp.ev(v_t2);
  v_err := pg_temp.editar(v_o, v_t2, 'todas', pg_temp.cv('{}'));
  assert v_err is null, format('remove eva: %s', v_err);
  -- blocklisted
  v_t3 := pg_temp.criar(v_o, pg_temp.p(pg_temp.cv(array['fabi@ext.com'])));
  insert into agenda_convidados_bloqueio (conta_id, email) values (v_ws, 'fabi@ext.com');
  -- the series of a guest is deleted after the send
  v_t5 := pg_temp.criar(v_o, pg_temp.p(pg_temp.cv(array['hilda@ext.com'])));
  update agenda_emails_cliente set status = 'enviado' where evento_id = pg_temp.ev(v_t5);
  v_err := pg_temp.erro(v_o, format('select public.agenda_evento_excluir(%s, %L)', v_t5, 'todas'));
  assert v_err is null, format('excluir t5: %s', v_err);

  update agenda_emails_cliente set enviar_apos = now() - interval '1 second' where conta_id = v_ws and status = 'pendente';
  v := pg_temp.svc('select public.agenda_cliente_claim_emails(100)');
  assert jsonb_typeof(v) = 'array', format('claim: %s', v);

  -- the guest item comes back
  select x into v_it from jsonb_array_elements(v) x where (x->>'convidado_id')::bigint = v_dora.id;
  assert v_it is not null, format('guest item not returned: %s', v);
  assert v_it->>'destinatario' = 'convidado' and v_it->>'email' = 'dora@ext.com' and v_it->>'nome' = 'Dora'
     and v_it->>'convidado_token' = v_dora.token and v_it->>'organizador_email' = 'olga.' || v_tag || '@agencia.com'
     and v_it->>'organizador_nome' = 'Olga Dona' and v_it->'cliente_id' = 'null'::jsonb
     and v_it->'cliente_email' = 'null'::jsonb and v_it->'cliente_nome' = 'null'::jsonb
     and v_it->>'tipo' = 'convite' and v_it->>'workspace_nome' = 'Agência Teste' and v_it->>'brand_color' = '#123456'
     and jsonb_array_length(v_it->'ocorrencias') = 1, format('guest payload: %s', v_it);
  assert (select status from agenda_emails_cliente where id = (v_it->>'id')::bigint) = 'enviando', 'guest item not claimed';
  -- the client item keeps its keys
  select x into v_it from jsonb_array_elements(v) x where (x->>'cliente_id')::bigint = v_ca and (x->>'evento_id')::bigint = pg_temp.ev(v_t1);
  assert v_it->>'destinatario' = 'cliente' and v_it->>'cliente_email' = 'a@example.com' and v_it->>'email' = 'a@example.com'
     and v_it->>'cliente_nome' = 'Clínica A' and v_it->>'nome' = 'Clínica A' and v_it->'convidado_id' = 'null'::jsonb
     and v_it->'convidado_token' = 'null'::jsonb and v_it->>'organizador_email' = 'olga.' || v_tag || '@agencia.com',
    format('client payload: %s', v_it);
  -- the removed guest's cancelamento is returned, without a token
  select x into v_it from jsonb_array_elements(v) x where (x->>'convidado_id')::bigint = v_eva.id;
  assert v_it->>'tipo' = 'cancelamento' and v_it->'convidado_token' = 'null'::jsonb and v_it->>'email' = 'eva@ext.com',
    format('removed guest item: %s', coalesce(v_it::text, 'not returned'));
  -- a deleted series: returned, no token, no organizer
  select x into v_it from jsonb_array_elements(v) x where x->>'email' = 'hilda@ext.com';
  assert v_it->>'tipo' = 'cancelamento' and v_it->'convidado_token' = 'null'::jsonb and v_it->'organizador_email' = 'null'::jsonb
     and v_it->'nome' = 'null'::jsonb, format('deleted series item: %s', coalesce(v_it::text, 'not returned'));
  -- blocklisted: discarded
  select * into q from agenda_emails_cliente where evento_id = pg_temp.ev(v_t3);
  assert q.status = 'descartado', format('blocklisted: %s', q.status);
  -- organizer no longer a member: no organizer e-mail
  v_t4 := pg_temp.criar(v_o, pg_temp.p(pg_temp.cv(array['iris@ext.com'])));
  update agenda_emails_cliente set enviar_apos = now() - interval '1 second' where evento_id = pg_temp.ev(v_t4);
  delete from workspace_members where user_id = v_o and workspace_id = v_ws;
  v := pg_temp.svc('select public.agenda_cliente_claim_emails(100)');
  select x into v_it from jsonb_array_elements(v) x where x->>'email' = 'iris@ext.com';
  assert v_it->'organizador_email' = 'null'::jsonb and v_it->>'organizador_nome' = 'Olga Dona', format('former member: %s', v_it);
  insert into workspace_members (user_id, workspace_id, role) values (v_o, v_ws, 'owner');
  -- flag off: discarded
  v_t4 := pg_temp.criar(v_o, pg_temp.p(pg_temp.cv(array['gil@ext.com'])));
  v_gil := pg_temp.g(v_t4, 'gil@ext.com');
  update agenda_emails_cliente set enviar_apos = now() - interval '1 second' where evento_id = pg_temp.ev(v_t4);
  update plans set feature_agenda = false;
  perform pg_temp.svc('select public.agenda_cliente_claim_emails(100)');
  update plans set feature_agenda = true;
  assert (select status from agenda_emails_cliente where convidado_id = v_gil.id) = 'descartado', 'flag off not discarded';
  -- a guest removed before the send of its convite: discarded
  v_t4 := pg_temp.criar(v_o, pg_temp.p(pg_temp.cv(array['jo@ext.com'])));
  update agenda_convidados set removido_em = now() where evento_id = pg_temp.ev(v_t4);
  update agenda_emails_cliente set enviar_apos = now() - interval '1 second' where evento_id = pg_temp.ev(v_t4);
  perform pg_temp.svc('select public.agenda_cliente_claim_emails(100)');
  assert (select status from agenda_emails_cliente where evento_id = pg_temp.ev(v_t4)) = 'descartado', 'removed guest convite not discarded';
  -- the queue CHECKs
  begin
    insert into agenda_emails_cliente (conta_id, cliente_id, convidado_id, convidado_email, evento_id, tipo)
      values (v_ws, v_ca, 1, 'x@ext.com', 1, 'convite');
    assert false, 'both recipients accepted';
  exception when check_violation then null; end;
  begin
    insert into agenda_emails_cliente (conta_id, convidado_id, evento_id, tipo) values (v_ws, 1, 1, 'convite');
    assert false, 'guest without e-mail accepted';
  exception when check_violation then null; end;
  begin
    insert into agenda_emails_cliente (conta_id, convidado_id, convidado_email, evento_id, tipo)
      values (v_ws, 1, 'x@ext.com', 1, 'remarcacao_aceita');
    assert false, 'guest remarcacao accepted';
  exception when check_violation then null; end;

  raise notice 'PASS 99_agenda_convidados (claim)';
end $$;

-- ============ block 6: convite RPCs ============
do $$
declare
  f jsonb := pg_temp.fx();
  v_ws uuid := (f->>'ws')::uuid;
  v_o uuid := (f->>'o')::uuid; v_x uuid := (f->>'x')::uuid;
  v_oc bigint; v_ev bigint; v_old bigint; v_x1 bigint;
  v_hugo agenda_convidados; v_velho agenda_convidados;
  v jsonb; v_it jsonb; v_err text; v_n int; v_meta jsonb; v_link text;
begin
  v_oc := pg_temp.criar(v_o, pg_temp.p(jsonb_build_object('titulo', 'Reunião', 'local', 'Sala 1', 'link_reuniao', 'https://meet.example.com/r')
    || jsonb_build_object('convidados', jsonb_build_array(jsonb_build_object('email', 'hugo@ext.com', 'nome', 'Hugo')))));
  v_ev := pg_temp.ev(v_oc);
  v_hugo := pg_temp.g(v_oc, 'hugo@ext.com');
  -- unknown token
  v := pg_temp.ler(repeat('0', 64));
  assert v->>'estado' = 'nao_encontrado', format('unknown token: %s', v);
  assert pg_temp.svc(format('select public.agenda_convite_resolver(%L)', repeat('0', 64))) is null, 'resolver of an unknown token';
  v := pg_temp.svc(format('select public.agenda_convite_resolver(%L)', v_hugo.token));
  assert (v->>'convidado_id')::bigint = v_hugo.id and (v->>'conta_id')::uuid = v_ws, format('resolver: %s', v);
  -- read
  v := pg_temp.ler(v_hugo.token);
  assert (select array_agg(k order by k) from jsonb_object_keys(v) k)
       = array['conta_id','convidado_id','estado','itens','organizador_nome','titulo','workspace'], format('envelope keys: %s', v);
  assert v->>'estado' = 'ok' and (v->>'convidado_id')::bigint = v_hugo.id and (v->>'conta_id')::uuid = v_ws
     and v->'workspace' = jsonb_build_object('nome', 'Agência Teste', 'brand_color', '#123456', 'logo_url', 'https://cdn.example.com/logo.png')
     and v->>'organizador_nome' = 'Olga Dona' and v->>'titulo' = 'Reunião' and pg_temp.ids(v) = array[v_oc], format('ler: %s', v);
  v_it := v->'itens'->0;
  assert (select array_agg(k order by k) from jsonb_object_keys(v_it) k)
       = array['data_fim_local','data_inicio_local','descricao','dia_inteiro','fim','inicio','link_reuniao','local',
               'ocorrencia_id','resposta','sequencia','titulo','tz'], format('item keys: %s', v_it);
  assert v_it->>'local' = 'Sala 1' and v_it->>'link_reuniao' = 'https://meet.example.com/r' and v_it->'resposta' = 'null'::jsonb
     and (v_it->>'inicio')::timestamptz = pg_temp.ts(5) and (v_it->>'sequencia')::int = 1
     and v_it->>'data_inicio_local' = to_char(current_date + 5, 'YYYY-MM-DD'), format('item: %s', v_it);
  -- one occurrence (.ics)
  assert (pg_temp.c_oc(v_hugo.token, v_oc)->>'ocorrencia_id')::bigint = v_oc, 'convite_ocorrencia';
  v_x1 := pg_temp.criar(v_x, pg_temp.p());
  assert pg_temp.c_oc(v_hugo.token, v_x1) is null, 'convite_ocorrencia of another series';
  -- answer
  v := pg_temp.c_resp(v_hugo.token, v_oc, 'sim', pg_temp.ini(v_oc));
  assert v->>'resposta' = 'sim' and (v->>'ocorrencia_id')::bigint = v_oc, format('responder: %s', v);
  assert (select resposta = 'sim' and conta_id = v_ws and inicio_respondido = pg_temp.ini(v_oc)
            from agenda_respostas_convidado where ocorrencia_id = v_oc and convidado_id = v_hugo.id), 'answer row';
  select count(*) into v_n from notifications where type = 'event_guest_rsvp' and user_id = v_o;
  assert v_n = 1, format('rsvp notifications: %s', v_n);
  select metadata, link into v_meta, v_link from notifications where type = 'event_guest_rsvp' and user_id = v_o;
  assert v_link = '/calendario?evento=' || v_oc and v_meta->>'convidado_nome' = 'Hugo' and v_meta->>'convidado_email' = 'hugo@ext.com'
     and v_meta->>'resposta' = 'sim' and v_meta->>'data_inicio_local' = to_char(current_date + 5, 'YYYY-MM-DD')
     and v_meta->>'titulo' = 'Reunião' and (v_meta->>'ocorrencia_id')::bigint = v_oc, format('rsvp metadata: %s %s', v_meta, v_link);
  -- same answer again: one notification
  v := pg_temp.c_resp(v_hugo.token, v_oc, 'sim', pg_temp.ini(v_oc));
  select count(*) into v_n from notifications where type = 'event_guest_rsvp' and user_id = v_o;
  assert v_n = 1, format('same answer twice: %s', v_n);
  -- invalid answer
  v := pg_temp.c_resp(v_hugo.token, v_oc, 'talvez', pg_temp.ini(v_oc));
  assert v->>'erro' like '22023:%', format('invalid answer: %s', v);
  -- stale inicio_visto
  v := pg_temp.c_resp(v_hugo.token, v_oc, 'nao', pg_temp.ini(v_oc) + interval '1 hour');
  assert v->>'erro' = 'P0001:agenda_convite:horario_mudou', format('horario_mudou: %s', v);
  -- the team moves the event: the answer is no longer effective
  v_err := pg_temp.editar(v_o, v_oc, 'todas', jsonb_build_object('inicio_local', pg_temp.dia(5, '16:00:00'), 'fim_local', pg_temp.dia(5, '17:00:00')));
  assert v_err is null, format('move: %s', v_err);
  assert pg_temp.ler(v_hugo.token)->'itens'->0->'resposta' = 'null'::jsonb, 'answer survived the move';
  -- unknown occurrence / another workspace's occurrence
  v := pg_temp.c_resp(v_hugo.token, v_x1, 'sim', pg_temp.ini(v_x1));
  assert v->>'erro' = 'P0001:agenda_convite:nao_encontrado', format('foreign occurrence: %s', v);
  v := pg_temp.c_resp(repeat('a', 64), v_oc, 'sim', pg_temp.ini(v_oc));
  assert v->>'erro' = 'P0001:agenda_convite:nao_encontrado', format('unknown token on responder: %s', v);
  -- ended
  v_old := pg_temp.criar(v_o, pg_temp.p(jsonb_build_object('inicio_local', pg_temp.dia(-2), 'fim_local', pg_temp.dia(-2, '15:00:00'))
    || pg_temp.cv(array['velho@ext.com'])));
  v_velho := pg_temp.g(v_old, 'velho@ext.com');
  v := pg_temp.c_resp(v_velho.token, v_old, 'sim', pg_temp.ini(v_old));
  assert v->>'erro' = 'P0001:agenda_convite:ja_aconteceu', format('ja_aconteceu: %s', v);
  assert pg_temp.ids(pg_temp.ler(v_velho.token)) = array[v_old], 'a recent past occurrence is listed';
  -- flag off
  update plans set feature_agenda = false;
  v := pg_temp.ler(v_hugo.token);
  assert v->>'estado' = 'nao_encontrado', format('flag off ler: %s', v);
  v := pg_temp.c_resp(v_hugo.token, v_oc, 'nao', pg_temp.ini(v_oc));
  assert v->>'erro' = 'P0001:agenda_convite:desligado', format('flag off responder: %s', v);
  assert pg_temp.c_oc(v_hugo.token, v_oc) is null, 'flag off ocorrencia';
  update plans set feature_agenda = true;
  -- unsubscribe
  perform pg_temp.svc(format('select ''{}''::jsonb from public.agenda_convite_descadastrar(%s)', v_hugo.id));
  perform pg_temp.svc(format('select ''{}''::jsonb from public.agenda_convite_descadastrar(%s)', v_hugo.id));
  assert (select count(*) from agenda_convidados_bloqueio where conta_id = v_ws and email = 'hugo@ext.com') = 1, 'blocklist row';
  -- the page keeps working after the unsubscribe
  assert pg_temp.ler(v_hugo.token)->>'estado' = 'ok', 'unsubscribe closed the page';
  -- removed guest
  v_err := pg_temp.editar(v_o, v_oc, 'todas', pg_temp.cv('{}'));
  assert v_err is null, format('remove hugo: %s', v_err);
  assert pg_temp.ler(v_hugo.token)->>'estado' = 'nao_encontrado', 'removed guest still reads';
  assert pg_temp.svc(format('select public.agenda_convite_resolver(%L)', v_hugo.token)) is null, 'resolver of a removed guest';
  v := pg_temp.c_resp(v_hugo.token, v_oc, 'sim', pg_temp.ini(v_oc));
  assert v->>'erro' = 'P0001:agenda_convite:nao_encontrado', format('removed guest responder: %s', v);
  -- removed and re-added: new token, the old link stays unavailable
  v_err := pg_temp.editar(v_o, v_oc, 'todas', pg_temp.cv(array['hugo@ext.com']));
  assert v_err is null, format('re-add hugo: %s', v_err);
  assert (pg_temp.g(v_oc, 'hugo@ext.com')).token <> v_hugo.token, 're-add kept the token';
  assert pg_temp.ler(v_hugo.token)->>'estado' = 'nao_encontrado', 'old token works after re-add';

  raise notice 'PASS 99_agenda_convidados (convite RPCs)';
end $$;

-- ============ block 7: agenda_listar.convidados ============
do $$
declare
  f jsonb := pg_temp.fx();
  v_o uuid := (f->>'o')::uuid; v_ad uuid := (f->>'ad')::uuid;
  v_oc bigint; v_vazio bigint; v_priv bigint;
  v_ivo agenda_convidados; v_jon agenda_convidados;
  v jsonb;
begin
  v_oc := pg_temp.criar(v_o, pg_temp.p(jsonb_build_object('convidados', jsonb_build_array(
    jsonb_build_object('email', 'ivo@ext.com', 'nome', 'Ivo'), jsonb_build_object('email', 'jon@ext.com', 'nome', null)))));
  v_ivo := pg_temp.g(v_oc, 'ivo@ext.com'); v_jon := pg_temp.g(v_oc, 'jon@ext.com');
  perform pg_temp.c_resp(v_ivo.token, v_oc, 'nao', pg_temp.ini(v_oc));
  v := pg_temp.como(v_o, format('select to_jsonb(l) from public.agenda_listar(null, null, %s) l', v_oc));
  assert v->'convidados' = jsonb_build_array(
    jsonb_build_object('id', v_ivo.id, 'email', 'ivo@ext.com', 'nome', 'Ivo', 'resposta', 'nao'),
    jsonb_build_object('id', v_jon.id, 'email', 'jon@ext.com', 'nome', null, 'resposta', null)), format('convidados: %s', v->'convidados');
  -- none
  v_vazio := pg_temp.criar(v_o, pg_temp.p());
  v := pg_temp.como(v_o, format('select to_jsonb(l) from public.agenda_listar(null, null, %s) l', v_vazio));
  assert v->'convidados' = '[]'::jsonb, format('no guests: %s', v->'convidados');
  -- masked private event of another member
  v_priv := pg_temp.criar(v_ad, pg_temp.p('{"privado":true}'));
  v := pg_temp.como(v_o, format('select to_jsonb(l) from public.agenda_listar(null, null, %s) l', v_priv));
  assert v->'mascarado' = 'true'::jsonb and v->'convidados' = 'null'::jsonb, format('masked: %s', v);
  -- column order: convidados appended last
  assert (select proargnames[cardinality(proargnames)] from pg_proc
           where oid = 'public.agenda_listar(timestamptz, timestamptz, bigint)'::regprocedure) = 'convidados',
    'convidados is not the last column';

  raise notice 'PASS 99_agenda_convidados (agenda_listar)';
end $$;

-- ============ block 8: concurrency lock ============
do $$
begin
  assert pg_get_functiondef('public.agenda_definir_convidados'::regproc) like '%pg_advisory_xact_lock%', 'no advisory lock';
  assert pg_get_functiondef('public.agenda_definir_convidados'::regproc) like '%agenda-convidados:plataforma%', 'no platform lock';
  raise notice 'PASS 99_agenda_convidados (lock)';
end $$;

-- ============ block 9: grants ============
do $$
declare
  v_fn text; v_t text;
begin
  foreach v_fn in array array[
    'public.agenda_convite_resolver(text)',
    'public.agenda_convite_ler(text)',
    'public.agenda_convite_ocorrencia(text, bigint)',
    'public.agenda_convite_responder(text, bigint, text, timestamptz)',
    'public.agenda_convite_descadastrar(bigint)',
    'public.agenda_convite_item(bigint, bigint)',
    'public.agenda_definir_convidados(bigint, jsonb)',
    'public.agenda_ocorrencias_bump_sequencia(bigint[])',
    'public.agenda_envios_enfileirar(uuid, bigint, jsonb)',
    'public.agenda_envios_convidados(bigint[], text, jsonb)',
    'public.agenda_convidados_perda(bigint, bigint[])',
    'public.agenda_cliente_enfileirar(uuid, bigint, bigint, text, jsonb, jsonb, bigint)',
    'public.agenda_cliente_claim_emails(int)'] loop
    assert to_regprocedure(v_fn) is not null, format('%s does not exist', v_fn);
    assert not has_function_privilege('anon', v_fn, 'EXECUTE'), format('anon executes %s', v_fn);
    assert not has_function_privilege('authenticated', v_fn, 'EXECUTE'), format('authenticated executes %s', v_fn);
    assert has_function_privilege('service_role', v_fn, 'EXECUTE'), format('service_role lacks %s', v_fn);
  end loop;
  assert to_regprocedure('public.agenda_cliente_enfileirar(uuid, bigint, bigint, text, jsonb, jsonb)') is null, 'the 6-arg enfileirar survived';
  foreach v_fn in array array['public.agenda_listar(timestamptz, timestamptz, bigint)',
                              'public.agenda_evento_criar(jsonb, uuid[])',
                              'public.agenda_evento_editar(bigint, text, jsonb, uuid[])',
                              'public.agenda_evento_excluir(bigint, text)'] loop
    assert has_function_privilege('authenticated', v_fn, 'EXECUTE'), format('authenticated lacks %s', v_fn);
    assert has_function_privilege('service_role', v_fn, 'EXECUTE'), format('service_role lacks %s', v_fn);
    assert not has_function_privilege('anon', v_fn, 'EXECUTE'), format('anon executes %s', v_fn);
  end loop;
  foreach v_t in array array['public.agenda_convidados', 'public.agenda_respostas_convidado', 'public.agenda_convidados_bloqueio'] loop
    assert (select relrowsecurity from pg_class where oid = v_t::regclass), format('%s has RLS off', v_t);
    assert not has_table_privilege('anon', v_t, 'SELECT'), format('anon selects %s', v_t);
    assert not has_table_privilege('authenticated', v_t, 'SELECT'), format('authenticated selects %s', v_t);
    assert not has_table_privilege('authenticated', v_t, 'INSERT'), format('authenticated inserts %s', v_t);
    assert has_table_privilege('service_role', v_t, 'SELECT'), format('service_role cannot select %s', v_t);
    assert has_table_privilege('service_role', v_t, 'INSERT'), format('service_role cannot insert %s', v_t);
  end loop;

  raise notice 'PASS 99_agenda_convidados (grants)';
end $$;

-- ============ block 10: guest loss while an item is still pending ============
-- Unlike the blocks above, the pending items are NOT marked sent before the
-- next write, so the cancellation merges into them (fix round 1).
do $$
declare
  f jsonb := pg_temp.fx();
  v_ws uuid := (f->>'ws')::uuid;
  v_o uuid := (f->>'o')::uuid;
  v_oc bigint; v_o2 bigint; v_ev bigint;
  v_g agenda_convidados;
  v jsonb; v_it jsonb; v_err text; q agenda_emails_cliente;
begin
  update agenda_emails_cliente set status = 'enviado' where status = 'pendente';

  -- (a) remove a guest while its alteracao is pending, one entry past 90 days
  v_oc := pg_temp.criar(v_o, pg_temp.diaria(5, 2, pg_temp.cv(array['lia@ext.com'])));
  v_o2 := pg_temp.nth(v_oc, 2); v_ev := pg_temp.ev(v_oc);
  v_g := pg_temp.g(v_oc, 'lia@ext.com');
  update agenda_emails_cliente set status = 'enviado' where evento_id = v_ev;   -- the convite went out
  v_err := pg_temp.editar(v_o, v_oc, 'todas', '{"titulo":"Novo título"}');
  assert v_err is null, format('todas: %s', v_err);
  v_err := pg_temp.editar(v_o, v_o2, 'esta', jsonb_build_object('inicio_local', pg_temp.dia(120), 'fim_local', pg_temp.dia(120, '15:00:00')));
  assert v_err is null, format('esta past 90 days: %s', v_err);
  select * into q from pg_temp.pend(v_ev) where convidado_id = v_g.id;
  assert q.tipo = 'alteracao' and jsonb_array_length(q.ocorrencias) = 2
     and (select bool_and(x->>'estado' = 'ativa') from jsonb_array_elements(q.ocorrencias) x), format('fixture alteracao: %s', to_jsonb(q));
  v_err := pg_temp.editar(v_o, v_oc, 'todas', pg_temp.cv('{}'));
  assert v_err is null, format('remove: %s', v_err);
  assert (select count(*) from pg_temp.pend(v_ev) where convidado_id = v_g.id) = 1, 'removal left more than one item';
  select * into q from pg_temp.pend(v_ev) where convidado_id = v_g.id;
  assert q.tipo = 'cancelamento' and pg_temp.snap_ids(q.ocorrencias) = array[v_oc, v_o2]
     and (select bool_and(x->>'estado' = 'cancelada') from jsonb_array_elements(q.ocorrencias) x), format('(a) merged removal: %s', to_jsonb(q));
  update agenda_emails_cliente set enviar_apos = now() - interval '1 second' where id = q.id;
  v := pg_temp.svc('select public.agenda_cliente_claim_emails(100)');
  select x into v_it from jsonb_array_elements(v) x where (x->>'id')::bigint = q.id;
  assert v_it->>'tipo' = 'cancelamento' and jsonb_array_length(v_it->'ocorrencias') = 2
     and (select bool_and(x->>'estado' = 'cancelada') from jsonb_array_elements(v_it->'ocorrencias') x)
     and v_it->'convidado_token' = 'null'::jsonb, format('(a) claim: %s', coalesce(v_it::text, 'not returned'));

  -- (b) a private edit removes every guest; their cancellation is claimed
  v_oc := pg_temp.criar(v_o, pg_temp.diaria(6, 2, pg_temp.cv(array['mel@ext.com'])));
  v_ev := pg_temp.ev(v_oc);
  v_g := pg_temp.g(v_oc, 'mel@ext.com');
  update agenda_emails_cliente set status = 'enviado' where evento_id = v_ev;
  v_err := pg_temp.editar(v_o, v_oc, 'todas', '{"local":"Sala 9"}');                  -- pending alteracao
  assert v_err is null, format('local: %s', v_err);
  v_err := pg_temp.editar(v_o, v_oc, 'todas', pg_temp.cv('{}') || '{"privado":true}');
  assert v_err is null, format('private + remove all: %s', v_err);
  select * into q from pg_temp.pend(v_ev) where convidado_id = v_g.id;
  assert q.tipo = 'cancelamento' and jsonb_array_length(q.ocorrencias) = 2
     and (select bool_and(x->>'estado' = 'cancelada') from jsonb_array_elements(q.ocorrencias) x), format('(b) item: %s', to_jsonb(q));
  update agenda_emails_cliente set enviar_apos = now() - interval '1 second' where id = q.id;
  v := pg_temp.svc('select public.agenda_cliente_claim_emails(100)');
  select x into v_it from jsonb_array_elements(v) x where (x->>'id')::bigint = q.id;
  assert v_it->>'tipo' = 'cancelamento' and v_it->>'email' = 'mel@ext.com'
     and (select bool_and(x->>'estado' = 'cancelada') from jsonb_array_elements(v_it->'ocorrencias') x),
    format('(b) claim: %s (status %s)', coalesce(v_it::text, 'not returned'), (select status from agenda_emails_cliente where id = q.id));
  -- a non-cancellation to a guest of a private series is still discarded
  insert into agenda_emails_cliente (conta_id, convidado_id, convidado_email, evento_id, tipo, ocorrencias, enviar_apos)
    values (v_ws, v_g.id, v_g.email, v_ev, 'alteracao', jsonb_build_array(jsonb_build_object('ocorrencia_id', v_oc, 'estado', 'ativa',
            'inicio', pg_temp.ini(v_oc))), now() - interval '1 second')
    returning * into q;
  perform pg_temp.svc('select public.agenda_cliente_claim_emails(100)');
  assert (select status from agenda_emails_cliente where id = q.id) = 'descartado', 'alteracao to a guest of a private series not discarded';

  -- (c) excluir todas with a pending guest alteracao (one entry past 90 days)
  v_oc := pg_temp.criar(v_o, pg_temp.diaria(7, 2, pg_temp.cv(array['nina@ext.com'])));
  v_o2 := pg_temp.nth(v_oc, 2); v_ev := pg_temp.ev(v_oc);
  v_g := pg_temp.g(v_oc, 'nina@ext.com');
  update agenda_emails_cliente set status = 'enviado' where evento_id = v_ev;
  v_err := pg_temp.editar(v_o, v_o2, 'esta', jsonb_build_object('inicio_local', pg_temp.dia(130), 'fim_local', pg_temp.dia(130, '15:00:00')));
  assert v_err is null, format('esta past 90 days: %s', v_err);
  v_err := pg_temp.erro(v_o, format('select public.agenda_evento_excluir(%s, %L)', v_oc, 'todas'));
  assert v_err is null, format('excluir todas: %s', v_err);
  assert not exists (select 1 from agenda_convidados where id = v_g.id), 'guest row survived';
  assert (select count(*) from pg_temp.pend(v_ev) where convidado_id = v_g.id) = 1, 'excluir left more than one item';
  select * into q from pg_temp.pend(v_ev) where convidado_id = v_g.id;
  assert q.tipo = 'cancelamento' and pg_temp.snap_ids(q.ocorrencias) = array[v_oc, v_o2]
     and (select bool_and(x->>'estado' = 'cancelada') from jsonb_array_elements(q.ocorrencias) x), format('(c) item: %s', to_jsonb(q));
  update agenda_emails_cliente set enviar_apos = now() - interval '1 second' where id = q.id;
  v := pg_temp.svc('select public.agenda_cliente_claim_emails(100)');
  select x into v_it from jsonb_array_elements(v) x where (x->>'id')::bigint = q.id;
  assert v_it->>'tipo' = 'cancelamento' and v_it->>'email' = 'nina@ext.com'
     and (select bool_and(x->>'estado' = 'cancelada') from jsonb_array_elements(v_it->'ocorrencias') x), format('(c) claim: %s', coalesce(v_it::text, 'not returned'));

  -- a pending convite of a guest removed before the send: discarded, nothing to cancel
  v_oc := pg_temp.criar(v_o, pg_temp.p(pg_temp.cv(array['olivia@ext.com'])));
  v_ev := pg_temp.ev(v_oc);
  v_g := pg_temp.g(v_oc, 'olivia@ext.com');
  v_err := pg_temp.editar(v_o, v_oc, 'todas', pg_temp.cv('{}'));
  assert v_err is null, format('remove before send: %s', v_err);
  assert not exists (select 1 from pg_temp.pend(v_ev) where convidado_id = v_g.id), 'unsent convite + removal left a pending item';

  raise notice 'PASS 99_agenda_convidados (guest loss with a pending item)';
end $$;

rollback;
