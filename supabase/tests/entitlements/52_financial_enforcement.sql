\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Migration B enforcement: column-level grants on membros/clientes, the
-- rewritten transacoes/contratos policies, and the guard_financial_write()
-- write-guard trigger.
--
-- membros and clientes are EXCLUDED from et_grant_hosted_parity(): this
-- suite's whole point is to assert the migration's own column-level
-- SELECT grant/revoke on those two tables, and a wholesale re-grant would
-- silently undo the very thing being asserted. authenticated (and anon, for
-- the write-guard's anonymous-bypass case below) still needs INSERT/
-- UPDATE/DELETE on them locally to exercise the write-guard trigger and the
-- RLS write-denial paths at all -- hosted Supabase's default ACL already
-- grants those in production (same rationale as et_grant_hosted_parity
-- itself: a test-harness fix, not a migration). Granted explicitly,
-- deliberately NOT including SELECT.
--
-- Both statements are issued INSIDE each begin/rollback block below (right
-- after `begin;`), not once here at file scope. GRANT is transactional DDL:
-- issuing it here, before the first `begin;`, would COMMIT it as soon as
-- psql executed the statement (autocommit, since no transaction is open
-- yet) and leave it permanently in place after this file's rollbacks run --
-- polluting reruns of this suite and every later suite in the same run.
-- 40_cliente_tables_tenant_isolation.sql already gets this right (helper
-- called inside its one rolled-back block); repeating the grants per-block
-- here costs nothing (GRANT is cheap and idempotent) and keeps every side
-- effect of this file inside a transaction that gets rolled back.

-- =============================================================
-- 1. Column grants: authenticated can select every allowlisted column on
--    membros/clientes, and is denied on the two protected financial columns.
--    Looping over the full allowlist (not just one representative column)
--    is the positive counterpart to the protected-column denial below --
--    without it, a revoke that was too broad (e.g. dropped by accident)
--    would go uncaught.
-- =============================================================
begin;
select et_grant_hosted_parity(ARRAY['membros', 'clientes']);
grant insert, update, delete on public.membros, public.clientes to anon, authenticated;
do $$
declare
  v_ws   uuid;
  v_uid  uuid := gen_random_uuid();
  v_col  text;
  v_ok   boolean;
  v_membro_cols text[] := array[
    'id','user_id','conta_id','nome','cargo','tipo','avatar_url',
    'data_pagamento','created_at','crm_user_id'
  ];
  v_cliente_cols text[] := array[
    'id','user_id','conta_id','nome','sigla','cor','plano','email',
    'telefone','status','created_at','notion_page_url','data_pagamento',
    'especialidade','data_aniversario','dia_entrega',
    'auto_publish_on_approval','send_report_email','include_ai_analysis'
  ];
begin
  v_ws := et_make_workspace('max');
  insert into auth.users (id) values (v_uid);
  insert into workspace_members (user_id, workspace_id, role) values (v_uid, v_ws, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_uid;

  insert into membros (user_id, conta_id, nome, cargo, tipo, custo_mensal, avatar_url)
    values (v_uid, v_ws, 'M', 'X', 'clt', 100, '');
  insert into clientes (user_id, conta_id, nome, sigla, cor, valor_mensal)
    values (v_uid, v_ws, 'C', 'C', '#000', 100);

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);

  foreach v_col in array v_membro_cols loop
    v_ok := true;
    set local role authenticated;
    begin
      execute format('select %I from public.membros limit 1', v_col);
    exception when insufficient_privilege then
      v_ok := false;
    end;
    reset role;
    if not v_ok then
      raise exception 'authenticated should be able to select membros.%, but was denied', v_col;
    end if;
  end loop;

  v_ok := true;
  set local role authenticated;
  begin
    execute 'select custo_mensal from public.membros limit 1';
  exception when insufficient_privilege then
    v_ok := false;
  end;
  reset role;
  if v_ok then
    raise exception 'authenticated must NOT be able to select membros.custo_mensal';
  end if;

  foreach v_col in array v_cliente_cols loop
    v_ok := true;
    set local role authenticated;
    begin
      execute format('select %I from public.clientes limit 1', v_col);
    exception when insufficient_privilege then
      v_ok := false;
    end;
    reset role;
    if not v_ok then
      raise exception 'authenticated should be able to select clientes.%, but was denied', v_col;
    end if;
  end loop;

  v_ok := true;
  set local role authenticated;
  begin
    execute 'select valor_mensal from public.clientes limit 1';
  exception when insufficient_privilege then
    v_ok := false;
  end;
  reset role;
  if v_ok then
    raise exception 'authenticated must NOT be able to select clientes.valor_mensal';
  end if;

  raise notice '52_financial_enforcement: column grants correct (full allowlist selectable, protected columns denied)';
end $$;
rollback;

-- =============================================================
-- 2. transacoes: restricted admin blocked on all four verbs; authorized
--    admin/owner NOT over-blocked (positive counterpart); cross-tenant
--    regression across all four of this table's policies.
-- =============================================================
begin;
select et_grant_hosted_parity(ARRAY['membros', 'clientes']);
grant insert, update, delete on public.membros, public.clientes to anon, authenticated;
do $$
declare
  v_ws_a uuid; v_ws_b uuid;
  v_owner    uuid := gen_random_uuid();
  v_admin_ok uuid := gen_random_uuid();
  v_admin_no uuid := gen_random_uuid();
  v_tx_a bigint; v_tx_b bigint;
  v_rows bigint;
  v_val  numeric;
  v_ok   boolean;
begin
  v_ws_a := et_make_workspace('max');
  v_ws_b := et_make_workspace('max');

  insert into auth.users (id) values (v_owner), (v_admin_ok), (v_admin_no);
  insert into workspace_members (user_id, workspace_id, role) values
    (v_owner, v_ws_a, 'owner'),
    (v_admin_ok, v_ws_a, 'admin'),
    (v_admin_no, v_ws_a, 'admin');
  update workspace_members set can_see_financials = false
   where user_id = v_admin_no and workspace_id = v_ws_a;
  update profiles set conta_id = v_ws_a, active_workspace_id = v_ws_a
   where id in (v_owner, v_admin_ok, v_admin_no);

  -- Seed rows directly as postgres (table owner bypasses RLS).
  insert into transacoes (user_id, conta_id, data, tipo, valor)
    values (v_owner, v_ws_a, '2026-01-01', 'entrada', 500) returning id into v_tx_a;
  insert into transacoes (user_id, conta_id, data, tipo, valor)
    values (v_owner, v_ws_b, '2026-01-01', 'entrada', 999) returning id into v_tx_b;

  -- SELECT: restricted admin sees 0 rows.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin_no, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_rows from transacoes where id = v_tx_a;
  reset role;
  if coalesce(v_rows, 0) <> 0 then
    raise exception 'restricted admin should not see transacoes row, got % rows', v_rows;
  end if;

  -- SELECT: authorized admin sees the real row (positive counterpart --
  -- proves the row is truly reachable, not universally hidden).
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin_ok, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select valor, count(*) over () into v_val, v_rows from transacoes where id = v_tx_a;
  reset role;
  if coalesce(v_rows, 0) <> 1 then
    raise exception 'authorized admin should see transacoes row, got % rows', v_rows;
  end if;
  if v_val is distinct from 500 then
    raise exception 'authorized admin should read transacoes.valor=500, got %', v_val;
  end if;

  -- INSERT: restricted admin denied.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin_no, 'role', 'authenticated')::text, true);
  v_ok := false;
  set local role authenticated;
  begin
    insert into transacoes (user_id, conta_id, data, tipo, valor)
      values (v_admin_no, v_ws_a, '2026-01-02', 'entrada', 1);
  exception when insufficient_privilege then
    v_ok := true;
  end;
  reset role;
  if not v_ok then
    raise exception 'restricted admin must be denied INSERT on transacoes';
  end if;

  -- INSERT: authorized admin succeeds (positive counterpart).
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin_ok, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into transacoes (user_id, conta_id, data, tipo, valor)
    values (v_admin_ok, v_ws_a, '2026-01-02', 'entrada', 42);
  reset role;
  select count(*) into v_rows from transacoes where conta_id = v_ws_a and valor = 42;
  if v_rows <> 1 then
    raise exception 'authorized admin insert into transacoes should have succeeded';
  end if;

  -- UPDATE: restricted admin denied -- 0 rows affected AND data unchanged.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin_no, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update transacoes set valor = 1 where id = v_tx_a;
  get diagnostics v_rows = row_count;
  reset role;
  if v_rows <> 0 then
    raise exception 'restricted admin updated % transacoes rows', v_rows;
  end if;
  select valor into v_val from transacoes where id = v_tx_a;
  if v_val is distinct from 500 then
    raise exception 'restricted admin mutated transacoes row despite 0 reported rows, valor=%', v_val;
  end if;

  -- UPDATE: owner succeeds (positive counterpart).
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update transacoes set valor = 501 where id = v_tx_a;
  get diagnostics v_rows = row_count;
  reset role;
  if v_rows <> 1 then
    raise exception 'owner should be able to update transacoes row, affected %', v_rows;
  end if;
  select valor into v_val from transacoes where id = v_tx_a;
  if v_val is distinct from 501 then
    raise exception 'owner update of transacoes.valor did not take effect, got %', v_val;
  end if;

  -- DELETE: restricted admin denied -- 0 rows affected AND row still exists.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin_no, 'role', 'authenticated')::text, true);
  set local role authenticated;
  delete from transacoes where id = v_tx_a;
  get diagnostics v_rows = row_count;
  reset role;
  if v_rows <> 0 then
    raise exception 'restricted admin deleted % transacoes rows', v_rows;
  end if;
  if not exists (select 1 from transacoes where id = v_tx_a) then
    raise exception 'restricted admin deleted the transacoes row despite 0 reported rows';
  end if;

  -- DELETE: authorized admin succeeds (positive counterpart).
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin_ok, 'role', 'authenticated')::text, true);
  set local role authenticated;
  delete from transacoes where id = v_tx_a;
  get diagnostics v_rows = row_count;
  reset role;
  if v_rows <> 1 then
    raise exception 'authorized admin should be able to delete transacoes row, affected %', v_rows;
  end if;

  -- Cross-tenant regression: admin_ok (financial access, ws_a) must not
  -- reach ws_b's row on ANY of the four verbs.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin_ok, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_rows from transacoes where id = v_tx_b;
  reset role;
  if v_rows <> 0 then
    raise exception 'financial-access admin in ws_a must not SEE ws_b transacoes row, got %', v_rows;
  end if;

  v_ok := false;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin_ok, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into transacoes (user_id, conta_id, data, tipo, valor)
      values (v_admin_ok, v_ws_b, '2026-01-03', 'entrada', 1);
  exception when insufficient_privilege then
    v_ok := true;
  end;
  reset role;
  if not v_ok then
    raise exception 'financial-access admin in ws_a must not INSERT into ws_b transacoes';
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin_ok, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update transacoes set valor = 1 where id = v_tx_b;
  get diagnostics v_rows = row_count;
  reset role;
  if v_rows <> 0 then
    raise exception 'financial-access admin in ws_a updated % rows in ws_b transacoes', v_rows;
  end if;
  select valor into v_val from transacoes where id = v_tx_b;
  if v_val is distinct from 999 then
    raise exception 'cross-tenant transacoes update mutated ws_b row despite 0 reported rows, valor=%', v_val;
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin_ok, 'role', 'authenticated')::text, true);
  set local role authenticated;
  delete from transacoes where id = v_tx_b;
  get diagnostics v_rows = row_count;
  reset role;
  if v_rows <> 0 then
    raise exception 'financial-access admin in ws_a deleted % rows from ws_b transacoes', v_rows;
  end if;
  if not exists (select 1 from transacoes where id = v_tx_b) then
    raise exception 'cross-tenant transacoes delete removed ws_b row despite 0 reported rows';
  end if;

  raise notice '52_financial_enforcement: transacoes verb + cross-tenant checks passed';
