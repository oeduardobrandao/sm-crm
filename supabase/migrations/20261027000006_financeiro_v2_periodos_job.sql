SET LOCAL lock_timeout = '5s';

-- Financeiro v2: period close job, reopen and close (spec
-- docs/superpowers/specs/2026-10-23-financeiro-rentabilidade-design.md, "Effective
-- dates and snapshots").
--
-- Periods close at 00:00 America/Sao_Paulo. financeiro_rolar_periodos runs hourly
-- (pg_cron, below): an ended 'aberto' latest period is frozen (snapshot =
-- _financeiro_calcular, periodo.status overlaid to 'fechado'), the next period is
-- opened, and the versions effective at the new open period are written through to
-- the legacy columns. A late run catches up period by period, in order; a second run
-- finds nothing to do. Each workspace runs in its own subtransaction, so one
-- workspace's failure is logged and the others still roll.
--
-- financeiro_periodo_reabrir / financeiro_periodo_fechar let an owner or admin with
-- financeiro edit rights correct a closed period: fechado -> reaberto (the old
-- snapshot is kept until the re-close; edits effective from the period are accepted
-- meanwhile, see _financeiro_inicio_editavel) -> fechado with a fresh snapshot. The
-- job never closes a reaberto period.
--
-- Every path that changes a period's status takes the per-workspace transaction
-- advisory lock _financeiro_lock_key(conta) (20261027000004) exclusively, so a manual
-- reopen cannot interleave with a roll and two overlapping cron runs cannot open the
-- same period twice (the (conta_id, inicio) primary key is the backstop). Every v2
-- write RPC and the legacy trigger take the same key shared before their editable /
-- latest-aberto checks, so no write lands a version inside a period that is closing.
-- The roll carries SET lock_timeout = '5s': a workspace blocked on a lock fails with
-- 55P03 into its own EXCEPTION block instead of stalling the whole job.
--
-- Also: financeiro_rentabilidade overlays the row's real status on a returned
-- snapshot (ruling R5); the rest of its body is unchanged from 20261027000003.

-- ===========================================================================
-- Close job (service_role / pg_cron only)
-- ===========================================================================

-- p_hoje exists for tests; NULL = today in Sao Paulo. For each seeded workspace,
-- loop on the latest period while it has ended (p_hoje >= fim): close it when it is
-- 'aberto' (a 'reaberto' or already 'fechado' latest row is left as it is), then
-- insert the next one (inicio = previous fim, fim from the current periodo_dia,
-- transicao when inicio is not on periodo_dia). After the loop, the versions
-- effective at the newest inserted period (the latest 'aberto' row) go to the legacy
-- columns; a closed or reopened period is never synced. A seeded workspace with no
-- period row is skipped (the seed always creates one).
CREATE OR REPLACE FUNCTION public.financeiro_rolar_periodos(p_hoje date DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '5s'
AS $$
DECLARE
  v_hoje   date := coalesce(p_hoje, (now() AT TIME ZONE 'America/Sao_Paulo')::date);
  v_conta  uuid;
  v_dia    int;
  v_inicio date;
  v_fim    date;
  v_status text;
  v_novo   date;
BEGIN
  FOR v_conta IN
    SELECT c.conta_id FROM public.financeiro_config c WHERE c.seeded_at IS NOT NULL ORDER BY c.conta_id
  LOOP
    BEGIN
      PERFORM pg_advisory_xact_lock(public._financeiro_lock_key(v_conta));

      SELECT c.periodo_dia INTO v_dia FROM public.financeiro_config c WHERE c.conta_id = v_conta;
      v_dia := coalesce(v_dia, 1);
      v_novo := NULL;

      LOOP
        SELECT p.inicio, p.fim, p.status INTO v_inicio, v_fim, v_status
          FROM public.financeiro_periodos p
         WHERE p.conta_id = v_conta
         ORDER BY p.inicio DESC
         LIMIT 1;
        EXIT WHEN NOT FOUND OR v_hoje < v_fim;

        IF v_status = 'aberto' THEN
          UPDATE public.financeiro_periodos p
             SET snapshot = jsonb_set(public._financeiro_calcular(v_conta, v_inicio), '{periodo,status}', '"fechado"'),
                 status = 'fechado',
                 fechado_em = now()
           WHERE p.conta_id = v_conta AND p.inicio = v_inicio;
        END IF;

        INSERT INTO public.financeiro_periodos (conta_id, inicio, fim, transicao)
        VALUES (v_conta, v_fim, public.financeiro_periodo_fim(v_fim, v_dia), extract(day FROM v_fim)::int <> v_dia);
        v_novo := v_fim;
      END LOOP;

      IF v_novo IS NOT NULL THEN
        PERFORM public._financeiro_sincronizar_legado(v_conta, v_novo);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'financeiro_rolar_periodos: workspace % failed: % %', v_conta, SQLSTATE, SQLERRM;
    END;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.financeiro_rolar_periodos(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.financeiro_rolar_periodos(date) TO service_role;

-- ===========================================================================
-- Reopen and close (authenticated)
-- ===========================================================================

-- Checks, in this order: feature_financial, feature_financeiro_v2 (P0001
-- feature_disabled:<flag>), has_permission('financeiro','editar') (42501), seeded
-- (P0001 nao_configurado), the caller's role in the active workspace is owner or
-- admin (42501 financial_access_denied; an agent whose custom role edits financeiro
-- still cannot reopen a period), then the period exists (P0002 not_found) and is in
-- the expected state (P0001 periodo_estado_invalido).

-- fechado -> reaberto. The snapshot stays until the re-close.
CREATE OR REPLACE FUNCTION public.financeiro_periodo_reabrir(p_inicio date)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conta  uuid := public.get_my_conta_id();
  v_role   text;
  v_status text;
BEGIN
  IF public.effective_plan_feature(v_conta, 'feature_financial') IS NOT TRUE THEN
    RAISE EXCEPTION 'feature_disabled:feature_financial' USING ERRCODE = 'P0001';
  END IF;
  IF public.effective_plan_feature(v_conta, 'feature_financeiro_v2') IS NOT TRUE THEN
    RAISE EXCEPTION 'feature_disabled:feature_financeiro_v2' USING ERRCODE = 'P0001';
  END IF;
  IF public.has_permission('financeiro', 'editar') IS NOT TRUE THEN
    RAISE EXCEPTION 'financial_access_denied' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.financeiro_config c WHERE c.conta_id = v_conta AND c.seeded_at IS NOT NULL) THEN
    RAISE EXCEPTION 'nao_configurado' USING ERRCODE = 'P0001';
  END IF;
  SELECT wm.role::text INTO v_role FROM public.workspace_members wm
   WHERE wm.workspace_id = v_conta AND wm.user_id = auth.uid();
  IF v_role IS NULL OR v_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'financial_access_denied' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(public._financeiro_lock_key(v_conta));
  SELECT p.status INTO v_status FROM public.financeiro_periodos p
   WHERE p.conta_id = v_conta AND p.inicio = p_inicio
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_status <> 'fechado' THEN
    RAISE EXCEPTION 'periodo_estado_invalido' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.financeiro_periodos p SET status = 'reaberto'
   WHERE p.conta_id = v_conta AND p.inicio = p_inicio;

  INSERT INTO public.audit_log (conta_id, actor_user_id, action, resource_type, resource_id, metadata)
  VALUES (v_conta, auth.uid(), 'financeiro-periodo-reabrir', 'financeiro_periodo', p_inicio::text,
          jsonb_build_object('status_anterior', v_status));
END;
$$;

-- reaberto -> fechado, with a fresh snapshot (periodo.status overlaid to 'fechado').
CREATE OR REPLACE FUNCTION public.financeiro_periodo_fechar(p_inicio date)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conta  uuid := public.get_my_conta_id();
  v_role   text;
  v_status text;
BEGIN
  IF public.effective_plan_feature(v_conta, 'feature_financial') IS NOT TRUE THEN
    RAISE EXCEPTION 'feature_disabled:feature_financial' USING ERRCODE = 'P0001';
  END IF;
  IF public.effective_plan_feature(v_conta, 'feature_financeiro_v2') IS NOT TRUE THEN
    RAISE EXCEPTION 'feature_disabled:feature_financeiro_v2' USING ERRCODE = 'P0001';
  END IF;
  IF public.has_permission('financeiro', 'editar') IS NOT TRUE THEN
    RAISE EXCEPTION 'financial_access_denied' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.financeiro_config c WHERE c.conta_id = v_conta AND c.seeded_at IS NOT NULL) THEN
    RAISE EXCEPTION 'nao_configurado' USING ERRCODE = 'P0001';
  END IF;
  SELECT wm.role::text INTO v_role FROM public.workspace_members wm
   WHERE wm.workspace_id = v_conta AND wm.user_id = auth.uid();
  IF v_role IS NULL OR v_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'financial_access_denied' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(public._financeiro_lock_key(v_conta));
  SELECT p.status INTO v_status FROM public.financeiro_periodos p
   WHERE p.conta_id = v_conta AND p.inicio = p_inicio
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_status <> 'reaberto' THEN
    RAISE EXCEPTION 'periodo_estado_invalido' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.financeiro_periodos p
     SET snapshot = jsonb_set(public._financeiro_calcular(v_conta, p_inicio), '{periodo,status}', '"fechado"'),
         status = 'fechado',
         fechado_em = now()
   WHERE p.conta_id = v_conta AND p.inicio = p_inicio;

  INSERT INTO public.audit_log (conta_id, actor_user_id, action, resource_type, resource_id, metadata)
  VALUES (v_conta, auth.uid(), 'financeiro-periodo-fechar', 'financeiro_periodo', p_inicio::text,
          jsonb_build_object('status_anterior', v_status));
END;
$$;

REVOKE ALL ON FUNCTION public.financeiro_periodo_reabrir(date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.financeiro_periodo_fechar(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.financeiro_periodo_reabrir(date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.financeiro_periodo_fechar(date) TO authenticated, service_role;

-- ===========================================================================
-- financeiro_rentabilidade: status overlay on a returned snapshot (ruling R5)
-- ===========================================================================

-- Same contract as 20261027000003. The profitability of a period for the caller's
-- workspace. p_inicio NULL = the latest period that is not fechado, else the latest
-- one (and, with no period row at all, the period containing today). A fechado period
-- returns its snapshot with periodo.status set to the row's status; any other is
-- computed live (a reaberto period reports 'reaberto', _financeiro_calcular reads the
-- row). A start that is neither a period row nor a projected start of
-- financeiro_periodos_editaveis() is periodo_invalido.
CREATE OR REPLACE FUNCTION public.financeiro_rentabilidade(p_inicio date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conta    uuid := public.get_my_conta_id();
  v_seeded   timestamptz;
  v_dia      int;
  v_inicio   date;
  v_status   text;
  v_snapshot jsonb;
BEGIN
  IF public.effective_plan_feature(v_conta, 'feature_financial') IS NOT TRUE THEN
    RAISE EXCEPTION 'feature_disabled:feature_financial' USING ERRCODE = 'P0001';
  END IF;
  IF public.effective_plan_feature(v_conta, 'feature_financeiro_v2') IS NOT TRUE THEN
    RAISE EXCEPTION 'feature_disabled:feature_financeiro_v2' USING ERRCODE = 'P0001';
  END IF;
  IF public.can_see_financials() IS NOT TRUE THEN
    RAISE EXCEPTION 'financial_access_denied' USING ERRCODE = '42501';
  END IF;

  SELECT c.seeded_at, c.periodo_dia INTO v_seeded, v_dia
    FROM public.financeiro_config c WHERE c.conta_id = v_conta;
  IF v_seeded IS NULL THEN
    RETURN jsonb_build_object('seeded', false);
  END IF;

  IF p_inicio IS NULL THEN
    SELECT p.inicio INTO v_inicio
      FROM public.financeiro_periodos p
     WHERE p.conta_id = v_conta
     ORDER BY (p.status <> 'fechado') DESC, p.inicio DESC
     LIMIT 1;
    IF v_inicio IS NULL THEN
      v_inicio := public.financeiro_periodo_inicio_de((now() AT TIME ZONE 'America/Sao_Paulo')::date, v_dia);
    END IF;
  ELSE
    v_inicio := p_inicio;
  END IF;

  SELECT p.status, p.snapshot INTO v_status, v_snapshot
    FROM public.financeiro_periodos p WHERE p.conta_id = v_conta AND p.inicio = v_inicio;
  IF FOUND THEN
    IF v_status = 'fechado' THEN
      RETURN jsonb_set(v_snapshot, '{periodo,status}', to_jsonb(v_status));
    END IF;
  ELSIF p_inicio IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(public.financeiro_periodos_editaveis()) e
     WHERE (e->>'inicio')::date = p_inicio
  ) THEN
    RAISE EXCEPTION 'periodo_invalido' USING ERRCODE = 'P0001';
  END IF;

  RETURN public._financeiro_calcular(v_conta, v_inicio);
END;
$$;

REVOKE ALL ON FUNCTION public.financeiro_rentabilidade(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.financeiro_rentabilidade(date) TO authenticated, service_role;

-- ===========================================================================
-- Cron: hourly at minute 29
-- ===========================================================================
-- Minute 29 is used by no other job (checked against 20260925110001_stagger_cron_schedules.sql
-- and every later cron.schedule: the hourly jobs sit on 0/5/7/8/15, the */5 residues on
-- 0/1/2, the */15 residues on 3/4/9/13, the every-6h and daily jobs on 10/14/17/20/22/23/30/44/47). Hourly,
-- not daily: the run is idempotent, a period closes within the hour after 00:00 Sao
-- Paulo, and a failed run is retried an hour later. A failed run (the whole job, not
-- one workspace: those only RAISE WARNING) shows up in cron.job_run_details and
-- recent_cron_failures().
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'financeiro-v2-rolar-periodos') THEN
    PERFORM cron.unschedule('financeiro-v2-rolar-periodos');
  END IF;
END $$;

SELECT cron.schedule('financeiro-v2-rolar-periodos', '29 * * * *', $$SELECT public.financeiro_rolar_periodos()$$);

DO $$
DECLARE
  v_fn text;
BEGIN
  v_fn := 'public.financeiro_rolar_periodos(date)';
  IF has_function_privilege('authenticated', v_fn, 'EXECUTE')
     OR has_function_privilege('anon', v_fn, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION '%: grants are not service_role only', v_fn;
  END IF;
  FOREACH v_fn IN ARRAY ARRAY['public.financeiro_periodo_reabrir(date)',
                              'public.financeiro_periodo_fechar(date)',
                              'public.financeiro_rentabilidade(date)'] LOOP
    IF has_function_privilege('anon', v_fn, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', v_fn, 'EXECUTE')
       OR NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '%: grants are not authenticated + service_role', v_fn;
    END IF;
  END LOOP;
END
$$;

-- Rollback (by hand, in this order):
--   1. SELECT cron.unschedule('financeiro-v2-rolar-periodos');
--   2. Re-run the financeiro_rentabilidade definition of 20261027000003.
--   3. DROP FUNCTION financeiro_periodo_reabrir(date), financeiro_periodo_fechar(date),
--      financeiro_rolar_periodos(date);
