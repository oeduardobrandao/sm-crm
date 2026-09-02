\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Analytics de Fluxos rebuild (Fase 2, Task 3): suite for
-- 20260903000010_workflows_concluido_em (concluido_em column + trigger) and
-- 20260903000020_workflow_analytics_rpc (add_business_days, etapa_deadline,
-- get_workflow_analytics). Mirrors the 72 suite's skeleton: et_make_workspace,
-- auth.users + workspace_members + profiles for JWT identity via
-- request.jwt.claims, begin/do $$/rollback per section.
--
-- get_workflow_analytics is SECURITY INVOKER with an explicit conta_id filter
-- (via get_my_conta_id(), itself SECURITY DEFINER reading profiles), not an
-- RLS-dependent one -- so these run as plain postgres (superuser, bypasses
-- RLS) without needing `set local role authenticated`, same as most of 72's
-- sections. Only the grants section (6) touches role-scoped privileges, and
-- that is a catalog check (has_function_privilege), not an impersonation.
--
-- TRANSACTION-NOW() GOTCHA. now() is stable for the whole transaction (it is
-- transaction_timestamp(), not clock_timestamp()). Where a workflow's
-- concluido_em is stamped by the trigger's own `now()` inside the same
-- transaction as the RPC call, p_to must be strictly AFTER that now() or the
-- half-open `concluido_em < p_to` bound silently excludes the row. Sections
-- that rely on the trigger (3d) pad p_to forward; sections that set
-- concluido_em explicitly to a past timestamp (2, 5) do not need to.

-- =====================================================================
-- 1. Entitlement fail-closed: no feature -> NULL, feature -> non-NULL jsonb
-- =====================================================================
begin;
do $$
declare
  v_ws_free uuid; v_ws_pro uuid; v_user uuid := gen_random_uuid();
  v_result jsonb;
begin
  v_ws_free := et_make_workspace('free'); -- feature_analytics_reports = false (seed.sql)
  v_ws_pro := et_make_workspace('pro');   -- feature_analytics_reports = true
  insert into auth.users (id) values (v_user);
  insert into workspace_members (user_id, workspace_id, role) values (v_user, v_ws_free, 'owner');
  insert into workspace_members (user_id, workspace_id, role) values (v_user, v_ws_pro, 'owner');
  update profiles set conta_id = v_ws_free, active_workspace_id = v_ws_free where id = v_user;

  perform set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);

  -- 1a. active workspace on a plan without the feature -> NULL (fail-closed)
  select get_workflow_analytics(now() - interval '30 days', now()) into v_result;
  assert v_result is null, format('a workspace without feature_analytics_reports must yield NULL, got %s', v_result);

  -- 1b. switch active workspace to a plan with the feature -> non-null jsonb
  update profiles set conta_id = v_ws_pro, active_workspace_id = v_ws_pro where id = v_user;
  select get_workflow_analytics(now() - interval '30 days', now()) into v_result;
  assert v_result is not null, 'a workspace with feature_analytics_reports must yield a non-null result';
  assert jsonb_typeof(v_result) = 'object',
    format('entitled result must be a jsonb object, got %s', jsonb_typeof(v_result));
  assert v_result ? 'kpis', format('entitled result must carry a kpis key, got %s', v_result);

  raise notice 'PASS 73.1 entitlement fail-closed (NULL without the feature, jsonb with it)';
end $$;
rollback;

-- =====================================================================
-- 2. Tenant isolation: workspace A's call never counts workspace B's
--    workflows, and vice versa
-- =====================================================================
begin;
do $$
declare
  v_ws_a uuid; v_ws_b uuid; v_user_a uuid := gen_random_uuid(); v_user_b uuid := gen_random_uuid();
  v_cli_a bigint; v_cli_b bigint;
  v_result jsonb;