end $$;
rollback;

-- =============================================================
-- 3. contratos: same shape as transacoes above (separate table, separate
--    set of four rewritten policies).
-- =============================================================
begin;
select et_grant_hosted_parity(ARRAY['membros', 'clientes']);
grant insert, update, delete on public.membros, public.clientes to anon, authenticated;
do $$
declare
  v_ws_a uuid; v_ws_b uuid;
  v_owner    uuid := gen_random_uuid();
  v_admin_ok uuid := gen_random_uuid();
  v_admin_no uuid := gen_random_uuid();
  v_ct_a bigint; v_ct_b bigint;
  v_rows bigint;
  v_val  numeric;
  v_ok   boolean;
begin
  v_ws_a := et_make_workspace('max');
  v_ws_b := et_make_workspace('max');

  insert into auth.users (id) values (v_owner), (v_admin_ok), (v_admin_no);
  insert into workspace_members (user_id, workspace_id, role) values
    (v_owner, v_ws_a, 'owner'),
    (v_admin_ok, v_ws_a, 'admin'),
    (v_admin_no, v_ws_a, 'admin');
  update workspace_members set can_see_financials = false
   where user_id = v_admin_no and workspace_id = v_ws_a;
  update profiles set conta_id = v_ws_a, active_workspace_id = v_ws_a
   where id in (v_owner, v_admin_ok, v_admin_no);

  insert into contratos (user_id, conta_id, titulo, data_inicio, data_fim, valor_total)
    values (v_owner, v_ws_a, 'Contrato A', '2026-01-01', '2026-12-31', 500)
    returning id into v_ct_a;
  insert into contratos (user_id, conta_id, titulo, data_inicio, data_fim, valor_total)
    values (v_owner, v_ws_b, 'Contrato B', '2026-01-01', '2026-12-31', 999)
    returning id into v_ct_b;

  -- SELECT: restricted admin sees 0 rows.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin_no, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_rows from contratos where id = v_ct_a;
  reset role;
  if coalesce(v_rows, 0) <> 0 then
    raise exception 'restricted admin should not see contratos row, got % rows', v_rows;
  end if;

  -- SELECT: authorized admin sees the real row (positive counterpart).
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin_ok, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select valor_total, count(*) over () into v_val, v_rows from contratos where id = v_ct_a;
  reset role;
  if coalesce(v_rows, 0) <> 1 then
    raise exception 'authorized admin should see contratos row, got % rows', v_rows;
  end if;
  if v_val is distinct from 500 then
    raise exception 'authorized admin should read contratos.valor_total=500, got %', v_val;
  end if;

  -- INSERT: restricted admin denied.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin_no, 'role', 'authenticated')::text, true);
  v_ok := false;
  set local role authenticated;
  begin
    insert into contratos (user_id, conta_id, titulo, data_inicio, data_fim, valor_total)
      values (v_admin_no, v_ws_a, 'Blocked', '2026-01-01', '2026-12-31', 1);
  exception when insufficient_privilege then
    v_ok := true;
  end;
  reset role;
  if not v_ok then
    raise exception 'restricted admin must be denied INSERT on contratos';
  end if;

  -- INSERT: authorized admin succeeds (positive counterpart).
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin_ok, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into contratos (user_id, conta_id, titulo, data_inicio, data_fim, valor_total)
    values (v_admin_ok, v_ws_a, 'Allowed', '2026-01-01', '2026-12-31', 42);
  reset role;
  select count(*) into v_rows from contratos where conta_id = v_ws_a and valor_total = 42;
  if v_rows <> 1 then
    raise exception 'authorized admin insert into contratos should have succeeded';
  end if;

  -- UPDATE: restricted admin denied -- 0 rows affected AND data unchanged.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin_no, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update contratos set valor_total = 1 where id = v_ct_a;
  get diagnostics v_rows = row_count;
  reset role;
  if v_rows <> 0 then
    raise exception 'restricted admin updated % contratos rows', v_rows;
  end if;
  select valor_total into v_val from contratos where id = v_ct_a;
  if v_val is distinct from 500 then
    raise exception 'restricted admin mutated contratos row despite 0 reported rows, valor_total=%', v_val;
  end if;

  -- UPDATE: owner succeeds (positive counterpart).
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update contratos set valor_total = 501 where id = v_ct_a;
  get diagnostics v_rows = row_count;
  reset role;
  if v_rows <> 1 then
    raise exception 'owner should be able to update contratos row, affected %', v_rows;
  end if;
  select valor_total into v_val from contratos where id = v_ct_a;
  if v_val is distinct from 501 then
    raise exception 'owner update of contratos.valor_total did not take effect, got %', v_val;
  end if;

  -- DELETE: restricted admin denied -- 0 rows affected AND row still exists.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin_no, 'role', 'authenticated')::text, true);
  set local role authenticated;
  delete from contratos where id = v_ct_a;
  get diagnostics v_rows = row_count;
  reset role;
  if v_rows <> 0 then
    raise exception 'restricted admin deleted % contratos rows', v_rows;
  end if;
  if not exists (select 1 from contratos where id = v_ct_a) then
    raise exception 'restricted admin deleted the contratos row despite 0 reported rows';
  end if;

  -- DELETE: authorized admin succeeds (positive counterpart).
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin_ok, 'role', 'authenticated')::text, true);
  set local role authenticated;
  delete from contratos where id = v_ct_a;
  get diagnostics v_rows = row_count;
  reset role;
  if v_rows <> 1 then
    raise exception 'authorized admin should be able to delete contratos row, affected %', v_rows;
  end if;

  -- Cross-tenant regression across all four contratos policies.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin_ok, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_rows from contratos where id = v_ct_b;
  reset role;
  if v_rows <> 0 then
    raise exception 'financial-access admin in ws_a must not SEE ws_b contratos row, got %', v_rows;
  end if;

  v_ok := false;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin_ok, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into contratos (user_id, conta_id, titulo, data_inicio, data_fim, valor_total)
      values (v_admin_ok, v_ws_b, 'Cross', '2026-01-01', '2026-12-31', 1);
  exception when insufficient_privilege then
    v_ok := true;
  end;
  reset role;
  if not v_ok then
    raise exception 'financial-access admin in ws_a must not INSERT into ws_b contratos';
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin_ok, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update contratos set valor_total = 1 where id = v_ct_b;
  get diagnostics v_rows = row_count;
  reset role;
  if v_rows <> 0 then
    raise exception 'financial-access admin in ws_a updated % rows in ws_b contratos', v_rows;
  end if;
  select valor_total into v_val from contratos where id = v_ct_b;
  if v_val is distinct from 999 then
    raise exception 'cross-tenant contratos update mutated ws_b row despite 0 reported rows, valor_total=%', v_val;
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin_ok, 'role', 'authenticated')::text, true);
  set local role authenticated;
  delete from contratos where id = v_ct_b;
  get diagnostics v_rows = row_count;
  reset role;
  if v_rows <> 0 then
    raise exception 'financial-access admin in ws_a deleted % rows from ws_b contratos', v_rows;
  end if;
  if not exists (select 1 from contratos where id = v_ct_b) then
    raise exception 'cross-tenant contratos delete removed ws_b row despite 0 reported rows';
  end if;

  raise notice '52_financial_enforcement: contratos verb + cross-tenant checks passed';
