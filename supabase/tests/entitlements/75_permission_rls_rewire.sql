\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Migração B (20260904000002_workspace_roles_b_enforcement.sql): exercises
-- every RLS point it rewires under a REAL custom papel (role_id), plus the
-- legacy-fallback regressions the rewire must not disturb.
--
-- Custom-role fixture technique (insert workspace_roles rows directly as
-- postgres -- table owner bypasses RLS -- then workspace_members with role_id
-- set) copied from 72_workspace_roles_permissions.sql's TT-01..16 block.
-- RLS-under-impersonation technique (set_config('request.jwt.claims', ...) +
-- SET LOCAL ROLE authenticated, verification reads as postgres after
-- `reset role`) copied from 50_can_see_financials.sql / 52_financial_
-- enforcement.sql. et_grant_hosted_parity() is required in every block that
-- impersonates `authenticated` against an ordinary table locally (see its own
-- doc comment in _helpers.sql) -- without it, "must be denied" assertions
-- would pass for the wrong reason (missing table grant, not RLS) and "must
-- succeed" assertions would fail for the wrong reason too.
--
-- Every workspace below uses plan 'max' (unlimited team members / every
-- feature on) so plan-count/feature gates never interfere with what is
-- actually under test.

-- =============================================================
-- WR-00: workspace_roles grant boundary (migration item 0) -- runs FIRST, own
-- transaction, BEFORE any et_grant_hosted_parity() call anywhere in this
-- file. et_grant_hosted_parity() grants ALL (including write) on every
-- public table to `authenticated`, workspace_roles included -- calling it
-- before this check would silently mask a regression in the migration's own
-- SELECT-only grant. House discipline for privilege-boundary checks: run
-- first and independently of the rest of the file -- same precedent as
-- RPC-09 in 73_workspace_role_rpcs.sql:12-20, TT-18/TT-19 in
-- 72_workspace_roles_permissions.sql, and the anon check in
-- 50_can_see_financials.sql.
--
-- Checks the relacl text directly (independent re-derivation of what the
-- migration's own post-condition asserts -- a regression that touched the
-- GRANT statement without touching the post-condition would otherwise go
-- uncaught), plus the behavioural counterpart (authenticated really can
-- SELECT, really cannot INSERT).
-- =============================================================
begin;
do $$
declare
  v_ws       uuid;
  v_owner    uuid := gen_random_uuid();
  v_seen     bigint;
  v_ok       boolean;
  v_acl      text;
  v_auth_priv text;
begin
  select array_to_string(c.relacl, ',') into v_acl
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'workspace_roles';

  v_auth_priv := substring(v_acl from 'authenticated=([^/]*)/');
  if v_auth_priv is distinct from 'r' then
    raise exception 'WR-00: authenticated must hold EXACTLY SELECT (r) on workspace_roles -- got %, full acl=%',
      coalesce(v_auth_priv, '<none>'), v_acl;
  end if;
  if v_acl like '%anon=%' then
    raise exception 'WR-00: anon retains privilege on workspace_roles -- acl=%', v_acl;
  end if;
  if v_acl like '=%' or v_acl like '%,=%' then
    raise exception 'WR-00: PUBLIC retains privilege on workspace_roles -- acl=%', v_acl;
  end if;
  -- service_role's grant is explicit in the migration now (house standard:
  -- REVOKE FROM PUBLIC also strips service_role -- re-grant explicitly), not
  -- an environment default -- mirrors the migration's own post-condition.
  if v_acl not like '%service_role=%' then
    raise exception 'WR-00: service_role has no ACL entry on workspace_roles -- acl=%', v_acl;
  end if;

  v_ws := et_make_workspace('max');
  insert into auth.users (id) values (v_owner);
  insert into workspace_members (user_id, workspace_id, role) values (v_owner, v_ws, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_owner;
  insert into workspace_roles (conta_id, nome, permissions) values (v_ws, 'WR-00 probe', '{}'::jsonb);

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);

  -- Positive: authenticated CAN select (the grant this migration adds).
  set local role authenticated;
  select count(*) into v_seen from workspace_roles where conta_id = v_ws;
  reset role;
  if v_seen <> 1 then
    raise exception 'WR-00: authenticated should SELECT the workspace_roles row, saw %', v_seen;
  end if;

  -- Negative: authenticated CANNOT insert -- either the table grant lacks
  -- INSERT (this migration's REVOKE) or RLS denies it (wr_no_client_insert,
  -- Migration A) -- both raise 42501/insufficient_privilege, and this suite
  -- does not need to distinguish which layer fired.
  v_ok := false;
  set local role authenticated;
  begin
    insert into workspace_roles (conta_id, nome, permissions) values (v_ws, 'WR-00 hack', '{}'::jsonb);
  exception when insufficient_privilege then
    v_ok := true;
  end;
  reset role;
  if not v_ok then
    raise exception 'WR-00: authenticated must not be able to INSERT into workspace_roles';
  end if;

  raise notice 'WR-00 workspace_roles grant boundary: ok';
