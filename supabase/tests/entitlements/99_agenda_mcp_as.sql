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
  assert has_function_privilege('authenticated', 'public.agenda_pode_ver_evento(bigint, boolean, uuid, uuid)', 'EXECUTE')
     and has_function_privilege('service_role', 'public.agenda_pode_ver_evento(bigint, boolean, uuid, uuid)', 'EXECUTE'),
    'pode_ver_evento_4arg_acl_as_3arg';
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
  -- 3-arg keeps auth.uid()
  v_v := pg_temp.val_as(v_part, null, format('select public.agenda_pode_ver_evento(%s, true, %L)::text', v_ev, v_a));
  assert v_v = 'true', 'pode_ver_evento_3arg_participant: ' || coalesce(v_v, 'null');
  v_v := pg_temp.val_as(v_b, v_a, format('select public.agenda_pode_ver_evento(%s, true, %L)::text', v_ev, v_a));
  assert v_v = 'false', 'pode_ver_evento_3arg_ignores_actor_setting: ' || coalesce(v_v, 'null');
end $$;

rollback;
