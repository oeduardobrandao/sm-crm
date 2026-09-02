\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Central de Notificacoes, Fase 2 (migration 20260904000001_client_event_emails.sql):
--   (a) trg_cliente_notify_guard / enforce_cliente_notify_columns() -- role guard
--       on clientes.send_event_email / event_email_unsub_at / send_report_email
--       (owner/admin only) and on clientes.event_cursor_at / event_claim_through /
--       event_claimed_at (service_role only, no exceptions -- not even owner).
--       Mirrors enforce_cliente_foto_owner_admin (20260817000001), see
--       66_cliente_foto_owner_admin.sql for the sibling pattern.
--   (b) claim_client_event_emails(p_now, p_limit) -- atomic claim with a
--       30-minute lease separate from the 4-hour digest cursor, gated on
--       workspaces.send_client_event_emails, clientes.send_event_email,
--       clientes.status = 'ativo' and a non-empty clientes.email.
--
-- Case numbering follows the task-2 brief 1:1.

-- =====================================================================
-- Case 1: role guard on UPDATE. An agent cannot touch either of the two
-- owner/admin-guarded columns (send_event_email, and the now-also-guarded
-- send_report_email); an owner can, on the same row, right after the
-- rejection -- proving the rejection wasn't caused by something else (a
-- missing column, a stale RLS policy) and the setup actually works. The
-- lease/cursor columns are stricter still: even the workspace owner is
-- rejected, and only an actual service_role caller succeeds.
-- =====================================================================
begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws       uuid;
  v_owner    uuid := gen_random_uuid();
  v_agent    uuid := gen_random_uuid();
  v_cli      bigint;
  v_rejected boolean;
  v_bool     boolean;
  v_ts       timestamptz;
begin
  -- 'max' plan: two team members (owner + agent) -- 'start' seeds
  -- max_team_members = 1 and would abort the second membership insert
  -- before the trigger under test ever runs (same reasoning as
  -- 66_cliente_foto_owner_admin.sql).
  v_ws := et_make_workspace('max');
  insert into auth.users (id) values (v_owner), (v_agent);
  insert into workspace_members (user_id, workspace_id, role)
    values (v_owner, v_ws, 'owner'), (v_agent, v_ws, 'agent');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id in (v_owner, v_agent);

  -- Seed a cliente with every guarded column left at its default -- the
  -- INSERT itself doesn't deviate from the default, so it succeeds
  -- regardless of caller identity (Case 2 below tests the INSERT path).
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_owner, v_ws, 'Cliente A', 'CA', '#000') returning id into v_cli;

  -- ---- agent cannot flip send_event_email ----
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_agent, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  v_rejected := false;
  begin
    update clientes set send_event_email = false where id = v_cli;
  exception when insufficient_privilege then
    v_rejected := true;
  end;
  assert v_rejected, 'agent update de send_event_email nao foi rejeitado com 42501';

  execute 'reset role';
  select send_event_email into v_bool from clientes where id = v_cli;
  assert v_bool = true, 'send_event_email vazou mesmo apos o update do agent ser rejeitado';

  -- ---- owner CAN flip send_event_email (positive proof, same column/row) ----
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  update clientes set send_event_email = false where id = v_cli;
  execute 'reset role';

  select send_event_email into v_bool from clientes where id = v_cli;
  assert v_bool = false, 'owner update de send_event_email foi rejeitado indevidamente';

  -- ---- agent cannot flip send_report_email (campo antigo, agora guardado) ----
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_agent, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  v_rejected := false;
  begin
    update clientes set send_report_email = true where id = v_cli;
  exception when insufficient_privilege then
    v_rejected := true;
  end;
  assert v_rejected, 'agent update de send_report_email nao foi rejeitado com 42501';

  execute 'reset role';
  select send_report_email into v_bool from clientes where id = v_cli;
  assert v_bool = false, 'send_report_email vazou mesmo apos o update do agent ser rejeitado';

  -- ---- owner CAN flip send_report_email (positive proof) ----
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  update clientes set send_report_email = true where id = v_cli;
  execute 'reset role';

  select send_report_email into v_bool from clientes where id = v_cli;
  assert v_bool = true, 'owner update de send_report_email foi rejeitado indevidamente';

  -- ---- owner CANNOT touch event_cursor_at -- cursor/lease e so do service role ----
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  v_rejected := false;
  begin
    update clientes set event_cursor_at = now() where id = v_cli;
  exception when insufficient_privilege then
    v_rejected := true;
  end;
  assert v_rejected, 'owner update de event_cursor_at nao foi rejeitado com 42501';

  execute 'reset role';
  select event_cursor_at into v_ts from clientes where id = v_cli;
  assert v_ts is null, 'event_cursor_at vazou mesmo apos o update do owner ser rejeitado';

  -- ---- postgres/service_role CAN touch event_cursor_at (positive proof) ----
  perform set_config('request.jwt.claims',
    json_build_object('role', 'service_role')::text, true);
  execute 'set local role service_role';
  update clientes set event_cursor_at = now() where id = v_cli;
  execute 'reset role';

  select event_cursor_at into v_ts from clientes where id = v_cli;
  assert v_ts is not null, 'service_role update de event_cursor_at foi rejeitado indevidamente';

  raise notice 'PASS 74 Case 1 guarda de papel (UPDATE)';
