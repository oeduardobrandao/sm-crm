\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql
select et_grant_hosted_parity();

-- membros_conta_crm_user_unique + set_membro_crm_user + accept_workspace_invite
-- (migration 20260922000003_membro_crm_user_uniqueness.sql). Cobre:
-- 94.0 o indice em si bloqueia uma segunda linha de membros linkada ao mesmo
--      crm_user_id na mesma conta
-- 94.1 set_membro_crm_user: caminho feliz, sem conflito
-- 94.2 set_membro_crm_user: conflito -- rejeita com P0409/crm_user_already_linked,
--      NADA e gravado no membro alvo
-- 94.3 set_membro_crm_user: checagem de permissao (owner/admin) preservada
-- 94.4 accept_workspace_invite: usuario ja linkado a outro membro na mesma
--      conta -- aceita o convite (entra no workspace) mas PULA o link do
--      membro em vez de falhar o accept inteiro

-- =============================================================
-- 94.0: indice unico bloqueia direto, sem passar pela RPC
-- =============================================================
begin;
do $$
declare
  v_ws uuid;
  v_user uuid := gen_random_uuid();
  v_m1 bigint;
  v_m2 bigint;
  v_raised boolean := false;
begin
  v_ws := et_make_workspace('max');
  insert into auth.users (id) values (v_user);

  insert into membros (user_id, conta_id, nome, crm_user_id) values (v_user, v_ws, 'M1', v_user)
    returning id into v_m1;
  insert into membros (user_id, conta_id, nome) values (v_user, v_ws, 'M2')
    returning id into v_m2;

  begin
    update membros set crm_user_id = v_user where id = v_m2;
  exception when unique_violation then
    v_raised := true;
  end;

  assert v_raised, '94.0: unique index should block a second membro linked to the same crm_user_id in the same conta';
  raise notice 'PASS 94.0';
end $$;
rollback;

-- =============================================================
-- 94.1: set_membro_crm_user caminho feliz
-- =============================================================
begin;
do $$
declare
  v_ws uuid;
  v_owner uuid := gen_random_uuid();
  v_target_user uuid := gen_random_uuid();
  v_membro bigint;
  v_after uuid;
begin
  v_ws := et_make_workspace('max');
  insert into auth.users (id) values (v_owner);
  insert into auth.users (id) values (v_target_user);
  insert into workspace_members (user_id, workspace_id, role) values (v_owner, v_ws, 'owner');

  insert into membros (user_id, conta_id, nome) values (v_owner, v_ws, 'M1')
    returning id into v_membro;

  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform set_membro_crm_user(v_membro, v_target_user);
  execute 'reset role';

  select crm_user_id into v_after from membros where id = v_membro;
  assert v_after = v_target_user, format('94.1: expected %s, got %s', v_target_user, v_after);
  raise notice 'PASS 94.1';
end $$;
rollback;

-- =============================================================
-- 94.2: set_membro_crm_user rejeita conflito, nao grava nada
-- =============================================================
begin;
do $$
declare
  v_ws uuid;
  v_owner uuid := gen_random_uuid();
  v_shared_user uuid := gen_random_uuid();
  v_m1 bigint;
  v_m2 bigint;
  v_after uuid;
  v_raised boolean := false;
  v_sqlstate text;
  v_msg text;
begin
  v_ws := et_make_workspace('max');
  insert into auth.users (id) values (v_owner);
  insert into auth.users (id) values (v_shared_user);
  insert into workspace_members (user_id, workspace_id, role) values (v_owner, v_ws, 'owner');

  insert into membros (user_id, conta_id, nome, crm_user_id) values (v_owner, v_ws, 'M1', v_shared_user)
    returning id into v_m1;
  insert into membros (user_id, conta_id, nome) values (v_owner, v_ws, 'M2')
    returning id into v_m2;

  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform set_membro_crm_user(v_m2, v_shared_user);
  exception when sqlstate 'P0409' then
    v_raised := true;
    get stacked diagnostics v_msg = message_text;
  end;
  execute 'reset role';

  assert v_raised, '94.2: linking an already-used crm_user_id should raise P0409';
  assert v_msg = 'crm_user_already_linked', format('94.2: wrong message: %s', v_msg);

  select crm_user_id into v_after from membros where id = v_m2;
  assert v_after is null, format('94.2: target membro should stay unlinked, got %s', v_after);
  raise notice 'PASS 94.2';
