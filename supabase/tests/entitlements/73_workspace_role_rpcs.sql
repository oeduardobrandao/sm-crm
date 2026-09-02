\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- public.create_workspace_role / update_workspace_role / delete_workspace_role
-- -- migration 20260903000001_workspace_roles_a_additive.sql -- are the SOLE
-- enforcement point for who may manage custom papéis. Like
-- set_financial_access (53_set_financial_access.sql), each is SECURITY
-- DEFINER and takes the actor as an explicit parameter, so it never reads
-- auth.uid() or current_user for the actor-authorization checks below -- no
-- set_config('request.jwt.claims', ...), no SET LOCAL ROLE, no
-- et_grant_hosted_parity() for RPC-01..08. The test runs as the table owner
-- and calls the functions directly, exactly as a service-role client would.
-- RPC-09 is the exception: it proves `authenticated` genuinely lacks EXECUTE
-- on all three, which DOES require SET LOCAL ROLE.

-- =============================================================
-- RPC-01..08: exercised as postgres, actor passed explicitly.
-- =============================================================
begin;
do $$
declare
  v_ws          uuid;
  v_ws2         uuid;
  v_owner       uuid := gen_random_uuid();
  v_admin       uuid := gen_random_uuid();
  v_agent       uuid := gen_random_uuid();
  v_owner2      uuid := gen_random_uuid();
  v_member_use  uuid := gen_random_uuid();
  v_role_id     uuid;
  v_role_id2    uuid;
  v_role_upd    uuid;
  v_role_del    uuid;
  v_role_use    uuid;
  v_result      text;
  v_nome        text;
  v_perms       jsonb;
  v_n           bigint;