end $$;
rollback;

-- =============================================================
-- RW-08: leads -- pg_policies contains EXACTLY leads_select/insert/update/
-- delete. Moved up to run SECOND (right after the WR-00 privilege-boundary
-- block and before any data-fixture block): under ON_ERROR_STOP the whole
-- file is one psql invocation, so a cheap structural check like this one
-- should get a chance to run and give a fast, unambiguous signal before the
-- more elaborate RW-01..07 blocks execute. The migration's sweep (item (5))
-- removed any legacy policy at apply time; nothing in RW-01..07 below could
-- have added one back, since those blocks only insert/update/delete DATA,
-- never DDL, and every block runs inside its own rolled-back transaction.
-- =============================================================
do $$
declare
  v_stray text;
  v_n     int;
begin
  select count(*) into v_n from pg_policies
   where schemaname = 'public' and tablename = 'leads';
  if v_n <> 4 then
    raise exception 'RW-08: expected 4 policies on leads, found %', v_n;
  end if;

  select string_agg(format('%s.%s', tablename, policyname), ', ' order by policyname)
    into v_stray
    from pg_policies
   where schemaname = 'public' and tablename = 'leads'
     and policyname not in ('leads_select', 'leads_insert', 'leads_update', 'leads_delete');
  if v_stray is not null then
    raise exception 'RW-08: unowned policy survives on leads: %', v_stray;
  end if;

  raise notice 'RW-08 leads policy set: ok';
end $$;

