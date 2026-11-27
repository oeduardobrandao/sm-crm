\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Agenda no MCP do workspace (20261212000001_agenda_mcp_as.sql).
-- Section 1, actor plumbing: the service-role *_as wrappers pass the calling
-- user in the transaction-local setting mesaas.agenda_actor. _agenda_actor()
-- reads auth.uid() first (a signed-in user can never impersonate through the
-- setting) and the setting only when there is no jwt; the zz_client_scope_guard
-- triggers, agenda_cliente_substituir_pedidos and agenda_definir_convidados
-- read the actor through it. agenda_pode_ver_evento gains a 4-arg form with an
-- explicit user.
-- Spec: docs/superpowers/specs/2026-11-27-mcp-agenda-design.md

begin;
-- ACLs (catalog, BEFORE parity hands out ALL)
do $$
begin
  assert not has_function_privilege('anon', 'public._agenda_actor()', 'EXECUTE'),
    'agenda_actor_not_executable_by_anon';
  assert has_function_privilege('authenticated', 'public._agenda_actor()', 'EXECUTE')
     and has_function_privilege('service_role', 'public._agenda_actor()', 'EXECUTE'),
    'agenda_actor_executable_by_authenticated_and_service_role';
  assert not has_function_privilege('anon', 'public.agenda_pode_ver_evento(bigint, boolean, uuid, uuid)', 'EXECUTE'),
    'pode_ver_evento_4arg_not_executable_by_anon';
  assert not has_function_privilege('authenticated', 'public.agenda_pode_ver_evento(bigint, boolean, uuid, uuid)', 'EXECUTE')
     and has_function_privilege('service_role', 'public.agenda_pode_ver_evento(bigint, boolean, uuid, uuid)', 'EXECUTE'),
    'pode_ver_evento_4arg_service_role_only';
  assert has_function_privilege('authenticated', 'public.agenda_pode_ver_evento(bigint, boolean, uuid)', 'EXECUTE'),
    'pode_ver_evento_3arg_keeps_authenticated';
  assert not has_function_privilege('authenticated', 'public.agenda_definir_convidados(bigint, jsonb)', 'EXECUTE')
     and not has_function_privilege('authenticated', 'public.agenda_cliente_substituir_pedidos(bigint, bigint, date)', 'EXECUTE')
     and not has_function_privilege('authenticated', 'public.guard_agenda_evento_scope()', 'EXECUTE')
     and not has_function_privilege('authenticated', 'public.guard_agenda_participante_scope()', 'EXECUTE'),
    'replaced_functions_keep_service_role_only_acl';
end $$;
update plans set feature_agenda = true;
select et_grant_hosted_parity();

-- value of an expression as p_user (authenticated), with mesaas.agenda_actor = p_actor
create or replace function pg_temp.val_as(p_user uuid, p_actor uuid, p_sql text) returns text language plpgsql as $f$
declare v text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('mesaas.agenda_actor', coalesce(p_actor::text, ''), true);
  execute 'set local role authenticated';
  execute p_sql into v;
  execute 'reset role';
  perform set_config('mesaas.agenda_actor', '', true);
  perform set_config('request.jwt.claims', '', true);
  return v;
end $f$;
-- error message of a statement as service_role with no jwt claims and
-- mesaas.agenda_actor = p_actor (NULL = no actor), or NULL on success
create or replace function pg_temp.svc(p_actor uuid, p_sql text) returns text language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('mesaas.agenda_actor', coalesce(p_actor::text, ''), true);
  execute 'set local role service_role';
  begin
    execute p_sql;
  exception when others then
    execute 'reset role';
    perform set_config('mesaas.agenda_actor', '', true);
    return sqlerrm;
  end;
  execute 'reset role';
  perform set_config('mesaas.agenda_actor', '', true);
  return null;
end $f$;
-- SQLSTATE raised by a statement as p_user (authenticated), or NULL on success
create or replace function pg_temp.err_as(p_user uuid, p_sql text) returns text language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    execute p_sql;
  exception when others then
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    return sqlstate;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return null;
end $f$;
-- value of an expression as service_role with no jwt claims and mesaas.agenda_actor = p_actor
create or replace function pg_temp.svc_val(p_actor uuid, p_sql text) returns text language plpgsql as $f$
declare v text;
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('mesaas.agenda_actor', coalesce(p_actor::text, ''), true);
  execute 'set local role service_role';
  execute p_sql into v;
  execute 'reset role';
  perform set_config('mesaas.agenda_actor', '', true);
  return v;
