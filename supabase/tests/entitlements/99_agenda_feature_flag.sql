\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Agenda rollout flag (feature_agenda, 20261005000001_agenda_eventos.sql §0 and
-- 20261005000002_agenda_lembretes.sql). Unlike the other 99_agenda_* suites this
-- one does NOT turn the flag on for every plan: plans keep the column default
-- (false) and each workspace is switched through
-- workspace_plan_overrides.feature_overrides, the way the platform Admin does it.
-- Block 1: the write RPCs raise feature_disabled:feature_agenda and agenda_listar
-- returns no rows when the flag is off; an override on a false plan enables
-- creation. Block 2: the tick creates reminders only for enabled workspaces.
-- Block 3: the e-mail claim never sends a row whose workspace lost the flag.
--
-- The claim settles a row whose occurrence already ended against the real
-- now() (o.fim < now()), so every fixture is built from current_date
-- (pg_temp.dia / pg_temp.ts) and app.agenda_hoje is pinned to current_date.
-- Never use a literal date here: the suite would start failing once that date
-- passes.

begin;
select et_grant_hosted_parity(array['agenda_eventos','agenda_ocorrencias','agenda_participantes','agenda_respostas','agenda_lembretes']);
revoke all on public.agenda_eventos, public.agenda_ocorrencias, public.agenda_participantes, public.agenda_respostas from anon, authenticated;
grant select on public.agenda_eventos, public.agenda_ocorrencias, public.agenda_participantes, public.agenda_respostas to authenticated;
grant all on public.agenda_eventos, public.agenda_ocorrencias, public.agenda_participantes, public.agenda_respostas to service_role;
revoke all on public.agenda_lembretes from anon, authenticated;
grant all on public.agenda_lembretes to service_role;

-- 'YYYY-MM-DD"T"HH:MI:SS' for current_date + p_dias at p_hora
create or replace function pg_temp.dia(p_dias int, p_hora text default '14:00:00') returns text language sql as $f$
  select to_char(current_date + p_dias, 'YYYY-MM-DD') || 'T' || p_hora;
$f$;
-- the instant of that wall clock in Sao Paulo
create or replace function pg_temp.ts(p_dias int, p_hora text default '14:00:00') returns timestamptz language sql as $f$
  select pg_temp.dia(p_dias, p_hora)::timestamp at time zone 'America/Sao_Paulo';
$f$;
-- inicio_local / fim_local overrides for a 14:00-15:00 event on current_date + p_dias
create or replace function pg_temp.em(p_dias int) returns jsonb language sql as $f$
  select jsonb_build_object('inicio_local', pg_temp.dia(p_dias), 'fim_local', pg_temp.dia(p_dias, '15:00:00'));
$f$;
create or replace function pg_temp.p(p jsonb default '{}') returns jsonb language sql as $f$
  select jsonb_build_object(
    'titulo', 'Evento', 'descricao', null, 'local', null, 'link_reuniao', null,
    'tipo', 'reuniao', 'cor', null, 'cliente_id', null, 'privado', false, 'dia_inteiro', false,
    'tz', 'America/Sao_Paulo', 'inicio_local', pg_temp.dia(0), 'fim_local', pg_temp.dia(0, '15:00:00'),
    'lembretes', jsonb_build_array(10), 'regra', null) || p;
$f$;
-- create an event as p_user; returns its (only) occurrence id
create or replace function pg_temp.criar(p_user uuid, p jsonb, parts uuid[]) returns bigint language plpgsql as $f$
declare v bigint;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select c.ocorrencia_id into v from public.agenda_evento_criar(p, parts) c;
  execute 'reset role';
  return v;
end $f$;
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
-- number of rows agenda_listar returns to p_user
create or replace function pg_temp.listar(p_user uuid, p_de timestamptz, p_ate timestamptz, p_oc bigint default null) returns int language plpgsql as $f$
declare v int;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v from public.agenda_listar(p_de, p_ate, p_oc);
  execute 'reset role';
  return v;
end $f$;
create or replace function pg_temp.tick(p_now timestamptz) returns int language plpgsql as $f$
declare v int;
begin
  execute 'set local role service_role';
  v := public.agenda_tick_lembretes(p_now, false);
  execute 'reset role';
  return v;
