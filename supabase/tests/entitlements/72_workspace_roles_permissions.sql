\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Truth table for the permission core added by migration
-- 20260903000002_workspace_roles_a_additive.sql:
--   public.has_permission_for(p_user, p_workspace, p_module, p_action) -- the
--     service-role-only core. Every truth-table case below calls it DIRECTLY
--     as postgres (superuser bypasses the EXECUTE grant), exactly as the
--     brief specifies ("via service path"), so none of these cases need
--     set_config('request.jwt.claims', ...) or SET LOCAL ROLE.
--   public.has_permission(p_module, p_action) -- the thin wrapper clients
--     call, resolving auth.uid() + get_my_conta_id() and delegating to the
--     function above. Exercised separately (TT-17) WITH the jwt claims +
--     role-impersonation technique from 50_can_see_financials.sql, since it
--     genuinely reads auth.uid().
--
-- Case ids below (TT-01..TT-20) are the verbatim ids from the task-2 brief
-- and are reused as-is by the Task 7 Vitest suite -- keep them stable.

-- =============================================================
-- TT-18: anon cannot execute has_permission() (client wrapper).
-- Runs first, in its own transaction, independent of every block below, so it
-- still executes even if a later block's ON_ERROR_STOP aborts the file.
-- =============================================================
begin;
do $$
declare v_ok boolean := false;
begin
  set local role anon;
  begin
    perform public.has_permission('clientes', 'ver');
  exception when insufficient_privilege then
    v_ok := true;
  end;
  reset role;
  if not v_ok then
    raise exception 'TT-18: anon must not be able to execute has_permission()';
  end if;
  raise notice '72: TT-18 ok';
end $$;
rollback;

-- =============================================================
-- TT-19: authenticated cannot execute has_permission_for() (service-role-only
-- core). Own transaction, independent of the rest.
-- =============================================================
begin;
do $$
declare v_ok boolean := false;
begin
  set local role authenticated;
  begin
    perform public.has_permission_for(gen_random_uuid(), gen_random_uuid(), 'clientes', 'ver');
  exception when insufficient_privilege then
    v_ok := true;
  end;
  reset role;
  if not v_ok then
    raise exception 'TT-19: authenticated must not be able to execute has_permission_for()';
  end if;
  raise notice '72: TT-19 ok';
end $$;
rollback;

-- =============================================================
-- TT-01..TT-16: the has_permission_for() predicate truth table.
-- =============================================================
begin;
do $$
declare
  v_ws             uuid;
  v_owner          uuid := gen_random_uuid();
  v_admin          uuid := gen_random_uuid();
  v_agent          uuid := gen_random_uuid();
  v_c_editar       uuid := gen_random_uuid();  -- custom role {"leads":"editar"}
  v_c_ver          uuid := gen_random_uuid();  -- custom role {"leads":"ver"}
  v_c_none         uuid := gen_random_uuid();  -- custom role {"leads":"none"}
  v_c_empty        uuid := gen_random_uuid();  -- custom role {}
  v_agent_fin      uuid := gen_random_uuid();  -- role='agent', can_see_financials=true, custom role {}
  v_no_member      uuid := gen_random_uuid();  -- never inserted anywhere: TT-14
  v_role_editar    uuid;
  v_role_ver       uuid;
  v_role_none      uuid;
  v_role_empty     uuid;