begin
  v_ws_a := et_make_workspace('pro');
  v_ws_b := et_make_workspace('pro');
  insert into auth.users (id) values (v_user_a), (v_user_b);
  insert into workspace_members (user_id, workspace_id, role) values (v_user_a, v_ws_a, 'owner');
  insert into workspace_members (user_id, workspace_id, role) values (v_user_b, v_ws_b, 'owner');
  update profiles set conta_id = v_ws_a, active_workspace_id = v_ws_a where id = v_user_a;
  update profiles set conta_id = v_ws_b, active_workspace_id = v_ws_b where id = v_user_b;

  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_user_a, v_ws_a, 'A', 'A', '#000') returning id into v_cli_a;
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_user_b, v_ws_b, 'B', 'B', '#000') returning id into v_cli_b;

  -- One concluded workflow per workspace, concluido_em set directly (INSERT
  -- bypasses the BEFORE UPDATE trigger) to a safely-in-the-past timestamp.
  insert into workflows (user_id, conta_id, cliente_id, titulo, status, concluido_em)
    values (v_user_a, v_ws_a, v_cli_a, 'WF-A', 'concluido', now() - interval '5 days');
  insert into workflows (user_id, conta_id, cliente_id, titulo, status, concluido_em)
    values (v_user_b, v_ws_b, v_cli_b, 'WF-B', 'concluido', now() - interval '5 days');

  perform set_config('request.jwt.claims', json_build_object('sub', v_user_a)::text, true);
  select get_workflow_analytics(now() - interval '30 days', now()) into v_result;
  assert (v_result->'kpis'->>'concluidos')::int = 1,
    format('workspace A must count only its own concluded workflow, got %s', v_result->'kpis');

  perform set_config('request.jwt.claims', json_build_object('sub', v_user_b)::text, true);
  select get_workflow_analytics(now() - interval '30 days', now()) into v_result;
  assert (v_result->'kpis'->>'concluidos')::int = 1,
    format('workspace B must count only its own concluded workflow, got %s', v_result->'kpis');

  raise notice 'PASS 73.2 tenant isolation (A never counts B''s workflows, and vice versa)';
end $$;
rollback;

-- =====================================================================
-- 3. Trigger behavior: stamps on -> concluido, clears on concluido -> ativo,
--    preserves on concluido -> arquivado; end-to-end archived semantics on
--    the RPC's kpis->>'concluidos'
-- =====================================================================
begin;
do $$
declare
  v_ws uuid; v_user uuid := gen_random_uuid();
  v_cli bigint; v_wf bigint;
  v_stamp_1 timestamptz; v_stamp_2 timestamptz;
begin
  v_ws := et_make_workspace('pro');
  insert into auth.users (id) values (v_user);
  insert into workspace_members (user_id, workspace_id, role) values (v_user, v_ws, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_user;
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_user, v_ws, 'C', 'C', '#000') returning id into v_cli;

  insert into workflows (user_id, conta_id, cliente_id, titulo, status)
    values (v_user, v_ws, v_cli, 'WF', 'ativo') returning id into v_wf;
  assert (select concluido_em from workflows where id = v_wf) is null,
    'a freshly-created ativo workflow must start with a NULL concluido_em';

  -- 3a. -> concluido stamps now()
  update workflows set status = 'concluido' where id = v_wf;
  select concluido_em into v_stamp_1 from workflows where id = v_wf;
  assert v_stamp_1 is not null, 'status -> concluido must stamp concluido_em';

  -- 3b. concluido -> ativo (reopen) clears it
  update workflows set status = 'ativo' where id = v_wf;
  assert (select concluido_em from workflows where id = v_wf) is null,
    'concluido -> ativo (reopen) must clear concluido_em back to NULL';

  -- 3c. concluido -> arquivado preserves the stamp
  update workflows set status = 'concluido' where id = v_wf;
  select concluido_em into v_stamp_1 from workflows where id = v_wf;
  update workflows set status = 'arquivado' where id = v_wf;
  select concluido_em into v_stamp_2 from workflows where id = v_wf;
  assert v_stamp_2 is not null and v_stamp_2 = v_stamp_1,
    format('concluido -> arquivado must preserve the stamp untouched, got %s then %s', v_stamp_1, v_stamp_2);

  raise notice 'PASS 73.3a-c trigger stamps on conclusion, clears on reopen, preserves on archive';
end $$;
rollback;

begin;
do $$
declare
  v_ws uuid; v_user uuid := gen_random_uuid();
  v_cli bigint;
  v_wf_arch_concl bigint; v_wf_arch_never bigint;
  v_result jsonb;
