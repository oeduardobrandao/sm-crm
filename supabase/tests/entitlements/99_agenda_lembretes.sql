\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Agenda reminders (20261005000002_agenda_lembretes.sql): the ledger, the
-- per-minute tick (window, recipients, e-mail prefs, re-targeting after a move),
-- the e-mail claim/mark lease, the 30-day cleanup, privileges, and the rollback
-- runbook (docs/superpowers/specs/assets/2026-10-05-agenda-rollback.sql), which
-- runs last inside this transaction and is rolled back with it. The tick is
-- called with p_chamar_email => false except where the e-mail kick is under test.

begin;
select et_grant_hosted_parity(array['agenda_eventos','agenda_ocorrencias','agenda_participantes','agenda_respostas','agenda_lembretes']);
revoke all on public.agenda_eventos, public.agenda_ocorrencias, public.agenda_participantes, public.agenda_respostas from anon, authenticated;
grant select on public.agenda_eventos, public.agenda_ocorrencias, public.agenda_participantes, public.agenda_respostas to authenticated;
grant all on public.agenda_eventos, public.agenda_ocorrencias, public.agenda_participantes, public.agenda_respostas to service_role;
revoke all on public.agenda_lembretes from anon, authenticated;
grant all on public.agenda_lembretes to service_role;

