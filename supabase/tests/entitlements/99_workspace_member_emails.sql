\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- get_workspace_member_emails (20261021130000): e-mails de login dos membros
-- do workspace ATIVO, só para quem tem equipe:editar. Dono, admin legado e
-- papel customizado com equipe:editar recebem as linhas; agente legado e
-- papel com equipe:ver recebem zero; nada vaza entre workspaces.

begin;
select et_grant_hosted_parity();

-- e-mails que p_user recebe, ordenados e separados por vírgula
create or replace function pg_temp.emails(p_user uuid) returns text language plpgsql as $f$
declare v text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select string_agg(e.email, ',' order by e.email) into v from public.get_workspace_member_emails() e;
  execute 'reset role';
  return coalesce(v, '');
end $f$;

do $$
declare
  v_ws_a uuid := et_make_workspace('max');
  v_ws_b uuid := et_make_workspace('max');
  v_owner  uuid := gen_random_uuid();
  v_admin  uuid := gen_random_uuid();
  v_agent  uuid := gen_random_uuid();
  v_ver    uuid := gen_random_uuid();
  v_editar uuid := gen_random_uuid();
  v_other  uuid := gen_random_uuid();
  v_role_ver uuid;
  v_role_editar uuid;
  v_all text := 'admin@a.test,agent@a.test,editar@a.test,owner@a.test,ver@a.test';
begin
  insert into auth.users (id, email) values
    (v_owner, 'owner@a.test'), (v_admin, 'admin@a.test'), (v_agent, 'agent@a.test'),
    (v_ver, 'ver@a.test'), (v_editar, 'editar@a.test'), (v_other, 'other@b.test');

  insert into workspace_roles (conta_id, nome, permissions)
    values (v_ws_a, 'So ver', '{"equipe": "ver"}'::jsonb) returning id into v_role_ver;
  insert into workspace_roles (conta_id, nome, permissions)
    values (v_ws_a, 'Gestor', '{"equipe": "editar"}'::jsonb) returning id into v_role_editar;

  insert into workspace_members (user_id, workspace_id, role, role_id) values
    (v_owner, v_ws_a, 'owner', null), (v_admin, v_ws_a, 'admin', null),
    (v_agent, v_ws_a, 'agent', null), (v_ver, v_ws_a, 'agent', v_role_ver),
    (v_editar, v_ws_a, 'agent', v_role_editar), (v_other, v_ws_b, 'owner', null);
  update profiles set conta_id = v_ws_a, active_workspace_id = v_ws_a
   where id in (v_owner, v_admin, v_agent, v_ver, v_editar);
  update profiles set conta_id = v_ws_b, active_workspace_id = v_ws_b where id = v_other;

  assert pg_temp.emails(v_owner) = v_all, 'owner: ' || pg_temp.emails(v_owner);
  assert pg_temp.emails(v_admin) = v_all, 'legacy admin: ' || pg_temp.emails(v_admin);
  assert pg_temp.emails(v_editar) = v_all, 'custom equipe:editar: ' || pg_temp.emails(v_editar);
  assert pg_temp.emails(v_agent) = '', 'legacy agent got emails: ' || pg_temp.emails(v_agent);
  assert pg_temp.emails(v_ver) = '', 'custom equipe:ver got emails: ' || pg_temp.emails(v_ver);
  assert pg_temp.emails(v_other) = 'other@b.test', 'workspace B owner: ' || pg_temp.emails(v_other);

  -- An admin removed from A whose profile still points at it: get_my_conta_id()
  -- resolves NULL (no membership), so nothing comes back. (Pointing the active
  -- workspace at a non-member one is blocked by validate_active_workspace.)
  delete from workspace_members where user_id = v_admin and workspace_id = v_ws_a;
  assert pg_temp.emails(v_admin) = '', 'removed admin still sees emails: ' || pg_temp.emails(v_admin);

  assert not has_function_privilege('anon', 'public.get_workspace_member_emails()', 'execute'),
    'anon can execute get_workspace_member_emails';

  raise notice 'PASS 99_workspace_member_emails';
end $$;
rollback;
