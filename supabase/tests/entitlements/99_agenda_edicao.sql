\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Agenda (20261005000001_agenda_eventos.sql §3/§4): write RPCs. Block 1 covers
-- agenda_evento_criar (payload validation, dtstart normalization, participants,
-- materialization, event_invited fan-out); block 2 the notification types and
-- the digest claim. Later tasks append blocks (edit/delete/RSVP) before the
-- final rollback.
--
-- Blocks 1-5 use literal dates. That is safe only because no literal there is
-- compared with the real clock: app.agenda_hoje is pinned to a literal too, and
-- block 2's digest rows are stamped relative to now(). Anything that compares against now() (the reminder e-mail claim
-- and mark fence, the iCal feed, the Hub, agenda_responder 'todas') must build
-- its fixtures from current_date instead, as block 6 does.

begin;
-- Agenda rollout flag (feature_agenda, migration A): on for every plan inside
-- this transaction; 99_agenda_feature_flag.sql covers the flag-off paths.
update plans set feature_agenda = true;
select et_grant_hosted_parity(array['agenda_eventos','agenda_ocorrencias','agenda_participantes','agenda_respostas']);
revoke all on public.agenda_eventos, public.agenda_ocorrencias, public.agenda_participantes, public.agenda_respostas from anon, authenticated;
grant select on public.agenda_eventos, public.agenda_ocorrencias, public.agenda_participantes, public.agenda_respostas to authenticated;
grant all on public.agenda_eventos, public.agenda_ocorrencias, public.agenda_participantes, public.agenda_respostas to service_role;