end $f$;
-- sets (or clears, with NULL) the workspace's feature_agenda override
create or replace function pg_temp.flag(p_ws uuid, p_on boolean) returns void language plpgsql as $f$
begin
  if p_on is null then
    update workspace_plan_overrides set feature_overrides = feature_overrides - 'feature_agenda' where workspace_id = p_ws;
  else
    insert into workspace_plan_overrides (workspace_id, feature_overrides)
      values (p_ws, jsonb_build_object('feature_agenda', p_on))
      on conflict (workspace_id) do update
        set feature_overrides = coalesce(workspace_plan_overrides.feature_overrides, '{}'::jsonb) || excluded.feature_overrides;
  end if;
end $f$;
grant execute on all functions in schema pg_temp to authenticated, service_role;

-- ============ block 1: write RPCs and agenda_listar ============
do $$
declare
  v_ws_on uuid; v_ws_off uuid;
  v_o uuid := gen_random_uuid();      -- ws_on owner, organizer
  v_b uuid := gen_random_uuid();      -- ws_on agent, participant
  v_x uuid := gen_random_uuid();      -- ws_off owner
  v_oc bigint; v_ev bigint;
  v_err text;
  v_edit jsonb;
  v_flag constant text := 'P0001:feature_disabled:feature_agenda';