end $f$;

do $$
declare
  v_ws uuid := et_make_workspace('max');
  v_owner uuid := gen_random_uuid();
  v_a uuid := gen_random_uuid();
  v_b uuid := gen_random_uuid();
  v_part uuid := gen_random_uuid();
  v_restr uuid := gen_random_uuid();
  v_ca bigint; v_cb bigint;
  v_ev bigint;
  v_err text; v_v text;
  v_sql text;
begin
  insert into auth.users (id, email) values
    (v_owner, 'owner@amcp.test'), (v_a, 'a@amcp.test'), (v_b, 'b@amcp.test'),
    (v_part, 'part@amcp.test'), (v_restr, 'restr@amcp.test');
  insert into workspace_members (user_id, workspace_id, role) values
    (v_owner, v_ws, 'owner'), (v_a, v_ws, 'agent'), (v_b, v_ws, 'agent'),
    (v_part, v_ws, 'agent'), (v_restr, v_ws, 'agent');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws
   where id in (v_owner, v_a, v_b, v_part, v_restr);

  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  insert into clientes (user_id, conta_id, nome, sigla, cor, status) values (v_owner, v_ws, 'A', 'A', '#111', 'ativo') returning id into v_ca;
  insert into clientes (user_id, conta_id, nome, sigla, cor, status) values (v_owner, v_ws, 'B', 'B', '#222', 'ativo') returning id into v_cb;
  -- restricted to A; B hidden
  update workspace_members set client_scope = 'atribuidos' where workspace_id = v_ws and user_id = v_restr;
  insert into workspace_member_clientes (workspace_id, user_id, cliente_id) values (v_ws, v_restr, v_ca);
  -- A's private event with one participant
  insert into agenda_eventos (conta_id, organizador_id, titulo, dtstart, duracao_min, privado)
    values (v_ws, v_a, 'priv', '2026-11-10 10:00', 30, true) returning id into v_ev;
  insert into agenda_participantes (evento_id, conta_id, user_id) values (v_ev, v_ws, v_part);
  perform set_config('request.jwt.claims', '', true);

  -- =========================================================== _agenda_actor()
  -- actor_setting_ignored_when_authenticated
  v_v := pg_temp.val_as(v_a, v_b, 'select public._agenda_actor()::text');
  assert v_v = v_a::text, 'actor_setting_ignored_when_authenticated: ' || coalesce(v_v, 'null');
  v_v := pg_temp.val_as(v_a, null, 'select public._agenda_actor()::text');
  assert v_v = v_a::text, 'actor_is_auth_uid_without_setting: ' || coalesce(v_v, 'null');

  -- actor_from_setting_for_service_role (no setting first, then B, then cleared)
  v_v := pg_temp.svc_val(null, 'select public._agenda_actor()::text');
  assert v_v is null, 'actor_null_for_service_role_without_setting: ' || coalesce(v_v, 'null');
  v_v := pg_temp.svc_val(v_b, 'select public._agenda_actor()::text');
  assert v_v = v_b::text, 'actor_from_setting_for_service_role: ' || coalesce(v_v, 'null');
  v_v := pg_temp.svc_val(null, 'select public._agenda_actor()::text');
  assert v_v is null, 'actor_null_for_service_role_after_clear: ' || coalesce(v_v, 'null');

  -- =========================================================== trigger guards
  v_sql := format('insert into agenda_eventos (conta_id, organizador_id, titulo, dtstart, duracao_min, cliente_id) values (%L, %L, ''x'', ''2026-11-10 10:00'', 30, %s)', v_ws, v_restr, v_cb);
  -- trigger_guards_service_role_with_actor
  v_err := pg_temp.svc(v_restr, v_sql);
  assert v_err = 'client_scope_restricted', 'trigger_guards_service_role_with_actor: ' || coalesce(v_err, 'inserted');
  -- accessible client with the same actor: allowed
  v_err := pg_temp.svc(v_restr, format('insert into agenda_eventos (conta_id, organizador_id, titulo, dtstart, duracao_min, cliente_id) values (%L, %L, ''x'', ''2026-11-10 10:00'', 30, %s)', v_ws, v_restr, v_ca));
  assert v_err is null, 'trigger_allows_service_role_actor_accessible_client: ' || coalesce(v_err, '');
  -- no actor: today's behavior (service role unrestricted)
  v_err := pg_temp.svc(null, v_sql);
  assert v_err is null, 'trigger_service_role_without_actor_unrestricted: ' || coalesce(v_err, '');

  -- participant guard: a restricted actor can't self-invite into a hidden client's event
  select id into v_ev from agenda_eventos where conta_id = v_ws and cliente_id = v_cb limit 1;
  v_err := pg_temp.svc(v_restr, format('insert into agenda_participantes (evento_id, conta_id, user_id) values (%s, %L, %L)', v_ev, v_ws, v_restr));
  assert v_err = 'client_scope_restricted', 'participant_trigger_guards_service_role_with_actor: ' || coalesce(v_err, 'inserted');
  v_err := pg_temp.svc(null, format('insert into agenda_participantes (evento_id, conta_id, user_id) values (%s, %L, %L)', v_ev, v_ws, v_restr));
  assert v_err is null, 'participant_trigger_service_role_without_actor_unrestricted: ' || coalesce(v_err, '');

  -- =========================================================== agenda_pode_ver_evento 4-arg
  select id into v_ev from agenda_eventos where conta_id = v_ws and titulo = 'priv';
  v_v := pg_temp.svc_val(null, format('select public.agenda_pode_ver_evento(%s, true, %L, %L)::text', v_ev, v_a, v_a));
  assert v_v = 'true', 'pode_ver_evento_4arg_organizer: ' || coalesce(v_v, 'null');
  v_v := pg_temp.svc_val(null, format('select public.agenda_pode_ver_evento(%s, true, %L, %L)::text', v_ev, v_a, v_b));
  assert v_v = 'false', 'pode_ver_evento_4arg_other_user: ' || coalesce(v_v, 'null');
  v_v := pg_temp.svc_val(null, format('select public.agenda_pode_ver_evento(%s, true, %L, %L)::text', v_ev, v_a, v_part));
  assert v_v = 'true', 'pode_ver_evento_4arg_participant: ' || coalesce(v_v, 'null');
  v_v := pg_temp.svc_val(null, format('select public.agenda_pode_ver_evento(%s, false, %L, %L)::text', v_ev, v_a, v_b));
  assert v_v = 'true', 'pode_ver_evento_4arg_public_event: ' || coalesce(v_v, 'null');
  -- pode_ver_evento_4arg_denied_to_authenticated (et_grant_hosted_parity does not touch function ACLs)
  v_err := pg_temp.err_as(v_a, format('select public.agenda_pode_ver_evento(%s, true, %L, %L)', v_ev, v_a, v_b));
  assert v_err = '42501', 'pode_ver_evento_4arg_denied_to_authenticated: ' || coalesce(v_err, 'allowed');
  -- 3-arg keeps auth.uid()
  v_v := pg_temp.val_as(v_part, null, format('select public.agenda_pode_ver_evento(%s, true, %L)::text', v_ev, v_a));
  assert v_v = 'true', 'pode_ver_evento_3arg_participant: ' || coalesce(v_v, 'null');
  v_v := pg_temp.val_as(v_b, v_a, format('select public.agenda_pode_ver_evento(%s, true, %L)::text', v_ev, v_a));
  assert v_v = 'false', 'pode_ver_evento_3arg_ignores_actor_setting: ' || coalesce(v_v, 'null');