-- =============================================================
-- RW-01: leads. SELECT was `get_my_role() IS DISTINCT FROM 'agent'`
-- (20260404); write policies did not exist at all before this migration
-- (20260315's leads_insert/update/delete were tenant-only). Now: SELECT ->
-- has_permission('leads','ver'); write -> has_permission('leads','editar').
-- =============================================================
begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws          uuid;
  v_owner       uuid := gen_random_uuid();
  v_admin       uuid := gen_random_uuid();
  v_agent       uuid := gen_random_uuid();
  v_c_ver       uuid := gen_random_uuid();  -- {"leads":"ver"}
  v_c_editar    uuid := gen_random_uuid();  -- {"leads":"editar"}
  v_c_none      uuid := gen_random_uuid();  -- {"leads":"none"}
  v_role_ver    uuid;
  v_role_editar uuid;
  v_role_none   uuid;
  v_lead_seen   bigint;
  v_lead_upd    bigint;
  v_lead_del    bigint;
  v_seen        bigint;
  v_rows        bigint;
  v_ok          boolean;
begin
  v_ws := et_make_workspace('max');

  insert into auth.users (id) values
    (v_owner), (v_admin), (v_agent), (v_c_ver), (v_c_editar), (v_c_none);

  insert into workspace_roles (conta_id, nome, permissions) values
    (v_ws, 'RW-01 leads ver',    '{"leads":"ver"}'::jsonb)    returning id into v_role_ver;
  insert into workspace_roles (conta_id, nome, permissions) values
    (v_ws, 'RW-01 leads editar', '{"leads":"editar"}'::jsonb) returning id into v_role_editar;
  insert into workspace_roles (conta_id, nome, permissions) values
    (v_ws, 'RW-01 leads none',   '{"leads":"none"}'::jsonb)   returning id into v_role_none;

  insert into workspace_members (user_id, workspace_id, role) values
    (v_owner, v_ws, 'owner'),
    (v_admin, v_ws, 'admin'),
    (v_agent, v_ws, 'agent');
  insert into workspace_members (user_id, workspace_id, role, role_id) values
    (v_c_ver,    v_ws, 'agent', v_role_ver),
    (v_c_editar, v_ws, 'agent', v_role_editar),
    (v_c_none,   v_ws, 'agent', v_role_none);
  update profiles set conta_id = v_ws, active_workspace_id = v_ws
   where id in (v_owner, v_admin, v_agent, v_c_ver, v_c_editar, v_c_none);

  insert into leads (user_id, conta_id, nome) values (v_owner, v_ws, 'Seen')  returning id into v_lead_seen;
  insert into leads (user_id, conta_id, nome) values (v_owner, v_ws, 'ToUpd') returning id into v_lead_upd;
  insert into leads (user_id, conta_id, nome) values (v_owner, v_ws, 'ToDel') returning id into v_lead_del;

  -- {"leads":"ver"}: SELECT ok, INSERT negado.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_c_ver, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_seen from leads where conta_id = v_ws;
  reset role;
  if v_seen <> 3 then
    raise exception 'RW-01: leads:ver should see 3 rows, saw %', v_seen;
  end if;

  v_ok := false;
  set local role authenticated;
  begin
    insert into leads (user_id, conta_id, nome) values (v_c_ver, v_ws, 'Blocked');
  exception when sqlstate '42501' then
    v_ok := true;
  end;
  reset role;
  if not v_ok then
    raise exception 'RW-01: leads:ver INSERT must be denied';
  end if;

  -- {"leads":"editar"}: INSERT/UPDATE/DELETE ok.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_c_editar, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into leads (user_id, conta_id, nome) values (v_c_editar, v_ws, 'Made');
  reset role;
  select count(*) into v_rows from leads where conta_id = v_ws and nome = 'Made';
  if v_rows <> 1 then
    raise exception 'RW-01: leads:editar INSERT should have succeeded';
  end if;

  set local role authenticated;
  update leads set nome = 'Updated' where id = v_lead_upd;
  get diagnostics v_rows = row_count;
  reset role;
  if v_rows <> 1 then
    raise exception 'RW-01: leads:editar UPDATE must affect 1 row, affected %', v_rows;
  end if;

  set local role authenticated;
  delete from leads where id = v_lead_del;
  get diagnostics v_rows = row_count;
  reset role;
  if v_rows <> 1 then
    raise exception 'RW-01: leads:editar DELETE must affect 1 row, affected %', v_rows;
  end if;

  -- {"leads":"none"}: SELECT vazio.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_c_none, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_seen from leads where conta_id = v_ws;
  reset role;
  if v_seen <> 0 then
    raise exception 'RW-01: leads:none should see 0 rows, saw %', v_seen;
  end if;

  -- agent legado: SELECT vazio (regressão -- has_permission_for's agent
  -- preset denies 'leads' entirely, same as 20260404's get_my_role() check).
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_agent, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_seen from leads where conta_id = v_ws;
  reset role;
  if v_seen <> 0 then
    raise exception 'RW-01: legacy agent should see 0 leads rows (regression), saw %', v_seen;
  end if;

  -- admin legado: tudo ok (regressão).
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_seen from leads where conta_id = v_ws;
  reset role;
  if v_seen < 1 then
    raise exception 'RW-01: legacy admin should see leads rows (regression), saw %', v_seen;
  end if;

  set local role authenticated;
  insert into leads (user_id, conta_id, nome) values (v_admin, v_ws, 'AdminMade');
  reset role;
  select count(*) into v_rows from leads where conta_id = v_ws and nome = 'AdminMade';
  if v_rows <> 1 then
    raise exception 'RW-01: legacy admin INSERT should have succeeded (regression)';
  end if;

  raise notice 'RW-01 leads: ok';
end $$;
rollback;

-- =============================================================
-- RW-02: post_status_automations. Module is 'configuracoes' (product
-- decision, migration item (6) final round -- NOT 'automacoes', which an
-- earlier round of this migration used and which would have given the
-- legacy agent SELECT it never had). configuracoes was already 'none' in
-- the agent preset, so this is byte-exact parity with 20260805000002's
-- owner/admin-only shape, not a delta: legacy agent is denied BOTH SELECT
-- and INSERT, same as before this migration existed.
-- =============================================================
begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws          uuid;
  v_agent       uuid := gen_random_uuid();
  v_c_ver       uuid := gen_random_uuid();
  v_c_editar    uuid := gen_random_uuid();
  v_role_ver    uuid;
  v_role_editar uuid;
  v_seen        bigint;
  v_rows        bigint;
  v_ok          boolean;
begin
  v_ws := et_make_workspace('max');

  insert into auth.users (id) values (v_agent), (v_c_ver), (v_c_editar);

  insert into workspace_roles (conta_id, nome, permissions) values
    (v_ws, 'RW-02 config ver',    '{"configuracoes":"ver"}'::jsonb)    returning id into v_role_ver;
  insert into workspace_roles (conta_id, nome, permissions) values
    (v_ws, 'RW-02 config editar', '{"configuracoes":"editar"}'::jsonb) returning id into v_role_editar;

  insert into workspace_members (user_id, workspace_id, role) values (v_agent, v_ws, 'agent');
  insert into workspace_members (user_id, workspace_id, role, role_id) values
    (v_c_ver,    v_ws, 'agent', v_role_ver),
    (v_c_editar, v_ws, 'agent', v_role_editar);
  update profiles set conta_id = v_ws, active_workspace_id = v_ws
   where id in (v_agent, v_c_ver, v_c_editar);

  insert into post_status_automations (conta_id, trigger_status, action_type, config)
    values (v_ws, 'rascunho', 'notify', '{"target":"roles","roles":["owner"]}');

  -- {"configuracoes":"ver"}: SELECT ok, INSERT negado.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_c_ver, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_seen from post_status_automations where conta_id = v_ws;
  reset role;
  if v_seen <> 1 then
    raise exception 'RW-02: configuracoes:ver should see 1 row, saw %', v_seen;
  end if;

  v_ok := false;
  set local role authenticated;
  begin
    insert into post_status_automations (conta_id, trigger_status, action_type, config)
      values (v_ws, 'aprovado_interno', 'notify', '{}');
  exception when sqlstate '42501' then
    v_ok := true;
  end;
  reset role;
  if not v_ok then
    raise exception 'RW-02: configuracoes:ver INSERT must be denied';
  end if;

  -- {"configuracoes":"editar"}: INSERT ok.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_c_editar, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into post_status_automations (conta_id, trigger_status, action_type, config)
    values (v_ws, 'aprovado_interno', 'notify', '{}');
  reset role;
  select count(*) into v_rows from post_status_automations
   where conta_id = v_ws and trigger_status = 'aprovado_interno';
  if v_rows <> 1 then
    raise exception 'RW-02: configuracoes:editar INSERT should have succeeded';
  end if;

  -- agent legado: SELECT vazio, INSERT negado -- byte-exato com o
  -- owner/admin-only de sempre, sem delta.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_agent, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_seen from post_status_automations where conta_id = v_ws;
  reset role;
  if v_seen <> 0 then
    raise exception 'RW-02: legacy agent should see 0 post_status_automations rows (no delta), saw %', v_seen;
  end if;

  v_ok := false;
  set local role authenticated;
  begin
    insert into post_status_automations (conta_id, trigger_status, action_type, config)
      values (v_ws, 'enviado_cliente', 'notify', '{}');
  exception when sqlstate '42501' then
    v_ok := true;
  end;
  reset role;
  if not v_ok then
    raise exception 'RW-02: legacy agent INSERT must be denied';
  end if;

  raise notice 'RW-02 post_status_automations: ok';
end $$;
rollback;

-- =============================================================
-- RW-03: instagram_comment_automations. Module is 'automacoes' (unlike RW-02
-- above): SELECT and write both gated on has_permission('automacoes', ...).
-- For a CUSTOM role this is a real, module-scoped gate. For the LEGACY agent
-- it is byte-exact parity with 20260829000002's "any workspace member
-- writes" shape -- the agent preset's 'automacoes' is 'editar' (product
-- decision, migration item (6) final round), which is what preserves the
-- write access the agent already had. There is no delta here, unlike an
-- earlier round of this migration believed.
-- =============================================================
begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws          uuid;
  v_owner       uuid := gen_random_uuid();
  v_agent       uuid := gen_random_uuid();
  v_c_ver       uuid := gen_random_uuid();
  v_c_editar    uuid := gen_random_uuid();
  v_role_ver    uuid;
  v_role_editar uuid;
  v_cli         bigint;
  v_seen        bigint;
  v_rows        bigint;
  v_ok          boolean;
begin
  v_ws := et_make_workspace('max');
  insert into workspace_plan_overrides (workspace_id, feature_overrides)
    values (v_ws, '{"feature_instagram_automation": true}'::jsonb);

  insert into auth.users (id) values (v_owner), (v_agent), (v_c_ver), (v_c_editar);

  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_owner, v_ws, 'C', 'C', '#000') returning id into v_cli;

  insert into workspace_roles (conta_id, nome, permissions) values
    (v_ws, 'RW-03 automacoes ver',    '{"automacoes":"ver"}'::jsonb)    returning id into v_role_ver;
  insert into workspace_roles (conta_id, nome, permissions) values
    (v_ws, 'RW-03 automacoes editar', '{"automacoes":"editar"}'::jsonb) returning id into v_role_editar;

  insert into workspace_members (user_id, workspace_id, role) values
    (v_owner, v_ws, 'owner'), (v_agent, v_ws, 'agent');
  insert into workspace_members (user_id, workspace_id, role, role_id) values
    (v_c_ver,    v_ws, 'agent', v_role_ver),
    (v_c_editar, v_ws, 'agent', v_role_editar);
  update profiles set conta_id = v_ws, active_workspace_id = v_ws
   where id in (v_owner, v_agent, v_c_ver, v_c_editar);

  insert into instagram_comment_automations (conta_id, client_id, name, keywords, dm_message)
    values (v_ws, v_cli, 'Promo', array['preco'], 'Chama no DM!');

  -- {"automacoes":"ver"}: SELECT ok, INSERT negado.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_c_ver, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_seen from instagram_comment_automations where conta_id = v_ws;
  reset role;
  if v_seen <> 1 then
    raise exception 'RW-03: automacoes:ver should see 1 row, saw %', v_seen;
  end if;

  v_ok := false;
  set local role authenticated;
  begin
    insert into instagram_comment_automations (conta_id, client_id, name, keywords, dm_message)
      values (v_ws, v_cli, 'Blocked', array['x'], 'y');
  exception when sqlstate '42501' then
    v_ok := true;
  end;
  reset role;
  if not v_ok then
    raise exception 'RW-03: automacoes:ver INSERT must be denied';
  end if;

  -- {"automacoes":"editar"}: INSERT ok.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_c_editar, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into instagram_comment_automations (conta_id, client_id, name, keywords, dm_message)
    values (v_ws, v_cli, 'MadeByEditar', array['x'], 'y');
  reset role;
  select count(*) into v_rows from instagram_comment_automations
   where conta_id = v_ws and name = 'MadeByEditar';
  if v_rows <> 1 then
    raise exception 'RW-03: automacoes:editar INSERT should have succeeded';
  end if;

  -- agent legado: SELECT ok, INSERT ok -- byte-exato com 20260829000002
  -- ("agent ganha escrita completa"), preservado via automacoes:editar no
  -- preset do agente (product decision, migration item (6) final round).
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_agent, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_seen from instagram_comment_automations where conta_id = v_ws;
  reset role;
  if v_seen < 1 then
    raise exception 'RW-03: legacy agent should see instagram_comment_automations rows, saw %', v_seen;
  end if;

  set local role authenticated;
  insert into instagram_comment_automations (conta_id, client_id, name, keywords, dm_message)
    values (v_ws, v_cli, 'AgentMade', array['x'], 'y');
  reset role;
  select count(*) into v_rows from instagram_comment_automations
   where conta_id = v_ws and name = 'AgentMade';
  if v_rows <> 1 then
    raise exception 'RW-03: legacy agent INSERT should have succeeded (no delta -- byte-exact with 20260829000002)';
  end if;

  raise notice 'RW-03 instagram_comment_automations: ok';
