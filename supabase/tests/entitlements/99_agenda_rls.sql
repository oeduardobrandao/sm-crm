\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Agenda (20261005000001_agenda_eventos.sql): SELECT-only privileges, composite
-- tenant FKs, the agenda_eventos guard, and RLS without policy recursion
-- (agenda_eventos <-> agenda_participantes goes through the DEFINER helper
-- agenda_pode_ver_evento). Pattern of 99_tarefa_series_rls. The four tables
-- are excluded from the parity helper so the suite asserts the migration's
-- REVOKE instead of undoing it. One DO block per area; later tasks append
-- blocks before the final rollback.

begin;
select et_grant_hosted_parity(array['agenda_eventos','agenda_ocorrencias','agenda_participantes','agenda_respostas']);
-- Defensive, as in 99_tarefa_series_rls: 92_reorder_fluxos_board.sql calls
-- et_grant_hosted_parity() outside any transaction, so in a full harness run
-- these tables may inherit ALL. Strip it and grant exactly what hosted would
-- keep after the migration (rolled back with this transaction).
revoke all on public.agenda_eventos, public.agenda_ocorrencias, public.agenda_participantes, public.agenda_respostas from anon, authenticated;
grant select on public.agenda_eventos, public.agenda_ocorrencias, public.agenda_participantes, public.agenda_respostas to authenticated;
grant all on public.agenda_eventos, public.agenda_ocorrencias, public.agenda_participantes, public.agenda_respostas to service_role;

-- ============ block 1: privileges, FKs, guard, RLS ============
do $$
declare
  v_tables text[] := array['agenda_eventos','agenda_ocorrencias','agenda_participantes','agenda_respostas'];
  v_table text;
  v_priv text;
  v_ws_a uuid; v_ws_b uuid;
  v_viewer uuid := gen_random_uuid();     -- ws A, agent (legacy fallback: calendario ver)
  v_org uuid := gen_random_uuid();        -- ws A, owner, organizes the private events
  v_user_b uuid := gen_random_uuid();     -- ws B, owner
  v_blind uuid := gen_random_uuid();      -- ws A, custom role calendario none
  v_role_none uuid;
  v_ev_pub bigint; v_ev_priv_part bigint; v_ev_priv_hidden bigint; v_ev_priv_own bigint; v_ev_b bigint;
  v_oc_pub bigint; v_oc_hidden bigint;
  v_tmp bigint;
  v_seen bigint;
  v_rejected boolean;
  v_msg text; v_code text;
  v_ts timestamptz;