end $$;
rollback;

-- =============================================================
-- 4. Agent hardening: an agent cannot select custo_mensal/valor_mensal, and
--    cannot INSERT/UPDATE/DELETE transacoes/contratos -- all of which an
--    agent COULD do before this migration (only SELECT carried an agent
--    predicate, from 20260404). Positive counterpart: the agent is not
--    over-blocked on an ordinary allowlisted column.
--
-- The role='agent' branch of can_see_financials()'s CASE always returns
-- false; the CHECK (role IN ('owner','admin','agent')) constraint on
-- workspace_members means an "unknown" role is rejected at insert time, so
-- that branch of the predicate is a source-level contract, not something an
-- integration test can reach -- it is not exercised here or anywhere else in
-- this suite.
-- =============================================================
begin;
select et_grant_hosted_parity(ARRAY['membros', 'clientes']);
grant insert, update, delete on public.membros, public.clientes to anon, authenticated;
do $$
declare
  v_ws uuid;
  v_agent uuid := gen_random_uuid();
  v_rows  bigint;
  v_val   numeric;
  v_ok    boolean;
  v_mid   bigint;
begin
  v_ws := et_make_workspace('max');
  insert into auth.users (id) values (v_agent);
  insert into workspace_members (user_id, workspace_id, role) values (v_agent, v_ws, 'agent');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_agent;

  insert into membros (user_id, conta_id, nome, cargo, tipo, custo_mensal, avatar_url)
    values (v_agent, v_ws, 'AgentSeen', 'X', 'clt', 321, '') returning id into v_mid;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_agent, 'role', 'authenticated')::text, true);

  -- Positive counterpart: agent still reads an ordinary allowlisted column.
  v_ok := true;
  set local role authenticated;
  begin
    perform nome from membros where id = v_mid;
  exception when insufficient_privilege then
    v_ok := false;
  end;
  reset role;
  if not v_ok then
    raise exception 'agent should still be able to select membros.nome';
  end if;

  -- Agent denied on the protected columns.
  v_ok := true;
  set local role authenticated;
  begin
    perform custo_mensal from membros where id = v_mid;
  exception when insufficient_privilege then
    v_ok := false;
  end;
  reset role;
  if v_ok then
    raise exception 'agent must NOT be able to select membros.custo_mensal';
  end if;

  v_ok := true;
  set local role authenticated;
  begin
    perform valor_mensal from clientes limit 1;
  exception when insufficient_privilege then
    v_ok := false;
  end;
  reset role;
  if v_ok then
    raise exception 'agent must NOT be able to select clientes.valor_mensal';
  end if;

  -- Agent cannot write transacoes/contratos on any of the three write verbs
  -- (SELECT-blocking for agents already existed pre-migration; this is the
  -- NEW restriction).
  set local role authenticated;
  v_ok := false;
  begin
    insert into transacoes (user_id, conta_id, data, tipo, valor)
      values (v_agent, v_ws, '2026-01-01', 'entrada', 1);
  exception when insufficient_privilege then
    v_ok := true;
  end;
  reset role;
  if not v_ok then
    raise exception 'agent must be denied INSERT on transacoes';
  end if;

  set local role authenticated;
  v_ok := false;
  begin
    insert into contratos (user_id, conta_id, titulo, data_inicio, data_fim, valor_total)
      values (v_agent, v_ws, 'AgentBlocked', '2026-01-01', '2026-12-31', 1);
  exception when insufficient_privilege then
    v_ok := true;
  end;
  reset role;
  if not v_ok then
    raise exception 'agent must be denied INSERT on contratos';
  end if;

  -- UPDATE/DELETE: seed rows as postgres, then confirm the agent's write is
  -- silently filtered (0 rows) and the data is unchanged.
  declare
    v_tx bigint; v_ct bigint;
  begin
    insert into transacoes (user_id, conta_id, data, tipo, valor)
      values (v_agent, v_ws, '2026-01-01', 'entrada', 700) returning id into v_tx;
    insert into contratos (user_id, conta_id, titulo, data_inicio, data_fim, valor_total)
      values (v_agent, v_ws, 'AgentSeeded', '2026-01-01', '2026-12-31', 700) returning id into v_ct;

    set local role authenticated;
    update transacoes set valor = 1 where id = v_tx;
    get diagnostics v_rows = row_count;
    reset role;
    if v_rows <> 0 then
      raise exception 'agent updated % transacoes rows', v_rows;
    end if;
    select valor into v_val from transacoes where id = v_tx;
    if v_val is distinct from 700 then
      raise exception 'agent mutated transacoes row despite 0 reported rows, valor=%', v_val;
    end if;

    set local role authenticated;
    delete from contratos where id = v_ct;
    get diagnostics v_rows = row_count;
    reset role;
    if v_rows <> 0 then
      raise exception 'agent deleted % contratos rows', v_rows;
    end if;
    if not exists (select 1 from contratos where id = v_ct) then
      raise exception 'agent deleted the contratos row despite 0 reported rows';
    end if;
  end;

  raise notice '52_financial_enforcement: agent-hardening checks passed';