end $$;
rollback;

-- =============================================================
-- RW-04: post_status_definitions. Write (INSERT/UPDATE/DELETE) requires
-- configuracoes/editar; the SELECT policy (psd_select) is UNCHANGED -- any
-- member, agent included, still reads (kanban/labels need it).
-- =============================================================
begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws          uuid;
  v_agent       uuid := gen_random_uuid();
  v_c_ver       uuid := gen_random_uuid();  -- {"configuracoes":"ver"}
  v_c_editar    uuid := gen_random_uuid();  -- {"configuracoes":"editar"}
  v_role_ver    uuid;
  v_role_editar uuid;
  v_def         uuid;
  v_seen        bigint;
  v_rows        bigint;
  v_ok          boolean;
begin
  v_ws := et_make_workspace('max');

  insert into auth.users (id) values (v_agent), (v_c_ver), (v_c_editar);

  insert into workspace_roles (conta_id, nome, permissions) values
    (v_ws, 'RW-04 config ver',    '{"configuracoes":"ver"}'::jsonb)    returning id into v_role_ver;
  insert into workspace_roles (conta_id, nome, permissions) values
    (v_ws, 'RW-04 config editar', '{"configuracoes":"editar"}'::jsonb) returning id into v_role_editar;

  insert into workspace_members (user_id, workspace_id, role) values (v_agent, v_ws, 'agent');
  insert into workspace_members (user_id, workspace_id, role, role_id) values
    (v_c_ver,    v_ws, 'agent', v_role_ver),
    (v_c_editar, v_ws, 'agent', v_role_editar);
  update profiles set conta_id = v_ws, active_workspace_id = v_ws
   where id in (v_agent, v_c_ver, v_c_editar);

  insert into post_status_definitions (conta_id, nome, behaves_as)
    values (v_ws, 'Em design', 'revisao_interna') returning id into v_def;

  -- SELECT: intocada -- qualquer membro lê, agente incluso.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_agent, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_seen from post_status_definitions where conta_id = v_ws;
  reset role;
  if v_seen <> 1 then
    raise exception 'RW-04: agent should still read post_status_definitions, saw %', v_seen;
  end if;

  -- {"configuracoes":"ver"}: INSERT negado (precisa editar).
  v_ok := false;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_c_ver, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into post_status_definitions (conta_id, nome, behaves_as)
      values (v_ws, 'Blocked', 'rascunho');
  exception when sqlstate '42501' then
    v_ok := true;
  end;
  reset role;
  if not v_ok then
    raise exception 'RW-04: configuracoes:ver INSERT must be denied';
  end if;

  -- {"configuracoes":"editar"}: UPDATE ok.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_c_editar, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update post_status_definitions set cor = '#7c5cff' where id = v_def;
  get diagnostics v_rows = row_count;
  reset role;
  if v_rows <> 1 then
    raise exception 'RW-04: configuracoes:editar UPDATE must affect 1 row, affected %', v_rows;
  end if;

  raise notice 'RW-04 post_status_definitions: ok';