end $$;

-- =============================================================
-- Section 2: agenda_listar = wrapper over _agenda_listar_core(conta, user,
-- privados, ...); agenda_listar_as is the service-role variant the MCP calls
-- with the connection's workspace and user. Permission, client scope and the
-- context-only client name are judged in p_conta for p_user, never in the
-- user's active workspace. p_privados = false masks every private event, the
-- actor's own included (API-key connections).
-- =============================================================
do $$
begin
  -- core and helper: only the definer wrappers reach them
  assert not has_function_privilege('anon', 'public._agenda_listar_core(uuid, uuid, boolean, timestamptz, timestamptz, bigint)', 'EXECUTE')
     and not has_function_privilege('authenticated', 'public._agenda_listar_core(uuid, uuid, boolean, timestamptz, timestamptz, bigint)', 'EXECUTE')
     and not has_function_privilege('service_role', 'public._agenda_listar_core(uuid, uuid, boolean, timestamptz, timestamptz, bigint)', 'EXECUTE'),
    'listar_core_not_executable_by_api_roles';
  assert not has_function_privilege('anon', 'public._agenda_cliente_context_for(uuid, uuid, bigint)', 'EXECUTE')
     and not has_function_privilege('authenticated', 'public._agenda_cliente_context_for(uuid, uuid, bigint)', 'EXECUTE')
     and not has_function_privilege('service_role', 'public._agenda_cliente_context_for(uuid, uuid, bigint)', 'EXECUTE'),
    'cliente_context_for_not_executable_by_api_roles';
  -- the _as wrapper: service_role only
  assert not has_function_privilege('anon', 'public.agenda_listar_as(uuid, uuid, boolean, timestamptz, timestamptz, bigint)', 'EXECUTE')
     and not has_function_privilege('authenticated', 'public.agenda_listar_as(uuid, uuid, boolean, timestamptz, timestamptz, bigint)', 'EXECUTE')
     and has_function_privilege('service_role', 'public.agenda_listar_as(uuid, uuid, boolean, timestamptz, timestamptz, bigint)', 'EXECUTE'),
    'listar_as_service_role_only';
  -- the CRM RPC keeps its ACL
  assert not has_function_privilege('anon', 'public.agenda_listar(timestamptz, timestamptz, bigint)', 'EXECUTE')
     and has_function_privilege('authenticated', 'public.agenda_listar(timestamptz, timestamptz, bigint)', 'EXECUTE')
     and has_function_privilege('service_role', 'public.agenda_listar(timestamptz, timestamptz, bigint)', 'EXECUTE'),
    'agenda_listar_keeps_acl';
  -- the core never reads the session identity
  assert (select p.prosrc !~ '(auth\.uid|get_my_conta_id|my_client_scope_all|has_permission\(|can_access_cliente\(e\.|can_see_cliente_context\()'
            from pg_proc p where p.oid = 'public._agenda_listar_core(uuid, uuid, boolean, timestamptz, timestamptz, bigint)'::regprocedure),
    'listar_core_has_no_session_identity';
  assert (select p.prosrc !~ '(auth\.uid|get_my_conta_id|my_membro_ids|can_access_cliente\(p_cliente_id\))'
            from pg_proc p where p.oid = 'public._agenda_cliente_context_for(uuid, uuid, bigint)'::regprocedure),
    'cliente_context_for_has_no_session_identity';