begin
  v_ws := et_make_workspace('max');

  insert into auth.users (id) values
    (v_owner), (v_admin), (v_agent), (v_c_editar), (v_c_ver), (v_c_none), (v_c_empty), (v_agent_fin);

  insert into workspace_roles (conta_id, nome, permissions) values
    (v_ws, 'TT Custom Editar Leads', '{"leads":"editar"}'::jsonb) returning id into v_role_editar;
  insert into workspace_roles (conta_id, nome, permissions) values
    (v_ws, 'TT Custom Ver Leads', '{"leads":"ver"}'::jsonb) returning id into v_role_ver;
  insert into workspace_roles (conta_id, nome, permissions) values
    (v_ws, 'TT Custom None Leads', '{"leads":"none"}'::jsonb) returning id into v_role_none;
  insert into workspace_roles (conta_id, nome, permissions) values
    (v_ws, 'TT Custom Empty', '{}'::jsonb) returning id into v_role_empty;

  insert into workspace_members (user_id, workspace_id, role) values
    (v_owner, v_ws, 'owner'),
    (v_admin, v_ws, 'admin'),
    (v_agent, v_ws, 'agent');
  insert into workspace_members (user_id, workspace_id, role, role_id) values
    (v_c_editar, v_ws, 'agent', v_role_editar),
    (v_c_ver,    v_ws, 'agent', v_role_ver),
    (v_c_none,   v_ws, 'agent', v_role_none),
    (v_c_empty,  v_ws, 'agent', v_role_empty);
  insert into workspace_members (user_id, workspace_id, role, role_id, can_see_financials) values
    (v_agent_fin, v_ws, 'agent', v_role_empty, true);

  -- TT-01: owner, qualquer módulo/ação => true (financeiro/editar incluso)
  if public.has_permission_for(v_owner, v_ws, 'financeiro', 'editar') is not true then
    raise exception 'TT-01: owner financeiro/editar should be true';
  end if;
  if public.has_permission_for(v_owner, v_ws, 'clientes', 'ver') is not true then
    raise exception 'TT-01: owner clientes/ver should be true';
  end if;
  raise notice '72: TT-01 ok';

  -- TT-02: admin legado, can_see_financials=true (default): financeiro/ver e
  -- financeiro/editar => true. Migração B
  -- (20260904000001_workspace_roles_b_enforcement.sql, item 2) acopla
  -- contratos à mesma exceção do ramo 'admin' -- fato de produção (admin
  -- restrito já não via contratos antes desta migração: nav-data.ts escondia
  -- os dois juntos, e a RLS legada de contratos_select lia
  -- can_see_financials() diretamente, igual a transacoes), não uma mudança
  -- de comportamento.
  if public.has_permission_for(v_admin, v_ws, 'financeiro', 'ver') is not true then
    raise exception 'TT-02: admin (can_see=true) financeiro/ver should be true';
  end if;
  if public.has_permission_for(v_admin, v_ws, 'financeiro', 'editar') is not true then
    raise exception 'TT-02: admin (can_see=true) financeiro/editar should be true';
  end if;
  if public.has_permission_for(v_admin, v_ws, 'contratos', 'ver') is not true then
    raise exception 'TT-02: admin (can_see=true) contratos/ver should be true';
  end if;
  if public.has_permission_for(v_admin, v_ws, 'contratos', 'editar') is not true then
    raise exception 'TT-02: admin (can_see=true) contratos/editar should be true';
  end if;
  raise notice '72: TT-02 ok';

  -- TT-04: admin legado, módulos fora de financeiro/contratos => true
  -- independente do flag (contratos passou a ser exceção junto com
  -- financeiro em Migração B, então NÃO entra neste "sempre true" -- ver
  -- TT-02/TT-03 acima para a cobertura de contratos).
  if public.has_permission_for(v_admin, v_ws, 'leads', 'editar') is not true then
    raise exception 'TT-04: admin leads/editar should be true';
  end if;
  if public.has_permission_for(v_admin, v_ws, 'configuracoes', 'editar') is not true then
    raise exception 'TT-04: admin configuracoes/editar should be true';
  end if;
  raise notice '72: TT-04 ok';

  -- TT-03: admin legado, can_see_financials=false: financeiro/ver e
  -- financeiro/editar => false (toggled AFTER TT-02/TT-04 read the true state,
  -- same same-user-sequential-update style as 50_can_see_financials.sql).
  -- Migração B: contratos/ver e contratos/editar seguem o mesmo flag.
  update workspace_members set can_see_financials = false
   where user_id = v_admin and workspace_id = v_ws;
  if public.has_permission_for(v_admin, v_ws, 'financeiro', 'ver') is not false then
    raise exception 'TT-03: admin (can_see=false) financeiro/ver should be false';
  end if;
  if public.has_permission_for(v_admin, v_ws, 'financeiro', 'editar') is not false then
    raise exception 'TT-03: admin (can_see=false) financeiro/editar should be false';
  end if;
  if public.has_permission_for(v_admin, v_ws, 'contratos', 'ver') is not false then
    raise exception 'TT-03: admin (can_see=false) contratos/ver should be false';
  end if;
  if public.has_permission_for(v_admin, v_ws, 'contratos', 'editar') is not false then
    raise exception 'TT-03: admin (can_see=false) contratos/editar should be false';
  end if;
  raise notice '72: TT-03 ok';

  -- TT-05: agent legado: clientes/editar=true, tarefas/editar=true
  if public.has_permission_for(v_agent, v_ws, 'clientes', 'editar') is not true then
    raise exception 'TT-05: agent clientes/editar should be true';
  end if;
  if public.has_permission_for(v_agent, v_ws, 'tarefas', 'editar') is not true then
    raise exception 'TT-05: agent tarefas/editar should be true';
  end if;
  raise notice '72: TT-05 ok';

  -- TT-06: agent legado: analytics/ver=true, analytics/editar=false
  if public.has_permission_for(v_agent, v_ws, 'analytics', 'ver') is not true then
    raise exception 'TT-06: agent analytics/ver should be true';
  end if;
  if public.has_permission_for(v_agent, v_ws, 'analytics', 'editar') is not false then
    raise exception 'TT-06: agent analytics/editar should be false';
  end if;
  raise notice '72: TT-06 ok';

  -- TT-07: agent legado: automacoes/ver=true, automacoes/editar=true.
  -- Migração B (20260904000001_workspace_roles_b_enforcement.sql, item 6)
  -- remaps 'automacoes' to govern only instagram_comment_automations, which
  -- already gave every workspace member (agent included) unrestricted write
  -- since 20260829000002 -- 'editar' is what preserves that byte-for-byte
  -- ('ver', used by an earlier round of this migration, would have revoked
  -- write the agent already had). post_status_automations moved to the
  -- 'configuracoes' module instead (already 'none' for the agent, so its
  -- owner/admin-only access is unchanged).
  if public.has_permission_for(v_agent, v_ws, 'automacoes', 'ver') is not true then
    raise exception 'TT-07: agent automacoes/ver should be true';
  end if;
  if public.has_permission_for(v_agent, v_ws, 'automacoes', 'editar') is not true then
    raise exception 'TT-07: agent automacoes/editar should be true';
  end if;
  raise notice '72: TT-07 ok';

  -- TT-08: agent legado: leads/ver, financeiro/ver, equipe/ver, contratos/ver,
  -- configuracoes/ver => false
  if public.has_permission_for(v_agent, v_ws, 'leads', 'ver') is not false then
    raise exception 'TT-08: agent leads/ver should be false';
  end if;
  if public.has_permission_for(v_agent, v_ws, 'financeiro', 'ver') is not false then
    raise exception 'TT-08: agent financeiro/ver should be false';
  end if;
  if public.has_permission_for(v_agent, v_ws, 'equipe', 'ver') is not false then
    raise exception 'TT-08: agent equipe/ver should be false';
  end if;
  if public.has_permission_for(v_agent, v_ws, 'contratos', 'ver') is not false then
    raise exception 'TT-08: agent contratos/ver should be false';
  end if;
  if public.has_permission_for(v_agent, v_ws, 'configuracoes', 'ver') is not false then
    raise exception 'TT-08: agent configuracoes/ver should be false';
  end if;
  raise notice '72: TT-08 ok';

  -- TT-09: papel custom {"leads":"editar"}: leads/ver=true, leads/editar=true
  if public.has_permission_for(v_c_editar, v_ws, 'leads', 'ver') is not true then
    raise exception 'TT-09: custom {leads:editar} leads/ver should be true';
  end if;
  if public.has_permission_for(v_c_editar, v_ws, 'leads', 'editar') is not true then
    raise exception 'TT-09: custom {leads:editar} leads/editar should be true';
  end if;
  raise notice '72: TT-09 ok';

  -- TT-10: papel custom {"leads":"ver"}: leads/ver=true, leads/editar=false
  if public.has_permission_for(v_c_ver, v_ws, 'leads', 'ver') is not true then
    raise exception 'TT-10: custom {leads:ver} leads/ver should be true';
  end if;
  if public.has_permission_for(v_c_ver, v_ws, 'leads', 'editar') is not false then
    raise exception 'TT-10: custom {leads:ver} leads/editar should be false';
  end if;
  raise notice '72: TT-10 ok';

  -- TT-11: papel custom {"leads":"none"}: leads/ver=false
  if public.has_permission_for(v_c_none, v_ws, 'leads', 'ver') is not false then
    raise exception 'TT-11: custom {leads:none} leads/ver should be false';
  end if;
  raise notice '72: TT-11 ok';

  -- TT-12: papel custom, módulo ausente do jsonb: clientes/ver=false
  -- (falha fechada). v_c_editar's jsonb only has a "leads" key.
  if public.has_permission_for(v_c_editar, v_ws, 'clientes', 'ver') is not false then
    raise exception 'TT-12: custom role missing the ''clientes'' key should fail closed (false)';
  end if;
  raise notice '72: TT-12 ok';

  -- TT-13: papel custom {}: tudo false
  if public.has_permission_for(v_c_empty, v_ws, 'leads', 'ver') is not false then
    raise exception 'TT-13: custom {} leads/ver should be false';
  end if;
  if public.has_permission_for(v_c_empty, v_ws, 'financeiro', 'ver') is not false then
    raise exception 'TT-13: custom {} financeiro/ver should be false';
  end if;
  if public.has_permission_for(v_c_empty, v_ws, 'clientes', 'editar') is not false then
    raise exception 'TT-13: custom {} clientes/editar should be false';
  end if;
  raise notice '72: TT-13 ok';

  -- TT-14: sem membership: false. v_no_member is never inserted into
  -- workspace_members (nor even auth.users -- has_permission_for only reads
  -- workspace_members, so this is a valid "no row found" fixture).
  if public.has_permission_for(v_no_member, v_ws, 'clientes', 'ver') is not false then
    raise exception 'TT-14: user with no membership should get false';
  end if;
  raise notice '72: TT-14 ok';

  -- TT-15: ação inválida ('excluir') => false; módulo inexistente ('xyz') =>
  -- false. The action check runs before role resolution, so any valid user
  -- works for the first half; the module check must use a role whose branch
  -- actually validates the module (agent's preset CASE has an ELSE false --
  -- owner/admin do not validate module at all).
  if public.has_permission_for(v_owner, v_ws, 'clientes', 'excluir') is not false then
    raise exception 'TT-15: invalid action ''excluir'' should yield false even for owner';
  end if;
  if public.has_permission_for(v_agent, v_ws, 'xyz', 'ver') is not false then
    raise exception 'TT-15: nonexistent module ''xyz'' should yield false for agent';
  end if;
  raise notice '72: TT-15 ok';

  -- TT-16: papel custom em membro com role='agent' e can_see_financials=true:
  -- financeiro/ver segue o PAPEL (false, pois ausente do jsonb {}), o flag
  -- legado é ignorado assim que role_id resolve para um papel.
  if public.has_permission_for(v_agent_fin, v_ws, 'financeiro', 'ver') is not false then
    raise exception 'TT-16: a custom role should override legacy can_see_financials=true (expected false)';
  end if;
  raise notice '72: TT-16 ok';

  raise notice '72_workspace_roles_permissions: TT-01..TT-16 all passed';