begin
  perform set_config('app.agenda_hoje', current_date::text, true);

  assert exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'plans' and column_name = 'feature_agenda'
                    and data_type = 'boolean' and is_nullable = 'NO' and column_default = 'false'),
    'plans.feature_agenda is not boolean NOT NULL DEFAULT false';
  assert not exists (select 1 from plans where feature_agenda), 'a plan has feature_agenda on by default';

  v_ws_on := et_make_workspace('max');
  v_ws_off := et_make_workspace('max');
  insert into auth.users (id) values (v_o), (v_b), (v_x);
  insert into workspace_members (user_id, workspace_id, role) values
    (v_o, v_ws_on, 'owner'), (v_b, v_ws_on, 'agent'), (v_x, v_ws_off, 'owner');
  update profiles set conta_id = v_ws_on, active_workspace_id = v_ws_on where id in (v_o, v_b);
  update profiles set conta_id = v_ws_off, active_workspace_id = v_ws_off where id = v_x;

  -- the plan has the flag off: creating raises the entitlement error
  assert not effective_plan_feature(v_ws_off, 'feature_agenda'), 'ws_off resolves feature_agenda on';
  v_err := pg_temp.erro(v_x, format('select * from public.agenda_evento_criar(%L::jsonb, %L::uuid[])', pg_temp.p(), '{}'));
  assert v_err = v_flag, format('criar with the flag off: %s', coalesce(v_err, 'succeeded'));
  assert not exists (select 1 from agenda_eventos where conta_id = v_ws_off), 'criar with the flag off left an event';

  -- an override on a plan that has it false enables creation
  perform pg_temp.flag(v_ws_on, true);
  assert effective_plan_feature(v_ws_on, 'feature_agenda'), 'override true did not enable feature_agenda';
  v_oc := pg_temp.criar(v_o, pg_temp.p('{"titulo":"Reunião"}'), array[v_b]);
  assert v_oc is not null, 'criar with the override on returned no occurrence';
  select o.evento_id into v_ev from agenda_ocorrencias o where o.id = v_oc;
  assert pg_temp.listar(v_o, pg_temp.ts(0, '00:00'), pg_temp.ts(1, '00:00')) = 1, 'listar with the flag on: expected 1 row';
  assert pg_temp.listar(v_b, null, null, v_oc) = 1, 'listar by occurrence with the flag on: expected 1 row';
  v_err := pg_temp.erro(v_b, format('select public.agenda_responder(%s, %L, %L)', v_oc, 'sim', 'esta'));
  assert v_err is null, format('responder with the flag on: %s', v_err);

  -- the workspace loses the flag: every write raises, listar returns nothing
  perform pg_temp.flag(v_ws_on, false);
  assert pg_temp.listar(v_o, pg_temp.ts(0, '00:00'), pg_temp.ts(1, '00:00')) = 0, 'listar by range with the flag off returned rows';
  assert pg_temp.listar(v_b, null, null, v_oc) = 0, 'listar by occurrence with the flag off returned rows';
  -- no raise either for an otherwise invalid range: the gate comes first
  assert pg_temp.listar(v_o, null, null) = 0, 'listar with the flag off and no range';

  v_err := pg_temp.erro(v_o, format('select * from public.agenda_evento_criar(%L::jsonb, %L::uuid[])', pg_temp.p(), '{}'));
  assert v_err = v_flag, format('criar after the flag went off: %s', coalesce(v_err, 'succeeded'));
  v_edit := pg_temp.p('{"titulo":"Renomeado"}');
  v_err := pg_temp.erro(v_o, format('select * from public.agenda_evento_editar(%s, %L, %L::jsonb, %L::uuid[])', v_oc, 'esta', v_edit, array[v_b]));
  assert v_err = v_flag, format('editar with the flag off: %s', coalesce(v_err, 'succeeded'));
  -- an invalid scope does not get past the gate either (no information about the row)
  v_err := pg_temp.erro(v_o, format('select * from public.agenda_evento_editar(%s, %L, %L::jsonb)', v_oc, 'qualquer', v_edit));
  assert v_err = v_flag, format('editar with the flag off and a bad scope: %s', coalesce(v_err, 'succeeded'));
  v_err := pg_temp.erro(v_o, format('select public.agenda_evento_excluir(%s, %L)', v_oc, 'todas'));
  assert v_err = v_flag, format('excluir with the flag off: %s', coalesce(v_err, 'succeeded'));
  v_err := pg_temp.erro(v_b, format('select public.agenda_responder(%s, %L, %L)', v_oc, 'nao', 'esta'));
  assert v_err = v_flag, format('responder with the flag off: %s', coalesce(v_err, 'succeeded'));

  -- nothing changed underneath
  assert (select titulo from agenda_eventos where id = v_ev) = 'Reunião', 'editar with the flag off changed the event';
  assert exists (select 1 from agenda_ocorrencias where id = v_oc and not cancelada), 'excluir with the flag off removed the occurrence';
  assert not exists (select 1 from agenda_respostas where ocorrencia_id = v_oc and resposta = 'nao')
     and not exists (select 1 from agenda_participantes where evento_id = v_ev and user_id = v_b and resposta = 'nao'),
    'responder with the flag off stored the answer';

  -- removing the override falls back to the plan (off); turning it back on restores everything
  perform pg_temp.flag(v_ws_on, null);
  assert pg_temp.listar(v_o, pg_temp.ts(0, '00:00'), pg_temp.ts(1, '00:00')) = 0, 'listar with the override removed returned rows';
  perform pg_temp.flag(v_ws_on, true);
  assert pg_temp.listar(v_o, pg_temp.ts(0, '00:00'), pg_temp.ts(1, '00:00')) = 1, 'listar after re-enabling: expected 1 row';
  v_err := pg_temp.erro(v_o, format('select public.agenda_evento_excluir(%s, %L)', v_oc, 'todas'));
  assert v_err is null, format('excluir after re-enabling: %s', v_err);

  raise notice 'PASS 99_agenda_feature_flag (write RPCs, listar)';
end $$;

-- ============ block 2: the tick only claims for enabled workspaces ============
do $$
declare
  v_ws_on uuid; v_ws_off uuid;
  v_o uuid := gen_random_uuid();
  v_x uuid := gen_random_uuid();
  v_oc_on bigint; v_oc_off bigint;
  v_n int;