end $$;

-- creates an event through the CRM RPC as p_user; returns its id
create or replace function pg_temp.criar(p_user uuid, p jsonb, parts uuid[] default '{}') returns bigint language plpgsql as $f$
declare v bigint;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select c.evento_id into v from public.agenda_evento_criar(jsonb_build_object(
    'titulo', 'Evento', 'descricao', 'desc', 'local', 'sala', 'link_reuniao', null,
    'tipo', 'gravacao', 'cor', null, 'cliente_id', null, 'privado', false, 'dia_inteiro', false,
    'tz', 'America/Sao_Paulo', 'inicio_local', '2026-11-10T14:00:00', 'fim_local', '2026-11-10T15:00:00',
    'lembretes', jsonb_build_array(10), 'regra', null) || p, parts) c;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return v;
end $f$;
grant execute on all functions in schema pg_temp to authenticated, service_role;

do $$
declare
  v_ws uuid := et_make_workspace('max');
  v_w1 uuid := et_make_workspace('max');
  v_owner uuid := gen_random_uuid();
  v_todos uuid := gen_random_uuid();
  v_restr uuid := gen_random_uuid();
  v_semver uuid := gen_random_uuid();
  v_fora uuid := gen_random_uuid();
  v_owner1 uuid := gen_random_uuid();
  v_role uuid;
  v_ca bigint; v_cb bigint; v_cc bigint; v_c1 bigint;
  e_a bigint; e_b bigint; e_bpart bigint; e_cpart bigint; e_no bigint;
  e_privr bigint; e_privo bigint; e_privo2 bigint; e_w1 bigint;
  v_oc bigint;
  v_u uuid; v_crm text; v_mcp text; v_n int;
  v_err text; v_v text;
  v_win text := '''2026-11-02'', ''2026-12-31''';