end $$;
rollback;

-- =====================================================================
-- Case 2: role guard on INSERT. clientes_insert RLS has no role check at
-- all (same precedent as 20260817000001), so without the trigger's INSERT
-- branch an agent could set a guarded column at row-creation time instead
-- of via a later UPDATE. The agent's rejected attempt is paired right next
-- to an agent INSERT that leaves the guarded columns at their default --
-- proving the trigger blocks a deviation, not every INSERT by that role.
-- =====================================================================
begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws       uuid;
  v_owner    uuid := gen_random_uuid();
  v_agent    uuid := gen_random_uuid();
  v_cli      bigint;
  v_rejected boolean;
  v_unsub    timestamptz;
begin
  v_ws := et_make_workspace('max');
  insert into auth.users (id) values (v_owner), (v_agent);
  insert into workspace_members (user_id, workspace_id, role)
    values (v_owner, v_ws, 'owner'), (v_agent, v_ws, 'agent');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id in (v_owner, v_agent);

  -- ---- agent cannot INSERT with send_event_email=false ----
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_agent, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  v_rejected := false;
  begin
    insert into clientes (user_id, conta_id, nome, sigla, cor, send_event_email)
      values (v_agent, v_ws, 'Cliente B', 'CB', '#000', false);
  exception when insufficient_privilege then
    v_rejected := true;
  end;
  assert v_rejected, 'agent INSERT com send_event_email=false nao foi rejeitado com 42501';

  -- ---- agent CAN insert leaving every guarded column at its default ----
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_agent, v_ws, 'Cliente C', 'CC', '#000') returning id into v_cli;
  assert v_cli is not null,
    'agent INSERT sem tocar campos guardados foi rejeitado indevidamente';

  execute 'reset role';

  -- ---- owner CAN insert with event_email_unsub_at preenchido ----
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into clientes (user_id, conta_id, nome, sigla, cor, event_email_unsub_at)
    values (v_owner, v_ws, 'Cliente D', 'CD', '#000', now())
    returning event_email_unsub_at into v_unsub;
  execute 'reset role';

  assert v_unsub is not null,
    'owner INSERT com event_email_unsub_at preenchido foi rejeitado indevidamente';

  raise notice 'PASS 74 Case 2 guarda de papel (INSERT)';
end $$;
rollback;

-- =====================================================================
-- Case 3: claim_client_event_emails gates, run as postgres/service_role
-- (the guard trigger would reject an owner touching event_cursor_at /
-- event_claimed_at -- see Case 1 -- so every write to a lease/cursor column
-- or to clientes.send_event_email below is done under a service_role
-- impersonation, exactly like the escape hatch the guard itself checks).
--
-- The baseline row proves a fully-eligible cliente IS claimable, and that
-- an immediate second call is blocked by the lease it just acquired. Each
-- gate is then flipped in isolation on its OWN otherwise-eligible row (a
-- shared row would confound the ws-level gate with the lease the baseline
-- row already holds), so a false negative there can only be caused by the
-- one column under test. The workspace-level gate uses a second workspace
-- that is simply never flipped to true, which is a plain instance of the
-- off state rather than a scripted flip-back-and-forth.
-- =====================================================================
begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws      uuid;
  v_ws_off  uuid;
  v_cli     bigint;  -- baseline: fully eligible
  v_cli_g1  bigint;  -- send_event_email = false
  v_cli_g2  bigint;  -- status = 'encerrado'
  v_cli_g3  bigint;  -- email = null
  v_cli_g4  bigint;  -- event_cursor_at = now() (cooldown)
  v_cli_off bigint;  -- lives in v_ws_off (workspace toggle off)
  v_claimed int;
