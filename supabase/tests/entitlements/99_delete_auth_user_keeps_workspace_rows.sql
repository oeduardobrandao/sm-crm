\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Migration 20261001000001_user_fk_columns_nullable.sql drops NOT NULL from
-- workflow_templates.user_id, workflows.user_id and invites.invited_by.
-- 20260408_fix_user_delete_cascade.sql had already switched their FKs to
-- auth.users to ON DELETE SET NULL, but left the columns NOT NULL, so deleting
-- any user who owned one of these rows errored with a not-null violation. That
-- includes every fresh signup since 20260920000001, which seeds a "Padrão"
-- template owned by the new user.
--
-- Fixture note: inserting into auth.users fires handle_new_user_workspace(),
-- which creates a workspace + profile + seeded template for the new user (see
-- 93_default_workflow_template_seed.sql). Each case is its own begin/rollback
-- block so an early failure doesn't mask the others.

-- =============================================================
-- 99-1: Deleting the owner keeps the seeded template, with user_id nulled.
-- =============================================================
begin;
do $$
declare
  v_uid   uuid := gen_random_uuid();
  v_conta uuid;
  v_tpl   bigint;
  v_owner uuid;
begin
  insert into auth.users (id, email, raw_user_meta_data)
    values (v_uid, 'del99a@example.com', jsonb_build_object('empresa', 'Empresa Del 99A'));

  select conta_id into v_conta from profiles where id = v_uid;
  select id into v_tpl from workflow_templates where conta_id = v_conta and user_id = v_uid;
  assert v_tpl is not null, '99-1: fixture: signup should have seeded a template owned by the user';

  delete from auth.users where id = v_uid;

  assert exists (select 1 from workflow_templates where id = v_tpl),
    '99-1: the workspace template must survive deleting its creator';
  select user_id into v_owner from workflow_templates where id = v_tpl;
  assert v_owner is null, format('99-1: template user_id should be NULL, got %L', v_owner);

  raise notice 'PASS 99-1: deleting a template owner keeps the template with user_id NULL';
end $$;
rollback;

-- =============================================================
-- 99-2: Deleting a workflow's creator keeps the workflow, user_id nulled.
-- =============================================================
begin;
do $$
declare
  v_uid     uuid := gen_random_uuid();
  v_conta   uuid;
  v_cliente bigint;
  v_wf      bigint;
  v_owner   uuid;
begin
  insert into auth.users (id, email, raw_user_meta_data)
    values (v_uid, 'del99b@example.com', jsonb_build_object('empresa', 'Empresa Del 99B'));
  select conta_id into v_conta from profiles where id = v_uid;

  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_uid, v_conta, 'C99', 'C9', '#000')
    returning id into v_cliente;
  insert into workflows (user_id, conta_id, cliente_id, titulo)
    values (v_uid, v_conta, v_cliente, 'Fluxo 99')
    returning id into v_wf;

  -- Drop the signup's seeded template so this case only exercises workflows.user_id.
  delete from workflow_templates where conta_id = v_conta;

  delete from auth.users where id = v_uid;

  assert exists (select 1 from workflows where id = v_wf),
    '99-2: the workflow must survive deleting its creator';
  select user_id into v_owner from workflows where id = v_wf;
  assert v_owner is null, format('99-2: workflow user_id should be NULL, got %L', v_owner);

  raise notice 'PASS 99-2: deleting a workflow creator keeps the workflow with user_id NULL';
end $$;
rollback;

-- =============================================================
-- 99-3: Deleting an inviter keeps the invite row, invited_by nulled.
-- =============================================================
begin;
do $$
declare
  v_uid     uuid := gen_random_uuid();
  v_conta   uuid;
  v_invite  uuid;
  v_inviter uuid;
begin
  insert into auth.users (id, email, raw_user_meta_data)
    values (v_uid, 'del99c@example.com', jsonb_build_object('empresa', 'Empresa Del 99C'));
  select conta_id into v_conta from profiles where id = v_uid;

  insert into invites (conta_id, email, role, invited_by)
    values (v_conta, 'convidado99c@example.com', 'agent', v_uid)
    returning id into v_invite;

  -- Drop the signup's seeded template so this case only exercises invites.invited_by.
  delete from workflow_templates where conta_id = v_conta;

  delete from auth.users where id = v_uid;

  assert exists (select 1 from invites where id = v_invite),
    '99-3: the invite must survive deleting the user who sent it';
  select invited_by into v_inviter from invites where id = v_invite;
  assert v_inviter is null, format('99-3: invites.invited_by should be NULL, got %L', v_inviter);

  raise notice 'PASS 99-3: deleting an inviter keeps the invite with invited_by NULL';
end $$;
rollback;