end $$;
rollback;

-- =============================================================
-- RW-05: workspaces UPDATE (ws_update_owner_admin). Requires
-- configuracoes/editar; legacy admin regression (still allowed, no papel).
-- =============================================================
begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws          uuid;
  v_admin       uuid := gen_random_uuid();
  v_c_editar    uuid := gen_random_uuid();
  v_c_none      uuid := gen_random_uuid();
  v_role_editar uuid;
  v_role_none   uuid;
  v_rows        bigint;
begin
  v_ws := et_make_workspace('max');

  insert into auth.users (id) values (v_admin), (v_c_editar), (v_c_none);

  insert into workspace_roles (conta_id, nome, permissions) values
    (v_ws, 'RW-05 config editar', '{"configuracoes":"editar"}'::jsonb) returning id into v_role_editar;
  insert into workspace_roles (conta_id, nome, permissions) values
    (v_ws, 'RW-05 config none',   '{}'::jsonb)                        returning id into v_role_none;

  insert into workspace_members (user_id, workspace_id, role) values (v_admin, v_ws, 'admin');
  insert into workspace_members (user_id, workspace_id, role, role_id) values
    (v_c_editar, v_ws, 'agent', v_role_editar),
    (v_c_none,   v_ws, 'agent', v_role_none);
  update profiles set conta_id = v_ws, active_workspace_id = v_ws
   where id in (v_admin, v_c_editar, v_c_none);

  -- {"configuracoes":"editar"}: UPDATE ok.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_c_editar, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update workspaces set name = 'RW-05 renamed' where id = v_ws;
  get diagnostics v_rows = row_count;
  reset role;
  if v_rows <> 1 then
    raise exception 'RW-05: configuracoes:editar UPDATE must affect 1 row, affected %', v_rows;
  end if;

  -- sem permissão (papel {}): negado (0 rows, silently filtered by USING).
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_c_none, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update workspaces set name = 'RW-05 hacked' where id = v_ws;
  get diagnostics v_rows = row_count;
  reset role;
  if v_rows <> 0 then
    raise exception 'RW-05: role without configuracoes:editar must affect 0 rows, affected %', v_rows;
  end if;

  -- admin legado: ok (regressão).
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update workspaces set name = 'RW-05 admin renamed' where id = v_ws;
  get diagnostics v_rows = row_count;
  reset role;
  if v_rows <> 1 then
    raise exception 'RW-05: legacy admin UPDATE must affect 1 row (regression), affected %', v_rows;
  end if;

  raise notice 'RW-05 workspaces UPDATE: ok';