end $$;
rollback;

-- =============================================================
-- TT-17: has_permission() wrapper, positive path -- owner sees everything on
-- their active workspace, agent's legado preset denies leads/ver. Needs
-- request.jwt.claims (auth.uid()) + SET LOCAL ROLE authenticated, same
-- technique as 50_can_see_financials.sql, because unlike TT-01..16 this
-- exercises auth.uid()/get_my_conta_id() for real.
-- =============================================================
begin;
do $$
declare
  v_ws    uuid;
  v_owner uuid := gen_random_uuid();
  v_agent uuid := gen_random_uuid();
  v_got   boolean;
begin
  v_ws := et_make_workspace('max');
  insert into auth.users (id) values (v_owner), (v_agent);
  insert into workspace_members (user_id, workspace_id, role) values
    (v_owner, v_ws, 'owner'),
    (v_agent, v_ws, 'agent');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws
   where id in (v_owner, v_agent);

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select public.has_permission('financeiro', 'editar') into v_got;
  reset role;
  if v_got is not true then
    raise exception 'TT-17: owner (active workspace) has_permission(financeiro,editar) should be true, got %', v_got;
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_agent, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select public.has_permission('leads', 'ver') into v_got;
  reset role;
  if v_got is not false then
    raise exception 'TT-17: agent (active workspace) has_permission(leads,ver) should be false, got %', v_got;
  end if;

  raise notice '72: TT-17 ok';
