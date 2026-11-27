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
  assert not has_function_privilege('anon', 'public._can_see_cliente_context_core(uuid, uuid, bigint)', 'EXECUTE')
     and not has_function_privilege('authenticated', 'public._can_see_cliente_context_core(uuid, uuid, bigint)', 'EXECUTE')
     and not has_function_privilege('service_role', 'public._can_see_cliente_context_core(uuid, uuid, bigint)', 'EXECUTE'),
    'context_core_not_executable_by_api_roles';
  -- the _as wrapper: service_role only
  assert not has_function_privilege('anon', 'public.agenda_listar_as(uuid, uuid, boolean, timestamptz, timestamptz, bigint)', 'EXECUTE')
     and not has_function_privilege('authenticated', 'public.agenda_listar_as(uuid, uuid, boolean, timestamptz, timestamptz, bigint)', 'EXECUTE')
     and has_function_privilege('service_role', 'public.agenda_listar_as(uuid, uuid, boolean, timestamptz, timestamptz, bigint)', 'EXECUTE'),
    'listar_as_service_role_only';
  -- can_see_cliente_context(bigint), now a wrapper over the core, keeps its ACL
  assert not has_function_privilege('anon', 'public.can_see_cliente_context(bigint)', 'EXECUTE')
     and has_function_privilege('authenticated', 'public.can_see_cliente_context(bigint)', 'EXECUTE')
     and has_function_privilege('service_role', 'public.can_see_cliente_context(bigint)', 'EXECUTE'),
    'can_see_cliente_context_keeps_acl';
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
            from pg_proc p where p.oid = 'public._can_see_cliente_context_core(uuid, uuid, bigint)'::regprocedure),
    'context_core_has_no_session_identity';
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
  -- ---- context_wrapper_parity: can_see_cliente_context(cli) as the user =
  -- _can_see_cliente_context_core(user, conta, cli), for an assigned client (A),
  -- one with his own item only (C), one without (B) and no client
  foreach v_u in array array[v_owner, v_todos, v_restr] loop
    foreach v_v in array array[v_ca::text, v_cc::text, v_cb::text, 'null'] loop
      v_crm := pg_temp.val_as(v_u, null, format('select public.can_see_cliente_context(%s::bigint)::text', v_v));
      execute format('select public._can_see_cliente_context_core(%L, %L, %s::bigint)::text', v_u, v_ws, v_v) into v_mcp;
      assert v_crm = v_mcp, format('context_wrapper_parity (%s, %s): %s vs %s', v_u, v_v, v_crm, v_mcp);
    end loop;
  end loop;
  -- the expected values for the restricted agent, so the parity is not vacuous
  v_v := pg_temp.val_as(v_restr, null, format(
    'select concat_ws('','', public.can_see_cliente_context(%s), public.can_see_cliente_context(%s), public.can_see_cliente_context(%s), public.can_see_cliente_context(null))',
    v_ca, v_cc, v_cb));
  assert v_v = 't,t,f,f', 'context_wrapper_restricted_values: ' || v_v;
  -- no jwt: true, as before
  v_v := pg_temp.svc_val(null, format('select public.can_see_cliente_context(%s)::text', v_cb));
  assert v_v = 'true', 'context_wrapper_without_jwt_true: ' || coalesce(v_v, 'null');

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

-- =============================================================
-- Section 3: agenda_evento_criar / _editar / _excluir = wrappers over
-- _agenda_evento_*_core(conta, user, privados, ...); the *_as variants (service
-- role only) check membership in p_conta, set mesaas.agenda_actor for the
-- triggers and agenda_cliente_substituir_pedidos, call the core and clear the
-- actor. p_privados = false (API-key connection) refuses any private event,
-- the caller's own included, with 'agenda: evento privado indisponível nesta conexão'.
-- =============================================================
do $$
declare
  v_f text;