begin
  perform set_config('app.agenda_hoje', current_date::text, true);
  delete from agenda_lembretes;
  v_ws_on := et_make_workspace('start');
  v_ws_off := et_make_workspace('start');
  insert into auth.users (id) values (v_o), (v_x);
  insert into workspace_members (user_id, workspace_id, role) values (v_o, v_ws_on, 'owner'), (v_x, v_ws_off, 'owner');
  update profiles set conta_id = v_ws_on, active_workspace_id = v_ws_on where id = v_o;
  update profiles set conta_id = v_ws_off, active_workspace_id = v_ws_off where id = v_x;

  -- both create their 14:00 event while enabled; ws_off then loses the override
  -- and falls back to its plan (off)
  perform pg_temp.flag(v_ws_on, true);
  perform pg_temp.flag(v_ws_off, true);
  v_oc_on := pg_temp.criar(v_o, pg_temp.p(pg_temp.em(7)), '{}');
  v_oc_off := pg_temp.criar(v_x, pg_temp.p(pg_temp.em(7)), '{}');
  delete from workspace_plan_overrides where workspace_id = v_ws_off;
  assert not effective_plan_feature(v_ws_off, 'feature_agenda'), 'ws_off still resolves feature_agenda on';

  v_n := pg_temp.tick(pg_temp.ts(7, '13:50'));
  assert v_n = 1, format('tick with one enabled workspace: %s claims', v_n);
  assert exists (select 1 from agenda_lembretes where ocorrencia_id = v_oc_on and user_id = v_o), 'the enabled workspace got no reminder';
  assert not exists (select 1 from agenda_lembretes where conta_id = v_ws_off), 'the disabled workspace got a ledger row';
  assert not exists (select 1 from notifications where workspace_id = v_ws_off and type = 'event_reminder'),
    'the disabled workspace got an event_reminder notification';

  -- re-enabled while the window is still open: the next tick claims it
  perform pg_temp.flag(v_ws_off, true);
  v_n := pg_temp.tick(pg_temp.ts(7, '13:51'));
  assert v_n = 1, format('tick after re-enabling: %s claims', v_n);
  assert exists (select 1 from agenda_lembretes where ocorrencia_id = v_oc_off and user_id = v_x), 'the re-enabled workspace got no reminder';

  raise notice 'PASS 99_agenda_feature_flag (tick)';
end $$;

-- ============ block 3: claimed rows of a workspace that lost the flag are never sent ============
do $$
declare
  v_ws_on uuid; v_ws_off uuid;
  v_o uuid := gen_random_uuid();
  v_x uuid := gen_random_uuid();
  v_oc_on bigint; v_oc_off bigint;
  v_users uuid[];
  v_status text;
begin
  perform set_config('app.agenda_hoje', current_date::text, true);
  delete from agenda_lembretes;
  v_ws_on := et_make_workspace('start');
  v_ws_off := et_make_workspace('start');
  insert into auth.users (id) values (v_o), (v_x);
  insert into workspace_members (user_id, workspace_id, role) values (v_o, v_ws_on, 'owner'), (v_x, v_ws_off, 'owner');
  update profiles set conta_id = v_ws_on, active_workspace_id = v_ws_on where id = v_o;
  update profiles set conta_id = v_ws_off, active_workspace_id = v_ws_off where id = v_x;
  perform pg_temp.flag(v_ws_on, true);
  perform pg_temp.flag(v_ws_off, true);

  -- a month ahead of the real clock so the claim's ended-event settling
  -- (o.fim < now()) never touches them
  v_oc_on := pg_temp.criar(v_o, pg_temp.p(pg_temp.em(30)), '{}');
  v_oc_off := pg_temp.criar(v_x, pg_temp.p(pg_temp.em(30)), '{}');
  assert pg_temp.tick(pg_temp.ts(30, '13:50')) = 2, 'claim setup: expected 2 pendente rows';

  -- ws_off loses the flag between the tick and the e-mail run
  perform pg_temp.flag(v_ws_off, false);
  execute 'set local role service_role';
  select array_agg(c.user_id) into v_users from public.agenda_claim_emails_lembrete(10) c;
  execute 'reset role';
  assert v_users = array[v_o], format('claim with one workspace disabled returned %s', v_users);
  select email_status into v_status from agenda_lembretes where ocorrencia_id = v_oc_off and user_id = v_x;
  assert v_status = 'nao', format('the disabled workspace''s row is %s, not nao', v_status);
  select email_status into v_status from agenda_lembretes where ocorrencia_id = v_oc_on and user_id = v_o;
  assert v_status = 'enviando', format('the enabled workspace''s row is %s, not enviando', v_status);

  -- re-enabling does not resurrect a settled row
  perform pg_temp.flag(v_ws_off, true);
  execute 'set local role service_role';
  select array_agg(c.user_id) into v_users from public.agenda_claim_emails_lembrete(10) c;
  execute 'reset role';
  assert v_users is null, format('a settled row was claimed after re-enabling: %s', v_users);

  raise notice 'PASS 99_agenda_feature_flag (claim)';
end $$;

rollback;