end $$;
rollback;

-- =============================================================
-- TT-20: structural checks -- realtime publication membership, the tenant-
-- pointer composite FKs (RESTRICT on workspace_members.role_id, SET NULL on
-- invites.role_id), and that the SET NULL preserves invites.conta_id.
-- =============================================================
begin;
do $$
declare
  v_ws           uuid;
  v_ws2          uuid;
  v_owner        uuid := gen_random_uuid();
  v_member_a     uuid := gen_random_uuid();  -- points at v_role_a -> RESTRICT case
  v_member_x     uuid := gen_random_uuid();  -- attempted cross-workspace FK insert
  v_role_a       uuid;  -- role in v_ws, gets a member -> RESTRICT case
  v_role_b       uuid;  -- role in v_ws2, used for the cross-workspace FK case
  v_role_invite  uuid;  -- role in v_ws, no members -> invites SET NULL case
  v_invite_id    uuid;
  v_ok           boolean;
  v_role_id_after uuid;
  v_conta_id_after uuid;
begin
  -- (a) workspace_roles must be added to the supabase_realtime publication
  -- (same precedent as workspace_members in 20260728000001).
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public' and tablename = 'workspace_roles'
  ) then
    raise exception 'TT-20: workspace_roles must be in the supabase_realtime publication';
  end if;

  v_ws  := et_make_workspace('max');
  v_ws2 := et_make_workspace('max');
  -- workspace_members.user_id has its own FK to auth.users, so every user_id
  -- inserted below (including the ones only used to probe the role_id FK)
  -- needs a real auth.users row -- otherwise the insert fails on the WRONG
  -- constraint (user_id) before ever reaching the role_id/workspace_id one
  -- this case is meant to exercise.
  insert into auth.users (id) values (v_owner), (v_member_a), (v_member_x);

  insert into workspace_roles (conta_id, nome, permissions) values
    (v_ws, 'TT-20 RESTRICT role', '{}'::jsonb) returning id into v_role_a;
  insert into workspace_roles (conta_id, nome, permissions) values
    (v_ws2, 'TT-20 other workspace role', '{}'::jsonb) returning id into v_role_b;
  insert into workspace_roles (conta_id, nome, permissions) values
    (v_ws, 'TT-20 invite-only role', '{}'::jsonb) returning id into v_role_invite;

  insert into workspace_members (user_id, workspace_id, role) values (v_owner, v_ws, 'owner');
  insert into workspace_members (user_id, workspace_id, role, role_id) values
    (v_member_a, v_ws, 'agent', v_role_a);

  -- (b) FK composta: INSERT workspace_members com role_id de OUTRO workspace
  -- falha com foreign_key_violation.
  v_ok := false;
  begin
    insert into workspace_members (user_id, workspace_id, role, role_id)
      values (v_member_x, v_ws, 'agent', v_role_b);
  exception when foreign_key_violation then
    v_ok := true;
  end;
  if not v_ok then
    raise exception 'TT-20: workspace_members.role_id pointing at a role from ANOTHER workspace should fail (foreign_key_violation)';
  end if;

  -- (c) DELETE de papel com membro falha (foreign_key_violation via
  -- RESTRICT, testado com DELETE direto -- the applicative role_in_use guard
  -- in delete_workspace_role() is covered separately, in 73_.).
  v_ok := false;
  begin
    delete from workspace_roles where id = v_role_a;
  exception when foreign_key_violation then
    v_ok := true;
  end;
  if not v_ok then
    raise exception 'TT-20: deleting a role a member still points at should fail (foreign_key_violation / RESTRICT)';
  end if;

  -- (d) invites: DELETE de papel anula role_id e PRESERVA conta_id.
  insert into invites (conta_id, email, role, invited_by, status, expires_at, role_id)
    values (v_ws, 'tt20-invite@example.com', 'agent', v_owner, 'pending', now() + interval '7 days', v_role_invite)
    returning id into v_invite_id;

  delete from workspace_roles where id = v_role_invite;

  select role_id, conta_id into v_role_id_after, v_conta_id_after
    from invites where id = v_invite_id;
  if v_role_id_after is not null then
    raise exception 'TT-20: invites.role_id should be nulled once its role is deleted, got %', v_role_id_after;
  end if;
  if v_conta_id_after is distinct from v_ws then
    raise exception 'TT-20: invites.conta_id should be PRESERVED (not nulled) after the role delete, got %', v_conta_id_after;
  end if;

  raise notice '72: TT-20 ok';
end $$;
rollback;