begin
  perform set_config('app.agenda_hoje', '2026-10-05', true);

  -- ---- table privileges: authenticated holds exactly SELECT, anon nothing ----
  foreach v_table in array v_tables loop
    assert has_table_privilege('authenticated', 'public.' || v_table, 'SELECT'),
      format('authenticated lost SELECT on %s', v_table);
    foreach v_priv in array array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
      assert has_table_privilege('authenticated', 'public.' || v_table, v_priv) = false,
        format('authenticated holds %s on %s', v_priv, v_table);
    end loop;
    foreach v_priv in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
      assert has_table_privilege('anon', 'public.' || v_table, v_priv) = false,
        format('anon holds %s on %s', v_priv, v_table);
    end loop;
    assert has_table_privilege('service_role', 'public.' || v_table, 'INSERT'),
      format('service_role lost INSERT on %s', v_table);
  end loop;

  -- ---- helper grants ----
  assert has_function_privilege('authenticated', 'public.agenda_pode_ver_evento(bigint, boolean, uuid)', 'EXECUTE'),
    'authenticated must execute agenda_pode_ver_evento (called from an RLS policy)';
  assert has_function_privilege('anon', 'public.agenda_pode_ver_evento(bigint, boolean, uuid)', 'EXECUTE') = false,
    'anon must not execute agenda_pode_ver_evento';

  -- ---- fixtures (as postgres: auth + workspaces) ----
  v_ws_a := et_make_workspace('max');   -- three members: start caps the team
  v_ws_b := et_make_workspace('start');
  insert into auth.users (id) values (v_viewer), (v_org), (v_user_b), (v_blind);
  insert into workspace_roles (conta_id, nome, permissions)
    values (v_ws_a, 'Sem calendário', '{"calendario":"none"}') returning id into v_role_none;
  insert into workspace_members (user_id, workspace_id, role) values
    (v_viewer, v_ws_a, 'agent'), (v_org, v_ws_a, 'owner'), (v_user_b, v_ws_b, 'owner');
  insert into workspace_members (user_id, workspace_id, role, role_id) values (v_blind, v_ws_a, 'agent', v_role_none);
  update profiles set conta_id = v_ws_a, active_workspace_id = v_ws_a where id in (v_viewer, v_org, v_blind);
  update profiles set conta_id = v_ws_b, active_workspace_id = v_ws_b where id = v_user_b;

  -- ---- as service_role: valid writes (bypass policy + GRANT ALL) ----
  execute 'set local role service_role';

  insert into agenda_eventos (conta_id, organizador_id, titulo, dtstart, duracao_min, lembretes)
    values (v_ws_a, v_org, 'Reunião pública', '2026-10-05 14:00', 60, '{10,1440}') returning id into v_ev_pub;
  insert into agenda_eventos (conta_id, organizador_id, titulo, privado, dtstart, duracao_min)
    values (v_ws_a, v_org, 'Privado com o viewer', true, '2026-10-06 10:00', 30) returning id into v_ev_priv_part;
  insert into agenda_eventos (conta_id, organizador_id, titulo, privado, dtstart, duracao_min)
    values (v_ws_a, v_org, 'Privado CONFIDENTIAL', true, '2026-10-07 10:00', 30) returning id into v_ev_priv_hidden;
  insert into agenda_eventos (conta_id, organizador_id, titulo, privado, dia_inteiro, dtstart, duracao_dias)
    values (v_ws_a, v_viewer, 'Privado do viewer', true, true, '2026-10-08 00:00', 1) returning id into v_ev_priv_own;
  insert into agenda_eventos (conta_id, organizador_id, titulo, dtstart, duracao_min, freq, dias_semana)
    values (v_ws_b, v_user_b, 'Evento B FOREIGN', '2026-10-05 09:00', 45, 'weekly', '{1,3}') returning id into v_ev_b;

  insert into agenda_ocorrencias (conta_id, evento_id, data_original, inicio, fim)
    values (v_ws_a, v_ev_pub, '2026-10-05', '2026-10-05 17:00+00', '2026-10-05 18:00+00') returning id into v_oc_pub;
  insert into agenda_ocorrencias (conta_id, evento_id, data_original, inicio, fim)
    values (v_ws_a, v_ev_priv_part, '2026-10-06', '2026-10-06 13:00+00', '2026-10-06 13:30+00');
  insert into agenda_ocorrencias (conta_id, evento_id, data_original, inicio, fim)
    values (v_ws_a, v_ev_priv_hidden, '2026-10-07', '2026-10-07 13:00+00', '2026-10-07 13:30+00') returning id into v_oc_hidden;
  insert into agenda_ocorrencias (conta_id, evento_id, data_original, inicio, fim)
    values (v_ws_a, v_ev_priv_own, '2026-10-08', '2026-10-08 03:00+00', '2026-10-09 03:00+00');
  insert into agenda_ocorrencias (conta_id, evento_id, data_original, inicio, fim)
    values (v_ws_b, v_ev_b, '2026-10-05', '2026-10-05 12:00+00', '2026-10-05 12:45+00');

  insert into agenda_participantes (evento_id, conta_id, user_id, resposta) values
    (v_ev_pub, v_ws_a, v_org, 'sim'),
    (v_ev_priv_part, v_ws_a, v_org, 'sim'),
    (v_ev_priv_part, v_ws_a, v_viewer, 'pendente'),
    (v_ev_priv_hidden, v_ws_a, v_org, 'sim'),
    (v_ev_b, v_ws_b, v_user_b, 'sim');
  insert into agenda_respostas (ocorrencia_id, conta_id, user_id, resposta) values
    (v_oc_pub, v_ws_a, v_org, 'talvez'),
    (v_oc_hidden, v_ws_a, v_org, 'nao');

  -- ---- composite FKs: a child cannot belong to another workspace ----
  v_rejected := false;
  begin
    insert into agenda_ocorrencias (conta_id, evento_id, data_original, inicio, fim)
      values (v_ws_b, v_ev_pub, '2026-10-12', '2026-10-12 17:00+00', '2026-10-12 18:00+00');
  exception when foreign_key_violation then v_rejected := true; end;
  assert v_rejected, 'agenda_ocorrencias accepted a conta_id different from its event';

  v_rejected := false;
  begin
    insert into agenda_participantes (evento_id, conta_id, user_id) values (v_ev_pub, v_ws_b, v_user_b);
  exception when foreign_key_violation then v_rejected := true; end;
  assert v_rejected, 'agenda_participantes accepted a conta_id different from its event';

  v_rejected := false;
  begin
    insert into agenda_respostas (ocorrencia_id, conta_id, user_id, resposta) values (v_oc_pub, v_ws_b, v_user_b, 'sim');
  exception when foreign_key_violation then v_rejected := true; end;
  assert v_rejected, 'agenda_respostas accepted a conta_id different from its occurrence';

  v_rejected := false;
  begin
    insert into agenda_ocorrencias (conta_id, evento_id, data_original, inicio, fim)
      values (v_ws_a, v_ev_pub, '2026-10-05', '2026-10-05 19:00+00', '2026-10-05 20:00+00');
  exception when unique_violation then v_rejected := true; end;
  assert v_rejected, 'duplicate (evento_id, data_original) accepted';

  v_rejected := false;
  begin
    insert into agenda_ocorrencias (conta_id, evento_id, data_original, inicio, fim)
      values (v_ws_a, v_ev_pub, '2026-10-13', '2026-10-13 17:00+00', '2026-10-13 17:00+00');
  exception when check_violation then v_rejected := true; end;
  assert v_rejected, 'occurrence with fim = inicio accepted';

  v_rejected := false;
  begin
    insert into agenda_ocorrencias (conta_id, evento_id, data_original, inicio, fim, campos_sobrescritos)
      values (v_ws_a, v_ev_pub, '2026-10-14', '2026-10-14 17:00+00', '2026-10-14 18:00+00', '{cor}');
  exception when check_violation then v_rejected := true; end;
  assert v_rejected, 'campos_sobrescritos outside the four content fields accepted';

  -- ---- CHECKs reached through the guard (the guard must not pre-empt them) ----
  v_rejected := false;
  begin
    insert into agenda_eventos (conta_id, titulo, dtstart, duracao_min, freq)
      values (v_ws_a, 'semanal sem dias', '2026-10-05 14:00', 60, 'weekly');
  exception when check_violation then v_rejected := true; end;
  assert v_rejected, 'weekly without dias_semana was not a check_violation';

  v_rejected := false;
  begin
    insert into agenda_eventos (conta_id, titulo, dia_inteiro, dtstart, duracao_dias, duracao_min)
      values (v_ws_a, 'dia inteiro com minutos', true, '2026-10-05 00:00', 1, 60);
  exception when check_violation then v_rejected := true; end;
  assert v_rejected, 'dia_inteiro with duracao_min was not a check_violation';

  v_rejected := false;
  begin
    insert into agenda_eventos (conta_id, titulo, dia_inteiro, dtstart, duracao_dias)
      values (v_ws_a, 'dia inteiro fora da meia-noite', true, '2026-10-05 09:00', 1);
  exception when check_violation then v_rejected := true; end;
  assert v_rejected, 'dia_inteiro with a non-midnight dtstart accepted';

  v_rejected := false;
  begin
    insert into agenda_eventos (conta_id, titulo, dtstart, duracao_min, freq, ate, contagem)
      values (v_ws_a, 'ate e contagem', '2026-10-05 14:00', 60, 'daily', '2026-10-30', 5);
  exception when check_violation then v_rejected := true; end;
  assert v_rejected, 'ate together with contagem accepted';

  v_rejected := false;
  begin
    insert into agenda_eventos (conta_id, titulo, dtstart, duracao_min, freq, mensal_modo)
      values (v_ws_a, 'mensal por dia da semana sem ordinal', '2026-10-05 14:00', 60, 'monthly', 'dia_semana');
  exception when check_violation then v_rejected := true; end;
  assert v_rejected, 'monthly dia_semana without mensal_ordinal accepted';

  v_rejected := false;
  begin
    insert into agenda_eventos (conta_id, titulo, dtstart, duracao_min, link_reuniao)
      values (v_ws_a, 'link sem esquema', '2026-10-05 14:00', 60, 'javascript:alert(1)');
  exception when check_violation then v_rejected := true; end;
  assert v_rejected, 'link_reuniao without http(s) accepted';

  -- ---- guard raises ----
  v_rejected := false; v_msg := null;
  begin
    insert into agenda_eventos (conta_id, titulo, tz, dtstart, duracao_min)
      values (v_ws_a, 'fuso de marte', 'Mars/Olympus', '2026-10-05 14:00', 60);
  exception when others then v_rejected := true; v_msg := sqlerrm; v_code := sqlstate; end;
  assert v_rejected, 'tz Mars/Olympus accepted';
  assert v_msg = 'agenda: fuso horário inválido', format('unexpected tz error: %s (%s)', v_msg, v_code);

  foreach v_priv in array array['{7}', '{1,1}', '{-1}', '{1,NULL}', '{{1},{2}}'] loop
    v_rejected := false; v_msg := null;
    begin
      insert into agenda_eventos (conta_id, titulo, dtstart, duracao_min, freq, dias_semana)
        values (v_ws_a, 'dias inválidos', '2026-10-05 14:00', 60, 'weekly', v_priv::int[]);
    exception when others then v_rejected := true; v_msg := sqlerrm; v_code := sqlstate; end;
    assert v_rejected, format('dias_semana %s accepted', v_priv);
    assert v_msg = 'agenda: dias da semana inválidos', format('dias_semana %s raised %s (%s)', v_priv, v_msg, v_code);
  end loop;

  foreach v_priv in array array['{10,10}', '{40321}', '{-1441}', '{10,NULL}', '{{10},{20}}'] loop
    v_rejected := false; v_msg := null;
    begin
      insert into agenda_eventos (conta_id, titulo, dtstart, duracao_min, lembretes)
        values (v_ws_a, 'lembretes inválidos', '2026-10-05 14:00', 60, v_priv::int[]);
    exception when others then v_rejected := true; v_msg := sqlerrm; v_code := sqlstate; end;
    assert v_rejected, format('lembretes %s accepted', v_priv);
    assert v_msg = 'agenda: lembrete inválido', format('lembretes %s raised %s (%s)', v_priv, v_msg, v_code);
  end loop;

  -- boundaries are accepted
  insert into agenda_eventos (conta_id, titulo, dtstart, duracao_min, freq, dias_semana, lembretes)
    values (v_ws_a, 'limites', '2026-10-05 14:00', 60, 'weekly', '{0,6}', '{-1440,0,40320}') returning id into v_tmp;
  delete from agenda_eventos where id = v_tmp;

  -- the guard also runs on UPDATE, and stamps updated_at
  v_rejected := false; v_msg := null;
  begin
    update agenda_eventos set tz = 'Mars/Olympus' where id = v_ev_pub;
  exception when others then v_rejected := true; v_msg := sqlerrm; end;
  assert v_rejected and v_msg = 'agenda: fuso horário inválido', format('UPDATE to an invalid tz: %s', v_msg);
  update agenda_eventos set updated_at = '2000-01-01' where id = v_ev_pub;
  select updated_at into v_ts from agenda_eventos where id = v_ev_pub;
  assert v_ts = now(), format('guard did not stamp updated_at on UPDATE (got %s)', v_ts);

  execute 'reset role';

  -- ---- as the viewer (ws A, agent): no recursion, private masking by visibility ----
  perform set_config('request.jwt.claims', json_build_object('sub', v_viewer, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  v_code := null;
  begin
    select count(*) into v_seen from agenda_eventos;
  exception when others then v_code := sqlstate; v_msg := sqlerrm; end;
  assert v_code is null, format('select on agenda_eventos raised %s: %s', v_code, v_msg);
  assert v_seen = 3, format('viewer: expected 3 visible events, got %s', v_seen);
  perform 1 from agenda_eventos where id = v_ev_pub; assert found, 'viewer cannot see the public event';
  perform 1 from agenda_eventos where id = v_ev_priv_part; assert found, 'viewer cannot see the private event they participate in';
  perform 1 from agenda_eventos where id = v_ev_priv_own; assert found, 'viewer cannot see their own private event';
  perform 1 from agenda_eventos where id = v_ev_priv_hidden; assert not found, 'viewer sees a private event of someone else';
  perform 1 from agenda_eventos where id = v_ev_b; assert not found, 'viewer sees an event of another workspace';

  select count(*) into v_seen from agenda_ocorrencias;
  assert v_seen = 3, format('viewer: expected 3 visible occurrences, got %s', v_seen);
  perform 1 from agenda_ocorrencias where evento_id = v_ev_priv_hidden; assert not found, 'occurrence of a hidden event visible';

  select count(*) into v_seen from agenda_participantes;
  assert v_seen = 3, format('viewer: expected 3 visible participant rows, got %s', v_seen);
  perform 1 from agenda_participantes where evento_id = v_ev_priv_hidden; assert not found, 'participants of a hidden event visible';

  select count(*) into v_seen from agenda_respostas;
  assert v_seen = 1, format('viewer: expected 1 visible RSVP row, got %s', v_seen);
  perform 1 from agenda_respostas where ocorrencia_id = v_oc_hidden; assert not found, 'RSVP of a hidden occurrence visible';

  -- writes are permission denied (RPC-only)
  v_rejected := false;
  begin
    insert into agenda_eventos (conta_id, titulo, dtstart, duracao_min) values (v_ws_a, 'direto', '2026-10-05 14:00', 60);
  exception when insufficient_privilege then v_rejected := true; end;
  assert v_rejected, 'direct INSERT on agenda_eventos was not permission denied';
  v_rejected := false;
  begin
    update agenda_ocorrencias set cancelada = true where id = v_oc_pub;
  exception when insufficient_privilege then v_rejected := true; end;
  assert v_rejected, 'direct UPDATE on agenda_ocorrencias was not permission denied';
  v_rejected := false;
  begin
    delete from agenda_participantes where evento_id = v_ev_pub;
  exception when insufficient_privilege then v_rejected := true; end;
  assert v_rejected, 'direct DELETE on agenda_participantes was not permission denied';
  v_rejected := false;
  begin
    insert into agenda_respostas (ocorrencia_id, conta_id, user_id, resposta) values (v_oc_pub, v_ws_a, v_viewer, 'sim');
  exception when insufficient_privilege then v_rejected := true; end;
  assert v_rejected, 'direct INSERT on agenda_respostas was not permission denied';
  execute 'reset role';

  -- ---- as the organizer: sees their private events, not the viewer's ----
  perform set_config('request.jwt.claims', json_build_object('sub', v_org, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_seen from agenda_eventos;
  assert v_seen = 3, format('organizer: expected 3 visible events (not the viewer''s private one), got %s', v_seen);
  perform 1 from agenda_eventos where id = v_ev_priv_hidden; assert found, 'organizer cannot see their own private event';
  perform 1 from agenda_eventos where id = v_ev_priv_own; assert not found, 'organizer sees the viewer''s private event';
  select count(*) into v_seen from agenda_respostas;
  assert v_seen = 2, format('organizer: expected 2 visible RSVP rows, got %s', v_seen);
  execute 'reset role';

  -- ---- member of ws B sees nothing from ws A ----
  perform set_config('request.jwt.claims', json_build_object('sub', v_user_b, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_seen from agenda_eventos;
  assert v_seen = 1, format('ws B: expected only its own event, got %s', v_seen);
  select count(*) into v_seen from agenda_eventos where conta_id = v_ws_a; assert v_seen = 0, 'ws B sees ws A events';
  select count(*) into v_seen from agenda_ocorrencias where conta_id = v_ws_a; assert v_seen = 0, 'ws B sees ws A occurrences';
  select count(*) into v_seen from agenda_participantes where conta_id = v_ws_a; assert v_seen = 0, 'ws B sees ws A participants';
  select count(*) into v_seen from agenda_respostas where conta_id = v_ws_a; assert v_seen = 0, 'ws B sees ws A RSVPs';
  execute 'reset role';

  -- ---- custom role with calendario none sees nothing ----
  perform set_config('request.jwt.claims', json_build_object('sub', v_blind, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_seen from agenda_eventos;
  assert v_seen = 0, format('calendario none: expected 0 events, got %s', v_seen);
  select count(*) into v_seen from agenda_ocorrencias;
  assert v_seen = 0, format('calendario none: expected 0 occurrences, got %s', v_seen);
  execute 'reset role';

  raise notice 'PASS 99_agenda_rls (tables, guard, RLS)';
end $$;

rollback;