-- base create payload (every key present, as the form sends it) merged with overrides
create or replace function pg_temp.payload(p jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object(
    'titulo', 'Gravação: Clínica Sorriso', 'descricao', null, 'local', null, 'link_reuniao', null,
    'tipo', 'gravacao', 'cor', null, 'cliente_id', null, 'privado', false, 'dia_inteiro', false,
    'tz', 'America/Sao_Paulo', 'inicio_local', '2026-10-05T14:00:00', 'fim_local', '2026-10-05T16:00:00',
    'lembretes', jsonb_build_array(10, 1440), 'regra', null) || p;
$$;
-- error message of agenda_evento_criar(p, parts), or NULL when it succeeds
create or replace function pg_temp.erro_criar(p jsonb, parts uuid[] default '{}') returns text language plpgsql as $$
begin
  perform public.agenda_evento_criar(p, parts);
  return null;
exception when others then
  return sqlerrm;
end $$;
grant execute on all functions in schema pg_temp to authenticated, service_role;

-- ============ block 1: agenda_evento_criar ============
do $$
declare
  v_ws_a uuid; v_ws_b uuid;
  v_owner uuid := gen_random_uuid();
  v_b1 uuid := gen_random_uuid();
  v_b2 uuid := gen_random_uuid();
  v_ver uuid := gen_random_uuid();      -- custom role calendario ver (no editar)
  v_x uuid := gen_random_uuid();        -- member of ws B only
  v_role_ver uuid;
  v_cli_a bigint; v_cli_b bigint;
  v_ev bigint; v_oc bigint; v_dt timestamp;
  v_n bigint;
  v_msg text;
  v_meta jsonb; v_link text;
  v_cinquenta uuid[];
  r record;
begin
  perform set_config('app.agenda_hoje', '2026-10-05', true);
  v_ws_a := et_make_workspace('max');
  v_ws_b := et_make_workspace('start');
  insert into auth.users (id) values (v_owner), (v_b1), (v_b2), (v_ver), (v_x);
  insert into workspace_roles (conta_id, nome, permissions)
    values (v_ws_a, 'Só vê a agenda', '{"calendario":"ver"}') returning id into v_role_ver;
  insert into workspace_members (user_id, workspace_id, role) values
    (v_owner, v_ws_a, 'owner'), (v_b1, v_ws_a, 'agent'), (v_b2, v_ws_a, 'agent'), (v_x, v_ws_b, 'owner');
  insert into workspace_members (user_id, workspace_id, role, role_id) values (v_ver, v_ws_a, 'agent', v_role_ver);
  update profiles set conta_id = v_ws_a, active_workspace_id = v_ws_a where id in (v_owner, v_b1, v_b2, v_ver);
  update profiles set conta_id = v_ws_b, active_workspace_id = v_ws_b where id = v_x;
  update profiles set nome = 'Olga Dona' where id = v_owner;
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (v_owner, v_ws_a, 'Clínica A', 'CA', '#000') returning id into v_cli_a;
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (v_x, v_ws_b, 'Clínica B', 'CB', '#000') returning id into v_cli_b;

  -- grants
  assert has_function_privilege('authenticated', 'public.agenda_evento_criar(jsonb, uuid[])', 'EXECUTE'), 'authenticated must execute agenda_evento_criar';
  assert has_function_privilege('anon', 'public.agenda_evento_criar(jsonb, uuid[])', 'EXECUTE') = false, 'anon must not execute agenda_evento_criar';
  assert has_function_privilege('authenticated', 'public.agenda_validar_payload(uuid, jsonb, public.agenda_eventos)', 'EXECUTE') = false, 'authenticated executes agenda_validar_payload';
  assert has_function_privilege('authenticated', 'public.agenda_notificar(uuid, bigint, bigint, text, uuid[], uuid, jsonb)', 'EXECUTE') = false, 'authenticated executes agenda_notificar';

  -- ---- as the owner of ws A ----
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  -- weekly on Tuesday with a Monday start: dtstart normalized to Tuesday
  select c.evento_id, c.ocorrencia_id, c.dtstart into v_ev, v_oc, v_dt
    from public.agenda_evento_criar(
      pg_temp.payload(jsonb_build_object('cliente_id', v_cli_a,
        'regra', '{"freq":"weekly","intervalo":1,"dias_semana":[2],"mensal_modo":null,"mensal_ordinal":null,"ate":null,"contagem":null}'::jsonb)),
      array[v_b1, v_b2, v_owner, v_b1]) c;
  assert v_dt = '2026-10-06 14:00', format('criar: dtstart not normalized (%s)', v_dt);
  execute 'reset role';

  select count(*) into v_n from agenda_ocorrencias where evento_id = v_ev;
  assert v_n = 105, format('criar: expected 105 Tuesdays to the horizon, got %s', v_n);
  perform 1 from agenda_ocorrencias where id = v_oc and evento_id = v_ev and data_original = '2026-10-06'
     and inicio = '2026-10-06 17:00+00' and fim = '2026-10-06 19:00+00';
  assert found, 'criar: returned occurrence is not the first one (2026-10-06 14:00-16:00 SP)';
  select * into r from agenda_eventos where id = v_ev;
  assert r.organizador_id = v_owner and r.conta_id = v_ws_a and r.duracao_min = 120 and r.lembretes = '{10,1440}'
     and r.cliente_id = v_cli_a and r.tipo = 'gravacao' and r.freq = 'weekly' and r.dias_semana = '{2}'
     and r.tz = 'America/Sao_Paulo' and r.horizonte_ate = '2028-10-05' and not r.materializacao_completa,
    format('criar: stored series is wrong: %s', to_jsonb(r));
  perform 1 from agenda_participantes where evento_id = v_ev and user_id = v_owner and resposta = 'sim';
  assert found, 'criar: organizer is not a participant with sim';
  select count(*) into v_n from agenda_participantes where evento_id = v_ev and user_id in (v_b1, v_b2) and resposta = 'pendente';
  assert v_n = 2, format('criar: expected B1 and B2 pendente, got %s', v_n);
  select count(*) into v_n from agenda_participantes where evento_id = v_ev;
  assert v_n = 3, format('criar: participants not deduplicated (%s rows)', v_n);

  -- event_invited: one per invitee, none for the organizer
  select count(*) into v_n from notifications where type = 'event_invited' and user_id = v_b1 and workspace_id = v_ws_a;
  assert v_n = 1, format('criar: B1 got %s event_invited', v_n);
  select count(*) into v_n from notifications where type = 'event_invited' and user_id = v_b2 and workspace_id = v_ws_a;
  assert v_n = 1, format('criar: B2 got %s event_invited', v_n);
  select count(*) into v_n from notifications where user_id = v_owner and type like 'event\_%';
  assert v_n = 0, 'criar: the organizer was notified';
  select metadata, link into v_meta, v_link from notifications where type = 'event_invited' and user_id = v_b1;
  assert v_link = '/calendario?evento=' || v_oc, format('criar: link %s', v_link);
  assert v_meta->>'titulo' = 'Gravação: Clínica Sorriso', format('metadata titulo: %s', v_meta);
  assert v_meta->>'ator_nome' = 'Olga Dona', format('metadata ator_nome: %s', v_meta);
  assert (v_meta->>'evento_id')::bigint = v_ev and (v_meta->>'ocorrencia_id')::bigint = v_oc, format('metadata ids: %s', v_meta);
  assert (v_meta->>'inicio')::timestamptz = '2026-10-06 17:00+00' and (v_meta->>'fim')::timestamptz = '2026-10-06 19:00+00',
    format('metadata inicio/fim: %s', v_meta);
  assert v_meta->>'data_local' = '2026-10-06', format('metadata data_local: %s', v_meta);
  assert v_meta->'dia_inteiro' = 'false'::jsonb and v_meta->'recorrente' = 'true'::jsonb, format('metadata flags: %s', v_meta);
  assert v_meta ? 'escopo', format('metadata lacks escopo: %s', v_meta);
  assert not (v_meta ? 'motivo'), format('metadata carries motivo on an invite: %s', v_meta);

  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  -- all-day: duracao_dias from the exclusive end date
  select c.evento_id, c.ocorrencia_id into v_ev, v_oc from public.agenda_evento_criar(
    pg_temp.payload('{"dia_inteiro":true,"inicio_local":"2026-10-10T00:00:00","fim_local":"2026-10-12T00:00:00","lembretes":[]}'),
    '{}') c;
  perform 1 from agenda_ocorrencias where id = v_oc and inicio = '2026-10-10 03:00+00' and fim = '2026-10-12 03:00+00';
  assert found, 'criar all-day: occurrence inicio/fim wrong';
  perform 1 from agenda_eventos where id = v_ev and dia_inteiro and duracao_dias = 2 and duracao_min is null
     and dtstart = '2026-10-10 00:00' and materializacao_completa;
  assert found, 'criar all-day: stored series wrong';

  -- an event past the 24-month horizon: no occurrence yet, real dtstart, stays open
  select c.evento_id, c.ocorrencia_id, c.dtstart into v_ev, v_oc, v_dt from public.agenda_evento_criar(
    pg_temp.payload('{"inicio_local":"2029-01-10T10:00:00","fim_local":"2029-01-10T11:00:00"}'), array[v_b1]) c;
  assert v_oc is null and v_dt = '2029-01-10 10:00', format('criar past horizon: ocorrencia %s dtstart %s', v_oc, v_dt);
  execute 'reset role';
  perform 1 from agenda_eventos where id = v_ev and not materializacao_completa;
  assert found, 'criar past horizon: series marked complete';
  select link into v_link from notifications where type = 'event_invited' and user_id = v_b1 and (metadata->>'evento_id')::bigint = v_ev;
  assert v_link = '/calendario?data=2029-01-10', format('criar past horizon: link %s', v_link);

  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  -- membership and tenant checks
  v_msg := pg_temp.erro_criar(pg_temp.payload(), array[v_b1, v_x]);
  assert v_msg = 'agenda: participante fora do workspace', format('foreign participant: %s', v_msg);
  v_msg := pg_temp.erro_criar(pg_temp.payload(jsonb_build_object('cliente_id', v_cli_b)));
  assert v_msg = 'agenda: cliente não encontrado', format('foreign cliente: %s', v_msg);
  v_msg := pg_temp.erro_criar(pg_temp.payload(), (select array_agg(gen_random_uuid()) from generate_series(1, 51)));
  assert v_msg = 'agenda: no máximo 50 participantes', format('51 participants: %s', v_msg);
  -- upper edge: 50 others plus the organizer is accepted
  execute 'reset role';
  select array_agg(gen_random_uuid()) into v_cinquenta from generate_series(1, 50);
  insert into auth.users (id) select unnest(v_cinquenta);
  insert into workspace_members (user_id, workspace_id, role) select u, v_ws_a, 'agent' from unnest(v_cinquenta) u;
  execute 'set local role authenticated';
  select c.evento_id into v_ev from public.agenda_evento_criar(pg_temp.payload(), v_cinquenta || v_owner) c;
  execute 'reset role';
  select count(*) into v_n from agenda_participantes where evento_id = v_ev;
  assert v_n = 51, format('50 others + organizer: %s participant rows', v_n);
  execute 'set local role authenticated';

  -- descricao is trimmed like the other text fields
  select c.evento_id into v_ev from public.agenda_evento_criar(pg_temp.payload('{"descricao":"  Pauta  "}'), '{}') c;
  assert (select e.descricao from agenda_eventos e where e.id = v_ev) = 'Pauta', 'descricao not trimmed';
  select c.evento_id into v_ev from public.agenda_evento_criar(pg_temp.payload('{"descricao":"   "}'), '{}') c;
  assert (select e.descricao from agenda_eventos e where e.id = v_ev) is null, 'blank descricao not NULL';

  -- overlong text fields get pt-BR errors, not the raw CHECK
  v_msg := pg_temp.erro_criar(pg_temp.payload(jsonb_build_object('titulo', repeat('a', 201))));
  assert v_msg = 'agenda: o título pode ter no máximo 200 caracteres', format('201-char title: %s', v_msg);
  assert pg_temp.erro_criar(pg_temp.payload(jsonb_build_object('titulo', repeat('a', 200)))) is null, '200-char title rejected';
  v_msg := pg_temp.erro_criar(pg_temp.payload(jsonb_build_object('descricao', repeat('a', 5001))));
  assert v_msg = 'agenda: a descrição pode ter no máximo 5000 caracteres', format('5001-char description: %s', v_msg);
  v_msg := pg_temp.erro_criar(pg_temp.payload(jsonb_build_object('local', repeat('a', 301))));
  assert v_msg = 'agenda: o local pode ter no máximo 300 caracteres', format('301-char local: %s', v_msg);

  -- lower bound: 400 days before today (2026-10-05 - 400 = 2025-08-31)
  v_msg := pg_temp.erro_criar(pg_temp.payload('{"inicio_local":"2025-08-31T14:00:00","fim_local":"2025-08-31T15:00:00"}'));
  assert v_msg = 'agenda: a data de início é antiga demais', format('old dtstart: %s', v_msg);
  -- 300 days back is fine
  assert pg_temp.erro_criar(pg_temp.payload('{"inicio_local":"2025-12-09T14:00:00","fim_local":"2025-12-09T15:00:00"}')) is null,
    'dtstart 300 days back rejected';

  -- validation messages
  v_msg := pg_temp.erro_criar(pg_temp.payload('{"titulo":"   "}'));
  assert v_msg = 'agenda: informe um título', format('blank title: %s', v_msg);
  v_msg := pg_temp.erro_criar(pg_temp.payload('{"titulo":null}'));
  assert v_msg = 'agenda: informe um título', format('null title: %s', v_msg);
  v_msg := pg_temp.erro_criar(pg_temp.payload() - 'titulo');
  assert v_msg = 'agenda: dados do evento incompletos', format('missing title key: %s', v_msg);
  v_msg := pg_temp.erro_criar(pg_temp.payload() - 'fim_local');
  assert v_msg = 'agenda: dados do evento incompletos', format('missing fim_local: %s', v_msg);
  v_msg := pg_temp.erro_criar(pg_temp.payload('{"fim_local":"2026-10-05T14:00:00"}'));
  assert v_msg = 'agenda: o fim precisa ser depois do início', format('fim = inicio: %s', v_msg);
  v_msg := pg_temp.erro_criar(pg_temp.payload('{"fim_local":"2026-10-05T13:00:00"}'));
  assert v_msg = 'agenda: o fim precisa ser depois do início', format('fim < inicio: %s', v_msg);
  v_msg := pg_temp.erro_criar(pg_temp.payload('{"dia_inteiro":true,"inicio_local":"2026-10-10T00:00:00","fim_local":"2026-10-10T00:00:00"}'));
  assert v_msg = 'agenda: o fim precisa ser depois do início', format('all-day zero days: %s', v_msg);
  v_msg := pg_temp.erro_criar(pg_temp.payload('{"link_reuniao":"javascript:alert(1)"}'));
  assert v_msg = 'agenda: link da reunião inválido', format('bad link: %s', v_msg);
  v_msg := pg_temp.erro_criar(pg_temp.payload('{"link_reuniao":"meet.google.com/abc"}'));
  assert v_msg = 'agenda: link da reunião inválido', format('schemeless link: %s', v_msg);
  v_msg := pg_temp.erro_criar(pg_temp.payload('{"tz":"Mars/Olympus"}'));
  assert v_msg = 'agenda: fuso horário inválido', format('bad tz: %s', v_msg);
  v_msg := pg_temp.erro_criar(pg_temp.payload('{"lembretes":[10,10]}'));
  assert v_msg = 'agenda: lembrete inválido', format('duplicate reminder: %s', v_msg);
  v_msg := pg_temp.erro_criar(pg_temp.payload('{"lembretes":[1,2,3,4,5,6]}'));
  assert v_msg = 'agenda: lembrete inválido', format('6 reminders: %s', v_msg);
  v_msg := pg_temp.erro_criar(pg_temp.payload('{"lembretes":["10"]}'));
  assert v_msg = 'agenda: lembrete inválido', format('string reminder: %s', v_msg);
  v_msg := pg_temp.erro_criar(pg_temp.payload('{"regra":{"freq":"weekly","intervalo":1,"dias_semana":[7],"mensal_modo":null,"mensal_ordinal":null,"ate":null,"contagem":null}}'));
  assert v_msg = 'agenda: dias da semana inválidos', format('weekday 7: %s', v_msg);
  v_msg := pg_temp.erro_criar(pg_temp.payload('{"regra":{"freq":"weekly","intervalo":1,"dias_semana":null,"mensal_modo":null,"mensal_ordinal":null,"ate":null,"contagem":null}}'));
  assert v_msg = 'agenda: dias da semana inválidos', format('weekly without days: %s', v_msg);
  v_msg := pg_temp.erro_criar(pg_temp.payload('{"regra":{"freq":"weekly","intervalo":1,"dias_semana":[2],"mensal_modo":null,"mensal_ordinal":null,"ate":"2026-10-05","contagem":null}}'));
  assert v_msg = 'agenda: a repetição não gera nenhuma data', format('rule without dates: %s', v_msg);
  v_msg := pg_temp.erro_criar(pg_temp.payload('{"regra":{"freq":"hourly","intervalo":1,"dias_semana":null,"mensal_modo":null,"mensal_ordinal":null,"ate":null,"contagem":null}}'));
  assert v_msg = 'agenda: repetição inválida', format('bad freq: %s', v_msg);
  v_msg := pg_temp.erro_criar(pg_temp.payload('{"regra":{"freq":"daily","intervalo":1,"dias_semana":null,"mensal_modo":null,"mensal_ordinal":null,"ate":"2026-10-30","contagem":3}}'));
  assert v_msg = 'agenda: repetição inválida', format('ate and contagem: %s', v_msg);
  v_msg := pg_temp.erro_criar(pg_temp.payload('{"tipo":"festa"}'));
  assert v_msg = 'agenda: dados do evento inválidos', format('bad tipo: %s', v_msg);
  v_msg := pg_temp.erro_criar(pg_temp.payload('{"privado":"sim"}'));
  assert v_msg = 'agenda: dados do evento inválidos', format('non-boolean privado: %s', v_msg);
  v_msg := pg_temp.erro_criar(pg_temp.payload('{"inicio_local":"amanhã"}'));
  assert v_msg = 'agenda: dados do evento inválidos', format('unparseable inicio_local: %s', v_msg);
  v_msg := pg_temp.erro_criar(pg_temp.payload('{"fim_local":"2026-10-20T16:00:00"}'));
  assert v_msg = 'agenda: o evento é longo demais', format('15-day timed event: %s', v_msg);
  execute 'reset role';

  -- monthly by ordinal weekday: dias_semana sent by the form is ignored, ordinal kept
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select c.evento_id, c.dtstart into v_ev, v_dt from public.agenda_evento_criar(
    pg_temp.payload('{"inicio_local":"2026-10-13T09:00:00","fim_local":"2026-10-13T10:00:00","regra":{"freq":"monthly","intervalo":1,"dias_semana":[2],"mensal_modo":"dia_semana","mensal_ordinal":2,"ate":null,"contagem":3}}'),
    '{}') c;
  execute 'reset role';
  perform 1 from agenda_eventos where id = v_ev and dias_semana is null and mensal_modo = 'dia_semana' and mensal_ordinal = 2
     and contagem = 3 and materializacao_completa;
  assert found, 'criar monthly: rule stored wrong';
  select count(*) into v_n from agenda_ocorrencias where evento_id = v_ev;
  assert v_n = 3, format('criar monthly contagem 3: %s rows', v_n);

  -- ---- a custom role without calendario editar cannot create ----
  perform set_config('request.jwt.claims', json_build_object('sub', v_ver, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_msg := pg_temp.erro_criar(pg_temp.payload());
  assert v_msg = 'agenda: você não pode criar eventos', format('role without editar: %s', v_msg);
  execute 'reset role';

  -- ---- a session with no active workspace ----
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_msg := pg_temp.erro_criar(pg_temp.payload());
  assert v_msg = 'agenda: sessão sem workspace ativo', format('no workspace: %s', v_msg);
  execute 'reset role';

  raise notice 'PASS 99_agenda_edicao (criar)';
end $$;

-- ============ block 2: notification types and the digest claim ============
do $$
declare
  v_ws uuid;
  v_user uuid := gen_random_uuid();
  v_t text;
  v_inv uuid; v_rem uuid; v_rsvp uuid; v_upd uuid; v_canc uuid;
  v_crsvp uuid; v_resched uuid;
  v_claimed uuid[];
  v_rejected boolean;
begin
  v_ws := et_make_workspace('start');
  insert into auth.users (id) values (v_user);
  insert into workspace_members (user_id, workspace_id, role) values (v_user, v_ws, 'owner');

  execute 'set local role service_role';
  foreach v_t in array array['event_invited','event_updated','event_cancelled','event_rsvp','event_reminder',
                            'event_client_rsvp','event_reschedule_requested'] loop
    insert into notifications (workspace_id, user_id, type, metadata, link)
      values (v_ws, v_user, v_t, '{}', '/calendario');
  end loop;
  execute 'reset role';

  foreach v_t in array array['event_invited','event_updated','event_cancelled','event_rsvp','event_reminder',
                            'event_client_rsvp','event_reschedule_requested','__all__'] loop
    insert into notification_inapp_prefs (user_id, type, enabled) values (v_user, v_t, true)
      on conflict (user_id, type) do nothing;
  end loop;
  -- event_client_rsvp / event_reschedule_requested (20261007000001_agenda_hub.sql) go to the team digest
  foreach v_t in array array['event_invited','event_updated','event_cancelled','event_reminder',
                            'event_client_rsvp','event_reschedule_requested'] loop
    insert into notification_email_prefs (user_id, type, enabled) values (v_user, v_t, true);
  end loop;
  v_rejected := false;
  begin
    insert into notification_email_prefs (user_id, type, enabled) values (v_user, 'event_rsvp', true);
  exception when check_violation then v_rejected := true; end;
  assert v_rejected, 'notification_email_prefs accepted event_rsvp (no e-mail for RSVPs)';
  -- the existing types still pass
  insert into notifications (workspace_id, user_id, type) values (v_ws, v_user, 'instagram_automation_failed');
  insert into notification_email_prefs (user_id, type, enabled) values (v_user, 'post_approved', true);

  -- claim: old event_invited / event_updated / event_cancelled rows are claimed, event_reminder / event_rsvp never
  insert into notifications (workspace_id, user_id, type, created_at) values (v_ws, v_user, 'event_invited', now() - interval '15 minutes') returning id into v_inv;
  insert into notifications (workspace_id, user_id, type, created_at) values (v_ws, v_user, 'event_updated', now() - interval '15 minutes') returning id into v_upd;
  insert into notifications (workspace_id, user_id, type, created_at) values (v_ws, v_user, 'event_cancelled', now() - interval '15 minutes') returning id into v_canc;
  insert into notifications (workspace_id, user_id, type, created_at) values (v_ws, v_user, 'event_client_rsvp', now() - interval '15 minutes') returning id into v_crsvp;
  insert into notifications (workspace_id, user_id, type, created_at) values (v_ws, v_user, 'event_reschedule_requested', now() - interval '15 minutes') returning id into v_resched;
  insert into notifications (workspace_id, user_id, type, created_at) values (v_ws, v_user, 'event_reminder', now() - interval '15 minutes') returning id into v_rem;
  insert into notifications (workspace_id, user_id, type, created_at) values (v_ws, v_user, 'event_rsvp', now() - interval '15 minutes') returning id into v_rsvp;

  execute 'set local role service_role';
  select array_agg(c.id) into v_claimed from public.claim_notification_emails(now() - interval '10 minutes', now() - interval '1 day', 100) c;
  assert v_inv = any (v_claimed), 'claim_notification_emails did not claim an event_invited row';
  assert v_upd = any (v_claimed), 'claim_notification_emails did not claim an event_updated row';
  assert v_canc = any (v_claimed), 'claim_notification_emails did not claim an event_cancelled row';
  assert v_crsvp = any (v_claimed), 'claim_notification_emails did not claim an event_client_rsvp row';
  assert v_resched = any (v_claimed), 'claim_notification_emails did not claim an event_reschedule_requested row';
  assert not (v_rem = any (v_claimed)) and not (v_rsvp = any (v_claimed)), 'claim_notification_emails claimed a reminder or RSVP row';
  execute 'reset role';
  perform 1 from notifications where id = v_rem and emailed_at is null;
  assert found, 'claim_notification_emails claimed an event_reminder row';
  perform 1 from notifications where id = v_rsvp and emailed_at is null;
  assert found, 'claim_notification_emails claimed an event_rsvp row';
  assert has_function_privilege('authenticated', 'public.claim_notification_emails(timestamptz, timestamptz, int)', 'EXECUTE') = false,
    'authenticated executes claim_notification_emails';
  assert has_function_privilege('service_role', 'public.claim_notification_emails(timestamptz, timestamptz, int)', 'EXECUTE'),
    'service_role lost claim_notification_emails';

  raise notice 'PASS 99_agenda_edicao (notification types)';
end $$;

-- ============ shared helpers for blocks 3-6 (edit, split, delete, RSVP) ============
-- Fixture: ws A ('max') with owner O, agents B1 B2 B3 AG, admin AD; ws B with X.
create or replace function pg_temp.fx() returns jsonb language plpgsql as $f$
declare
  v_ws uuid := et_make_workspace('max');
  v_wsb uuid := et_make_workspace('start');
  v jsonb := '{}';
  k text;
  u uuid;
begin
  foreach k in array array['o','b1','b2','b3','ag','ad','x'] loop
    u := gen_random_uuid();
    insert into auth.users (id) values (u);
    v := v || jsonb_build_object(k, u);
  end loop;
  insert into workspace_members (user_id, workspace_id, role) values
    ((v->>'o')::uuid, v_ws, 'owner'), ((v->>'b1')::uuid, v_ws, 'agent'), ((v->>'b2')::uuid, v_ws, 'agent'),
    ((v->>'b3')::uuid, v_ws, 'agent'), ((v->>'ag')::uuid, v_ws, 'agent'), ((v->>'ad')::uuid, v_ws, 'admin'),
    ((v->>'x')::uuid, v_wsb, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws
   where id in ((v->>'o')::uuid, (v->>'b1')::uuid, (v->>'b2')::uuid, (v->>'b3')::uuid, (v->>'ag')::uuid, (v->>'ad')::uuid);
  update profiles set conta_id = v_wsb, active_workspace_id = v_wsb where id = (v->>'x')::uuid;
  update profiles set nome = 'Olga' where id = (v->>'o')::uuid;
  update profiles set nome = 'Bia' where id = (v->>'b1')::uuid;
  return v || jsonb_build_object('ws', v_ws, 'wsb', v_wsb);
end $f$;
create or replace function pg_temp.como(p_user uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end $f$;
-- lookups bypass RLS (security definer, owner postgres) so they work under any role
create or replace function pg_temp.oc(p_ev bigint, p_d date) returns bigint language sql security definer as $f$
  select o.id from public.agenda_ocorrencias o where o.evento_id = p_ev and o.data_original = p_d;
$f$;
create or replace function pg_temp.row_oc(p_id bigint) returns public.agenda_ocorrencias language sql security definer as $f$
  select o from public.agenda_ocorrencias o where o.id = p_id;
$f$;
create or replace function pg_temp.row_ev(p_id bigint) returns public.agenda_eventos language sql security definer as $f$
  select e from public.agenda_eventos e where e.id = p_id;
$f$;
create or replace function pg_temp.nnotif(p_user uuid, p_tipo text) returns bigint language sql security definer as $f$
  select count(*) from public.notifications n where n.user_id = p_user and n.type = p_tipo;
$f$;
create or replace function pg_temp.limpa_notif(p_ws uuid) returns void language sql security definer as $f$
  delete from public.notifications n where n.workspace_id = p_ws;
$f$;
create or replace function pg_temp.sql(p text) returns bigint language plpgsql security definer as $f$
declare v bigint; begin execute p into v; return v; end $f$;
create or replace function pg_temp.erro_editar(p_oc bigint, p_esc text, p jsonb, parts uuid[] default null) returns text language plpgsql as $f$
begin
  perform public.agenda_evento_editar(p_oc, p_esc, p, parts);
  return null;
exception when others then
  return sqlerrm;
end $f$;
create or replace function pg_temp.erro_excluir(p_oc bigint, p_esc text) returns text language plpgsql as $f$
begin
  perform public.agenda_evento_excluir(p_oc, p_esc);
  return null;
exception when others then
  return sqlerrm;
end $f$;
create or replace function pg_temp.erro_responder(p_oc bigint, p_resp text, p_esc text) returns text language plpgsql as $f$
begin
  perform public.agenda_responder(p_oc, p_resp, p_esc);
  return null;
exception when others then
  return sqlerrm;
end $f$;
create or replace function pg_temp.semanal(p_dias int[], p_contagem int default null) returns jsonb language sql as $f$
  select jsonb_build_object('freq','weekly','intervalo',1,'dias_semana',to_jsonb(p_dias),'mensal_modo',null,
                            'mensal_ordinal',null,'ate',null,'contagem',p_contagem);
$f$;
grant execute on all functions in schema pg_temp to authenticated, service_role;

-- ============ block 3: agenda_evento_editar (esta / todas / permissions / participants) ============
do $$
declare
  f jsonb; v_ws uuid; v_o uuid; v_b1 uuid; v_b2 uuid; v_b3 uuid; v_ag uuid; v_ad uuid; v_x uuid;
  v_s bigint; v_t bigint; v_n1 bigint; v_old bigint; v_priv bigint; v_s2 bigint;
  v_ret bigint; v_oc bigint;
  v_msg text;
  o public.agenda_ocorrencias; e public.agenda_eventos;
begin
  perform set_config('app.agenda_hoje', '2026-10-05', true);
  f := pg_temp.fx();
  v_ws := f->>'ws'; v_o := f->>'o'; v_b1 := f->>'b1'; v_b2 := f->>'b2'; v_b3 := f->>'b3'; v_ag := f->>'ag'; v_ad := f->>'ad'; v_x := f->>'x';

  foreach v_msg in array array['public.agenda_evento_editar(bigint, text, jsonb, uuid[])',
                               'public.agenda_evento_excluir(bigint, text)',
                               'public.agenda_responder(bigint, text, text)'] loop
    assert has_function_privilege('authenticated', v_msg, 'EXECUTE'), format('authenticated must execute %s', v_msg);
    assert has_function_privilege('anon', v_msg, 'EXECUTE') = false, format('anon must not execute %s', v_msg);
  end loop;
  foreach v_msg in array array['public.agenda_pode_editar(public.agenda_eventos, uuid, uuid)',
                               'public.agenda_definir_participantes(bigint, uuid, uuid, uuid[])'] loop
    assert has_function_privilege('authenticated', v_msg, 'EXECUTE') = false, format('authenticated executes %s', v_msg);
  end loop;

  execute 'set local role authenticated';
  perform pg_temp.como(v_o);
  -- S: weekly Monday 09:00-10:00 from 2026-10-05, local Estúdio, B1 + B2
  select c.evento_id into v_s from public.agenda_evento_criar(pg_temp.payload(jsonb_build_object(
    'titulo', 'Gravação semanal', 'local', 'Estúdio', 'inicio_local', '2026-10-05T09:00:00', 'fim_local', '2026-10-05T10:00:00',
    'regra', pg_temp.semanal('{1}'))), array[v_b1, v_b2]) c;
  perform pg_temp.limpa_notif(v_ws);

  -- ---- esta: title + move to Tuesday 10:00 ----
  v_oc := pg_temp.oc(v_s, '2026-10-19');
  v_ret := public.agenda_evento_editar(v_oc, 'esta',
    '{"titulo":"Especial","inicio_local":"2026-10-20T10:00:00","fim_local":"2026-10-20T11:00:00"}');
  assert v_ret = v_oc, format('esta returned %s, expected %s', v_ret, v_oc);
  o := pg_temp.row_oc(v_oc);
  assert o.campos_sobrescritos = '{titulo}' and o.titulo = 'Especial' and o.horario_alterado
     and o.data_original = '2026-10-19' and o.inicio = '2026-10-20 13:00+00' and o.fim = '2026-10-20 14:00+00',
    format('esta row: %s', to_jsonb(o));
  assert pg_temp.sql(format('select count(*) from agenda_ocorrencias where evento_id = %s and (campos_sobrescritos <> ''{}'' or horario_alterado)', v_s)) = 1,
    'esta touched other occurrences';
  e := pg_temp.row_ev(v_s);
  assert e.titulo = 'Gravação semanal' and e.dtstart = '2026-10-05 09:00', 'esta changed the series';
  assert pg_temp.nnotif(v_b1, 'event_updated') = 1 and pg_temp.nnotif(v_b2, 'event_updated') = 1, 'esta: participants not notified once';
  assert pg_temp.nnotif(v_o, 'event_updated') = 0, 'esta: the actor was notified';

  -- series fields with esta raise
  v_msg := pg_temp.erro_editar(pg_temp.oc(v_s, '2026-10-26'), 'esta', '{"tipo":"outro"}');
  assert v_msg = 'agenda: este campo vale para toda a série', format('esta tipo: %s', v_msg);
  v_msg := pg_temp.erro_editar(pg_temp.oc(v_s, '2026-10-26'), 'esta', '{"lembretes":[30]}');
  assert v_msg = 'agenda: este campo vale para toda a série', format('esta lembretes: %s', v_msg);
  v_msg := pg_temp.erro_editar(pg_temp.oc(v_s, '2026-10-26'), 'esta', jsonb_build_object('regra', pg_temp.semanal('{2}')));
  assert v_msg = 'agenda: este campo vale para toda a série', format('esta regra: %s', v_msg);
  v_msg := pg_temp.erro_editar(pg_temp.oc(v_s, '2026-10-26'), 'esta', '{}', array[v_b1]);
  assert v_msg = 'agenda: este campo vale para toda a série', format('esta participantes: %s', v_msg);
  -- the full form state with unchanged series fields is fine (lembretes and participants in any order)
  v_ret := public.agenda_evento_editar(pg_temp.oc(v_s, '2026-10-26'), 'esta', pg_temp.payload(jsonb_build_object(
    'titulo', 'Especial 2', 'local', 'Estúdio', 'inicio_local', '2026-10-26T09:00:00', 'fim_local', '2026-10-26T10:00:00',
    'lembretes', jsonb_build_array(1440, 10), 'regra', pg_temp.semanal('{1}'))), array[v_b2, v_b1, v_o]);
  o := pg_temp.row_oc(v_ret);
  assert o.campos_sobrescritos = '{titulo}' and not o.horario_alterado, format('full-state esta: %s', to_jsonb(o));

  -- ---- esta clearing inherited content, then restoring it ----
  v_oc := pg_temp.oc(v_s, '2026-11-02');
  perform public.agenda_evento_editar(v_oc, 'esta', '{"local":null}');
  o := pg_temp.row_oc(v_oc);
  assert o.campos_sobrescritos = '{local}' and o.local is null, format('esta local null: %s', to_jsonb(o));
  select l.local into v_msg from public.agenda_listar(p_ocorrencia_id => v_oc) l;
  assert v_msg is null, 'agenda_listar still shows the inherited local';
  select l.local into v_msg from public.agenda_listar(p_ocorrencia_id => pg_temp.oc(v_s, '2026-11-09')) l;
  assert v_msg = 'Estúdio', 'clearing local leaked to another occurrence';
  perform public.agenda_evento_editar(v_oc, 'esta', '{"local":"Estúdio"}');
  o := pg_temp.row_oc(v_oc);
  assert o.campos_sobrescritos = '{}', format('restoring the series value kept the override: %s', to_jsonb(o));

  -- ---- drag (times only) keeps a title override ----
  v_oc := pg_temp.oc(v_s, '2026-10-26');
  perform public.agenda_evento_editar(v_oc, 'esta', '{"inicio_local":"2026-10-26T15:00:00","fim_local":"2026-10-26T16:00:00"}');
  o := pg_temp.row_oc(v_oc);
  assert o.campos_sobrescritos = '{titulo}' and o.titulo = 'Especial 2' and o.horario_alterado and o.inicio = '2026-10-26 18:00+00',
    format('drag lost the title override: %s', to_jsonb(o));

  -- ---- partial payload esta on a recurring series: only times change ----
  v_oc := pg_temp.oc(v_s, '2026-11-16');
  perform public.agenda_evento_editar(v_oc, 'esta', '{"inicio_local":"2026-11-17T10:00:00","fim_local":"2026-11-17T11:00:00"}');
  o := pg_temp.row_oc(v_oc);
  assert o.campos_sobrescritos = '{}' and o.horario_alterado and o.inicio = '2026-11-17 13:00+00', format('partial esta: %s', to_jsonb(o));
  e := pg_temp.row_ev(v_s);
  assert e.titulo = 'Gravação semanal' and e.tipo = 'gravacao' and e.lembretes = '{10,1440}' and e.local = 'Estúdio'
     and e.freq = 'weekly' and e.dias_semana = '{1}', format('partial esta changed the series: %s', to_jsonb(e));
  assert pg_temp.sql(format('select count(*) from agenda_participantes where evento_id = %s', v_s)) = 3, 'partial esta changed participants';

  -- ---- todas: tz is immutable ----
  perform public.agenda_evento_editar(pg_temp.oc(v_s, '2026-11-09'), 'todas', '{"tz":"Asia/Tokyo","titulo":"Gravação S"}');
  e := pg_temp.row_ev(v_s);
  assert e.tz = 'America/Sao_Paulo' and e.titulo = 'Gravação S', format('todas tz: %s %s', e.tz, e.titulo);
  -- content-only overrides survive a todas without regeneration
  assert (pg_temp.row_oc(pg_temp.oc(v_s, '2026-10-19'))).titulo = 'Especial', 'todas dropped a content override';

  -- ---- todas changing dia_inteiro: every row recalculated, horario_alterado cleared ----
  perform pg_temp.limpa_notif(v_ws);
  v_ret := public.agenda_evento_editar(pg_temp.oc(v_s, '2026-11-09'), 'todas',
    '{"dia_inteiro":true,"inicio_local":"2026-11-09T00:00:00","fim_local":"2026-11-10T00:00:00"}');
  assert v_ret = pg_temp.oc(v_s, '2026-11-09'), 'todas dia_inteiro: wrong occurrence returned';
  e := pg_temp.row_ev(v_s);
  assert e.dia_inteiro and e.dtstart = '2026-10-05 00:00' and e.duracao_dias = 1 and e.duracao_min is null,
    format('todas dia_inteiro series: %s', to_jsonb(e));
  assert pg_temp.sql(format('select count(*) from agenda_ocorrencias where evento_id = %s and horario_alterado', v_s)) = 0,
    'todas dia_inteiro kept horario_alterado';
  assert pg_temp.sql(format($q$select count(*) from agenda_ocorrencias where evento_id = %s
      and ((inicio at time zone 'America/Sao_Paulo')::time <> '00:00' or fim - inicio <> interval '1 day'
           or (inicio at time zone 'America/Sao_Paulo')::date <> data_original)$q$, v_s)) = 0,
    'todas dia_inteiro: rows not recalculated';
  assert pg_temp.nnotif(v_b1, 'event_updated') = 1, 'todas dia_inteiro: B1 not notified';

  -- ---- todas with a date delta: Mon+Wed -> Wed only, moved from the 10-12 occurrence to Wed 10-14 11:00 ----
  select c.evento_id into v_t from public.agenda_evento_criar(pg_temp.payload(jsonb_build_object(
    'titulo', 'Mon Wed', 'inicio_local', '2026-10-05T09:00:00', 'fim_local', '2026-10-05T10:00:00',
    'regra', pg_temp.semanal('{1,3}'))), array[v_b1, v_b2]) c;
  perform public.agenda_evento_editar(pg_temp.oc(v_t, '2026-10-19'), 'esta', '{"titulo":"Segunda especial"}');
  perform public.agenda_evento_editar(pg_temp.oc(v_t, '2026-10-21'), 'esta', '{"titulo":"Fica"}');
  v_oc := pg_temp.oc(v_t, '2026-10-12');
  v_ret := public.agenda_evento_editar(v_oc, 'todas', jsonb_build_object(
    'inicio_local', '2026-10-14T11:00:00', 'fim_local', '2026-10-14T12:00:00', 'regra', pg_temp.semanal('{3}')));
  e := pg_temp.row_ev(v_t);
  assert e.dtstart = '2026-10-07 11:00' and e.dias_semana = '{3}', format('todas delta: dtstart %s dias %s', e.dtstart, e.dias_semana);
  assert pg_temp.sql(format('select count(*) from agenda_ocorrencias where evento_id = %s and extract(dow from data_original) <> 3', v_t)) = 0,
    'todas delta: non-Wednesday rows left';
  assert pg_temp.oc(v_t, '2026-10-19') is null, 'todas delta: the Monday 10-19 override survived';
  o := pg_temp.row_oc(pg_temp.oc(v_t, '2026-10-21'));
  assert o.titulo = 'Fica' and o.campos_sobrescritos = '{titulo}' and o.inicio = '2026-10-21 14:00+00',
    format('todas delta: surviving override: %s', to_jsonb(o));
  assert v_ret = pg_temp.oc(v_t, '2026-10-14'), format('todas delta returned %s (expected the 10-14 occurrence)', v_ret);

  -- ---- partial payload on a one-off (scope ignored): times change, everything else kept, same occurrence ----
  select c.evento_id, c.ocorrencia_id into v_n1, v_oc from public.agenda_evento_criar(pg_temp.payload(jsonb_build_object(
    'titulo', 'Avulso', 'local', 'Sala', 'lembretes', jsonb_build_array(10),
    'inicio_local', '2026-10-07T14:00:00', 'fim_local', '2026-10-07T15:00:00')), array[v_b1]) c;
  v_ret := public.agenda_evento_editar(v_oc, 'esta', '{"inicio_local":"2026-10-08T16:00:00","fim_local":"2026-10-08T17:30:00"}');
  assert v_ret = v_oc, format('one-off drag returned %s, expected the same occurrence %s', v_ret, v_oc);
  e := pg_temp.row_ev(v_n1);
  assert e.dtstart = '2026-10-08 16:00' and e.duracao_min = 90 and e.titulo = 'Avulso' and e.local = 'Sala'
     and e.tipo = 'gravacao' and e.lembretes = '{10}' and e.freq is null,
    format('one-off drag series: %s', to_jsonb(e));
  o := pg_temp.row_oc(v_oc);
  assert o.data_original = '2026-10-08' and o.inicio = '2026-10-08 19:00+00' and o.fim = '2026-10-08 20:30+00' and not o.horario_alterado,
    format('one-off drag occurrence: %s', to_jsonb(o));
  assert pg_temp.sql(format('select count(*) from agenda_ocorrencias where evento_id = %s', v_n1)) = 1, 'one-off drag: row count';
  assert pg_temp.sql(format('select count(*) from agenda_participantes where evento_id = %s', v_n1)) = 2, 'one-off drag: participants changed';
  -- a one-off moved past the horizon has no occurrence until the generator reaches it: NULL return
  v_ret := public.agenda_evento_editar(v_oc, 'todas', '{"inicio_local":"2029-03-01T16:00:00","fim_local":"2029-03-01T17:00:00"}');
  assert v_ret is null, format('one-off past the horizon returned %s', v_ret);
  e := pg_temp.row_ev(v_n1);
  assert e.dtstart = '2029-03-01 16:00' and not e.materializacao_completa, 'one-off past the horizon: series';

  -- ---- old dtstart on edit ----
  select c.evento_id into v_old from public.agenda_evento_criar(pg_temp.payload(jsonb_build_object(
    'titulo', 'Antiga', 'inicio_local', '2025-12-09T09:00:00', 'fim_local', '2025-12-09T10:00:00',
    'regra', pg_temp.semanal('{2}'))), '{}') c;
  -- from the 2026-03-17 occurrence, 100 days earlier: the derived series start is 2025-08-31
  v_msg := pg_temp.erro_editar(pg_temp.oc(v_old, '2026-03-17'), 'todas', jsonb_build_object(
    'inicio_local', '2025-12-07T09:00:00', 'fim_local', '2025-12-07T10:00:00', 'regra', pg_temp.semanal('{0}')));
  assert v_msg = 'agenda: a data de início é antiga demais', format('todas 100 days earlier: %s', v_msg);
  assert pg_temp.erro_editar(pg_temp.oc(v_old, '2026-03-17'), 'todas', '{"titulo":"Antiga 2"}') is null, 'todas keeping the old dtstart failed';
  e := pg_temp.row_ev(v_old);
  assert e.dtstart = '2025-12-09 09:00' and e.titulo = 'Antiga 2', 'todas keeping the old dtstart changed it';

  -- ---- participants under todas ----
  select c.evento_id into v_s2 from public.agenda_evento_criar(pg_temp.payload(jsonb_build_object(
    'titulo', 'Com gente', 'inicio_local', '2026-10-06T09:00:00', 'fim_local', '2026-10-06T10:00:00',
    'regra', pg_temp.semanal('{2}'))), array[v_b1, v_b2]) c;
  execute 'reset role';
  insert into agenda_respostas (ocorrencia_id, conta_id, user_id, resposta) values (pg_temp.oc(v_s2, '2026-10-13'), v_ws, v_b2, 'sim');
  delete from notifications where workspace_id = v_ws;
  execute 'set local role authenticated';
  perform public.agenda_evento_editar(pg_temp.oc(v_s2, '2026-10-13'), 'todas', '{}', array[v_b1, v_b3]);
  assert pg_temp.sql(format('select count(*) from agenda_participantes where evento_id = %s and user_id = %L', v_s2, v_b2)) = 0, 'B2 still a participant';
  assert pg_temp.sql(format('select count(*) from agenda_participantes where evento_id = %s and user_id = %L and resposta = ''pendente''', v_s2, v_b3)) = 1, 'B3 not added';
  assert pg_temp.sql(format('select count(*) from agenda_respostas where user_id = %L', v_b2)) = 0, 'B2 RSVPs survived the removal';
  assert pg_temp.nnotif(v_b2, 'event_cancelled') = 1, 'B2 got no event_cancelled';
  assert pg_temp.sql(format($q$select count(*) from notifications where user_id = %L and type = 'event_cancelled' and metadata->>'motivo' = 'removido'$q$, v_b2)) = 1,
    'B2 event_cancelled lacks motivo removido';
  assert pg_temp.nnotif(v_b3, 'event_invited') = 1, 'B3 got no event_invited';
  assert pg_temp.nnotif(v_b1, 'event_updated') = 0 and pg_temp.nnotif(v_b1, 'event_invited') = 0, 'B1 notified without a change';
  v_msg := pg_temp.erro_editar(pg_temp.oc(v_s2, '2026-10-13'), 'todas', '{}', array[v_b1, v_x]);
  assert v_msg = 'agenda: participante fora do workspace', format('todas foreign participant: %s', v_msg);
  -- the form sends the set without the organizer: an admin replacing it with {B3}
  -- keeps the organizer (sim), never removes or notifies them
  perform pg_temp.limpa_notif(v_ws);
  perform pg_temp.como(v_ad);
  perform public.agenda_evento_editar(pg_temp.oc(v_s2, '2026-10-13'), 'todas', '{}', array[v_b3]);
  assert pg_temp.sql(format($q$select count(*) from agenda_participantes where evento_id = %s and user_id = %L and resposta = 'sim'$q$, v_s2, v_o)) = 1,
    'organizer dropped from the participants';
  assert pg_temp.sql(format('select count(*) from agenda_participantes where evento_id = %s', v_s2)) = 2, 'expected organizer + B3';
  assert pg_temp.sql(format($q$select count(*) from notifications where user_id = %L and type like 'event\_%%'$q$, v_o)) = 0,
    'organizer notified about a participant change';
  assert pg_temp.nnotif(v_b1, 'event_cancelled') = 1, 'B1 not told about the removal';
  perform pg_temp.como(v_o);

  -- ---- permissions and missing occurrences ----
  select c.evento_id into v_priv from public.agenda_evento_criar(pg_temp.payload('{"titulo":"Privado","privado":true}'), array[v_b1]) c;
  perform pg_temp.como(v_ag);
  v_msg := pg_temp.erro_editar(pg_temp.oc(v_s2, '2026-10-13'), 'todas', '{"titulo":"x"}');
  assert v_msg = 'agenda: você não pode editar este evento', format('agent non-organizer: %s', v_msg);
  perform pg_temp.como(v_ad);
  assert pg_temp.erro_editar(pg_temp.oc(v_s2, '2026-10-13'), 'todas', '{"titulo":"Pelo admin"}') is null, 'admin cannot edit a public event';
  assert (pg_temp.row_ev(v_s2)).organizador_id = v_o, 'admin edit changed the organizer';
  v_msg := pg_temp.erro_editar(pg_temp.oc(v_priv, '2026-10-05'), 'todas', '{"titulo":"x"}');
  assert v_msg = 'agenda: você não pode editar este evento', format('admin on a private event: %s', v_msg);
  perform pg_temp.como(v_o);
  v_msg := pg_temp.erro_editar(-1, 'todas', '{}');
  assert v_msg = 'agenda: este evento não existe mais', format('nonexistent occurrence: %s', v_msg);
  execute 'reset role';
  update agenda_ocorrencias set cancelada = true where id = pg_temp.oc(v_s2, '2026-10-20');
  execute 'set local role authenticated';
  v_msg := pg_temp.erro_editar(pg_temp.oc(v_s2, '2026-10-20'), 'esta', '{"titulo":"x"}');
  assert v_msg = 'agenda: este evento não existe mais', format('cancelled occurrence: %s', v_msg);
  v_msg := pg_temp.erro_editar(pg_temp.oc(v_s2, '2026-10-27'), 'algumas', '{}');
  assert v_msg = 'agenda: escopo inválido', format('bad scope: %s', v_msg);
  perform pg_temp.como(v_x);
  v_msg := pg_temp.erro_editar(pg_temp.oc(v_s2, '2026-10-27'), 'todas', '{"titulo":"x"}');
  assert v_msg = 'agenda: este evento não existe mais', format('other workspace: %s', v_msg);
  execute 'reset role';

  raise notice 'PASS 99_agenda_edicao (editar)';
end $$;

-- ============ block 3b: drags of recurring series, esta past ate ============
do $$
declare
  f jsonb; v_ws uuid; v_o uuid;
  v_w1 bigint; v_w2 bigint; v_w3 bigint; v_m1 bigint; v_e1 bigint; v_e2 bigint;
  v_novo bigint; v_ret bigint; v_oc bigint;
  v_msg text; v_esc text; v_n bigint; v_antes jsonb; v_ocs jsonb;
  e public.agenda_eventos; o public.agenda_ocorrencias;
begin
  perform set_config('app.agenda_hoje', '2026-10-05', true);
  f := pg_temp.fx();
  v_ws := f->>'ws'; v_o := f->>'o';
  execute 'set local role authenticated';
  perform pg_temp.como(v_o);

  -- D1/D2: a date-changing drag (no regra) of a recurring series is refused under
  -- todas and seguintes, with nothing changed
  select c.evento_id into v_w1 from public.agenda_evento_criar(pg_temp.payload(jsonb_build_object(
    'titulo', 'D1', 'inicio_local', '2026-10-05T09:00:00', 'fim_local', '2026-10-05T10:00:00',
    'regra', pg_temp.semanal('{1}'))), '{}') c;
  v_antes := (select to_jsonb(ev) from agenda_eventos ev where ev.id = v_w1);
  v_ocs := (select jsonb_agg(to_jsonb(x) order by x.id) from agenda_ocorrencias x where x.evento_id = v_w1);
  foreach v_esc in array array['todas', 'seguintes'] loop
    v_msg := pg_temp.erro_editar(pg_temp.oc(v_w1, '2026-10-19'), v_esc,
      '{"inicio_local":"2026-10-20T10:00:00","fim_local":"2026-10-20T11:00:00"}');
    assert v_msg = 'agenda: para mudar o dia da repetição, edite o evento', format('%s date drag: %s', v_esc, v_msg);
  end loop;
  assert (select to_jsonb(ev) from agenda_eventos ev where ev.id = v_w1) = v_antes, 'refused drag changed the series';
  assert (select jsonb_agg(to_jsonb(x) order by x.id) from agenda_ocorrencias x where x.evento_id = v_w1) = v_ocs, 'refused drag changed occurrences';
  assert pg_temp.sql(format('select count(*) from agenda_eventos where serie_origem_id = %s', v_w1)) = 0, 'refused seguintes drag split the series';
  -- monthly too
  select c.evento_id into v_m1 from public.agenda_evento_criar(pg_temp.payload(jsonb_build_object(
    'titulo', 'M1', 'inicio_local', '2026-10-13T09:00:00', 'fim_local', '2026-10-13T10:00:00',
    'regra', '{"freq":"monthly","intervalo":1,"dias_semana":null,"mensal_modo":"dia_semana","mensal_ordinal":2,"ate":null,"contagem":null}'::jsonb)), '{}') c;
  v_msg := pg_temp.erro_editar(pg_temp.oc(v_m1, '2026-11-10'), 'todas',
    '{"inicio_local":"2026-11-11T09:00:00","fim_local":"2026-11-11T10:00:00"}');
  assert v_msg = 'agenda: para mudar o dia da repetição, edite o evento', format('monthly date drag: %s', v_msg);

  -- T: a same-day time drag with todas on weekly Mon+Wed moves every occurrence, none lost
  select c.evento_id into v_w2 from public.agenda_evento_criar(pg_temp.payload(jsonb_build_object(
    'titulo', 'T', 'inicio_local', '2026-10-05T09:00:00', 'fim_local', '2026-10-05T10:00:00',
    'regra', pg_temp.semanal('{1,3}'))), '{}') c;
  v_n := pg_temp.sql(format('select count(*) from agenda_ocorrencias where evento_id = %s', v_w2));
  v_ret := public.agenda_evento_editar(pg_temp.oc(v_w2, '2026-10-14'), 'todas',
    '{"inicio_local":"2026-10-14T11:00:00","fim_local":"2026-10-14T12:30:00"}');
  e := pg_temp.row_ev(v_w2);
  assert e.dias_semana = '{1,3}' and e.dtstart = '2026-10-05 11:00', format('T time drag: %s', to_jsonb(e));
  assert pg_temp.sql(format('select count(*) from agenda_ocorrencias where evento_id = %s', v_w2)) = v_n, 'T time drag lost occurrences';
  assert pg_temp.sql(format($q$select count(*) from agenda_ocorrencias where evento_id = %s
                                and ((inicio at time zone 'America/Sao_Paulo')::time <> '11:00' or fim - inicio <> interval '90 minutes')$q$, v_w2)) = 0,
    'T time drag: an occurrence kept the old time';
  assert (pg_temp.row_oc(v_ret)).data_original = '2026-10-14', 'T time drag: returned occurrence';

  -- an explicit regra changes the day (the form path): Mon+Wed -> Tue+Thu
  select c.evento_id into v_w3 from public.agenda_evento_criar(pg_temp.payload(jsonb_build_object(
    'titulo', 'W3', 'inicio_local', '2026-10-05T09:00:00', 'fim_local', '2026-10-05T10:00:00',
    'regra', pg_temp.semanal('{1,3}'))), '{}') c;
  perform public.agenda_evento_editar(pg_temp.oc(v_w3, '2026-10-19'), 'todas', jsonb_build_object(
    'inicio_local', '2026-10-20T09:00:00', 'fim_local', '2026-10-20T10:00:00', 'regra', pg_temp.semanal('{2,4}')));
  e := pg_temp.row_ev(v_w3);
  assert e.dias_semana = '{2,4}' and e.dtstart = '2026-10-06 09:00', format('W3 explicit regra: dias %s dtstart %s', e.dias_semana, e.dtstart);
  assert pg_temp.oc(v_w3, '2026-10-06') is not null and pg_temp.oc(v_w3, '2026-10-08') is not null, 'W3 explicit regra: first Tue/Thu missing';

  -- E1: an esta drag of the last occurrence past ate works; a todas opened from it works too
  select c.evento_id into v_e1 from public.agenda_evento_criar(pg_temp.payload(jsonb_build_object(
    'titulo', 'E1', 'inicio_local', '2026-10-05T09:00:00', 'fim_local', '2026-10-05T10:00:00',
    'regra', '{"freq":"daily","intervalo":1,"dias_semana":null,"mensal_modo":null,"mensal_ordinal":null,"ate":"2026-10-09","contagem":null}'::jsonb)), '{}') c;
  v_oc := pg_temp.oc(v_e1, '2026-10-09');
  v_msg := pg_temp.erro_editar(v_oc, 'esta', '{"inicio_local":"2026-10-12T09:00:00","fim_local":"2026-10-12T10:00:00"}');
  assert v_msg is null, format('esta past ate: %s', v_msg);
  assert (pg_temp.row_oc(v_oc)).inicio = '2026-10-12 12:00+00', 'esta past ate: not moved';
  v_msg := pg_temp.erro_editar(v_oc, 'todas', '{"titulo":"E1b","inicio_local":"2026-10-12T11:00:00","fim_local":"2026-10-12T12:00:00"}');
  assert v_msg is null, format('todas from an occurrence moved past ate: %s', v_msg);
  e := pg_temp.row_ev(v_e1);
  assert e.titulo = 'E1b' and e.dtstart = '2026-10-05 11:00' and e.ate = '2026-10-09', format('todas past ate: %s', to_jsonb(e));
  -- the edited occurrence takes the times of this edit, on its own date
  o := pg_temp.row_oc(v_oc);
  assert o.inicio = '2026-10-09 14:00+00' and not o.horario_alterado, format('todas past ate: edited occurrence %s', to_jsonb(o));
  -- E2: same with seguintes
  select c.evento_id into v_e2 from public.agenda_evento_criar(pg_temp.payload(jsonb_build_object(
    'titulo', 'E2', 'inicio_local', '2026-10-05T09:00:00', 'fim_local', '2026-10-05T10:00:00',
    'regra', '{"freq":"daily","intervalo":1,"dias_semana":null,"mensal_modo":null,"mensal_ordinal":null,"ate":"2026-10-09","contagem":null}'::jsonb)), '{}') c;
  v_oc := pg_temp.oc(v_e2, '2026-10-09');
  perform public.agenda_evento_editar(v_oc, 'esta', '{"inicio_local":"2026-10-12T09:00:00","fim_local":"2026-10-12T10:00:00"}');
  v_msg := pg_temp.erro_editar(v_oc, 'seguintes', '{"titulo":"E2b","inicio_local":"2026-10-12T15:00:00","fim_local":"2026-10-12T16:00:00"}');
  assert v_msg is null, format('seguintes from an occurrence moved past ate: %s', v_msg);
  v_novo := pg_temp.sql(format('select id from agenda_eventos where serie_origem_id = %s', v_e2));
  o := pg_temp.row_oc(v_oc);
  assert o.evento_id = v_novo and o.inicio = '2026-10-09 18:00+00' and not o.horario_alterado,
    format('seguintes past ate: edited occurrence %s', to_jsonb(o));
  execute 'reset role';

  raise notice 'PASS 99_agenda_edicao (drags, esta past ate)';
end $$;

-- ============ block 4: seguintes (split) ============
do $$
declare
  f jsonb; v_ws uuid; v_o uuid; v_b1 uuid; v_b2 uuid;
  v_c bigint; v_d bigint; v_e5 bigint; v_f bigint; v_g bigint;
  v_novo bigint; v_ret bigint; v_oc4 bigint; v_oc6 bigint;
  e public.agenda_eventos; o public.agenda_ocorrencias;
begin
  perform set_config('app.agenda_hoje', '2026-10-05', true);
  f := pg_temp.fx();
  v_ws := f->>'ws'; v_o := f->>'o'; v_b1 := f->>'b1'; v_b2 := f->>'b2';
  execute 'set local role authenticated';
  perform pg_temp.como(v_o);

  -- C: contagem 10, Mondays 09:00 from 10-05 (10-05 .. 12-07); split at the 4th (10-26)
  select c.evento_id into v_c from public.agenda_evento_criar(pg_temp.payload(jsonb_build_object(
    'titulo', 'Dez vezes', 'inicio_local', '2026-10-05T09:00:00', 'fim_local', '2026-10-05T10:00:00',
    'regra', pg_temp.semanal('{1}', 10))), array[v_b1, v_b2]) c;
  v_oc4 := pg_temp.oc(v_c, '2026-10-26');
  v_oc6 := pg_temp.oc(v_c, '2026-11-09');
  execute 'reset role';
  insert into agenda_respostas (ocorrencia_id, conta_id, user_id, resposta) values (v_oc6, v_ws, v_b1, 'talvez');
  update agenda_ocorrencias set cancelada = true where id = pg_temp.oc(v_c, '2026-11-16');
  execute 'set local role authenticated';
  -- an earlier esta date move on the cut occurrence (to Wednesday)
  perform public.agenda_evento_editar(v_oc4, 'esta', '{"inicio_local":"2026-10-28T09:00:00","fim_local":"2026-10-28T10:00:00"}');
  -- the form shows the occurrence's current date (Wednesday) with a new time; same rule as stored
  v_ret := public.agenda_evento_editar(v_oc4, 'seguintes', jsonb_build_object(
    'inicio_local', '2026-10-28T14:00:00', 'fim_local', '2026-10-28T15:00:00', 'regra', pg_temp.semanal('{1}', 10)));
  e := pg_temp.row_ev(v_c);
  assert e.ate = '2026-10-25' and e.contagem is null and e.materializacao_completa, format('old series after split: %s', to_jsonb(e));
  assert pg_temp.sql(format('select count(*) from agenda_ocorrencias where evento_id = %s and not cancelada', v_c)) = 3, 'old series live rows';
  v_novo := pg_temp.sql(format('select id from agenda_eventos where serie_origem_id = %s', v_c));
  assert v_novo is not null, 'no new series';
  e := pg_temp.row_ev(v_novo);
  assert e.contagem = 7 and e.dtstart = '2026-10-26 14:00' and e.dias_semana = '{1}' and e.organizador_id = v_o,
    format('new series: %s', to_jsonb(e));
  assert pg_temp.sql(format('select count(*) from agenda_ocorrencias where evento_id = %s', v_novo)) = 7, 'new series rows';
  assert v_ret = v_oc4, format('seguintes returned %s, expected the re-parented cut occurrence %s', v_ret, v_oc4);
  -- the edited (earlier hand-moved) occurrence takes this edit's times on its own date
  o := pg_temp.row_oc(v_oc4);
  assert o.evento_id = v_novo and o.inicio = '2026-10-26 17:00+00' and o.fim = '2026-10-26 18:00+00' and not o.horario_alterado,
    format('edited occurrence times after seguintes: %s', to_jsonb(o));
  -- a tombstone on a date of the new rule moves over, still cancelled
  o := pg_temp.row_oc(pg_temp.sql(format($q$select id from agenda_ocorrencias where data_original = '2026-11-16' and evento_id in (%s, %s)$q$, v_c, v_novo)));
  assert o.evento_id = v_novo and o.cancelada, format('tombstone not re-parented: %s', to_jsonb(o));
  o := pg_temp.row_oc(v_oc6);
  assert o.evento_id = v_novo and o.inicio = '2026-11-09 17:00+00', format('6th occurrence not re-parented / recalculated: %s', to_jsonb(o));
  assert pg_temp.sql(format($q$select count(*) from agenda_respostas where ocorrencia_id = %s and user_id = %L and resposta = 'talvez'$q$, v_oc6, v_b1)) = 1,
    'RSVP on the re-parented occurrence lost';
  assert pg_temp.sql(format('select count(*) from agenda_participantes where evento_id = %s', v_novo)) = 3, 'participants not copied';

  -- D: removing a participant with seguintes
  select c.evento_id into v_d from public.agenda_evento_criar(pg_temp.payload(jsonb_build_object(
    'titulo', 'D', 'inicio_local', '2026-10-05T09:00:00', 'fim_local', '2026-10-05T10:00:00',
    'regra', pg_temp.semanal('{1}'))), array[v_b1, v_b2]) c;
  execute 'reset role';
  insert into agenda_respostas (ocorrencia_id, conta_id, user_id, resposta) values (pg_temp.oc(v_d, '2026-11-09'), v_ws, v_b2, 'nao');
  insert into agenda_respostas (ocorrencia_id, conta_id, user_id, resposta) values (pg_temp.oc(v_d, '2026-10-12'), v_ws, v_b2, 'nao');
  delete from notifications where workspace_id = v_ws;
  execute 'set local role authenticated';
  perform public.agenda_evento_editar(pg_temp.oc(v_d, '2026-10-19'), 'seguintes', '{"titulo":"D2"}', array[v_b1]);
  v_novo := pg_temp.sql(format('select id from agenda_eventos where serie_origem_id = %s', v_d));
  assert pg_temp.sql(format('select count(*) from agenda_participantes where evento_id = %s and user_id = %L', v_novo, v_b2)) = 0, 'B2 in the new series';
  assert pg_temp.sql(format('select count(*) from agenda_participantes where evento_id = %s and user_id = %L', v_d, v_b2)) = 1, 'B2 left the old series';
  assert pg_temp.sql(format('select count(*) from agenda_respostas where ocorrencia_id = %s', pg_temp.oc(v_novo, '2026-11-09'))) = 0,
    'B2 RSVP on a re-parented occurrence survived';
  assert pg_temp.sql(format('select count(*) from agenda_respostas where ocorrencia_id = %s', pg_temp.oc(v_d, '2026-10-12'))) = 1,
    'B2 RSVP on an earlier occurrence was deleted';
  assert pg_temp.sql(format($q$select count(*) from notifications where user_id = %L and type = 'event_cancelled' and metadata->>'motivo' = 'removido'$q$, v_b2)) = 1,
    'B2 got no event_cancelled removido';
  assert pg_temp.nnotif(v_b1, 'event_updated') = 1, 'B1 not told about the title change';
  assert (pg_temp.row_ev(v_novo)).titulo = 'D2' and (pg_temp.row_ev(v_d)).titulo = 'D', 'split titles';

  -- E: a payload contagem different from the stored one is used as is
  select c.evento_id into v_e5 from public.agenda_evento_criar(pg_temp.payload(jsonb_build_object(
    'titulo', 'E', 'inicio_local', '2026-10-05T09:00:00', 'fim_local', '2026-10-05T10:00:00',
    'regra', pg_temp.semanal('{1}', 10))), '{}') c;
  perform public.agenda_evento_editar(pg_temp.oc(v_e5, '2026-10-26'), 'seguintes', jsonb_build_object('regra', pg_temp.semanal('{1}', 5)));
  v_novo := pg_temp.sql(format('select id from agenda_eventos where serie_origem_id = %s', v_e5));
  assert (pg_temp.row_ev(v_novo)).contagem = 5, 'payload contagem not used';
  assert pg_temp.sql(format('select count(*) from agenda_ocorrencias where evento_id = %s', v_novo)) = 5, 'contagem 5 rows';
  -- F: the form re-derives the weekday from a moved date (Mon -> Wed) but keeps
  -- contagem 10: the end was not touched, the remaining 7 carry over
  select c.evento_id into v_f from public.agenda_evento_criar(pg_temp.payload(jsonb_build_object(
    'titulo', 'F', 'inicio_local', '2026-10-05T09:00:00', 'fim_local', '2026-10-05T10:00:00',
    'regra', pg_temp.semanal('{1}', 10))), '{}') c;
  perform public.agenda_evento_editar(pg_temp.oc(v_f, '2026-10-26'), 'seguintes', jsonb_build_object(
    'inicio_local', '2026-10-28T09:00:00', 'fim_local', '2026-10-28T10:00:00', 'regra', pg_temp.semanal('{3}', 10)));
  v_novo := pg_temp.sql(format('select id from agenda_eventos where serie_origem_id = %s', v_f));
  e := pg_temp.row_ev(v_novo);
  assert e.contagem = 7 and e.dias_semana = '{3}' and e.dtstart = '2026-10-28 09:00', format('re-derived weekday split: %s', to_jsonb(e));
  assert pg_temp.sql(format('select count(*) from agenda_ocorrencias where evento_id = %s', v_novo)) = 7, 're-derived weekday split rows';
  -- any rule key changed and contagem equal: still the remainder (intervalo 2)
  select c.evento_id into v_f from public.agenda_evento_criar(pg_temp.payload(jsonb_build_object(
    'titulo', 'F2', 'inicio_local', '2026-10-05T09:00:00', 'fim_local', '2026-10-05T10:00:00',
    'regra', pg_temp.semanal('{1}', 10))), '{}') c;
  perform public.agenda_evento_editar(pg_temp.oc(v_f, '2026-10-26'), 'seguintes',
    jsonb_build_object('regra', pg_temp.semanal('{1}', 10) || '{"intervalo":2}'));
  v_novo := pg_temp.sql(format('select id from agenda_eventos where serie_origem_id = %s', v_f));
  assert (pg_temp.row_ev(v_novo)).contagem = 7 and (pg_temp.row_ev(v_novo)).intervalo = 2, 'intervalo changed, contagem equal: remainder not derived';
  -- a same-day time drag (no regra) of a contagem series carries the remainder
  select c.evento_id into v_f from public.agenda_evento_criar(pg_temp.payload(jsonb_build_object(
    'titulo', 'F3', 'inicio_local', '2026-10-05T09:00:00', 'fim_local', '2026-10-05T10:00:00',
    'regra', pg_temp.semanal('{1}', 10))), '{}') c;
  perform public.agenda_evento_editar(pg_temp.oc(v_f, '2026-10-26'), 'seguintes',
    '{"inicio_local":"2026-10-26T11:00:00","fim_local":"2026-10-26T12:00:00"}');
  v_novo := pg_temp.sql(format('select id from agenda_eventos where serie_origem_id = %s', v_f));
  assert (pg_temp.row_ev(v_novo)).contagem = 7 and (pg_temp.row_ev(v_novo)).dtstart = '2026-10-26 11:00', 'time drag of a contagem series: remainder';

  -- G: seguintes at the first live occurrence is todas
  select c.evento_id into v_g from public.agenda_evento_criar(pg_temp.payload(jsonb_build_object(
    'titulo', 'G', 'inicio_local', '2026-10-05T09:00:00', 'fim_local', '2026-10-05T10:00:00',
    'regra', pg_temp.semanal('{1}'))), '{}') c;
  perform public.agenda_evento_excluir(pg_temp.oc(v_g, '2026-10-05'), 'esta');
  v_ret := public.agenda_evento_editar(pg_temp.oc(v_g, '2026-10-12'), 'seguintes', '{"titulo":"G2"}');
  assert v_ret = pg_temp.oc(v_g, '2026-10-12'), 'seguintes at the first live occurrence returned another row';
  assert pg_temp.sql(format('select count(*) from agenda_eventos where serie_origem_id = %s', v_g)) = 0, 'seguintes at the first live occurrence split';
  assert (pg_temp.row_ev(v_g)).titulo = 'G2', 'seguintes as todas did not edit the series';
  execute 'reset role';

  raise notice 'PASS 99_agenda_edicao (seguintes)';
end $$;

-- ============ block 5: agenda_evento_excluir ============
do $$
declare
  f jsonb; v_ws uuid; v_o uuid; v_b1 uuid; v_b2 uuid; v_ag uuid;
  v_h bigint; v_k bigint; v_um bigint; v_oc bigint; v_canc bigint;
  v_msg text;
  e public.agenda_eventos;
begin
  perform set_config('app.agenda_hoje', '2026-10-05', true);
  f := pg_temp.fx();
  v_ws := f->>'ws'; v_o := f->>'o'; v_b1 := f->>'b1'; v_b2 := f->>'b2'; v_ag := f->>'ag';
  execute 'set local role authenticated';
  perform pg_temp.como(v_o);
  select c.evento_id into v_h from public.agenda_evento_criar(pg_temp.payload(jsonb_build_object(
    'titulo', 'H semanal', 'inicio_local', '2026-10-05T09:00:00', 'fim_local', '2026-10-05T10:00:00',
    'regra', pg_temp.semanal('{1}'))), array[v_b1, v_b2]) c;
  perform pg_temp.limpa_notif(v_ws);

  -- permission
  perform pg_temp.como(v_ag);
  v_msg := pg_temp.erro_excluir(pg_temp.oc(v_h, '2026-10-12'), 'esta');
  assert v_msg = 'agenda: você não pode editar este evento', format('agent delete: %s', v_msg);
  perform pg_temp.como(v_o);
  v_msg := pg_temp.erro_excluir(pg_temp.oc(v_h, '2026-10-12'), 'tudo');
  assert v_msg = 'agenda: escopo inválido', format('bad delete scope: %s', v_msg);

  -- esta: tombstone, notified before
  v_canc := pg_temp.oc(v_h, '2026-10-12');
  perform public.agenda_evento_excluir(v_canc, 'esta');
  assert (pg_temp.row_oc(v_canc)).cancelada, 'esta delete did not cancel';
  assert pg_temp.nnotif(v_b1, 'event_cancelled') = 1 and pg_temp.nnotif(v_b2, 'event_cancelled') = 1 and pg_temp.nnotif(v_o, 'event_cancelled') = 0,
    'esta delete notifications';
  assert pg_temp.sql(format($q$select count(*) from notifications where user_id = %L and type = 'event_cancelled'
      and metadata->>'titulo' = 'H semanal' and link = '/calendario?data=2026-10-12' and not (metadata ? 'motivo')$q$, v_b1)) = 1,
    'esta delete notification content';
  v_msg := pg_temp.erro_excluir(v_canc, 'esta');
  assert v_msg = 'agenda: este evento não existe mais', format('deleting a tombstone: %s', v_msg);
  -- a todas regeneration keeps the tombstone
  perform public.agenda_evento_editar(pg_temp.oc(v_h, '2026-10-19'), 'todas', '{"inicio_local":"2026-10-19T10:00:00","fim_local":"2026-10-19T11:00:00"}');
  assert (pg_temp.row_oc(v_canc)).cancelada, 'todas regeneration revived a tombstone';
  assert (pg_temp.row_ev(v_h)).dtstart = '2026-10-05 10:00', 'todas time change';

  -- seguintes: ate = cut - 1, rows from the cut deleted
  perform public.agenda_evento_excluir(pg_temp.oc(v_h, '2026-11-02'), 'seguintes');
  e := pg_temp.row_ev(v_h);
  assert e.ate = '2026-11-01' and e.contagem is null and e.materializacao_completa, format('seguintes delete series: %s', to_jsonb(e));
  assert pg_temp.sql(format($q$select count(*) from agenda_ocorrencias where evento_id = %s and data_original >= '2026-11-02'$q$, v_h)) = 0,
    'seguintes delete left rows from the cut';
  assert pg_temp.sql(format('select count(*) from agenda_ocorrencias where evento_id = %s', v_h)) = 4, 'seguintes delete: rows before the cut';

  -- todas: series gone, notified before (rows exist with the title)
  perform pg_temp.limpa_notif(v_ws);
  perform public.agenda_evento_excluir(pg_temp.oc(v_h, '2026-10-19'), 'todas');
  assert pg_temp.sql(format('select count(*) from agenda_eventos where id = %s', v_h)) = 0, 'todas delete kept the series';
  assert pg_temp.sql(format('select count(*) from agenda_ocorrencias where evento_id = %s', v_h)) = 0, 'todas delete kept rows';
  assert pg_temp.sql(format($q$select count(*) from notifications where type = 'event_cancelled' and metadata->>'titulo' = 'H semanal'
      and user_id in (%L, %L)$q$, v_b1, v_b2)) = 2, 'todas delete notifications';

  -- deleting the last live occurrence with esta deletes the series
  select c.evento_id into v_k from public.agenda_evento_criar(pg_temp.payload(jsonb_build_object(
    'titulo', 'Duas', 'inicio_local', '2026-10-05T09:00:00', 'fim_local', '2026-10-05T10:00:00',
    'regra', pg_temp.semanal('{1}', 2))), '{}') c;
  perform public.agenda_evento_excluir(pg_temp.oc(v_k, '2026-10-05'), 'esta');
  assert pg_temp.sql(format('select count(*) from agenda_eventos where id = %s', v_k)) = 1, 'series deleted with a live occurrence left';
  perform public.agenda_evento_excluir(pg_temp.oc(v_k, '2026-10-12'), 'esta');
  assert pg_temp.sql(format('select count(*) from agenda_eventos where id = %s', v_k)) = 0, 'series without live occurrences kept';

  -- a one-off with esta is deleted outright
  select c.evento_id, c.ocorrencia_id into v_um, v_oc from public.agenda_evento_criar(pg_temp.payload(), array[v_b1]) c;
  perform public.agenda_evento_excluir(v_oc, 'esta');
  assert pg_temp.sql(format('select count(*) from agenda_eventos where id = %s', v_um)) = 0, 'one-off not deleted';
  execute 'reset role';

  raise notice 'PASS 99_agenda_edicao (excluir)';
end $$;

-- ============ block 6: agenda_responder ============
-- "future" uses the real now(): the series starts 14 days before today, so it
-- has past and future occurrences.
do $$
declare
  f jsonb; v_ws uuid; v_o uuid; v_b1 uuid; v_ag uuid;
  v_hoje date := current_date;
  v_r bigint; v_um bigint; v_oc_um bigint;
  v_pass bigint; v_fut1 bigint; v_fut2 bigint;
  v_msg text; v_resp text;
begin
  perform set_config('app.agenda_hoje', v_hoje::text, true);
  f := pg_temp.fx();
  v_ws := f->>'ws'; v_o := f->>'o'; v_b1 := f->>'b1'; v_ag := f->>'ag';
  execute 'set local role authenticated';
  perform pg_temp.como(v_o);
  select c.evento_id into v_r from public.agenda_evento_criar(pg_temp.payload(jsonb_build_object(
    'titulo', 'RSVP', 'inicio_local', (v_hoje - 14)::text || 'T09:00:00', 'fim_local', (v_hoje - 14)::text || 'T10:00:00',
    'regra', pg_temp.semanal(array[extract(dow from v_hoje)::int]))), array[v_b1]) c;
  select c.evento_id, c.ocorrencia_id into v_um, v_oc_um from public.agenda_evento_criar(pg_temp.payload(jsonb_build_object(
    'titulo', 'Avulso RSVP', 'inicio_local', (v_hoje + 3)::text || 'T09:00:00', 'fim_local', (v_hoje + 3)::text || 'T10:00:00')), array[v_b1]) c;
  v_pass := pg_temp.oc(v_r, v_hoje - 14);
  v_fut1 := pg_temp.oc(v_r, v_hoje + 7);
  v_fut2 := pg_temp.oc(v_r, v_hoje + 14);
  perform pg_temp.limpa_notif(v_ws);

  -- organizer cannot answer
  v_msg := pg_temp.erro_responder(v_fut1, 'sim', 'esta');
  assert v_msg = 'agenda: o organizador não responde ao próprio evento', format('organizer RSVP: %s', v_msg);

  perform pg_temp.como(v_b1);
  perform public.agenda_responder(v_fut1, 'sim', 'esta');
  assert pg_temp.sql(format($q$select count(*) from agenda_respostas where ocorrencia_id = %s and user_id = %L and resposta = 'sim'$q$, v_fut1, v_b1)) = 1,
    'esta RSVP not stored';
  select l.minha_resposta into v_resp from public.agenda_listar(p_ocorrencia_id => v_fut1) l;
  assert v_resp = 'sim', format('listar minha_resposta on the answered occurrence: %s', v_resp);
  select l.minha_resposta into v_resp from public.agenda_listar(p_ocorrencia_id => v_fut2) l;
  assert v_resp = 'pendente', format('listar minha_resposta on another occurrence: %s', v_resp);
  assert pg_temp.nnotif(v_o, 'event_rsvp') = 1, 'organizer did not get one event_rsvp';
  assert pg_temp.sql(format($q$select count(*) from notifications where user_id = %L and type = 'event_rsvp'
      and metadata->>'resposta' = 'sim' and metadata->>'ator_nome' = 'Bia' and link = '/calendario?evento=%s'$q$, v_o, v_fut1)) = 1,
    'event_rsvp metadata';
  -- esta again upserts
  perform public.agenda_responder(v_fut1, 'talvez', 'esta');
  assert pg_temp.sql(format($q$select count(*) from agenda_respostas where ocorrencia_id = %s and user_id = %L and resposta = 'talvez'$q$, v_fut1, v_b1)) = 1,
    'esta RSVP not upserted';

  -- todas: series answer; future per-occurrence answers removed, past ones stay
  perform public.agenda_responder(v_pass, 'talvez', 'esta');
  perform public.agenda_responder(v_fut2, 'sim', 'esta');
  perform public.agenda_responder(v_fut1, 'nao', 'todas');
  assert pg_temp.sql(format($q$select count(*) from agenda_participantes where evento_id = %s and user_id = %L and resposta = 'nao' and respondido_em is not null$q$, v_r, v_b1)) = 1,
    'todas RSVP not stored on the series';
  assert pg_temp.sql(format('select count(*) from agenda_respostas where user_id = %L and ocorrencia_id in (%s, %s)', v_b1, v_fut1, v_fut2)) = 0,
    'todas RSVP kept future per-occurrence answers';
  assert pg_temp.sql(format('select count(*) from agenda_respostas where user_id = %L and ocorrencia_id = %s', v_b1, v_pass)) = 1,
    'todas RSVP removed a past per-occurrence answer';
  select l.minha_resposta into v_resp from public.agenda_listar(p_ocorrencia_id => v_fut2) l;
  assert v_resp = 'nao', format('listar after todas: %s', v_resp);

  -- a one-off: esta is stored on the series
  perform public.agenda_responder(v_oc_um, 'sim', 'esta');
  assert pg_temp.sql(format($q$select count(*) from agenda_participantes where evento_id = %s and user_id = %L and resposta = 'sim'$q$, v_um, v_b1)) = 1,
    'one-off RSVP not stored on the series';

  v_msg := pg_temp.erro_responder(v_fut1, 'pendente', 'todas');
  assert v_msg = 'agenda: resposta inválida', format('bad answer: %s', v_msg);
  v_msg := pg_temp.erro_responder(v_fut1, 'sim', 'seguintes');
  assert v_msg = 'agenda: escopo inválido', format('bad RSVP scope: %s', v_msg);

  perform pg_temp.como(v_ag);
  v_msg := pg_temp.erro_responder(v_fut1, 'sim', 'esta');
  assert v_msg = 'agenda: você não participa deste evento', format('non-participant RSVP: %s', v_msg);
  execute 'reset role';

  raise notice 'PASS 99_agenda_edicao (responder)';
end $$;

rollback;