begin
  perform set_config('app.agenda_hoje', '2026-11-02', true);
  insert into auth.users (id, email) values
    (v_owner, 'owner2@amcp.test'), (v_todos, 'todos2@amcp.test'), (v_restr, 'restr2@amcp.test'),
    (v_semver, 'semver2@amcp.test'), (v_fora, 'fora2@amcp.test'), (v_owner1, 'owner1@amcp.test');
  insert into workspace_roles (conta_id, nome, permissions)
    values (v_ws, 'Sem agenda', '{"clientes":"ver"}') returning id into v_role;
  insert into workspace_members (user_id, workspace_id, role) values
    (v_owner, v_ws, 'owner'), (v_todos, v_ws, 'agent'), (v_restr, v_ws, 'agent'),
    (v_owner1, v_w1, 'owner'), (v_restr, v_w1, 'agent'), (v_fora, v_w1, 'agent');
  insert into workspace_members (user_id, workspace_id, role, role_id) values (v_semver, v_ws, 'agent', v_role);
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id in (v_owner, v_todos, v_semver);
  update profiles set conta_id = v_w1, active_workspace_id = v_w1 where id in (v_owner1, v_fora);
  -- the restricted agent's ACTIVE workspace is W1, where he sees every client
  update profiles set conta_id = v_w1, active_workspace_id = v_w1 where id = v_restr;

  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  insert into clientes (user_id, conta_id, nome, sigla, cor, status) values (v_owner, v_ws, 'A', 'A', '#111', 'ativo') returning id into v_ca;
  insert into clientes (user_id, conta_id, nome, sigla, cor, status) values (v_owner, v_ws, 'B', 'B', '#222', 'ativo') returning id into v_cb;
  insert into clientes (user_id, conta_id, nome, sigla, cor, status) values (v_owner, v_ws, 'C', 'C', '#333', 'ativo') returning id into v_cc;
  insert into clientes (user_id, conta_id, nome, sigla, cor, status) values (v_owner1, v_w1, 'W1', 'W', '#444', 'ativo') returning id into v_c1;
  -- in W the restricted agent sees A only; C only through context (his task there)
  update workspace_members set client_scope = 'atribuidos' where workspace_id = v_ws and user_id = v_restr;
  insert into workspace_member_clientes (workspace_id, user_id, cliente_id) values (v_ws, v_restr, v_ca);
  insert into tarefas (conta_id, user_id, titulo, cliente_id) values (v_ws, v_restr, 'tC', v_cc);
  perform set_config('request.jwt.claims', '', true);

  e_a := pg_temp.criar(v_owner, jsonb_build_object('titulo', 'eA', 'cliente_id', v_ca));
  e_b := pg_temp.criar(v_owner, jsonb_build_object('titulo', 'eB', 'cliente_id', v_cb));
  e_bpart := pg_temp.criar(v_owner, jsonb_build_object('titulo', 'eBpart', 'cliente_id', v_cb), array[v_restr]);
  e_cpart := pg_temp.criar(v_owner, jsonb_build_object('titulo', 'eCpart', 'cliente_id', v_cc), array[v_restr]);
  e_no := pg_temp.criar(v_owner, jsonb_build_object('titulo', 'eNo'));
  e_privr := pg_temp.criar(v_owner, jsonb_build_object('titulo', 'ePrivR', 'privado', true));
  e_privo := pg_temp.criar(v_owner, jsonb_build_object('titulo', 'ePrivO', 'privado', true), array[v_restr]);
  e_privo2 := pg_temp.criar(v_owner, jsonb_build_object('titulo', 'ePrivO2', 'privado', true));
  e_w1 := pg_temp.criar(v_owner1, jsonb_build_object('titulo', 'eW1', 'cliente_id', v_c1));
  -- the restricted agent organizes ePrivR (superuser, no claims)
  update agenda_eventos set organizador_id = v_restr where id = e_privr;
  update agenda_participantes set user_id = v_restr where evento_id = e_privr and user_id = v_owner;

  -- ---- listar_as_denied_to_authenticated
  v_err := pg_temp.err_as(v_owner, format('select * from public.agenda_listar_as(%L, %L, true, %s)', v_ws, v_owner, v_win));
  assert v_err = '42501', 'listar_as_denied_to_authenticated: ' || coalesce(v_err, 'allowed');

  -- ---- listar_as_non_member_refused (member of W1 only), and null identities
  v_err := pg_temp.svc(null, format('select * from public.agenda_listar_as(%L, %L, true, %s)', v_ws, v_fora, v_win));
  assert v_err = 'agenda: sessão sem workspace ativo', 'listar_as_non_member_refused: ' || coalesce(v_err, 'allowed');
  v_err := pg_temp.svc(null, format('select * from public.agenda_listar_as(%L, null, true, %s)', v_ws, v_win));
  assert v_err = 'agenda: sessão sem workspace ativo', 'listar_as_null_user_refused: ' || coalesce(v_err, 'allowed');
  v_err := pg_temp.svc(null, format('select * from public.agenda_listar_as(null, %L, true, %s)', v_owner, v_win));
  assert v_err = 'agenda: sessão sem workspace ativo', 'listar_as_null_conta_refused: ' || coalesce(v_err, 'allowed');

  -- ---- listar_as_without_calendario_ver
  v_err := pg_temp.svc(null, format('select * from public.agenda_listar_as(%L, %L, true, %s)', v_ws, v_semver, v_win));
  assert v_err = 'agenda: você não pode ver a agenda', 'listar_as_without_calendario_ver: ' || coalesce(v_err, 'allowed');

  -- ---- listar_as_restricted_scope: A, his B event (no client name), his C event
  -- (name through context), his private event, the private event he takes part in
  v_v := pg_temp.svc_val(null, format(
    'select string_agg(l.titulo || ''|'' || coalesce(l.cliente_nome, ''-'') || ''|'' || l.mascarado, '','' order by l.titulo) from public.agenda_listar_as(%L, %L, true, %s) l',
    v_ws, v_restr, v_win));
  assert v_v = 'eA|A|false,eBpart|-|false,eCpart|C|false,ePrivO|-|false,ePrivR|-|false',
    'listar_as_restricted_scope: ' || coalesce(v_v, 'null');
  -- the todos agent sees all eight, the private ones he is not in masked
  v_v := pg_temp.svc_val(null, format(
    'select string_agg(l.titulo || ''|'' || l.mascarado, '','' order by l.mascarado, l.titulo, l.evento_id) from public.agenda_listar_as(%L, %L, true, %s) l',
    v_ws, v_todos, v_win));
  assert v_v = 'eA|false,eB|false,eBpart|false,eCpart|false,eNo|false,Ocupado|true,Ocupado|true,Ocupado|true',
    'listar_as_todos_scope: ' || coalesce(v_v, 'null');

  -- ---- listar_as_privados_false_masks_own
  v_v := pg_temp.svc_val(null, format(
    'select l.mascarado || ''|'' || l.titulo || ''|'' || coalesce(l.descricao, ''-'') || ''|'' || coalesce(l.local, ''-'') from public.agenda_listar_as(%L, %L, false, %s) l where l.evento_id = %s',
    v_ws, v_restr, v_win, e_privr));
  assert v_v = 'true|Ocupado|-|-', 'listar_as_privados_false_masks_own: ' || coalesce(v_v, 'null');
  v_v := pg_temp.svc_val(null, format(
    'select l.mascarado || ''|'' || l.titulo from public.agenda_listar_as(%L, %L, false, %s) l where l.evento_id = %s',
    v_ws, v_restr, v_win, e_privo));
  assert v_v = 'true|Ocupado', 'listar_as_privados_false_masks_participant: ' || coalesce(v_v, 'null');
  v_v := pg_temp.svc_val(null, format(
    'select l.mascarado || ''|'' || l.titulo from public.agenda_listar_as(%L, %L, false, %s) l where l.evento_id = %s',
    v_ws, v_restr, v_win, e_a));
  assert v_v = 'false|eA', 'listar_as_privados_false_keeps_public: ' || coalesce(v_v, 'null');

  -- ---- mcp_as_uses_p_conta_not_active_workspace: his active workspace is W1
  -- (all clients there); in W he is restricted and W1's event never shows
  v_v := pg_temp.svc_val(null, format(
    'select string_agg(l.titulo, '','' order by l.titulo) from public.agenda_listar_as(%L, %L, true, %s) l where l.evento_id in (%s, %s, %s)',
    v_ws, v_restr, v_win, e_w1, e_a, e_b));
  assert v_v = 'eA', 'mcp_as_uses_p_conta_not_active_workspace: ' || coalesce(v_v, 'null');
  v_v := pg_temp.svc_val(null, format(
    'select string_agg(l.titulo, '','' order by l.titulo) from public.agenda_listar_as(%L, %L, true, %s) l',
    v_w1, v_restr, v_win));
  assert v_v = 'eW1', 'mcp_as_other_workspace_scope_follows_p_conta: ' || coalesce(v_v, 'null');
  -- the CRM RPC still follows the active workspace
  v_v := pg_temp.val_as(v_restr, null, format(
    'select string_agg(l.titulo, '','' order by l.titulo) from public.agenda_listar(%s) l', v_win));
  assert v_v = 'eW1', 'crm_listar_follows_active_workspace: ' || coalesce(v_v, 'null');

  -- ---- listar_parity: the CRM RPC as the user = agenda_listar_as(conta, user, true)
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_restr;
  foreach v_u in array array[v_owner, v_todos, v_restr] loop
    v_crm := pg_temp.val_as(v_u, null, format(
      'select jsonb_agg(to_jsonb(l) order by l.ocorrencia_id)::text from public.agenda_listar(%s) l', v_win));
    v_mcp := pg_temp.svc_val(null, format(
      'select jsonb_agg(to_jsonb(l) order by l.ocorrencia_id)::text from public.agenda_listar_as(%L, %L, true, %s) l',
      v_ws, v_u, v_win));
    v_n := jsonb_array_length(v_crm::jsonb);
    assert v_n >= 5, format('listar_parity_nonempty (%s): %s', v_u, v_n);
    assert v_crm = v_mcp, format('listar_parity (%s): %s vs %s', v_u, v_crm, v_mcp);
  end loop;
  -- single-occurrence path
  select o.id into v_oc from agenda_ocorrencias o where o.evento_id = e_cpart order by o.data_original limit 1;
  v_crm := pg_temp.val_as(v_restr, null, format(
    'select jsonb_agg(to_jsonb(l))::text from public.agenda_listar(null, null, %s) l', v_oc));
  v_mcp := pg_temp.svc_val(null, format(
    'select jsonb_agg(to_jsonb(l))::text from public.agenda_listar_as(%L, %L, true, null, null, %s) l', v_ws, v_restr, v_oc));
  assert v_crm is not null and v_crm = v_mcp, format('listar_parity_single_occurrence: %s vs %s', v_crm, v_mcp);
  -- a hidden client's occurrence stays hidden on both paths
  select o.id into v_oc from agenda_ocorrencias o where o.evento_id = e_b order by o.data_original limit 1;
  v_v := pg_temp.svc_val(null, format(
    'select count(*)::text from public.agenda_listar_as(%L, %L, true, null, null, %s) l', v_ws, v_restr, v_oc));
  assert v_v = '0', 'listar_as_single_occurrence_hidden_client: ' || v_v;
  -- the CRM error with no session stays
  v_err := pg_temp.svc(null, format('select * from public.agenda_listar(%s)', v_win));
  assert v_err = 'agenda: sessão sem workspace ativo', 'crm_listar_without_session_raises: ' || coalesce(v_err, 'allowed');

  -- ---- listar_as_flag_off_returns_zero (override on W, plan stays on)
  insert into workspace_plan_overrides (workspace_id, feature_overrides)
    values (v_ws, '{"feature_agenda": false}')
    on conflict (workspace_id) do update
      set feature_overrides = coalesce(workspace_plan_overrides.feature_overrides, '{}'::jsonb) || excluded.feature_overrides;
  v_v := pg_temp.svc_val(null, format('select count(*)::text from public.agenda_listar_as(%L, %L, true, %s) l', v_ws, v_owner, v_win));
  assert v_v = '0', 'listar_as_flag_off_returns_zero: ' || v_v;
end $$;

rollback;