begin
  v_ws := et_make_workspace('pro');
  insert into auth.users (id) values (v_user);
  insert into workspace_members (user_id, workspace_id, role) values (v_user, v_ws, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_user;
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_user, v_ws, 'C', 'C', '#000') returning id into v_cli;

  -- Concluded (trigger stamps now()) then archived: concluido_em must survive
  -- the archive per the trigger's guarantee (Task 1), so the RPC's `wf` CTE
  -- ("status <> 'arquivado' OR concluido_em IS NOT NULL") must still include
  -- it, and `concluidos` must still count it.
  insert into workflows (user_id, conta_id, cliente_id, titulo, status)
    values (v_user, v_ws, v_cli, 'WF-ARCH-CONCL', 'ativo') returning id into v_wf_arch_concl;
  update workflows set status = 'concluido' where id = v_wf_arch_concl;
  update workflows set status = 'arquivado' where id = v_wf_arch_concl;
  assert (select status from workflows where id = v_wf_arch_concl) = 'arquivado'
     and (select concluido_em from workflows where id = v_wf_arch_concl) is not null,
    'setup sanity: archived-after-concluded workflow must be arquivado with a non-null stamp';

  -- Archived, never concluded: excluded from `wf` entirely (status =
  -- 'arquivado' AND concluido_em IS NULL), so it must contribute nothing.
  insert into workflows (user_id, conta_id, cliente_id, titulo, status)
    values (v_user, v_ws, v_cli, 'WF-ARCH-NEVER', 'arquivado') returning id into v_wf_arch_never;
  assert (select concluido_em from workflows where id = v_wf_arch_never) is null,
    'setup sanity: an archived workflow that was never concluded must have a NULL stamp';

  perform set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);
  -- p_to padded 1 minute past the transaction's now() so the trigger's own
  -- now() (equal to transaction now()) falls strictly inside [p_from, p_to).
  select get_workflow_analytics(now() - interval '30 days', now() + interval '1 minute') into v_result;

  assert (v_result->'kpis'->>'concluidos')::int = 1,
    format('a workflow concluded then archived must still count as concluido, got %s', v_result->'kpis');
  assert (v_result->'kpis'->>'ativos')::int = 0,
    format('neither archived workflow (concluded or not) may count as ativos, got %s', v_result->'kpis');

  raise notice 'PASS 73.3d archived semantics: concluded-then-archived counts, archived-never-concluded does not';
end $$;
rollback;

-- =====================================================================
-- 4. Deadline parity with the frontend (etapaPrazo.test.ts) -- 4
--    representative fixtures against etapa_deadline(..., 'America/Sao_Paulo')
-- =====================================================================
begin;
do $$
declare
  v_result timestamptz;