begin
  v_ws  := et_make_workspace('max');
  v_ws2 := et_make_workspace('max');

  insert into auth.users (id) values
    (v_owner), (v_admin), (v_agent), (v_owner2), (v_member_use);

  insert into workspace_members (user_id, workspace_id, role) values
    (v_owner, v_ws, 'owner'),
    (v_admin, v_ws, 'admin'),
    (v_agent, v_ws, 'agent'),
    (v_owner2, v_ws2, 'owner');

  -- =============================================================
  -- RPC-01: create por owner retorna uuid; linha em workspace_roles; audit_log
  -- tem action='role_created' com resource_id = uuid.
  -- =============================================================
  select public.create_workspace_role(v_owner, v_ws, 'Editor de Conteudo',
           '{"clientes":"editar"}'::jsonb) into v_role_id;
  if v_role_id is null then
    raise exception 'RPC-01: create_workspace_role should return a uuid';
  end if;

  select count(*) into v_n from workspace_roles
   where id = v_role_id and conta_id = v_ws and nome = 'Editor de Conteudo';
  if v_n <> 1 then
    raise exception 'RPC-01: workspace_roles should have exactly one row for the new role, got %', v_n;
  end if;

  select count(*) into v_n from audit_log
   where action = 'role_created' and resource_id = v_role_id::text;
  if v_n <> 1 then
    raise exception 'RPC-01: expected exactly 1 role_created audit_log row, got %', v_n;
  end if;
  raise notice '73: RPC-01 ok';

  -- =============================================================
  -- RPC-02: create por admin => not_owner; por agent => not_owner.
  -- =============================================================
  begin
    perform public.create_workspace_role(v_admin, v_ws, 'Should Fail Admin', '{}'::jsonb);
    raise exception 'RPC-02: admin actor should have been rejected with not_owner';
  exception when others then
    if sqlerrm <> 'not_owner' then raise; end if;
  end;

  begin
    perform public.create_workspace_role(v_agent, v_ws, 'Should Fail Agent', '{}'::jsonb);
    raise exception 'RPC-02: agent actor should have been rejected with not_owner';
  exception when others then
    if sqlerrm <> 'not_owner' then raise; end if;
  end;
  raise notice '73: RPC-02 ok';

  -- =============================================================
  -- RPC-03: nome vazio => invalid_name; nome duplicado (mesmo conta) =>
  -- duplicate_name; mesmo nome em OUTRO workspace => ok.
  -- =============================================================
  begin
    perform public.create_workspace_role(v_owner, v_ws, '', '{}'::jsonb);
    raise exception 'RPC-03: empty name should have been rejected with invalid_name';
  exception when others then
    if sqlerrm <> 'invalid_name' then raise; end if;
  end;

  begin
    perform public.create_workspace_role(v_owner, v_ws, 'Editor de Conteudo', '{}'::jsonb);
    raise exception 'RPC-03: duplicate name (same workspace) should have been rejected with duplicate_name';
  exception when others then
    if sqlerrm <> 'duplicate_name' then raise; end if;
  end;

  select public.create_workspace_role(v_owner2, v_ws2, 'Editor de Conteudo', '{}'::jsonb) into v_role_id2;
  if v_role_id2 is null then
    raise exception 'RPC-03: the same role name in a DIFFERENT workspace should succeed';
  end if;
  raise notice '73: RPC-03 ok';

  -- =============================================================
  -- RPC-04: permissions inválidas ({"foo":"ver"} e {"leads":"talvez"}) =>
  -- invalid_permissions.
  -- =============================================================
  begin
    perform public.create_workspace_role(v_owner, v_ws, 'Bad Module Key', '{"foo":"ver"}'::jsonb);
    raise exception 'RPC-04: unknown module key should have been rejected with invalid_permissions';
  exception when others then
    if sqlerrm <> 'invalid_permissions' then raise; end if;
  end;

  begin
    perform public.create_workspace_role(v_owner, v_ws, 'Bad Level Value', '{"leads":"talvez"}'::jsonb);
    raise exception 'RPC-04: unknown level value should have been rejected with invalid_permissions';
  exception when others then
    if sqlerrm <> 'invalid_permissions' then raise; end if;
  end;
  raise notice '73: RPC-04 ok';

  -- =============================================================
  -- RPC-05: update por owner muda nome+permissions => 'updated' + audit
  -- role_updated; update idêntico => 'noop' e NENHUM audit novo.
  -- =============================================================
  select public.create_workspace_role(v_owner, v_ws, 'Update Target', '{"leads":"ver"}'::jsonb)
    into v_role_upd;

  select public.update_workspace_role(v_owner, v_ws, v_role_upd, 'Update Target v2',
           '{"leads":"editar"}'::jsonb) into v_result;
  if v_result is distinct from 'updated' then
    raise exception 'RPC-05: update should return ''updated'', got %', v_result;
  end if;

  select nome, permissions into v_nome, v_perms from workspace_roles where id = v_role_upd;
  if v_nome <> 'Update Target v2' or v_perms <> '{"leads":"editar"}'::jsonb then
    raise exception 'RPC-05: role row should reflect the new nome/permissions, got nome=%, permissions=%', v_nome, v_perms;
  end if;

  select count(*) into v_n from audit_log
   where action = 'role_updated' and resource_id = v_role_upd::text;
  if v_n <> 1 then
    raise exception 'RPC-05: expected exactly 1 role_updated audit_log row, got %', v_n;
  end if;

  select public.update_workspace_role(v_owner, v_ws, v_role_upd, 'Update Target v2',
           '{"leads":"editar"}'::jsonb) into v_result;
  if v_result is distinct from 'noop' then
    raise exception 'RPC-05: repeating the identical update should return ''noop'', got %', v_result;
  end if;

  select count(*) into v_n from audit_log
   where action = 'role_updated' and resource_id = v_role_upd::text;
  if v_n <> 1 then
    raise exception 'RPC-05: a noop update must not add a new audit_log row, count is now %', v_n;
  end if;
  raise notice '73: RPC-05 ok';

  -- =============================================================
  -- RPC-06: update de papel de outro workspace => role_not_found.
  -- v_role_id2 belongs to v_ws2, actor/workspace here are v_owner/v_ws.
  -- =============================================================
  begin
    perform public.update_workspace_role(v_owner, v_ws, v_role_id2, 'X', '{}'::jsonb);
    raise exception 'RPC-06: updating a role that belongs to another workspace should have been rejected with role_not_found';
  exception when others then
    if sqlerrm <> 'role_not_found' then raise; end if;
  end;
  raise notice '73: RPC-06 ok';

  -- =============================================================
  -- RPC-07: delete sem membros => 'deleted' + audit role_deleted.
  -- =============================================================
  select public.create_workspace_role(v_owner, v_ws, 'Delete Me', '{}'::jsonb) into v_role_del;

  select public.delete_workspace_role(v_owner, v_ws, v_role_del) into v_result;
  if v_result is distinct from 'deleted' then
    raise exception 'RPC-07: delete with no members should return ''deleted'', got %', v_result;
  end if;

  select count(*) into v_n from workspace_roles where id = v_role_del;
  if v_n <> 0 then
    raise exception 'RPC-07: role row should be gone after delete';
  end if;

  select count(*) into v_n from audit_log
   where action = 'role_deleted' and resource_id = v_role_del::text;
  if v_n <> 1 then
    raise exception 'RPC-07: expected exactly 1 role_deleted audit_log row, got %', v_n;
  end if;
  raise notice '73: RPC-07 ok';

  -- =============================================================
  -- RPC-08: delete com membro apontando => role_in_use (e a linha sobrevive).
  -- This is the applicative guard inside delete_workspace_role() -- distinct
  -- from the FK-level RESTRICT proven by a direct DELETE in
  -- 72_workspace_roles_permissions.sql's TT-20.
  -- =============================================================
  select public.create_workspace_role(v_owner, v_ws, 'In Use', '{}'::jsonb) into v_role_use;
  insert into workspace_members (user_id, workspace_id, role, role_id)
    values (v_member_use, v_ws, 'agent', v_role_use);

  begin
    perform public.delete_workspace_role(v_owner, v_ws, v_role_use);
    raise exception 'RPC-08: deleting a role a member points at should have been rejected with role_in_use';
  exception when others then
    if sqlerrm <> 'role_in_use' then raise; end if;
  end;

  select count(*) into v_n from workspace_roles where id = v_role_use;
  if v_n <> 1 then
    raise exception 'RPC-08: role row should survive a rejected (role_in_use) delete';
  end if;
  raise notice '73: RPC-08 ok';

  raise notice '73_workspace_role_rpcs: RPC-01..RPC-08 all passed';