end $$;
rollback;

-- =============================================================
-- 5. Write guards on membros.custo_mensal / clientes.valor_mensal.
-- =============================================================
begin;
select et_grant_hosted_parity(ARRAY['membros', 'clientes']);
grant insert, update, delete on public.membros, public.clientes to anon, authenticated;
do $$
declare
  v_ws uuid;
  v_owner    uuid := gen_random_uuid();
  v_admin_no uuid := gen_random_uuid();
  v_mid bigint;
  v_cid bigint;
  v_mid_val bigint;
  v_cid_val bigint;
  v_val  numeric;
  v_nome text;
  v_rows bigint;
  v_ok   boolean;
begin
  v_ws := et_make_workspace('max');
  insert into auth.users (id) values (v_owner), (v_admin_no);
  insert into workspace_members (user_id, workspace_id, role) values
    (v_owner, v_ws, 'owner'),
    (v_admin_no, v_ws, 'admin');
  update workspace_members set can_see_financials = false
   where user_id = v_admin_no and workspace_id = v_ws;
  update profiles set conta_id = v_ws, active_workspace_id = v_ws
   where id in (v_owner, v_admin_no);

  -- Seed a SECOND row per table carrying a REAL financial value, inserted
  -- directly as postgres (current_user IN ('postgres','supabase_admin')
  -- bypasses the guard -- see guard_financial_write() -- so this seeding
  -- step itself proves nothing about the guard; it only sets up state).
  --
  -- Why this row is needed at all: v_mid/v_cid below are seeded through the
  -- restricted-admin "INSERT carrying NULL succeeds" step, so
  -- custo_mensal/valor_mensal stay NULL for their entire lifetime in this
  -- block. A non-financial UPDATE against a permanently-NULL column can
  -- never distinguish the correct guard (`new_val IS DISTINCT FROM
  -- old_val`) from the over-broad, previously-shipped variant (`new_val IS
  -- NOT NULL`) -- both evaluate to false when the column never carries a
  -- value, so a test built only on v_mid/v_cid would pass even against a
  -- guard that rejects every edit to a member/client that actually has a
  -- retainer. v_mid_val/v_cid_val close that hole.
  insert into membros (user_id, conta_id, nome, cargo, tipo, avatar_url, custo_mensal)
    values (v_owner, v_ws, 'HasValue', 'X', 'clt', '', 5000)
    returning id into v_mid_val;
  insert into clientes (user_id, conta_id, nome, sigla, cor, valor_mensal)
    values (v_owner, v_ws, 'HasValueCli', 'HV', '#000', 3000)
    returning id into v_cid_val;

  -- restricted admin INSERT carrying NULL succeeds (no change to guard).
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin_no, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into membros (user_id, conta_id, nome, cargo, tipo, avatar_url, custo_mensal)
    values (v_admin_no, v_ws, 'Guarded', 'X', 'clt', '', null)
    returning id into v_mid;
  reset role;
  if v_mid is null then
    raise exception 'restricted admin insert of membros with NULL custo_mensal should have succeeded';
  end if;

  -- restricted admin INSERT carrying a financial value fails.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin_no, 'role', 'authenticated')::text, true);
  v_ok := false;
  set local role authenticated;
  begin
    insert into membros (user_id, conta_id, nome, cargo, tipo, avatar_url, custo_mensal)
      values (v_admin_no, v_ws, 'Blocked', 'X', 'clt', '', 999);
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'financial_access_denied' then raise; end if;
    v_ok := true;
  end;
  reset role;
  if not v_ok then
    raise exception 'restricted admin insert of membros carrying a financial value must be denied';
  end if;

  -- restricted admin UPDATE of a non-financial field succeeds (NULL-row case).
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin_no, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update membros set nome = 'Renamed' where id = v_mid;
  get diagnostics v_rows = row_count;
  reset role;
  if v_rows <> 1 then
    raise exception 'restricted admin should be able to rename a member, affected %', v_rows;
  end if;
  select nome into v_nome from membros where id = v_mid;
  if v_nome is distinct from 'Renamed' then
    raise exception 'restricted admin non-financial update did not take effect, got %', v_nome;
  end if;

  -- restricted admin UPDATE of a non-financial field on a row that HAS a
  -- real custo_mensal succeeds, and the financial value is left untouched.
  -- This is the case the NULL-row test above cannot exercise: a restricted
  -- admin changing a phone number / name on a member who actually has a
  -- retainer -- the single most common edit this feature must not break.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin_no, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update membros set nome = 'RenamedHasValue' where id = v_mid_val;
  get diagnostics v_rows = row_count;
  reset role;
  if v_rows <> 1 then
    raise exception 'restricted admin should be able to rename a member with a real custo_mensal, affected %', v_rows;
  end if;
  select nome, custo_mensal into v_nome, v_val from membros where id = v_mid_val;
  if v_nome is distinct from 'RenamedHasValue' then
    raise exception 'restricted admin non-financial update (real-value row) did not take effect, got %', v_nome;
  end if;
  if v_val is distinct from 5000 then
    raise exception 'restricted admin non-financial update mutated custo_mensal on a real-value row, got %', v_val;
  end if;

  -- authorized owner CAN change the financial value (positive counterpart).
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update membros set custo_mensal = 777 where id = v_mid;
  get diagnostics v_rows = row_count;
  reset role;
  if v_rows <> 1 then
    raise exception 'owner should be able to change custo_mensal, affected %', v_rows;
  end if;
  select custo_mensal into v_val from membros where id = v_mid;
  if v_val is distinct from 777 then
    raise exception 'owner custo_mensal update did not take effect, got %', v_val;
  end if;

  -- Mirror the same NULL/value/non-financial/authorized shape on clientes.valor_mensal.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin_no, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into clientes (user_id, conta_id, nome, sigla, cor, valor_mensal)
    values (v_admin_no, v_ws, 'GuardedCli', 'GC', '#000', null)
    returning id into v_cid;
  reset role;
  if v_cid is null then
    raise exception 'restricted admin insert of clientes with NULL valor_mensal should have succeeded';
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin_no, 'role', 'authenticated')::text, true);
  v_ok := false;
  set local role authenticated;
  begin
    update clientes set valor_mensal = 999 where id = v_cid;
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'financial_access_denied' then raise; end if;
    v_ok := true;
  end;
  reset role;
  if not v_ok then
    raise exception 'restricted admin update of clientes.valor_mensal must be denied';
  end if;
  select valor_mensal into v_val from clientes where id = v_cid;
  if v_val is not null then
    raise exception 'restricted admin mutated clientes.valor_mensal despite the raised exception, got %', v_val;
  end if;

  -- restricted admin UPDATE of a non-financial field on a client that HAS a
  -- real valor_mensal succeeds, and the financial value is left untouched.
  -- Same rationale as the membros case above: clientes has the identical
  -- hole, and this is the single most common edit this feature must not
  -- break (e.g. a restricted admin fixing a client's phone number).
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin_no, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update clientes set nome = 'RenamedHasValueCli' where id = v_cid_val;
  get diagnostics v_rows = row_count;
  reset role;
  if v_rows <> 1 then
    raise exception 'restricted admin should be able to rename a client with a real valor_mensal, affected %', v_rows;
  end if;
  select nome, valor_mensal into v_nome, v_val from clientes where id = v_cid_val;
  if v_nome is distinct from 'RenamedHasValueCli' then
    raise exception 'restricted admin non-financial update (real-value row) did not take effect, got %', v_nome;
  end if;
  if v_val is distinct from 3000 then
    raise exception 'restricted admin non-financial update mutated valor_mensal on a real-value row, got %', v_val;
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update clientes set valor_mensal = 321 where id = v_cid;
  get diagnostics v_rows = row_count;
  reset role;
  if v_rows <> 1 then
    raise exception 'owner should be able to change valor_mensal, affected %', v_rows;
  end if;
  select valor_mensal into v_val from clientes where id = v_cid;
  if v_val is distinct from 321 then
    raise exception 'owner valor_mensal update did not take effect, got %', v_val;
  end if;

  -- Anonymous does NOT get the trusted bypass: an insert carrying a
  -- financial value must fail for anon too -- whether via the guard's own
  -- denial or via lacking EXECUTE on can_see_financials(), the "postgres" /
  -- "service_role" bypass branch must not fire just because the caller is
  -- unauthenticated.
  --
  -- The specific failure matters, not just "some exception was raised".
  -- membros_insert (20260315_rls_security_audit.sql:164) already denies anon
  -- outright via a NULL get_my_conta_id(), so even a guard that silently
  -- handed anon the trusted bypass -- the exact SECURITY DEFINER defect this
  -- guard once had, which made current_user read as the function owner for
  -- every caller, skipping the can_see_financials() call entirely -- would
  -- still fail this INSERT via that unrelated RLS policy (a DIFFERENT
  -- message: "new row violates row-level security policy..."), and a bare
  -- `exception when others` would count that as a pass without the guard
  -- ever having done anything. Asserting the guard's own 'financial_access_
  -- denied' (P0001, same sentinel asserted for the restricted-admin case
  -- above) proves the guard actually evaluated can_see_financials() and got
  -- a non-true result, rather than bypassing the check and having some
  -- unrelated policy deny the write instead.
  --
  -- (Note: anon's own lack of EXECUTE on can_see_financials() -- REVOKEd by
  -- Migration A -- does NOT surface here as a 42501 "permission denied for
  -- function" the way it would in a fresh session. Earlier in this same
  -- do-block, can_see_financials() was already called as `authenticated`,
  -- which DOES hold EXECUTE; plpgsql caches that call as a "simple
  -- expression" plan and reuses it for later invocations in the same
  -- transaction without re-checking EXECUTE, so by the time this anon call
  -- runs, it actually reaches the function body and gets a real NULL/false
  -- result -- which the guard then correctly treats as "not authorized".)
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  v_ok := false;
  set local role anon;
  begin
    insert into membros (user_id, conta_id, nome, cargo, tipo, avatar_url, custo_mensal)
      values (v_owner, v_ws, 'AnonRow', 'X', 'clt', '', 555);
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'financial_access_denied' then raise; end if;
    v_ok := true;
  end;
  reset role;
  if not v_ok then
    raise exception 'anonymous insert of membros carrying a financial value must be denied by the guard (financial_access_denied)';
  end if;
  if exists (select 1 from membros where nome = 'AnonRow') then
    raise exception 'anonymous insert must not have created a row despite being denied';
  end if;

  raise notice '52_financial_enforcement: write-guard checks passed (membros + clientes, incl. anon)';