begin
  -- Fixture 1 ("prefers data_limite, preserving the local day"): data_limite
  -- wins and means "until the end of that local day" -- the RPC's own
  -- documented formula, ((data_limite + 1)::timestamp AT TIME ZONE tz).
  select etapa_deadline(date '2026-07-20', NULL, 3, 'corridos', 'America/Sao_Paulo') into v_result;
  assert v_result = ((date '2026-07-20' + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo'),
    format('data_limite must resolve to the end of that local day, got %s', v_result);

  -- Fixture 2 ("adds calendar days for corridos"): Wed 2026-07-15 10:00 BRT +
  -- 3 corridos = Sat 2026-07-18 10:00 BRT, exactly (no weekday skipping).
  select etapa_deadline(NULL, timestamptz '2026-07-15 10:00:00-03', 3, 'corridos', 'America/Sao_Paulo')
    into v_result;
  assert v_result = timestamptz '2026-07-18 10:00:00-03',
    format('corridos must add exactly N calendar days, got %s', v_result);

  -- Fixture 3 (brief's "Friday start + 2 dias uteis lands Tuesday"): Fri
  -- 2026-07-17 10:00 BRT + 2 uteis skips Sat/Sun -> Tue 2026-07-21 10:00 BRT.
  select etapa_deadline(NULL, timestamptz '2026-07-17 10:00:00-03', 2, 'uteis', 'America/Sao_Paulo')
    into v_result;
  assert v_result = timestamptz '2026-07-21 10:00:00-03',
    format('uteis must skip the weekend, got %s', v_result);

  -- Fixture 4 ("returns null when not started and no fixed date"): no
  -- data_limite and no iniciado_em -> NULL, regardless of prazo_dias/tipo.
  select etapa_deadline(NULL, NULL, 2, 'corridos', 'America/Sao_Paulo') into v_result;
  assert v_result is null,
    format('NULL data_limite + NULL iniciado_em must yield NULL, got %s', v_result);

  raise notice 'PASS 73.4 etapa_deadline parity with the frontend (4 fixtures)';
end $$;
rollback;

-- =====================================================================
-- 5. Semanas key includes the year (that week's Monday, YYYY-MM-DD)
-- =====================================================================
begin;
do $$
declare
  v_ws uuid; v_user uuid := gen_random_uuid();
  v_cli bigint; v_wf bigint;
  v_result jsonb;
begin
  v_ws := et_make_workspace('pro');
  insert into auth.users (id) values (v_user);
  insert into workspace_members (user_id, workspace_id, role) values (v_user, v_ws, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_user;
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_user, v_ws, 'C', 'C', '#000') returning id into v_cli;

  -- Concluded Wed 2026-07-15 10:00 BRT -- that ISO week's Monday is 2026-07-13.
  insert into workflows (user_id, conta_id, cliente_id, titulo, status, concluido_em)
    values (v_user, v_ws, v_cli, 'WF', 'concluido', timestamptz '2026-07-15 10:00:00-03')
    returning id into v_wf;

  perform set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);
  select get_workflow_analytics(timestamptz '2026-07-01 00:00:00-03', timestamptz '2026-08-01 00:00:00-03')
    into v_result;

  assert jsonb_array_length(v_result->'semanas') = 1,
    format('exactly one week bucket expected, got %s', v_result->'semanas');
  assert v_result->'semanas'->0->>'semana' = '2026-07-13',
    format('semana key must be that week''s Monday as YYYY-MM-DD, got %s', v_result->'semanas'->0->>'semana');
  assert (v_result->'semanas'->0->>'concluidos')::int = 1,
    format('the semana bucket must count the one concluido workflow, got %s', v_result->'semanas'->0);

  raise notice 'PASS 73.5 semanas key includes the year (Monday YYYY-MM-DD)';
end $$;
rollback;

-- =====================================================================
-- 6. Grants: anon has no EXECUTE on any of the three functions;
--    authenticated and service_role do
-- =====================================================================
begin;
do $$
begin
  assert has_function_privilege(
      'authenticated',
      'public.get_workflow_analytics(timestamptz,timestamptz,text,bigint,bigint,bigint)', 'EXECUTE') = true,
    'authenticated must be able to call get_workflow_analytics';
  assert has_function_privilege(
      'anon',
      'public.get_workflow_analytics(timestamptz,timestamptz,text,bigint,bigint,bigint)', 'EXECUTE') = false,
    'anon must NOT be able to call get_workflow_analytics';
  assert has_function_privilege(
      'service_role',
      'public.get_workflow_analytics(timestamptz,timestamptz,text,bigint,bigint,bigint)', 'EXECUTE') = true,
    'service_role must be able to call get_workflow_analytics';

  assert has_function_privilege(
      'authenticated', 'public.add_business_days(timestamptz,int,text)', 'EXECUTE') = true,
    'authenticated must be able to call add_business_days';
  assert has_function_privilege(
      'anon', 'public.add_business_days(timestamptz,int,text)', 'EXECUTE') = false,
    'anon must NOT be able to call add_business_days';

  assert has_function_privilege(
      'authenticated', 'public.etapa_deadline(date,timestamptz,int,text,text)', 'EXECUTE') = true,
    'authenticated must be able to call etapa_deadline';
  assert has_function_privilege(
      'anon', 'public.etapa_deadline(date,timestamptz,int,text,text)', 'EXECUTE') = false,
    'anon must NOT be able to call etapa_deadline';

  raise notice 'PASS 73.6 grants (anon revoked, authenticated/service_role retained)';
end $$;
rollback;

-- =====================================================================
-- 7. DoS guard: the NULL-tz short-circuit and the 3660-day cap both return
--    immediately instead of looping
-- =====================================================================
begin;
do $$
declare
  v_result timestamptz;
  v_started timestamptz := clock_timestamp();
  v_elapsed interval;
begin
  -- etapa_deadline's own top-of-CASE guard: a NULL p_tz short-circuits to
  -- NULL before ever reaching the 'uteis' branch's add_business_days call
  -- (which would otherwise hit add_business_days' own p_tz-IS-NULL guard --
  -- belt and braces, but this is the one the brief names explicitly).
  select etapa_deadline(NULL, now(), 1, 'uteis', NULL) into v_result;
  assert v_result is null, format('a NULL p_tz must short-circuit etapa_deadline to NULL, got %s', v_result);

  -- add_business_days' 3660-day (~10y) cap: a p_days above it returns NULL
  -- immediately rather than looping once per calendar day with no bound.
  select add_business_days(now(), 5000, 'America/Sao_Paulo') into v_result;
  assert v_result is null,
    format('p_days above the 3660-day cap must return NULL, got %s', v_result);

  -- A much larger p_days proves the cap is a genuine short-circuit and not
  -- merely "5000 iterations happens to be fast": if the cap regressed, this
  -- would loop for a very long time instead of returning within the
  -- assertion below.
  select add_business_days(now(), 2000000000, 'America/Sao_Paulo') into v_result;
  assert v_result is null,
    format('an extreme p_days must still short-circuit to NULL, got %s', v_result);

  v_elapsed := clock_timestamp() - v_started;
  assert v_elapsed < interval '3 seconds',
    format('DoS-guarded calls must return near-instantly, took %s', v_elapsed);

  raise notice 'PASS 73.7 DoS guard (NULL-tz short-circuit + 3660-day cap, no hang)';
end $$;
rollback;
