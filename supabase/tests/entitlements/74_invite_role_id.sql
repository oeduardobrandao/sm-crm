\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- public.accept_workspace_invite(p_user_id) -- migration
-- 20260903000002_workspace_roles_a_additive.sql applied exactly two changes
-- to the deployed body from 20260731000002_invite_membro_link.sql: the
-- workspace_members INSERT now copies invites.role_id and coerces role to
-- 'agent' whenever a role_id is present, and profiles.role follows the same
-- coercion. Everything else -- including the membro-link block -- is
-- untouched. Each case below is its own begin/rollback block ("independent
-- begin/rollback blocks" per the house convention in 50_/53_), so an early
-- failure doesn't mask the other two.
--
-- SECURITY DEFINER, explicit p_user_id parameter: called directly as
-- postgres, no set_config/SET LOCAL ROLE needed for the RPC call itself.
--
-- Fixture note: inserting into auth.users fires handle_new_user_workspace(),
-- which auto-creates a throwaway workspace, a workspace_members row there,
-- and a profiles row with conta_id pointing at THAT throwaway workspace
-- (20260317_multi_workspace.sql / 20260719000002_signup_marketing_opt_in.sql).
-- accept_workspace_invite() requires profiles.conta_id to already equal the
-- invite's conta_id before it will find the pending invite at all
-- (`WHERE i.conta_id = v_conta_id`), so every case below explicitly points
-- profiles.conta_id at the test workspace first -- this is the RPC's actual
-- prerequisite, not incidental cleanup.

-- =============================================================
-- INV-01: invite com role_id: accept_workspace_invite cria membership com
-- role='agent' E role_id copiado; profiles.role='agent'.
-- =============================================================
begin;
do $$
declare
  v_ws            uuid;
  v_user          uuid := gen_random_uuid();
  v_owner         uuid := gen_random_uuid();
  v_role          uuid;
  v_role_after    text;
  v_role_id_after uuid;
  v_profile_role  text;
begin
  v_ws := et_make_workspace('max');
  insert into auth.users (id) values (v_owner);
  insert into auth.users (id, email) values (v_user, 'inv01@example.com');
  update profiles set conta_id = v_ws where id = v_user;

  insert into workspace_roles (conta_id, nome, permissions) values
    (v_ws, 'INV-01 role', '{"leads":"editar"}'::jsonb) returning id into v_role;

  -- invite.role is deliberately 'admin' (not 'agent'): accept_workspace_invite
  -- must coerce the MEMBERSHIP role to 'agent' because role_id is present,
  -- regardless of what the invite's own role text column says.
  insert into invites (conta_id, email, role, invited_by, status, expires_at, role_id)
    values (v_ws, 'inv01@example.com', 'admin', v_owner, 'pending', now() + interval '7 days', v_role);

  perform public.accept_workspace_invite(v_user);

  select role, role_id into v_role_after, v_role_id_after
    from workspace_members where user_id = v_user and workspace_id = v_ws;
  if v_role_after is distinct from 'agent' then
    raise exception 'INV-01: workspace_members.role should be ''agent'' when the invite carries a role_id, got %', v_role_after;
  end if;
  if v_role_id_after is distinct from v_role then
    raise exception 'INV-01: workspace_members.role_id should be copied from the invite, got %', v_role_id_after;
  end if;

  select role::text into v_profile_role from profiles where id = v_user;
  if v_profile_role is distinct from 'agent' then
    raise exception 'INV-01: profiles.role should be ''agent'' when the invite carries a role_id, got %', v_profile_role;
  end if;

  raise notice '74: INV-01 ok';
end $$;
rollback;

-- =============================================================
-- INV-02: invite sem role_id: comportamento atual intacto (role copiado,
-- role_id NULL) -- regressão do fluxo legado.
-- =============================================================
begin;
do $$
declare
  v_ws            uuid;
  v_user          uuid := gen_random_uuid();
  v_owner         uuid := gen_random_uuid();
  v_role_after    text;
  v_role_id_after uuid;
  v_profile_role  text;
begin
  v_ws := et_make_workspace('max');
  insert into auth.users (id) values (v_owner);
  insert into auth.users (id, email) values (v_user, 'inv02@example.com');
  update profiles set conta_id = v_ws where id = v_user;

  insert into invites (conta_id, email, role, invited_by, status, expires_at)
    values (v_ws, 'inv02@example.com', 'admin', v_owner, 'pending', now() + interval '7 days');

  perform public.accept_workspace_invite(v_user);

  select role, role_id into v_role_after, v_role_id_after
    from workspace_members where user_id = v_user and workspace_id = v_ws;
  if v_role_after is distinct from 'admin' then
    raise exception 'INV-02: workspace_members.role should still be copied verbatim from the invite (''admin''), got %', v_role_after;
  end if;
  if v_role_id_after is not null then
    raise exception 'INV-02: workspace_members.role_id should stay NULL for a legacy (no role_id) invite, got %', v_role_id_after;
  end if;

  select role::text into v_profile_role from profiles where id = v_user;
  if v_profile_role is distinct from 'admin' then
    raise exception 'INV-02: profiles.role should still be copied verbatim from the invite (''admin''), got %', v_profile_role;
  end if;

  raise notice '74: INV-02 ok';
end $$;
rollback;

-- =============================================================
-- INV-03: membro-link continua: invite com membro_id + role_id linka
-- membros.crm_user_id, alongside the role_id/role='agent' coercion from
-- INV-01.
-- =============================================================
begin;
do $$
declare
  v_ws              uuid;
  v_user            uuid := gen_random_uuid();
  v_owner           uuid := gen_random_uuid();
  v_role            uuid;
  v_membro_id       bigint;
  v_crm_user_after  uuid;
  v_role_after      text;
  v_role_id_after   uuid;
begin
  v_ws := et_make_workspace('max');
  insert into auth.users (id) values (v_owner);
  insert into auth.users (id, email) values (v_user, 'inv03@example.com');
  update profiles set conta_id = v_ws where id = v_user;

  insert into workspace_roles (conta_id, nome, permissions) values
    (v_ws, 'INV-03 role', '{}'::jsonb) returning id into v_role;

  insert into membros (user_id, conta_id, nome) values (v_owner, v_ws, 'Membro Convidado INV-03')
    returning id into v_membro_id;

  insert into invites (conta_id, email, role, invited_by, status, expires_at, role_id, membro_id)
    values (v_ws, 'inv03@example.com', 'admin', v_owner, 'pending', now() + interval '7 days', v_role, v_membro_id);

  perform public.accept_workspace_invite(v_user);

  select crm_user_id into v_crm_user_after from membros where id = v_membro_id;
  if v_crm_user_after is distinct from v_user then
    raise exception 'INV-03: membros.crm_user_id should be linked to the accepting user, got %', v_crm_user_after;
  end if;

  select role, role_id into v_role_after, v_role_id_after
    from workspace_members where user_id = v_user and workspace_id = v_ws;
  if v_role_after is distinct from 'agent' then
    raise exception 'INV-03: workspace_members.role should be ''agent'' (role_id present), got %', v_role_after;
  end if;
  if v_role_id_after is distinct from v_role then
    raise exception 'INV-03: workspace_members.role_id should be copied from the invite, got %', v_role_id_after;
  end if;

  raise notice '74: INV-03 ok';
end $$;
rollback;