end $$;
rollback;

-- =============================================================
-- 6. Allowlist dependants still work: objects whose policies/definitions
--    sub-select clientes columns must keep functioning against the
--    column-level grant, not just the base table itself.
-- =============================================================
begin;
select et_grant_hosted_parity(ARRAY['membros', 'clientes']);
grant insert, update, delete on public.membros, public.clientes to anon, authenticated;
do $$
declare
  v_ws uuid;
  v_owner uuid := gen_random_uuid();
  v_cli bigint;
  v_acc uuid;
  v_rows bigint;
begin
  v_ws := et_make_workspace('max');
  insert into auth.users (id) values (v_owner);
  insert into workspace_members (user_id, workspace_id, role) values (v_owner, v_ws, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_owner;

  insert into clientes (user_id, conta_id, nome, sigla, cor, status)
    values (v_owner, v_ws, 'Cliente Dep', 'CD', '#000', 'ativo') returning id into v_cli;
  insert into instagram_accounts (client_id, instagram_user_id, username, authorization_status)
    values (v_cli, '123456', 'depuser', 'active') returning id into v_acc;
  insert into hub_brand (cliente_id) values (v_cli);

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);

  set local role authenticated;
  select count(*) into v_rows from instagram_accounts where id = v_acc;
  reset role;
  if v_rows <> 1 then
    raise exception 'authenticated should still SELECT instagram_accounts (policy sub-selects clientes.id/conta_id), got %', v_rows;
  end if;

  set local role authenticated;
  select count(*) into v_rows from hub_brand where cliente_id = v_cli;
  reset role;
  if v_rows <> 1 then
    raise exception 'authenticated should still SELECT hub_brand (policy sub-selects clientes.id/conta_id), got %', v_rows;
  end if;

  set local role authenticated;
  select count(*) into v_rows from get_client_health_aggregates(28) where client_id = v_cli;
  reset role;
  if v_rows <> 1 then
    raise exception 'authenticated should still execute get_client_health_aggregates() (selects clientes.id/nome/sigla/cor/status), got %', v_rows;
  end if;

  raise notice '52_financial_enforcement: allowlist-dependent objects (instagram_accounts, hub_brand, get_client_health_aggregates) still work';
end $$;
rollback;