end $$;
rollback;

-- =============================================================
-- RW-06: transacoes write policies (financeiro module -- contratos moved to
-- its own module, RW-06b below). {"financeiro":"ver"} reads via
-- can_see_financials() (now 'ver') but is blocked from writing (INSERT,
-- UPDATE, AND DELETE) by the NEW has_permission('financeiro','editar')
-- conjunct; {"financeiro":"editar"} writes; restricted legacy admin
-- (can_see_financials=false) still gets 0 rows on SELECT (regression of 52
-- -- can_see_financials() stays in the policy alongside the new conjunct, so
-- nothing here narrows further for the legacy path).
-- =============================================================
begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws          uuid;
  v_owner       uuid := gen_random_uuid();
  v_admin_no    uuid := gen_random_uuid();
  v_c_ver       uuid := gen_random_uuid();
  v_c_editar    uuid := gen_random_uuid();
  v_role_ver    uuid;
  v_role_editar uuid;
  v_tx          bigint;
  v_tx_upd      bigint;
  v_tx_del      bigint;
  v_seen        bigint;
  v_rows        bigint;
  v_ok          boolean;
  v_val         numeric;
begin
  v_ws := et_make_workspace('max');

  insert into auth.users (id) values (v_owner), (v_admin_no), (v_c_ver), (v_c_editar);

  insert into workspace_roles (conta_id, nome, permissions) values
    (v_ws, 'RW-06 financeiro ver',    '{"financeiro":"ver"}'::jsonb)    returning id into v_role_ver;
  insert into workspace_roles (conta_id, nome, permissions) values
    (v_ws, 'RW-06 financeiro editar', '{"financeiro":"editar"}'::jsonb) returning id into v_role_editar;

  insert into workspace_members (user_id, workspace_id, role) values
    (v_owner, v_ws, 'owner'), (v_admin_no, v_ws, 'admin');
  update workspace_members set can_see_financials = false
   where user_id = v_admin_no and workspace_id = v_ws;
  insert into workspace_members (user_id, workspace_id, role, role_id) values
    (v_c_ver,    v_ws, 'agent', v_role_ver),
    (v_c_editar, v_ws, 'agent', v_role_editar);
  update profiles set conta_id = v_ws, active_workspace_id = v_ws
   where id in (v_owner, v_admin_no, v_c_ver, v_c_editar);

  insert into transacoes (user_id, conta_id, data, tipo, valor)
    values (v_owner, v_ws, '2026-01-01', 'entrada', 500) returning id into v_tx;
  insert into transacoes (user_id, conta_id, data, tipo, valor)
    values (v_owner, v_ws, '2026-01-01', 'entrada', 600) returning id into v_tx_upd;
  insert into transacoes (user_id, conta_id, data, tipo, valor)
    values (v_owner, v_ws, '2026-01-01', 'entrada', 700) returning id into v_tx_del;

  -- {"financeiro":"ver"}: SELECT ok, INSERT/UPDATE/DELETE negado.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_c_ver, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_seen from transacoes where id = v_tx;
  reset role;
  if v_seen <> 1 then
    raise exception 'RW-06: financeiro:ver should see the transacoes row, saw %', v_seen;
  end if;

  v_ok := false;
  set local role authenticated;
  begin
    insert into transacoes (user_id, conta_id, data, tipo, valor)
      values (v_c_ver, v_ws, '2026-01-02', 'entrada', 1);
  exception when sqlstate '42501' then
    v_ok := true;
  end;
  reset role;
  if not v_ok then
    raise exception 'RW-06: financeiro:ver INSERT on transacoes must be denied';
  end if;

  -- UPDATE: silently filtered by USING (0 rows), value unchanged.
  set local role authenticated;
  update transacoes set valor = 1 where id = v_tx_upd;
  get diagnostics v_rows = row_count;
  reset role;
  if v_rows <> 0 then
    raise exception 'RW-06: financeiro:ver UPDATE on transacoes must affect 0 rows, affected %', v_rows;
  end if;
  select valor into v_val from transacoes where id = v_tx_upd;
  if v_val is distinct from 600 then
    raise exception 'RW-06: financeiro:ver UPDATE mutated transacoes despite 0 reported rows, valor=%', v_val;
  end if;

  -- DELETE: silently filtered by USING (0 rows), row survives.
  set local role authenticated;
  delete from transacoes where id = v_tx_del;
  get diagnostics v_rows = row_count;
  reset role;
  if v_rows <> 0 then
    raise exception 'RW-06: financeiro:ver DELETE on transacoes must affect 0 rows, affected %', v_rows;
  end if;
  if not exists (select 1 from transacoes where id = v_tx_del) then
    raise exception 'RW-06: financeiro:ver DELETE removed the transacoes row despite 0 reported rows';
  end if;

  -- {"financeiro":"editar"}: INSERT ok.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_c_editar, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into transacoes (user_id, conta_id, data, tipo, valor)
    values (v_c_editar, v_ws, '2026-01-03', 'entrada', 42);
  reset role;
  select count(*) into v_rows from transacoes where conta_id = v_ws and valor = 42;
  if v_rows <> 1 then
    raise exception 'RW-06: financeiro:editar INSERT on transacoes should have succeeded';
  end if;

  -- admin legado can_see_financials=false: SELECT vazio (regressão do 52).
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin_no, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_seen from transacoes where id = v_tx;
  reset role;
  if v_seen <> 0 then
    raise exception 'RW-06: restricted legacy admin should see 0 transacoes rows (regression), saw %', v_seen;
  end if;

  raise notice 'RW-06 transacoes: ok';