create or replace function pg_temp.p(p jsonb default '{}') returns jsonb language sql as $f$
  select jsonb_build_object(
    'titulo', 'Evento', 'descricao', null, 'local', null, 'link_reuniao', null,
    'tipo', 'reuniao', 'cor', null, 'cliente_id', null, 'privado', false, 'dia_inteiro', false,
    'tz', 'America/Sao_Paulo', 'inicio_local', '2026-10-05T14:00:00', 'fim_local', '2026-10-05T15:00:00',
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
create or replace function pg_temp.tick(p_now timestamptz) returns int language plpgsql as $f$
declare v int;
begin
  execute 'set local role service_role';
  v := public.agenda_tick_lembretes(p_now, false);
  execute 'reset role';
  return v;
end $f$;
grant execute on all functions in schema pg_temp to authenticated, service_role;

do $$
declare
  v_ws uuid;
  v_o uuid := gen_random_uuid();     -- organizer (participant with sim)
  v_b1 uuid := gen_random_uuid();
  v_b2 uuid := gen_random_uuid();
  v_b3 uuid := gen_random_uuid();
  v_oc bigint; v_oc_late bigint; v_oc_dia bigint; v_oc_nao bigint; v_oc_ex bigint; v_oc_pref bigint; v_oc_canc bigint;
  v_n int; v_c bigint;
  v_meta jsonb; v_link text; v_emailed timestamptz;
  v_t text;
  r record;
begin
  perform set_config('app.agenda_hoje', '2026-10-05', true);
  v_ws := et_make_workspace('max');
  insert into auth.users (id) values (v_o), (v_b1), (v_b2), (v_b3);
  insert into workspace_members (user_id, workspace_id, role) values
    (v_o, v_ws, 'owner'), (v_b1, v_ws, 'agent'), (v_b2, v_ws, 'agent'), (v_b3, v_ws, 'agent');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id in (v_o, v_b1, v_b2, v_b3);

  -- ---- privileges ----
  foreach v_t in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
    assert has_table_privilege('authenticated', 'public.agenda_lembretes', v_t) = false, format('authenticated holds %s on agenda_lembretes', v_t);
    assert has_table_privilege('anon', 'public.agenda_lembretes', v_t) = false, format('anon holds %s on agenda_lembretes', v_t);
  end loop;
  assert has_table_privilege('service_role', 'public.agenda_lembretes', 'INSERT'), 'service_role lost INSERT on agenda_lembretes';
  foreach v_t in array array['public.agenda_tick_lembretes(timestamptz, boolean)',
                             'public.agenda_claim_emails_lembrete(int)',
                             'public.agenda_marcar_email_lembrete(bigint, uuid, int, timestamptz, boolean)'] loop
    assert has_function_privilege('authenticated', v_t, 'EXECUTE') = false, format('authenticated executes %s', v_t);
    assert has_function_privilege('service_role', v_t, 'EXECUTE'), format('service_role cannot execute %s', v_t);
  end loop;
  perform 1 from cron.job where jobname = 'agenda-lembretes' and schedule = '* * * * *' and command ilike '%agenda_tick_lembretes()%';
  assert found, 'cron agenda-lembretes not scheduled every minute';

  -- ---- the 10-minute window: 14:00 event, organizer + B1 ----
  v_oc := pg_temp.criar(v_o, pg_temp.p('{"titulo":"Gravação 14h"}'), array[v_b1]);
  assert pg_temp.tick('2026-10-05 13:49-03') = 0, 'tick at 13:49 claimed';
  v_n := pg_temp.tick('2026-10-05 13:50-03');
  assert v_n = 2, format('tick at 13:50: %s claims', v_n);
  select count(*) into v_c from agenda_lembretes where ocorrencia_id = v_oc and email_status = 'pendente'
     and minutos = 10 and inicio_alvo = '2026-10-05 17:00+00' and notification_id is not null;
  assert v_c = 2, format('ledger rows: %s', v_c);
  select count(*) into v_c from notifications where type = 'event_reminder' and emailed_at is not null
     and user_id in (v_o, v_b1) and (metadata->>'ocorrencia_id')::bigint = v_oc;
  assert v_c = 2, format('event_reminder notifications: %s', v_c);
  select n.metadata, n.link into v_meta, v_link from notifications n where n.type = 'event_reminder' and n.user_id = v_b1;
  assert v_link = '/calendario?evento=' || v_oc, format('reminder link %s', v_link);
  assert v_meta->>'titulo' = 'Gravação 14h' and (v_meta->>'minutos')::int = 10
     and (v_meta->>'inicio')::timestamptz = '2026-10-05 17:00+00' and (v_meta->>'fim')::timestamptz = '2026-10-05 18:00+00'
     and v_meta->'dia_inteiro' = 'false'::jsonb and (v_meta->>'ocorrencia_id')::bigint = v_oc and v_meta ? 'evento_id',
    format('reminder metadata: %s', v_meta);
  perform 1 from agenda_lembretes l join notifications n on n.id = l.notification_id
   where l.ocorrencia_id = v_oc and l.user_id = v_b1 and n.user_id = v_b1;
  assert found, 'ledger notification_id does not point at the user''s notification';
  assert pg_temp.tick('2026-10-05 13:51-03') = 0, 'tick at 13:51 claimed again';

  -- ---- more than 15 minutes late: dropped ----
  v_oc_late := pg_temp.criar(v_o, pg_temp.p('{"titulo":"Atrasado","inicio_local":"2026-10-06T14:00:00","fim_local":"2026-10-06T15:00:00"}'), '{}');
  assert pg_temp.tick('2026-10-06 14:06-03') = 0, 'a reminder 16 minutes late was claimed';
  assert pg_temp.tick('2026-10-06 14:04-03') = 1, 'a reminder 14 minutes late was not claimed';

  -- ---- negative minutes: all-day, "no dia às 9h" (-540) fires at 09:00 local ----
  v_oc_dia := pg_temp.criar(v_o, pg_temp.p('{"titulo":"Dia todo","dia_inteiro":true,"inicio_local":"2026-10-07T00:00:00","fim_local":"2026-10-08T00:00:00","lembretes":[-540]}'), '{}');
  assert pg_temp.tick('2026-10-07 08:59-03') = 0, 'all-day -540 fired before 09:00';
  assert pg_temp.tick('2026-10-07 09:00-03') = 1, 'all-day -540 did not fire at 09:00';
  select n.metadata into v_meta from notifications n where n.type = 'event_reminder' and (n.metadata->>'ocorrencia_id')::bigint = v_oc_dia;
  assert (v_meta->>'minutos')::int = -540 and v_meta->'dia_inteiro' = 'true'::jsonb and v_meta->>'data_local' = '2026-10-07',
    format('all-day reminder metadata: %s', v_meta);

  -- ---- effective nao (series-level and per-occurrence) and ex-members get nothing ----
  v_oc_nao := pg_temp.criar(v_o, pg_temp.p('{"inicio_local":"2026-10-08T14:00:00","fim_local":"2026-10-08T15:00:00"}'), array[v_b1, v_b2, v_b3]);
  update agenda_participantes set resposta = 'nao' where user_id = v_b1 and evento_id = (select evento_id from agenda_ocorrencias where id = v_oc_nao);
  insert into agenda_respostas (ocorrencia_id, conta_id, user_id, resposta) values (v_oc_nao, v_ws, v_b2, 'nao');
  delete from workspace_members where user_id = v_b3 and workspace_id = v_ws;
  assert pg_temp.tick('2026-10-08 13:50-03') = 1, 'nao / ex-member got a reminder';
  perform 1 from agenda_lembretes where ocorrencia_id = v_oc_nao and user_id = v_o;
  assert found, 'the organizer did not get the reminder';
  insert into workspace_members (user_id, workspace_id, role) values (v_b3, v_ws, 'agent');
  -- a per-occurrence sim overrides a series-level nao
  v_oc_ex := pg_temp.criar(v_o, pg_temp.p('{"inicio_local":"2026-10-09T14:00:00","fim_local":"2026-10-09T15:00:00","lembretes":[30]}'), array[v_b1]);
  update agenda_participantes set resposta = 'nao' where user_id = v_b1 and evento_id = (select evento_id from agenda_ocorrencias where id = v_oc_ex);
  insert into agenda_respostas (ocorrencia_id, conta_id, user_id, resposta) values (v_oc_ex, v_ws, v_b1, 'sim');
  assert pg_temp.tick('2026-10-09 13:30-03') = 2, 'per-occurrence sim did not override series nao';

  -- ---- e-mail prefs off: claimed in-app, e-mail status nao ----
  insert into notification_email_prefs (user_id, type, enabled) values (v_b1, 'event_reminder', false);
  insert into notification_email_prefs (user_id, type, enabled) values (v_b2, '__all__', false);
  v_oc_pref := pg_temp.criar(v_o, pg_temp.p('{"inicio_local":"2026-10-10T14:00:00","fim_local":"2026-10-10T15:00:00"}'), array[v_b1, v_b2]);
  assert pg_temp.tick('2026-10-10 13:50-03') = 3, 'prefs: expected 3 claims';
  select count(*) into v_c from agenda_lembretes where ocorrencia_id = v_oc_pref and user_id in (v_b1, v_b2) and email_status = 'nao';
  assert v_c = 2, format('prefs off: %s rows with email_status nao', v_c);
  perform 1 from agenda_lembretes where ocorrencia_id = v_oc_pref and user_id = v_o and email_status = 'pendente';
  assert found, 'prefs: the organizer row is not pendente';
  select count(*) into v_c from notifications where type = 'event_reminder' and (metadata->>'ocorrencia_id')::bigint = v_oc_pref;
  assert v_c = 3, 'prefs off still gets the in-app reminder';

  -- ---- moving an already-reminded occurrence re-targets the reminder ----
  update agenda_ocorrencias set inicio = '2026-10-05 18:00+00', fim = '2026-10-05 19:00+00', horario_alterado = true where id = v_oc;
  v_n := pg_temp.tick('2026-10-05 14:50-03');
  assert v_n = 2, format('moved occurrence: %s new claims', v_n);
  select count(*) into v_c from agenda_lembretes where ocorrencia_id = v_oc;
  assert v_c = 4, format('moved occurrence ledger rows: %s', v_c);

  -- ---- cancelled occurrence: nothing ----
  v_oc_canc := pg_temp.criar(v_o, pg_temp.p('{"inicio_local":"2026-10-11T14:00:00","fim_local":"2026-10-11T15:00:00"}'), array[v_b1]);
  update agenda_ocorrencias set cancelada = true where id = v_oc_canc;
  assert pg_temp.tick('2026-10-11 13:50-03') = 0, 'cancelled occurrence got a reminder';

  raise notice 'PASS 99_agenda_lembretes (tick)';
end $$;

-- ============ block 2: e-mail claim / mark lease ============
do $$
declare
  v_ws uuid;
  v_o uuid := gen_random_uuid();
  v_oc bigint; v_oc2 bigint;
  v_n int;
  r record;
  v_status text; v_tent int;
begin
  perform set_config('app.agenda_hoje', '2026-10-05', true);
  -- clean slate for the claim counts (rolled back with the suite)
  delete from agenda_lembretes;
  v_ws := et_make_workspace('start');
  insert into auth.users (id) values (v_o);
  insert into workspace_members (user_id, workspace_id, role) values (v_o, v_ws, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_o;
  -- far in the future so the claim's stale-row settling never touches them
  v_oc := pg_temp.criar(v_o, pg_temp.p('{"titulo":"Lembrar <b>","local":"Sala 1","link_reuniao":"https://meet.example/a","inicio_local":"2027-03-01T14:00:00","fim_local":"2027-03-01T15:00:00","lembretes":[10,60]}'), '{}');
  v_oc2 := pg_temp.criar(v_o, pg_temp.p('{"inicio_local":"2027-03-02T14:00:00","fim_local":"2027-03-02T15:00:00","lembretes":[10]}'), '{}');
  assert pg_temp.tick('2027-03-01 13:00-03') = 1, 'claim setup: 60-min reminder';
  assert pg_temp.tick('2027-03-01 13:50-03') = 1, 'claim setup: 10-min reminder';
  assert pg_temp.tick('2027-03-02 13:50-03') = 1, 'claim setup: second event';

  execute 'set local role service_role';
  select count(*) into v_n from public.agenda_claim_emails_lembrete(10);
  assert v_n = 3, format('claim returned %s rows', v_n);
  execute 'reset role';
  select count(*) into v_n from agenda_lembretes where email_status = 'enviando' and email_tentativas = 1
     and email_lease_ate > now() + interval '1 minute';
  assert v_n = 3, format('claimed rows not enviando with a lease: %s', v_n);

  execute 'set local role service_role';
  select * into r from public.agenda_claim_emails_lembrete(10) limit 1;
  assert r is null, 'a second claim returned leased rows';
  execute 'reset role';

  -- expired lease: re-claimed with the event data
  update agenda_lembretes set email_lease_ate = now() - interval '1 second';
  execute 'set local role service_role';
  select count(*) into v_n from public.agenda_claim_emails_lembrete(10);
  assert v_n = 3, format('expired leases not re-claimed: %s', v_n);
  execute 'reset role';
  update agenda_lembretes set email_lease_ate = now() - interval '1 second' where ocorrencia_id = v_oc and minutos = 60;
  execute 'set local role service_role';
  select * into r from public.agenda_claim_emails_lembrete(10);
  execute 'reset role';
  assert r.ocorrencia_id = v_oc and r.user_id = v_o and r.minutos = 60 and r.inicio_alvo = '2027-03-01 17:00+00'
     and r.notification_id is not null and r.titulo = 'Lembrar <b>' and r.inicio = '2027-03-01 17:00+00'
     and r.fim = '2027-03-01 18:00+00' and not r.dia_inteiro and r.local = 'Sala 1'
     and r.link_reuniao = 'https://meet.example/a' and r.tz = 'America/Sao_Paulo' and r.tentativas = 3,
    format('claim row: %s', to_jsonb(r));

  -- mark: ok -> enviado; failure -> pendente below 3 attempts, falhou at 3
  execute 'set local role service_role';
  perform public.agenda_marcar_email_lembrete(v_oc, v_o, 10, '2027-03-01 17:00+00', true);
  perform public.agenda_marcar_email_lembrete(v_oc2, v_o, 10, '2027-03-02 17:00+00', false);
  perform public.agenda_marcar_email_lembrete(v_oc, v_o, 60, '2027-03-01 17:00+00', false);
  execute 'reset role';
  select email_status into v_status from agenda_lembretes where ocorrencia_id = v_oc and minutos = 10 and email_lease_ate is null;
  assert v_status = 'enviado', format('ok mark: %s', v_status);
  select email_status, email_tentativas into v_status, v_tent from agenda_lembretes where ocorrencia_id = v_oc2;
  assert v_status = 'pendente' and v_tent = 2, format('failed mark below the cap: %s / %s', v_status, v_tent);
  select email_status, email_tentativas into v_status, v_tent from agenda_lembretes where ocorrencia_id = v_oc and minutos = 60;
  assert v_status = 'falhou' and v_tent = 3, format('failed mark at the cap: %s / %s', v_status, v_tent);
  -- marking a row that is not being sent is a no-op
  execute 'set local role service_role';
  perform public.agenda_marcar_email_lembrete(v_oc, v_o, 10, '2027-03-01 17:00+00', false);
  execute 'reset role';
  select email_status into v_status from agenda_lembretes where ocorrencia_id = v_oc and minutos = 10;
  assert v_status = 'enviado', format('marking a settled row changed it: %s', v_status);

  -- claimed 3 times and never marked (deadline-skipped): settles as falhou
  execute 'set local role service_role';
  perform public.agenda_claim_emails_lembrete(10);        -- v_oc2, attempt 3
  execute 'reset role';
  update agenda_lembretes set email_lease_ate = now() - interval '1 second' where ocorrencia_id = v_oc2;
  execute 'set local role service_role';
  select count(*) into v_n from public.agenda_claim_emails_lembrete(10);
  execute 'reset role';
  assert v_n = 0, format('a row at the attempt cap was re-claimed (%s rows)', v_n);
  select email_status, email_tentativas into v_status, v_tent from agenda_lembretes where ocorrencia_id = v_oc2;
  assert v_status = 'falhou' and v_tent = 3, format('never-marked row at the cap: %s / %s', v_status, v_tent);

  raise notice 'PASS 99_agenda_lembretes (claim)';
end $$;

-- ============ block 3: stale rows, e-mail kick, cleanup ============
do $$
declare
  v_ws uuid;
  v_o uuid := gen_random_uuid();
  v_oc bigint; v_oc_canc bigint;
  v_n int;
  v_status text;
begin
  perform set_config('app.agenda_hoje', '2026-10-05', true);
  delete from agenda_lembretes;
  v_ws := et_make_workspace('start');
  insert into auth.users (id) values (v_o);
  insert into workspace_members (user_id, workspace_id, role) values (v_o, v_ws, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_o;

  -- a pending row whose occurrence moved or was cancelled is never e-mailed
  v_oc := pg_temp.criar(v_o, pg_temp.p('{"inicio_local":"2027-04-01T14:00:00","fim_local":"2027-04-01T15:00:00"}'), '{}');
  v_oc_canc := pg_temp.criar(v_o, pg_temp.p('{"inicio_local":"2027-04-02T14:00:00","fim_local":"2027-04-02T15:00:00"}'), '{}');
  perform pg_temp.tick('2027-04-01 13:50-03');
  perform pg_temp.tick('2027-04-02 13:50-03');
  update agenda_ocorrencias set inicio = inicio + interval '1 hour', fim = fim + interval '1 hour', horario_alterado = true where id = v_oc;
  update agenda_ocorrencias set cancelada = true where id = v_oc_canc;
  execute 'set local role service_role';
  select count(*) into v_n from public.agenda_claim_emails_lembrete(10);
  execute 'reset role';
  assert v_n = 0, format('stale rows claimed: %s', v_n);
  select count(*) into v_n from agenda_lembretes where email_status = 'nao' and ocorrencia_id in (v_oc, v_oc_canc);
  assert v_n = 2, format('stale rows not settled as nao: %s', v_n);

  -- the tick with the e-mail kick and no vault secrets still commits its claims (WARNING only)
  delete from vault.secrets where name in ('project_url', 'cron_secret');
  v_oc := pg_temp.criar(v_o, pg_temp.p('{"inicio_local":"2027-04-03T14:00:00","fim_local":"2027-04-03T15:00:00"}'), '{}');
  execute 'set local role service_role';
  v_n := public.agenda_tick_lembretes('2027-04-03 13:50-03', true);
  execute 'reset role';
  assert v_n = 1, format('tick with e-mail kick: %s claims', v_n);
  perform 1 from agenda_lembretes where ocorrencia_id = v_oc and email_status = 'pendente';
  assert found, 'tick with e-mail kick lost its claim';

  -- the daily generator deletes ledger rows older than 30 days
  update agenda_lembretes set criado_em = now() - interval '31 days' where ocorrencia_id = v_oc;
  execute 'set local role service_role';
  perform public.agenda_gerar_horizonte();
  execute 'reset role';
  perform 1 from agenda_lembretes where ocorrencia_id = v_oc;
  assert not found, 'ledger row older than 30 days survived the generator';
  select count(*) into v_n from agenda_lembretes;
  assert v_n = 2, format('the cleanup deleted recent rows (%s left)', v_n);

  raise notice 'PASS 99_agenda_lembretes (stale, kick, cleanup)';
end $$;

-- ============ block 3b: bounded tick candidates, mark fence ============
do $$
declare
  v_ws uuid;
  v_o uuid := gen_random_uuid();
  v_oc bigint; v_ev bigint;
  v_n int;
  v_status text;
begin
  perform set_config('app.agenda_hoje', '2026-10-05', true);
  delete from agenda_lembretes;
  v_ws := et_make_workspace('start');
  insert into auth.users (id) values (v_o);
  insert into workspace_members (user_id, workspace_id, role) values (v_o, v_ws, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_o;

  -- edge of the bound: a -1440 reminder on yesterday's one-off and on the last
  -- occurrence of a daily series that ended yesterday still fire
  v_oc := pg_temp.criar(v_o, pg_temp.p('{"inicio_local":"2026-10-04T14:00:00","fim_local":"2026-10-04T15:00:00","lembretes":[-1440]}'), '{}');
  assert pg_temp.tick('2026-10-05 14:05-03') = 1, 'one-off: -1440 reminder at the bound not fired';
  -- each case retires its occurrences so later ticks count only the next one
  update agenda_ocorrencias set cancelada = true where conta_id = v_ws;
  v_oc := pg_temp.criar(v_o, pg_temp.p(jsonb_build_object('inicio_local', '2026-09-28T14:00:00', 'fim_local', '2026-09-28T15:00:00',
    'lembretes', jsonb_build_array(-1440),
    'regra', jsonb_build_object('freq','daily','intervalo',1,'dias_semana',null,'mensal_modo',null,'mensal_ordinal',null,'ate','2026-10-04','contagem',null))), '{}');
  assert pg_temp.tick('2026-10-05 14:05-03') = 1, 'series ended yesterday: -1440 reminder on its last occurrence not fired';
  update agenda_ocorrencias set cancelada = true where conta_id = v_ws;

  -- a one-off 3 days old is not probed: its occurrence is forced into the
  -- window (an inconsistent state no RPC produces) and still gets no claim
  v_oc := pg_temp.criar(v_o, pg_temp.p('{"inicio_local":"2026-10-02T14:00:00","fim_local":"2026-10-02T15:00:00","lembretes":[10]}'), '{}');
  update agenda_ocorrencias set inicio = '2026-10-05 14:05-03', fim = '2026-10-05 15:05-03' where id = v_oc;
  assert pg_temp.tick('2026-10-05 14:00-03') = 0, 'a one-off 3 days old was probed';
  perform 1 from agenda_lembretes where ocorrencia_id = v_oc;
  assert not found, 'ledger row for a one-off 3 days old';
  update agenda_ocorrencias set cancelada = true where conta_id = v_ws;

  -- a series whose ate passed 3 days ago is not probed either
  v_oc := pg_temp.criar(v_o, pg_temp.p(jsonb_build_object('inicio_local', '2026-09-28T14:00:00', 'fim_local', '2026-09-28T15:00:00',
    'lembretes', jsonb_build_array(10),
    'regra', jsonb_build_object('freq','daily','intervalo',1,'dias_semana',null,'mensal_modo',null,'mensal_ordinal',null,'ate','2026-10-02','contagem',null))), '{}');
  select o.evento_id into v_ev from agenda_ocorrencias o where o.id = v_oc;
  select o.id into v_oc from agenda_ocorrencias o where o.evento_id = v_ev and o.data_original = '2026-10-02';
  update agenda_ocorrencias set inicio = '2026-10-05 16:05-03', fim = '2026-10-05 17:05-03' where id = v_oc;
  assert pg_temp.tick('2026-10-05 16:00-03') = 0, 'a series ended 3 days ago was probed';
  perform 1 from agenda_lembretes where ocorrencia_id = v_oc;
  assert not found, 'ledger row for a series ended 3 days ago';
  -- but an occurrence moved by hand past that ate (horario_alterado) is found
  update agenda_ocorrencias set horario_alterado = true where id = v_oc;
  assert pg_temp.tick('2026-10-05 16:00-03') = 1, 'occurrence moved past ate missed';
  assert pg_temp.tick('2026-10-05 16:01-03') = 0, 'moved occurrence claimed twice';
  perform 1 from agenda_lembretes where ocorrencia_id = v_oc and minutos = 10 and inicio_alvo = '2026-10-05 16:05-03';
  assert found, 'moved occurrence ledger row';
  update agenda_ocorrencias set cancelada = true where conta_id = v_ws;
  -- a moved occurrence of a live series is claimed once (the branches never overlap)
  v_oc := pg_temp.criar(v_o, pg_temp.p(jsonb_build_object('inicio_local', '2026-10-05T09:00:00', 'fim_local', '2026-10-05T10:00:00',
    'lembretes', jsonb_build_array(10), 'regra', jsonb_build_object('freq','daily','intervalo',1,'dias_semana',null,'mensal_modo',null,'mensal_ordinal',null,'ate',null,'contagem',null))), '{}');
  select o.evento_id into v_ev from agenda_ocorrencias o where o.id = v_oc;
  select o.id into v_oc from agenda_ocorrencias o where o.evento_id = v_ev and o.data_original = '2026-10-06';
  update agenda_ocorrencias set inicio = '2026-10-06 18:05-03', fim = '2026-10-06 19:05-03', horario_alterado = true where id = v_oc;
  assert pg_temp.tick('2026-10-06 18:00-03') = 1, 'moved occurrence of a live series not claimed exactly once';

  -- mark fence: a mark more than 5 minutes after the lease ended is dropped
  delete from agenda_lembretes where ocorrencia_id <> v_oc;
  execute 'set local role service_role';
  select count(*) into v_n from public.agenda_claim_emails_lembrete(10);
  execute 'reset role';
  assert v_n = 1, format('fence setup: %s claimed', v_n);
  update agenda_lembretes set email_lease_ate = now() - interval '6 minutes' where ocorrencia_id = v_oc;
  execute 'set local role service_role';
  perform public.agenda_marcar_email_lembrete(v_oc, v_o, 10, '2026-10-06 18:05-03', true);
  execute 'reset role';
  select email_status into v_status from agenda_lembretes where ocorrencia_id = v_oc;
  assert v_status = 'enviando', format('a very stale mark landed: %s', v_status);
  update agenda_lembretes set email_lease_ate = now() - interval '4 minutes' where ocorrencia_id = v_oc;
  execute 'set local role service_role';
  perform public.agenda_marcar_email_lembrete(v_oc, v_o, 10, '2026-10-06 18:05-03', true);
  execute 'reset role';
  select email_status into v_status from agenda_lembretes where ocorrencia_id = v_oc;
  assert v_status = 'enviado', format('a mark within 5 minutes of the lease did not land: %s', v_status);

  raise notice 'PASS 99_agenda_lembretes (bounded candidates, mark fence)';
end $$;

-- ============ block 3c: the claim re-checks involvement; no anon on date helpers ============
do $$
declare
  v_ws uuid;
  v_o uuid := gen_random_uuid();
  v_rem uuid := gen_random_uuid();   -- removed from the event
  v_sai uuid := gen_random_uuid();   -- removed from the workspace
  v_occ uuid := gen_random_uuid();   -- answers nao for this occurrence
  v_ser uuid := gen_random_uuid();   -- answers nao for the series
  v_fica uuid := gen_random_uuid();  -- still involved
  v_oc bigint; v_ev bigint;
  v_n int;
  v_users uuid[];
  v_f text;
begin
  perform set_config('app.agenda_hoje', '2026-10-05', true);
  delete from agenda_lembretes;
  v_ws := et_make_workspace('max');
  insert into auth.users (id) values (v_o), (v_rem), (v_sai), (v_occ), (v_ser), (v_fica);
  insert into workspace_members (user_id, workspace_id, role) values
    (v_o, v_ws, 'owner'), (v_rem, v_ws, 'agent'), (v_sai, v_ws, 'agent'),
    (v_occ, v_ws, 'agent'), (v_ser, v_ws, 'agent'), (v_fica, v_ws, 'agent');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id in (v_o, v_rem, v_sai, v_occ, v_ser, v_fica);

  -- a private event; the tick writes pendente rows for all six
  v_oc := pg_temp.criar(v_o, pg_temp.p('{"titulo":"Privado","privado":true,"inicio_local":"2027-05-03T14:00:00","fim_local":"2027-05-03T15:00:00"}'),
                        array[v_rem, v_sai, v_occ, v_ser, v_fica]);
  select o.evento_id into v_ev from agenda_ocorrencias o where o.id = v_oc;
  assert pg_temp.tick('2027-05-03 13:50-03') = 6, 'involvement setup: six claims';
  select count(*) into v_n from agenda_lembretes where ocorrencia_id = v_oc and email_status = 'pendente';
  assert v_n = 6, format('involvement setup: %s pendente', v_n);

  -- then, while e-mail is down, the involvement changes
  delete from agenda_participantes where evento_id = v_ev and user_id = v_rem;
  delete from workspace_members where workspace_id = v_ws and user_id = v_sai;
  insert into agenda_respostas (ocorrencia_id, conta_id, user_id, resposta) values (v_oc, v_ws, v_occ, 'nao');
  update agenda_participantes set resposta = 'nao' where evento_id = v_ev and user_id = v_ser;
  -- a per-occurrence sim overrides a series nao (the effective answer, like the tick)
  update agenda_participantes set resposta = 'nao' where evento_id = v_ev and user_id = v_fica;
  insert into agenda_respostas (ocorrencia_id, conta_id, user_id, resposta) values (v_oc, v_ws, v_fica, 'sim');

  execute 'set local role service_role';
  select array_agg(c.user_id order by c.user_id) into v_users from public.agenda_claim_emails_lembrete(10) c;
  execute 'reset role';
  assert v_users = (select array_agg(u order by u) from unnest(array[v_o, v_fica]) u),
    format('claimed recipients: %s', v_users);
  select count(*) into v_n from agenda_lembretes
   where ocorrencia_id = v_oc and email_status = 'nao' and user_id in (v_rem, v_sai, v_occ, v_ser);
  assert v_n = 4, format('no-longer-involved rows not settled as nao: %s', v_n);
  select count(*) into v_n from agenda_lembretes
   where ocorrencia_id = v_oc and email_status = 'enviando' and user_id in (v_o, v_fica);
  assert v_n = 2, format('involved rows not claimed: %s', v_n);

  -- an expired lease of someone removed meanwhile is settled too, not re-claimed
  delete from agenda_participantes where evento_id = v_ev and user_id = v_fica;
  update agenda_lembretes set email_lease_ate = now() - interval '1 second' where ocorrencia_id = v_oc and user_id in (v_o, v_fica);
  execute 'set local role service_role';
  select array_agg(c.user_id) into v_users from public.agenda_claim_emails_lembrete(10) c;
  execute 'reset role';
  assert v_users = array[v_o], format('re-claim after removal: %s', v_users);
  perform 1 from agenda_lembretes where ocorrencia_id = v_oc and user_id = v_fica and email_status = 'nao';
  assert found, 'removed participant with an expired lease not settled as nao';

  -- the pure date helpers: no EXECUTE for anon; authenticated and service_role keep it
  foreach v_f in array array['public.agenda_hoje(text)',
                             'public.agenda_datas_regra(public.agenda_eventos, date, date)',
                             'public.agenda_normalizar_dtstart(public.agenda_eventos)',
                             'public.agenda_inicio_fim(public.agenda_eventos, date)'] loop
    assert not has_function_privilege('anon', v_f, 'EXECUTE'), format('anon can execute %s', v_f);
    assert has_function_privilege('authenticated', v_f, 'EXECUTE'), format('authenticated cannot execute %s', v_f);
    assert has_function_privilege('service_role', v_f, 'EXECUTE'), format('service_role cannot execute %s', v_f);
  end loop;

  raise notice 'PASS 99_agenda_lembretes (claim re-checks involvement, date helper grants)';
end $$;

-- ============ block 4: rollback runbook (inside this transaction, rolled back) ============
\i docs/superpowers/specs/assets/2026-10-05-agenda-rollback.sql

do $$
declare
  v_ws uuid;
  v_user uuid := gen_random_uuid();
  v_t text;
  v_rejected boolean;
begin
  v_ws := et_make_workspace('start');
  insert into auth.users (id) values (v_user);
  insert into workspace_members (user_id, workspace_id, role) values (v_user, v_ws, 'owner');

  foreach v_t in array array['event_invited','event_updated','event_cancelled','event_rsvp','event_reminder'] loop
    v_rejected := false;
    begin
      insert into notifications (workspace_id, user_id, type) values (v_ws, v_user, v_t);
    exception when check_violation then v_rejected := true; end;
    assert v_rejected, format('after rollback notifications still accepts %s', v_t);
    v_rejected := false;
    begin
      insert into notification_inapp_prefs (user_id, type, enabled) values (v_user, v_t, true);
    exception when check_violation then v_rejected := true; end;
    assert v_rejected, format('after rollback notification_inapp_prefs still accepts %s', v_t);
  end loop;
  v_rejected := false;
  begin
    insert into notification_email_prefs (user_id, type, enabled) values (v_user, 'event_invited', true);
  exception when check_violation then v_rejected := true; end;
  assert v_rejected, 'after rollback notification_email_prefs still accepts event_invited';

  insert into notifications (workspace_id, user_id, type) values (v_ws, v_user, 'task_assigned');
  insert into notification_inapp_prefs (user_id, type, enabled) values (v_user, 'task_assigned', true);
  insert into notification_email_prefs (user_id, type, enabled) values (v_user, 'task_assigned', true);
  insert into notification_email_prefs (user_id, type, enabled) values (v_user, '__all__', true);

  assert position('event_' in pg_get_functiondef('public.claim_notification_emails(timestamptz, timestamptz, int)'::regprocedure)) = 0,
    'claim_notification_emails still lists an event_ type';
  assert position('''mention''' in pg_get_functiondef('public.claim_notification_emails(timestamptz, timestamptz, int)'::regprocedure)) > 0,
    'claim_notification_emails lost mention';
  assert has_function_privilege('service_role', 'public.claim_notification_emails(timestamptz, timestamptz, int)', 'EXECUTE'),
    'rollback dropped the claim grant';
  assert to_regclass('public.agenda_eventos') is null and to_regclass('public.agenda_lembretes') is null, 'agenda tables survived the rollback';
  assert not exists (select 1 from pg_proc where proname like 'agenda\_%'), 'agenda functions survived the rollback';
  assert not exists (select 1 from cron.job where jobname in ('agenda-lembretes', 'agenda-horizonte')), 'agenda cron jobs survived the rollback';

  raise notice 'PASS 99_agenda_lembretes (rollback runbook)';
end $$;

rollback;