begin
  v_ws := et_make_workspace('pro');
  update workspaces set send_client_event_emails = true where id = v_ws;

  -- send_client_event_emails defaults to false -- deliberately left alone.
  v_ws_off := et_make_workspace('pro');

  insert into clientes (user_id, conta_id, nome, sigla, cor, email)
    values (gen_random_uuid(), v_ws, 'Cliente Base', 'CB', '#000', 'base@example.com')
    returning id into v_cli;

  -- ---- positive proof: a fully-eligible cliente is claimed ----
  select count(*) into v_claimed
    from claim_client_event_emails(now(), 10) where id = v_cli;
  assert v_claimed = 1, format('claim deveria retornar o cliente elegivel, got %s', v_claimed);

  -- ---- immediate second call: blocked by the 30-min lease just acquired ----
  select count(*) into v_claimed
    from claim_client_event_emails(now(), 10) where id = v_cli;
  assert v_claimed = 0,
    format('segunda chamada imediata nao deveria reclamar (lease de 30min), got %s', v_claimed);

  -- ---- gate: workspaces.send_client_event_emails = false ----
  insert into clientes (user_id, conta_id, nome, sigla, cor, email)
    values (gen_random_uuid(), v_ws_off, 'Cliente WSOff', 'CW', '#000', 'wsoff@example.com')
    returning id into v_cli_off;

  select count(*) into v_claimed
    from claim_client_event_emails(now(), 50) where id = v_cli_off;
  assert v_claimed = 0,
    format('workspaces.send_client_event_emails=false deveria bloquear o claim, got %s', v_claimed);

  -- ---- gate: clientes.send_event_email = false ----
  insert into clientes (user_id, conta_id, nome, sigla, cor, email)
    values (gen_random_uuid(), v_ws, 'Cliente G1', 'G1', '#000', 'g1@example.com')
    returning id into v_cli_g1;

  perform set_config('request.jwt.claims',
    json_build_object('role', 'service_role')::text, true);
  execute 'set local role service_role';
  update clientes set send_event_email = false where id = v_cli_g1;
  execute 'reset role';

  select count(*) into v_claimed
    from claim_client_event_emails(now(), 50) where id = v_cli_g1;
  assert v_claimed = 0,
    format('clientes.send_event_email=false deveria bloquear o claim, got %s', v_claimed);

  -- ---- gate: clientes.status = 'encerrado' ----
  insert into clientes (user_id, conta_id, nome, sigla, cor, email)
    values (gen_random_uuid(), v_ws, 'Cliente G2', 'G2', '#000', 'g2@example.com')
    returning id into v_cli_g2;
  update clientes set status = 'encerrado' where id = v_cli_g2;

  select count(*) into v_claimed
    from claim_client_event_emails(now(), 50) where id = v_cli_g2;
  assert v_claimed = 0,
    format('clientes.status <> ativo deveria bloquear o claim, got %s', v_claimed);

  -- ---- gate: clientes.email = null ----
  insert into clientes (user_id, conta_id, nome, sigla, cor, email)
    values (gen_random_uuid(), v_ws, 'Cliente G3', 'G3', '#000', 'g3@example.com')
    returning id into v_cli_g3;
  update clientes set email = null where id = v_cli_g3;

  select count(*) into v_claimed
    from claim_client_event_emails(now(), 50) where id = v_cli_g3;
  assert v_claimed = 0,
    format('clientes.email vazio deveria bloquear o claim, got %s', v_claimed);

  -- ---- gate: clientes.event_cursor_at = now() (cooldown de 4h) ----
  insert into clientes (user_id, conta_id, nome, sigla, cor, email)
    values (gen_random_uuid(), v_ws, 'Cliente G4', 'G4', '#000', 'g4@example.com')
    returning id into v_cli_g4;

  perform set_config('request.jwt.claims',
    json_build_object('role', 'service_role')::text, true);
  execute 'set local role service_role';
  update clientes set event_cursor_at = now() where id = v_cli_g4;
  execute 'reset role';

  select count(*) into v_claimed
    from claim_client_event_emails(now(), 50) where id = v_cli_g4;
  assert v_claimed = 0,
    format('cooldown de 4h (event_cursor_at recente) deveria bloquear o claim, got %s', v_claimed);

  -- ---- lease expirado: backdate event_claimed_at 31min -> reclaim ----
  perform set_config('request.jwt.claims',
    json_build_object('role', 'service_role')::text, true);
  execute 'set local role service_role';
  update clientes set event_claimed_at = now() - interval '31 minutes' where id = v_cli;
  execute 'reset role';

  select count(*) into v_claimed
    from claim_client_event_emails(now(), 10) where id = v_cli;
  assert v_claimed = 1,
    format('lease expirado (31min) deveria permitir reclaim, got %s', v_claimed);

  raise notice 'PASS 74 Case 3 claim_client_event_emails gates + lease';
end $$;
rollback;

-- =====================================================================
-- Case 4: claim_client_event_emails ACL -- service_role-only. Same
-- has_function_privilege triple technique as 73_notification_center.sql
-- Case 5 (and 07_workspace_usage.sql, 70_workflow_posts_avulsos.sql,
-- 71_board_ordem.sql before it). Read-only checks against pg_proc, so no
-- transaction/rollback wrapper needed.
-- =====================================================================
do $$
begin
  assert has_function_privilege('anon', 'public.claim_client_event_emails(timestamptz, int)', 'EXECUTE') = false,
    'anon nao deveria executar claim_client_event_emails';
  assert has_function_privilege('authenticated', 'public.claim_client_event_emails(timestamptz, int)', 'EXECUTE') = false,
    'authenticated nao deveria executar claim_client_event_emails';
  assert has_function_privilege('service_role', 'public.claim_client_event_emails(timestamptz, int)', 'EXECUTE') = true,
    'service_role deveria poder executar claim_client_event_emails';

  raise notice 'PASS 74 Case 4 claim_client_event_emails ACL';
end $$;