begin
  foreach v_f in array array['public._agenda_evento_criar_core(uuid, uuid, boolean, jsonb, uuid[])',
      'public._agenda_evento_editar_core(uuid, uuid, boolean, bigint, text, jsonb, uuid[])',
      'public._agenda_evento_excluir_core(uuid, uuid, boolean, bigint, text)'] loop
    assert not has_function_privilege('anon', v_f, 'EXECUTE')
       and not has_function_privilege('authenticated', v_f, 'EXECUTE')
       and not has_function_privilege('service_role', v_f, 'EXECUTE'),
      'write_core_not_executable_by_api_roles: ' || v_f;
    assert (select p.prosrc !~ '(auth\.uid|get_my_conta_id|my_client_scope_all|has_permission\(|can_access_cliente\(v_e\.|can_see_cliente_context\(|my_membro_ids|agenda_pode_ver_evento\([^()]*organizador_id\))'
              from pg_proc p where p.oid = v_f::regprocedure),
      'write_core_has_no_session_identity: ' || v_f;
  end loop;
  foreach v_f in array array['public.agenda_evento_criar_as(uuid, uuid, boolean, jsonb, uuid[])',
      'public.agenda_evento_editar_as(uuid, uuid, boolean, bigint, text, jsonb, uuid[])',
      'public.agenda_evento_excluir_as(uuid, uuid, boolean, bigint, text)'] loop
    assert not has_function_privilege('anon', v_f, 'EXECUTE')
       and not has_function_privilege('authenticated', v_f, 'EXECUTE')
       and has_function_privilege('service_role', v_f, 'EXECUTE'),
      'write_as_service_role_only: ' || v_f;
  end loop;
  foreach v_f in array array['public.agenda_evento_criar(jsonb, uuid[])',
      'public.agenda_evento_editar(bigint, text, jsonb, uuid[])',
      'public.agenda_evento_excluir(bigint, text)'] loop
    assert not has_function_privilege('anon', v_f, 'EXECUTE')
       and has_function_privilege('authenticated', v_f, 'EXECUTE')
       and has_function_privilege('service_role', v_f, 'EXECUTE'),
      'crm_write_rpc_keeps_acl: ' || v_f;
  end loop;
  -- the CRM editar keeps its optional participants argument
  assert (select p.pronargdefaults from pg_proc p
           where p.oid = 'public.agenda_evento_editar(bigint, text, jsonb, uuid[])'::regprocedure) = 1,
    'crm_editar_keeps_default';
  assert (select p.pronargdefaults from pg_proc p
           where p.oid = 'public.agenda_evento_editar_as(uuid, uuid, boolean, bigint, text, jsonb, uuid[])'::regprocedure) = 1,
    'editar_as_participants_default';
end $$;

-- full create payload (every key, as the form sends it) merged with overrides
create or replace function pg_temp.pl(p jsonb default '{}') returns jsonb language sql as $f$
  select jsonb_build_object(
    'titulo', 'Evento', 'descricao', null, 'local', null, 'link_reuniao', null,
    'tipo', 'gravacao', 'cor', null, 'cliente_id', null, 'privado', false, 'dia_inteiro', false,
    'tz', 'America/Sao_Paulo', 'inicio_local', '2026-11-10T14:00:00', 'fim_local', '2026-11-10T15:00:00',
    'lembretes', jsonb_build_array(10), 'regra', null) || p;
$f$;
create or replace function pg_temp.oc(p_ev bigint, p_d date) returns bigint language sql as $f$
  select o.id from public.agenda_ocorrencias o where o.evento_id = p_ev and o.data_original = p_d;
$f$;
create or replace function pg_temp.oc1(p_ev bigint) returns bigint language sql as $f$
  select o.id from public.agenda_ocorrencias o where o.evento_id = p_ev order by o.data_original limit 1;
$f$;
grant execute on all functions in schema pg_temp to authenticated, service_role;

