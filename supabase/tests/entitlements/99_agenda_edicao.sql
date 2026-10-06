\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Agenda (20261005000001_agenda_eventos.sql §3/§4): write RPCs. Block 1 covers
-- agenda_evento_criar (payload validation, dtstart normalization, participants,
-- materialization, event_invited fan-out); block 2 the notification types and
-- the digest claim. Later tasks append blocks (edit/delete/RSVP) before the
-- final rollback.

begin;
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
  v_claimed uuid[];
  v_rejected boolean;
begin
  v_ws := et_make_workspace('start');
  insert into auth.users (id) values (v_user);
  insert into workspace_members (user_id, workspace_id, role) values (v_user, v_ws, 'owner');

  execute 'set local role service_role';
  foreach v_t in array array['event_invited','event_updated','event_cancelled','event_rsvp','event_reminder'] loop
    insert into notifications (workspace_id, user_id, type, metadata, link)
      values (v_ws, v_user, v_t, '{}', '/calendario');
  end loop;
  execute 'reset role';

  foreach v_t in array array['event_invited','event_updated','event_cancelled','event_rsvp','event_reminder','__all__'] loop
    insert into notification_inapp_prefs (user_id, type, enabled) values (v_user, v_t, true)
      on conflict (user_id, type) do nothing;
  end loop;
  foreach v_t in array array['event_invited','event_updated','event_cancelled','event_reminder'] loop
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
  insert into notifications (workspace_id, user_id, type, created_at) values (v_ws, v_user, 'event_reminder', now() - interval '15 minutes') returning id into v_rem;
  insert into notifications (workspace_id, user_id, type, created_at) values (v_ws, v_user, 'event_rsvp', now() - interval '15 minutes') returning id into v_rsvp;

  execute 'set local role service_role';
  select array_agg(c.id) into v_claimed from public.claim_notification_emails(now() - interval '10 minutes', now() - interval '1 day', 100) c;
  assert v_inv = any (v_claimed), 'claim_notification_emails did not claim an event_invited row';
  assert v_upd = any (v_claimed), 'claim_notification_emails did not claim an event_updated row';
  assert v_canc = any (v_claimed), 'claim_notification_emails did not claim an event_cancelled row';
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

rollback;