end $$;
rollback;

-- =============================================================
-- RPC-09: authenticated executes none of the three RPCs (insufficient_privilege).
-- Own transaction, independent of the block above.
-- =============================================================
begin;
do $$
declare v_ok boolean;
begin
  set local role authenticated;

  v_ok := false;
  begin
    perform public.create_workspace_role(gen_random_uuid(), gen_random_uuid(), 'x', '{}'::jsonb);
  exception when insufficient_privilege then
    v_ok := true;
  end;
  if not v_ok then
    raise exception 'RPC-09: authenticated must not be able to execute create_workspace_role()';
  end if;

  v_ok := false;
  begin
    perform public.update_workspace_role(gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'x', '{}'::jsonb);
  exception when insufficient_privilege then
    v_ok := true;
  end;
  if not v_ok then
    raise exception 'RPC-09: authenticated must not be able to execute update_workspace_role()';
  end if;

  v_ok := false;
  begin
    perform public.delete_workspace_role(gen_random_uuid(), gen_random_uuid(), gen_random_uuid());
  exception when insufficient_privilege then
    v_ok := true;
  end;
  if not v_ok then
    raise exception 'RPC-09: authenticated must not be able to execute delete_workspace_role()';
  end if;

  reset role;
  raise notice '73: RPC-09 ok';
end $$;
rollback;