do $$
declare
  v_ws uuid := et_make_workspace('max');
  v_w1 uuid := et_make_workspace('max');
  v_owner uuid := gen_random_uuid();
  v_adm uuid := gen_random_uuid();
  v_todos uuid := gen_random_uuid();
  v_restr uuid := gen_random_uuid();
  v_semed uuid := gen_random_uuid();
  v_fora uuid := gen_random_uuid();
  v_role uuid;
  v_ca bigint; v_cb bigint;
  e_a bigint; e_b bigint; e_borg bigint; e_bser bigint; e_tail bigint; e_privr bigint;
  e_no bigint; e_noown bigint; e_semed bigint; e_shared bigint;
  v_id bigint; v_oc bigint; v_rm bigint;
  v_err text; v_v text;
  v_win text := '''2026-11-02'', ''2026-12-31''';
  v_semanal jsonb := jsonb_build_object('freq','weekly','intervalo',1,'dias_semana',jsonb_build_array(1),
                       'mensal_modo',null,'mensal_ordinal',null,'ate',null,'contagem',null);
begin
  perform set_config('app.agenda_hoje', '2026-11-02', true);
  insert into auth.users (id, email) values
    (v_owner, 'owner3@amcp.test'), (v_adm, 'adm3@amcp.test'), (v_todos, 'todos3@amcp.test'),
    (v_restr, 'restr3@amcp.test'), (v_semed, 'semed3@amcp.test'), (v_fora, 'fora3@amcp.test');
  insert into workspace_roles (conta_id, nome, permissions)
    values (v_ws, 'Só ver agenda', '{"calendario":"ver"}') returning id into v_role;
  insert into workspace_members (user_id, workspace_id, role) values
    (v_owner, v_ws, 'owner'), (v_adm, v_ws, 'admin'), (v_todos, v_ws, 'agent'), (v_restr, v_ws, 'agent'),
    (v_fora, v_w1, 'owner');
  insert into workspace_members (user_id, workspace_id, role, role_id) values (v_semed, v_ws, 'agent', v_role);
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id in (v_owner, v_adm, v_todos, v_restr, v_semed);
  update profiles set conta_id = v_w1, active_workspace_id = v_w1 where id = v_fora;

  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  insert into clientes (user_id, conta_id, nome, sigla, cor, status) values (v_owner, v_ws, 'A', 'A', '#111', 'ativo') returning id into v_ca;
  insert into clientes (user_id, conta_id, nome, sigla, cor, status) values (v_owner, v_ws, 'B', 'B', '#222', 'ativo') returning id into v_cb;
  update workspace_members set client_scope = 'atribuidos' where workspace_id = v_ws and user_id = v_restr;
  insert into workspace_member_clientes (workspace_id, user_id, cliente_id) values (v_ws, v_restr, v_ca);
  perform set_config('request.jwt.claims', '', true);

  e_a := pg_temp.criar(v_owner, jsonb_build_object('titulo', 'eA', 'cliente_id', v_ca));
  e_b := pg_temp.criar(v_owner, jsonb_build_object('titulo', 'eB', 'cliente_id', v_cb));
  e_borg := pg_temp.criar(v_owner, jsonb_build_object('titulo', 'eBorg', 'cliente_id', v_cb));
  e_bser := pg_temp.criar(v_owner, jsonb_build_object('titulo', 'eBser', 'cliente_id', v_cb,
              'inicio_local', '2026-11-09T09:00:00', 'fim_local', '2026-11-09T10:00:00', 'regra', v_semanal));
  e_privr := pg_temp.criar(v_owner, jsonb_build_object('titulo', 'ePrivR', 'privado', true));
  e_no := pg_temp.criar(v_owner, jsonb_build_object('titulo', 'eNo'));
  e_noown := pg_temp.criar(v_owner, jsonb_build_object('titulo', 'eNoOwn'));
  e_semed := pg_temp.criar(v_owner, jsonb_build_object('titulo', 'eSemEd'));
  e_shared := pg_temp.criar(v_owner, jsonb_build_object('titulo', 'eShared', 'cliente_id', v_ca,
              'compartilhado_cliente', true,
              'inicio_local', '2026-11-09T09:00:00', 'fim_local', '2026-11-09T10:00:00', 'regra', v_semanal));
  -- the restricted agent organizes eBorg / eBser / ePrivR / eNoOwn; semed organizes eSemEd (superuser, no claims)
  update agenda_eventos set organizador_id = v_restr where id in (e_borg, e_bser, e_privr, e_noown);
  update agenda_participantes set user_id = v_restr where evento_id in (e_borg, e_bser, e_privr, e_noown) and user_id = v_owner;
  update agenda_eventos set organizador_id = v_semed where id = e_semed;
  update agenda_participantes set user_id = v_semed where evento_id = e_semed and user_id = v_owner;

  -- ---- write_as_denied_to_authenticated
  v_err := pg_temp.err_as(v_owner, format('select * from public.agenda_evento_criar_as(%L, %L, true, %L::jsonb, ''{}''::uuid[])', v_ws, v_owner, pg_temp.pl()));
  assert v_err = '42501', 'criar_as_denied_to_authenticated: ' || coalesce(v_err, 'allowed');
  v_err := pg_temp.err_as(v_owner, format('select public.agenda_evento_editar_as(%L, %L, true, %s, ''todas'', ''{"titulo":"x"}''::jsonb)', v_ws, v_owner, pg_temp.oc1(e_a)));
  assert v_err = '42501', 'editar_as_denied_to_authenticated: ' || coalesce(v_err, 'allowed');
  v_err := pg_temp.err_as(v_owner, format('select public.agenda_evento_excluir_as(%L, %L, true, %s, ''todas'')', v_ws, v_owner, pg_temp.oc1(e_a)));
  assert v_err = '42501', 'excluir_as_denied_to_authenticated: ' || coalesce(v_err, 'allowed');

  -- ---- write_as_non_member_refused (member of W1 only), and null identities
  v_err := pg_temp.svc(null, format('select * from public.agenda_evento_criar_as(%L, %L, true, %L::jsonb, ''{}''::uuid[])', v_ws, v_fora, pg_temp.pl()));
  assert v_err = 'agenda: sessão sem workspace ativo', 'criar_as_non_member_refused: ' || coalesce(v_err, 'allowed');
  v_err := pg_temp.svc(null, format('select * from public.agenda_evento_criar_as(%L, null, true, %L::jsonb, ''{}''::uuid[])', v_ws, pg_temp.pl()));
  assert v_err = 'agenda: sessão sem workspace ativo', 'criar_as_null_user_refused: ' || coalesce(v_err, 'allowed');
  v_err := pg_temp.svc(null, format('select * from public.agenda_evento_criar_as(null, %L, true, %L::jsonb, ''{}''::uuid[])', v_owner, pg_temp.pl()));
  assert v_err = 'agenda: sessão sem workspace ativo', 'criar_as_null_conta_refused: ' || coalesce(v_err, 'allowed');
  v_err := pg_temp.svc(null, format('select public.agenda_evento_editar_as(%L, %L, true, %s, ''todas'', ''{"titulo":"x"}''::jsonb)', v_ws, v_fora, pg_temp.oc1(e_a)));
  assert v_err = 'agenda: sessão sem workspace ativo', 'editar_as_non_member_refused: ' || coalesce(v_err, 'allowed');
  v_err := pg_temp.svc(null, format('select public.agenda_evento_editar_as(null, %L, true, %s, ''todas'', ''{"titulo":"x"}''::jsonb)', v_owner, pg_temp.oc1(e_a)));
  assert v_err = 'agenda: sessão sem workspace ativo', 'editar_as_null_conta_refused: ' || coalesce(v_err, 'allowed');
  v_err := pg_temp.svc(null, format('select public.agenda_evento_excluir_as(%L, %L, true, %s, ''todas'')', v_ws, v_fora, pg_temp.oc1(e_a)));
  assert v_err = 'agenda: sessão sem workspace ativo', 'excluir_as_non_member_refused: ' || coalesce(v_err, 'allowed');
  v_err := pg_temp.svc(null, format('select public.agenda_evento_excluir_as(%L, null, true, %s, ''todas'')', v_ws, pg_temp.oc1(e_a)));
  assert v_err = 'agenda: sessão sem workspace ativo', 'excluir_as_null_user_refused: ' || coalesce(v_err, 'allowed');

  -- ---- create: strict for the restricted agent (the trigger sees the actor)
  v_err := pg_temp.svc(null, format('select * from public.agenda_evento_criar_as(%L, %L, true, %L::jsonb, ''{}''::uuid[])',
             v_ws, v_restr, pg_temp.pl(jsonb_build_object('cliente_id', v_cb))));
  assert v_err = 'client_scope_restricted', 'criar_as_restricted_unassigned_client_denied: ' || coalesce(v_err, 'ok');
  v_err := pg_temp.svc(null, format('select * from public.agenda_evento_criar_as(%L, %L, true, %L::jsonb, ''{}''::uuid[])',
             v_ws, v_restr, pg_temp.pl()));
  assert v_err = 'client_scope_restricted', 'criar_as_restricted_no_client_denied: ' || coalesce(v_err, 'ok');
  v_v := pg_temp.svc_val(null, format('select c.evento_id::text from public.agenda_evento_criar_as(%L, %L, true, %L::jsonb, ''{}''::uuid[]) c',
             v_ws, v_restr, pg_temp.pl(jsonb_build_object('titulo', 'eNovoA', 'cliente_id', v_ca))));
  assert v_v is not null, 'criar_as_restricted_assigned_ok';
  assert (select organizador_id from agenda_eventos where id = v_v::bigint) = v_restr, 'criar_as_organizer_is_p_user';
  assert (select conta_id from agenda_eventos where id = v_v::bigint) = v_ws, 'criar_as_conta_is_p_conta';
  -- the todos agent creates without a client
  v_err := pg_temp.svc(null, format('select * from public.agenda_evento_criar_as(%L, %L, true, %L::jsonb, ''{}''::uuid[])',
             v_ws, v_todos, pg_temp.pl()));
  assert v_err is null, 'criar_as_todos_without_client_ok: ' || coalesce(v_err, '');
  -- without calendario editar
  v_err := pg_temp.svc(null, format('select * from public.agenda_evento_criar_as(%L, %L, true, %L::jsonb, ''{}''::uuid[])',
             v_ws, v_semed, pg_temp.pl()));
  assert v_err = 'agenda: você não pode criar eventos', 'criar_as_without_calendario_editar_denied: ' || coalesce(v_err, 'ok');

  -- ---- edit
  v_err := pg_temp.svc(null, format('select public.agenda_evento_editar_as(%L, %L, true, %s, ''todas'', ''{"titulo":"meu"}''::jsonb)', v_ws, v_restr, pg_temp.oc1(e_borg)));
  assert v_err is null, 'editar_as_own_unassigned_event_content_ok: ' || coalesce(v_err, '');
  assert (select titulo from agenda_eventos where id = e_borg) = 'meu', 'editar_as_own_unassigned_event_content_saved';
  v_err := pg_temp.svc(null, format('select public.agenda_evento_editar_as(%L, %L, true, %s, ''todas'', %L::jsonb)', v_ws, v_restr, pg_temp.oc1(e_borg), jsonb_build_object('cliente_id', v_ca)));
  assert v_err = 'client_scope_restricted', 'editar_as_move_to_other_client_denied: ' || coalesce(v_err, 'ok');
  -- a hidden client's event: same error as a missing one
  v_err := pg_temp.svc(null, format('select public.agenda_evento_editar_as(%L, %L, true, %s, ''todas'', ''{"titulo":"x"}''::jsonb)', v_ws, v_restr, pg_temp.oc1(e_b)));
  assert v_err = 'agenda: este evento não existe mais', 'editar_as_hidden_event_denied: ' || coalesce(v_err, 'ok');
  -- the 'seguintes' split of his own series in B inherits the source's client
  v_err := pg_temp.svc(null, format('select public.agenda_evento_editar_as(%L, %L, true, %s, ''seguintes'', ''{"titulo":"tail"}''::jsonb)', v_ws, v_restr, pg_temp.oc(e_bser, '2026-11-16')));
  assert v_err is null, 'editar_as_seguintes_split_inherits_source: ' || coalesce(v_err, '');
  select id into e_tail from agenda_eventos where serie_origem_id = e_bser;
  assert e_tail is not null and (select cliente_id from agenda_eventos where id = e_tail) = v_cb
     and (select organizador_id from agenda_eventos where id = e_tail) = v_restr, 'editar_as_split_tail_stays_in_b';
  v_err := pg_temp.svc(null, format('select public.agenda_evento_editar_as(%L, %L, true, %s, ''todas'', ''{"titulo":"x"}''::jsonb)', v_ws, v_semed, pg_temp.oc1(e_semed)));
  assert v_err = 'agenda: você não pode editar este evento', 'editar_as_without_calendario_editar_denied: ' || coalesce(v_err, 'ok');
  v_err := pg_temp.svc(null, format('select public.agenda_evento_editar_as(%L, %L, true, %s, ''todas'', ''{"titulo":"x"}''::jsonb)', v_ws, v_todos, pg_temp.oc1(e_a)));
  assert v_err = 'agenda: você não pode editar este evento', 'editar_as_non_organizer_agent_denied: ' || coalesce(v_err, 'ok');
  -- an admin edits the owner's event: the organizer stays (author_immutable now fires for the actor)
  v_err := pg_temp.svc(null, format('select public.agenda_evento_editar_as(%L, %L, false, %s, ''todas'', ''{"titulo":"eA2"}''::jsonb)', v_ws, v_adm, pg_temp.oc1(e_a)));
  assert v_err is null, 'editar_as_admin_public_event_ok: ' || coalesce(v_err, '');
  assert (select organizador_id from agenda_eventos where id = e_a) = v_owner
     and (select titulo from agenda_eventos where id = e_a) = 'eA2', 'editar_as_keeps_organizer';

  -- ---- delete
  v_err := pg_temp.svc(null, format('select public.agenda_evento_excluir_as(%L, %L, true, %s, ''todas'')', v_ws, v_restr, pg_temp.oc1(e_b)));
  assert v_err = 'agenda: este evento não existe mais', 'excluir_as_hidden_event_denied: ' || coalesce(v_err, 'ok');
  v_err := pg_temp.svc(null, format('select public.agenda_evento_excluir_as(%L, %L, true, %s, ''todas'')', v_ws, v_restr, pg_temp.oc1(e_borg)));
  assert v_err = 'client_scope_restricted', 'excluir_as_own_unassigned_client_event_denied: ' || coalesce(v_err, 'ok');
  v_err := pg_temp.svc(null, format('select public.agenda_evento_excluir_as(%L, %L, true, %s, ''todas'')', v_ws, v_restr, pg_temp.oc1(e_noown)));
  assert v_err is null, 'excluir_as_own_ok: ' || coalesce(v_err, '');
  assert not exists (select 1 from agenda_ocorrencias where evento_id = e_noown and not cancelada), 'excluir_as_own_removed';

  -- ---- privados_false: an API-key connection never touches a private event
  v_err := pg_temp.svc(null, format('select * from public.agenda_evento_criar_as(%L, %L, false, %L::jsonb, ''{}''::uuid[])',
             v_ws, v_owner, pg_temp.pl(jsonb_build_object('privado', true))));
  assert v_err = 'agenda: evento privado indisponível nesta conexão', 'privados_false_criar_privado_refused: ' || coalesce(v_err, 'ok');
  v_err := pg_temp.svc(null, format('select * from public.agenda_evento_criar_as(%L, %L, null, %L::jsonb, ''{}''::uuid[])',
             v_ws, v_owner, pg_temp.pl(jsonb_build_object('privado', true))));
  assert v_err = 'agenda: evento privado indisponível nesta conexão', 'privados_null_criar_privado_refused: ' || coalesce(v_err, 'ok');
  v_err := pg_temp.svc(null, format('select * from public.agenda_evento_criar_as(%L, %L, false, %L::jsonb, ''{}''::uuid[])',
             v_ws, v_owner, pg_temp.pl()));
  assert v_err is null, 'privados_false_criar_publico_ok: ' || coalesce(v_err, '');
  v_err := pg_temp.svc(null, format('select public.agenda_evento_editar_as(%L, %L, false, %s, ''todas'', ''{"titulo":"x"}''::jsonb)', v_ws, v_restr, pg_temp.oc1(e_privr)));
  assert v_err = 'agenda: evento privado indisponível nesta conexão', 'privados_false_editar_own_private_refused: ' || coalesce(v_err, 'ok');
  v_err := pg_temp.svc(null, format('select public.agenda_evento_excluir_as(%L, %L, false, %s, ''todas'')', v_ws, v_restr, pg_temp.oc1(e_privr)));
  assert v_err = 'agenda: evento privado indisponível nesta conexão', 'privados_false_excluir_own_private_refused: ' || coalesce(v_err, 'ok');
  v_err := pg_temp.svc(null, format('select public.agenda_evento_editar_as(%L, %L, false, %s, ''todas'', ''{"privado":true}''::jsonb)', v_ws, v_owner, pg_temp.oc1(e_no)));
  assert v_err = 'agenda: evento privado indisponível nesta conexão', 'privados_false_editar_set_privado_refused: ' || coalesce(v_err, 'ok');
  assert (select not privado from agenda_eventos where id = e_no), 'privados_false_editar_set_privado_not_saved';
  -- with privados the organizer edits his own private event
  v_err := pg_temp.svc(null, format('select public.agenda_evento_editar_as(%L, %L, true, %s, ''todas'', ''{"titulo":"meu priv"}''::jsonb)', v_ws, v_restr, pg_temp.oc1(e_privr)));
  assert v_err is null, 'privados_true_editar_own_private_ok: ' || coalesce(v_err, '');
  -- listar core with a NULL p_privados fails closed (masks his own private event)
  execute format('select l.mascarado::text from public._agenda_listar_core(%L, %L, null, %s, null) l where l.evento_id = %s',
                 v_ws, v_restr, v_win, e_privr) into v_v;
  assert v_v = 'true', 'listar_core_null_privados_masks: ' || coalesce(v_v, 'null');

  -- ---- substituir_records_actor: moving one occurrence of a shared series
  -- supersedes its pending reschedule request, resolved by the MCP user
  v_oc := pg_temp.oc(e_shared, '2026-11-16');
  insert into agenda_remarcacoes (conta_id, cliente_id, ocorrencia_id, inicio_sugerido, fim_sugerido)
    values (v_ws, v_ca, v_oc, '2026-11-17 14:00+00', '2026-11-17 15:00+00') returning id into v_rm;
  v_err := pg_temp.svc(null, format('select public.agenda_evento_editar_as(%L, %L, true, %s, ''esta'', ''{"inicio_local":"2026-11-16T16:00:00","fim_local":"2026-11-16T17:00:00"}''::jsonb)', v_ws, v_owner, v_oc));
  assert v_err is null, 'substituir_edit_ok: ' || coalesce(v_err, '');
  assert (select status from agenda_remarcacoes where id = v_rm) = 'substituida', 'substituir_status';
  assert (select resolvido_por from agenda_remarcacoes where id = v_rm) = v_owner,
    'substituir_records_actor: ' || coalesce((select resolvido_por::text from agenda_remarcacoes where id = v_rm), 'null');

  -- ---- actor_setting_cleared_after_as (inline: the svc helpers clear it themselves)
  perform set_config('request.jwt.claims', '', true);
  perform set_config('mesaas.agenda_actor', '', true);
  execute 'set local role service_role';
  perform public.agenda_evento_editar_as(v_ws, v_owner, true, pg_temp.oc1(e_no), 'todas', '{"titulo":"eNo2"}'::jsonb);
  v_v := current_setting('mesaas.agenda_actor', true);
  execute 'reset role';
  assert v_v = '', 'actor_setting_cleared_after_editar_as: ' || coalesce(v_v, 'null');
  execute 'set local role service_role';
  perform * from public.agenda_evento_criar_as(v_ws, v_owner, true, pg_temp.pl(), '{}'::uuid[]);
  v_v := current_setting('mesaas.agenda_actor', true);
  execute 'reset role';
  assert v_v = '', 'actor_setting_cleared_after_criar_as: ' || coalesce(v_v, 'null');
  select o.id into v_oc from agenda_ocorrencias o join agenda_eventos e on e.id = o.evento_id
   where e.conta_id = v_ws and e.titulo = 'eNo2' limit 1;
  execute 'set local role service_role';
  perform public.agenda_evento_excluir_as(v_ws, v_owner, true, v_oc, 'todas');
  v_v := current_setting('mesaas.agenda_actor', true);
  execute 'reset role';
  assert v_v = '', 'actor_setting_cleared_after_excluir_as: ' || coalesce(v_v, 'null');

  -- ---- the CRM errors with no session stay
  v_err := pg_temp.svc(null, format('select * from public.agenda_evento_criar(%L::jsonb, ''{}''::uuid[])', pg_temp.pl()));
  assert v_err = 'agenda: sessão sem workspace ativo', 'crm_criar_without_session_raises: ' || coalesce(v_err, 'allowed');
  v_err := pg_temp.svc(null, format('select public.agenda_evento_editar(%s, ''todas'', ''{"titulo":"x"}''::jsonb)', pg_temp.oc1(e_a)));
  assert v_err = 'agenda: sessão sem workspace ativo', 'crm_editar_without_session_raises: ' || coalesce(v_err, 'allowed');
  v_err := pg_temp.svc(null, format('select public.agenda_evento_excluir(%s, ''todas'')', pg_temp.oc1(e_a)));
  assert v_err = 'agenda: sessão sem workspace ativo', 'crm_excluir_without_session_raises: ' || coalesce(v_err, 'allowed');

  -- ---- write_as_flag_off (override on W, plan stays on)
  insert into workspace_plan_overrides (workspace_id, feature_overrides)
    values (v_ws, '{"feature_agenda": false}')
    on conflict (workspace_id) do update
      set feature_overrides = coalesce(workspace_plan_overrides.feature_overrides, '{}'::jsonb) || excluded.feature_overrides;
  v_err := pg_temp.svc(null, format('select * from public.agenda_evento_criar_as(%L, %L, true, %L::jsonb, ''{}''::uuid[])', v_ws, v_owner, pg_temp.pl()));
  assert v_err = 'feature_disabled:feature_agenda', 'criar_as_flag_off: ' || coalesce(v_err, 'ok');
  v_err := pg_temp.svc(null, format('select public.agenda_evento_editar_as(%L, %L, true, %s, ''todas'', ''{"titulo":"x"}''::jsonb)', v_ws, v_owner, pg_temp.oc1(e_a)));
  assert v_err = 'feature_disabled:feature_agenda', 'editar_as_flag_off: ' || coalesce(v_err, 'ok');
  v_err := pg_temp.svc(null, format('select public.agenda_evento_excluir_as(%L, %L, true, %s, ''todas'')', v_ws, v_owner, pg_temp.oc1(e_a)));
  assert v_err = 'feature_disabled:feature_agenda', 'excluir_as_flag_off: ' || coalesce(v_err, 'ok');
end $$;

rollback;