end $$;
rollback;

-- =============================================================
-- RW-06b: contratos write policies (own permission module, DECOUPLED from
-- financeiro's RLS text -- migration item (4b)). {"contratos":"ver"} reads
-- but is denied on every write verb; {"contratos":"none"} is denied on
-- everything; restricted legacy admin (can_see_financials=false) still gets
-- 0 rows on SELECT -- regression PARITY with today: has_permission_for's
-- admin branch (item (2)) explicitly couples contratos to the same flag,
-- which is a confirmed production fact (nav-data.ts already hides
-- 'financeiro' and 'contratos' together for a restricted admin), not a new
-- restriction introduced by moving contratos off the financeiro RLS text.
-- =============================================================
begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws          uuid;
  v_owner       uuid := gen_random_uuid();
  v_admin_no    uuid := gen_random_uuid();
  v_c_ver       uuid := gen_random_uuid();
  v_c_none      uuid := gen_random_uuid();
  v_role_ver    uuid;
  v_role_none   uuid;
  v_ct          bigint;
  v_seen        bigint;
  v_ok          boolean;
begin
  v_ws := et_make_workspace('max');

  insert into auth.users (id) values (v_owner), (v_admin_no), (v_c_ver), (v_c_none);

  insert into workspace_roles (conta_id, nome, permissions) values
    (v_ws, 'RW-06b contratos ver',  '{"contratos":"ver"}'::jsonb)  returning id into v_role_ver;
  insert into workspace_roles (conta_id, nome, permissions) values
    (v_ws, 'RW-06b contratos none', '{"contratos":"none"}'::jsonb) returning id into v_role_none;

  insert into workspace_members (user_id, workspace_id, role) values
    (v_owner, v_ws, 'owner'), (v_admin_no, v_ws, 'admin');
  update workspace_members set can_see_financials = false
   where user_id = v_admin_no and workspace_id = v_ws;
  insert into workspace_members (user_id, workspace_id, role, role_id) values
    (v_c_ver,  v_ws, 'agent', v_role_ver),
    (v_c_none, v_ws, 'agent', v_role_none);
  update profiles set conta_id = v_ws, active_workspace_id = v_ws
   where id in (v_owner, v_admin_no, v_c_ver, v_c_none);

  insert into contratos (user_id, conta_id, titulo, data_inicio, data_fim, valor_total)
    values (v_owner, v_ws, 'Contrato', '2026-01-01', '2026-12-31', 500) returning id into v_ct;

  -- {"contratos":"ver"}: SELECT ok, INSERT negado.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_c_ver, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_seen from contratos where id = v_ct;
  reset role;
  if v_seen <> 1 then
    raise exception 'RW-06b: contratos:ver should see the contratos row, saw %', v_seen;
  end if;

  v_ok := false;
  set local role authenticated;
  begin
    insert into contratos (user_id, conta_id, titulo, data_inicio, data_fim, valor_total)
      values (v_c_ver, v_ws, 'Blocked', '2026-01-01', '2026-12-31', 1);
  exception when sqlstate '42501' then
    v_ok := true;
  end;
  reset role;
  if not v_ok then
    raise exception 'RW-06b: contratos:ver INSERT must be denied';
  end if;

  -- {"contratos":"none"}: SELECT vazio, INSERT negado.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_c_none, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_seen from contratos where conta_id = v_ws;
  reset role;
  if v_seen <> 0 then
    raise exception 'RW-06b: contratos:none should see 0 rows, saw %', v_seen;
  end if;

  v_ok := false;
  set local role authenticated;
  begin
    insert into contratos (user_id, conta_id, titulo, data_inicio, data_fim, valor_total)
      values (v_c_none, v_ws, 'Blocked2', '2026-01-01', '2026-12-31', 1);
  exception when sqlstate '42501' then
    v_ok := true;
  end;
  reset role;
  if not v_ok then
    raise exception 'RW-06b: contratos:none INSERT must be denied';
  end if;

  -- admin legado can_see_financials=false: SELECT vazio -- regressão
  -- PARIDADE com hoje (não uma restrição nova; ver o comentário do bloco).
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin_no, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_seen from contratos where id = v_ct;
  reset role;
  if v_seen <> 0 then
    raise exception 'RW-06b: restricted legacy admin should see 0 contratos rows (parity with today), saw %', v_seen;
  end if;

  raise notice 'RW-06b contratos: ok';
end $$;
rollback;

-- =============================================================
-- RW-07: can_see_financials() -- the 50_can_see_financials.sql truth table
-- (owner / admin±flag / no-workspace) retested against the NEW body (was a
-- direct role.CASE, now delegates to has_permission), plus the two custom-
-- role cases the redefinition adds. 50 itself stays unedited and is the
-- compatibility proof for the legacy cases; this suite adds the papel cases.
-- =============================================================
begin;
do $$
declare
  v_ws          uuid;
  v_owner       uuid := gen_random_uuid();
  v_admin       uuid := gen_random_uuid();
  v_c_ver       uuid := gen_random_uuid();
  v_c_none      uuid := gen_random_uuid();
  v_role_ver    uuid;
  v_role_none   uuid;
  v_got         boolean;
begin
  v_ws := et_make_workspace('max');

  insert into auth.users (id) values (v_owner), (v_admin), (v_c_ver), (v_c_none);

  insert into workspace_roles (conta_id, nome, permissions) values
    (v_ws, 'RW-07 financeiro ver',  '{"financeiro":"ver"}'::jsonb)  returning id into v_role_ver;
  insert into workspace_roles (conta_id, nome, permissions) values
    (v_ws, 'RW-07 financeiro none', '{"financeiro":"none"}'::jsonb) returning id into v_role_none;

  insert into workspace_members (user_id, workspace_id, role) values
    (v_owner, v_ws, 'owner'), (v_admin, v_ws, 'admin');
  insert into workspace_members (user_id, workspace_id, role, role_id) values
    (v_c_ver,  v_ws, 'agent', v_role_ver),
    (v_c_none, v_ws, 'agent', v_role_none);
  update profiles set conta_id = v_ws, active_workspace_id = v_ws
   where id in (v_owner, v_admin, v_c_ver, v_c_none);

  -- owner: true (short-circuits in has_permission_for before the papel jsonb
  -- is even consulted).
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select public.can_see_financials() into v_got;
  reset role;
  if v_got is not true then
    raise exception 'RW-07: owner should see financials via the new body too, got %', v_got;
  end if;

  -- admin (default flag=true): true.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select public.can_see_financials() into v_got;
  reset role;
  if v_got is not true then
    raise exception 'RW-07: admin (can_see=true) should see financials via the new body, got %', v_got;
  end if;

  -- admin flag=false: false.
  update workspace_members set can_see_financials = false
   where user_id = v_admin and workspace_id = v_ws;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select public.can_see_financials() into v_got;
  reset role;
  if v_got is not false then
    raise exception 'RW-07: restricted admin should NOT see financials via the new body, got %', v_got;
  end if;

  -- papel {"financeiro":"ver"} => true.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_c_ver, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select public.can_see_financials() into v_got;
  reset role;
  if v_got is not true then
    raise exception 'RW-07: custom role financeiro:ver should see financials, got %', v_got;
  end if;

  -- papel {"financeiro":"none"} => false.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_c_none, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select public.can_see_financials() into v_got;
  reset role;
  if v_got is not false then
    raise exception 'RW-07: custom role financeiro:none should NOT see financials, got %', v_got;
  end if;

  raise notice 'RW-07 can_see_financials(): ok';
end $$;
rollback;