end $$;
rollback;

-- =============================================================
-- 94.3: set_membro_crm_user ainda exige owner/admin (regressao)
-- =============================================================
begin;
do $$
declare
  v_ws uuid;
  v_agent uuid := gen_random_uuid();
  v_target_user uuid := gen_random_uuid();
  v_membro bigint;
  v_raised boolean := false;
begin
  v_ws := et_make_workspace('max');
  insert into auth.users (id) values (v_agent);
  insert into auth.users (id) values (v_target_user);
  insert into workspace_members (user_id, workspace_id, role) values (v_agent, v_ws, 'agent');

  insert into membros (user_id, conta_id, nome) values (v_agent, v_ws, 'M1')
    returning id into v_membro;

  perform set_config('request.jwt.claims', json_build_object('sub', v_agent, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform set_membro_crm_user(v_membro, v_target_user);
  exception when others then
    v_raised := true;
    assert sqlerrm = 'Insufficient permissions', format('94.3: wrong message: %s', sqlerrm);
  end;
  execute 'reset role';

  assert v_raised, '94.3: an agent should not be able to call set_membro_crm_user';
  raise notice 'PASS 94.3';
end $$;
rollback;

-- =============================================================
-- 94.4: accept_workspace_invite pula o link (nao falha o accept) quando o
-- usuario ja esta linkado a OUTRO membro na mesma conta
-- =============================================================
begin;
do $$
declare
  v_ws uuid;
  v_owner uuid := gen_random_uuid();
  v_user uuid := gen_random_uuid();
  v_m_existing bigint;
  v_m_invited bigint;
  v_membership_count int;
  v_invite_status text;
  v_crm_after uuid;
begin
  v_ws := et_make_workspace('max');
  insert into auth.users (id) values (v_owner);
  insert into auth.users (id, email) values (v_user, 'inv94@example.com');
  update profiles set conta_id = v_ws where id = v_user;

  -- v_user is already linked to a DIFFERENT membro in this conta.
  insert into membros (user_id, conta_id, nome, crm_user_id) values (v_owner, v_ws, 'Existing', v_user)
    returning id into v_m_existing;

  -- A second membro row has an invite pending for the SAME v_user.
  insert into membros (user_id, conta_id, nome) values (v_owner, v_ws, 'Invited')
    returning id into v_m_invited;
  insert into invites (conta_id, email, role, invited_by, status, expires_at, membro_id)
    values (v_ws, 'inv94@example.com', 'agent', v_owner, 'pending', now() + interval '7 days', v_m_invited);

  perform public.accept_workspace_invite(v_user);

  select count(*) into v_membership_count from workspace_members
    where user_id = v_user and workspace_id = v_ws;
  assert v_membership_count = 1, '94.4: accept should still join the workspace';

  select status into v_invite_status from invites
    where conta_id = v_ws and email = 'inv94@example.com';
  assert v_invite_status = 'accepted', format('94.4: invite should be accepted, got %s', v_invite_status);

  select crm_user_id into v_crm_after from membros where id = v_m_invited;
  assert v_crm_after is null, format('94.4: invited membro should stay unlinked (conflict skipped), got %s', v_crm_after);

  select crm_user_id into v_crm_after from membros where id = v_m_existing;
  assert v_crm_after = v_user, '94.4: the pre-existing link should be untouched';

  raise notice 'PASS 94.4';
end $$;
rollback;
