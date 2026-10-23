SET LOCAL lock_timeout = '5s';

-- Financeiro v2: write RPCs (spec docs/superpowers/specs/2026-10-23-financeiro-rentabilidade-design.md,
-- "Effective dates and snapshots" and "Paused and ended clients").
--
-- These are the only way the app changes fees, acordos, assignments, funcoes, the
-- config and the manual delivery counts (the v2 tables have no write policy).
-- Every effective-dated change takes a "vale a partir de" that must be an editable
-- period start (a reaberto period, the current aberto one or one of the next two
-- projected starts); a closed period is rejected with periodo_fechado. After a
-- client or acordo change, the versions effective at the current open period (the
-- latest 'aberto' row) are written through to the legacy columns
-- (clientes.valor_mensal / data_pagamento / status, membros.custo_mensal /
-- data_pagamento), so the old screens, CSV export and MCP keep reading the right
-- values. No open period row: the write-through is skipped.
--
-- Checks, in this order, in every public write RPC:
--   1. feature_financial, 2. feature_financeiro_v2  -> P0001 feature_disabled:<flag>
--   3. has_permission('financeiro','editar')        -> 42501 financial_access_denied
--      then pg_advisory_xact_lock_shared(_financeiro_lock_key(conta)): the period roll,
--      reabrir and fechar (20261025000006) and the seed take the same key exclusively,
--      so a write can't pass the editable check against a period that is closing
--      (the checks below run after the lock, each statement on a fresh snapshot)
--   4. financeiro_config.seeded_at set               -> P0001 nao_configurado
--      (not in financeiro_config_salvar, which may create the row unseeded)
--   5. the date is an editable start                 -> P0001 periodo_fechado
--   6. every id belongs to the caller's workspace    -> P0002 not_found
-- The id checks run before any write: the composite FKs would otherwise reject a
-- foreign id with a 23503 instead of not_found.

-- ===========================================================================
-- Internal helpers (service_role only)
-- ===========================================================================

-- The per-workspace advisory lock key shared by every path that changes or depends
-- on the period rows. Exclusive: financeiro_seed, financeiro_rolar_periodos,
-- financeiro_periodo_reabrir / _fechar. Shared: every v2 write RPC and the legacy
-- trigger. One definition so the key can't drift between them.
CREATE OR REPLACE FUNCTION public._financeiro_lock_key(p_conta uuid)
RETURNS bigint
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT hashtext('financeiro_rolar:' || p_conta::text)::bigint;
$$;

-- Is p_inicio one of financeiro_periodos_editaveis() for p_conta? Same rule, without
-- the auth checks (the write RPCs have already run theirs): every reaberto row, the
-- latest aberto row, and the next two projected starts, which begin at the newest
-- row's fim (or at the period containing today, Sao Paulo, when there is no row).
-- Keep in step with financeiro_periodos_editaveis() (20261025000003); the suite
-- 99_financeiro_v2_escrita checks that the two agree.
CREATE OR REPLACE FUNCTION public._financeiro_inicio_editavel(p_conta uuid, p_inicio date)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_dia int;
  v_p1  date;
  v_f1  date;
BEGIN
  IF p_conta IS NULL OR p_inicio IS NULL THEN
    RETURN false;
  END IF;

  IF EXISTS (SELECT 1 FROM public.financeiro_periodos p
              WHERE p.conta_id = p_conta AND p.inicio = p_inicio AND p.status = 'reaberto') THEN
    RETURN true;
  END IF;
  IF p_inicio = (SELECT p.inicio FROM public.financeiro_periodos p
                  WHERE p.conta_id = p_conta AND p.status = 'aberto'
                  ORDER BY p.inicio DESC LIMIT 1) THEN
    RETURN true;
  END IF;

  SELECT c.periodo_dia INTO v_dia FROM public.financeiro_config c WHERE c.conta_id = p_conta;
  v_dia := coalesce(v_dia, 1);
  SELECT max(p.fim) INTO v_p1 FROM public.financeiro_periodos p WHERE p.conta_id = p_conta;
  IF v_p1 IS NULL THEN
    v_p1 := public.financeiro_periodo_inicio_de((now() AT TIME ZONE 'America/Sao_Paulo')::date, v_dia);
  END IF;
  v_f1 := public.financeiro_periodo_fim(v_p1, v_dia);
  RETURN p_inicio IN (v_p1, v_f1);
END;
$$;

-- Write the versions effective at p_inicio into the legacy columns, touching only
-- rows whose values differ (so a no-op save never fires the legacy triggers, and the
-- legacy-to-version trigger of the next migration never sees an echo of its own
-- write). A member's legacy custo_mensal is the acordo valor for the monthly models
-- and NULL for por_entrega. Clients / members with no version are left alone.
-- Runs as the function owner, so guard_financial_write lets it through.
CREATE OR REPLACE FUNCTION public._financeiro_sincronizar_legado(p_conta uuid, p_inicio date)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_conta IS NULL OR p_inicio IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.clientes c
     SET valor_mensal = v.valor_mensal,
         data_pagamento = v.dia_pagamento,
         status = v.status
    FROM (SELECT DISTINCT ON (cv.cliente_id) cv.cliente_id, cv.valor_mensal, cv.dia_pagamento, cv.status
            FROM public.financeiro_cliente_versoes cv
           WHERE cv.conta_id = p_conta AND cv.vale_desde <= p_inicio
           ORDER BY cv.cliente_id, cv.vale_desde DESC) v
   WHERE c.id = v.cliente_id
     AND c.conta_id = p_conta
     AND (c.valor_mensal IS DISTINCT FROM v.valor_mensal
          OR c.data_pagamento IS DISTINCT FROM v.dia_pagamento::int
          OR c.status IS DISTINCT FROM v.status);

  UPDATE public.membros m
     SET custo_mensal = v.custo,
         data_pagamento = v.dia_pagamento
    FROM (SELECT DISTINCT ON (av.membro_id) av.membro_id, av.dia_pagamento,
                 CASE WHEN av.modelo = 'por_entrega' THEN NULL ELSE av.valor END AS custo
            FROM public.financeiro_acordo_versoes av
           WHERE av.conta_id = p_conta AND av.vale_desde <= p_inicio
           ORDER BY av.membro_id, av.vale_desde DESC) v
   WHERE m.id = v.membro_id
     AND m.conta_id = p_conta
     AND (m.custo_mensal IS DISTINCT FROM v.custo
          OR m.data_pagamento IS DISTINCT FROM v.dia_pagamento::int);
END;
$$;

REVOKE ALL ON FUNCTION public._financeiro_lock_key(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._financeiro_lock_key(uuid) TO service_role;
REVOKE ALL ON FUNCTION public._financeiro_inicio_editavel(uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._financeiro_sincronizar_legado(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._financeiro_inicio_editavel(uuid, date) TO service_role;
GRANT EXECUTE ON FUNCTION public._financeiro_sincronizar_legado(uuid, date) TO service_role;

-- ===========================================================================
-- Config and funcoes
-- ===========================================================================

-- Start day and target margin. NULL keeps the current value. A new periodo_dia
-- takes effect from the next period (the projected starts in editaveis and the
-- close job read it); the current period row, and its fim, is not touched. Creates
-- the config row when missing, with seeded_at left NULL (the seed sets it).
CREATE OR REPLACE FUNCTION public.financeiro_config_salvar(p_periodo_dia int, p_meta_margem numeric)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conta uuid := public.get_my_conta_id();
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
  -- shared: serializes against the period roll / reabrir / fechar (exclusive), not other writes
  PERFORM pg_advisory_xact_lock_shared(public._financeiro_lock_key(v_conta));

  INSERT INTO public.financeiro_config AS c (conta_id, periodo_dia, meta_margem)
  VALUES (v_conta, coalesce(p_periodo_dia, 1), coalesce(p_meta_margem, 55))
  ON CONFLICT (conta_id) DO UPDATE
     SET periodo_dia = coalesce(p_periodo_dia, c.periodo_dia),
         meta_margem = coalesce(p_meta_margem, c.meta_margem),
         updated_at = now();
END;
$$;

-- Insert (p_id NULL) or rename / reorder a funcao; returns its id. NULL p_ordem
-- appends (insert) or keeps the current one (update). Names are unique per
-- workspace, case-insensitive: funcao_duplicada.
CREATE OR REPLACE FUNCTION public.financeiro_funcao_salvar(p_id bigint, p_nome text, p_ordem int)
RETURNS bigint
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conta uuid := public.get_my_conta_id();
  v_id    bigint;
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
  -- shared: serializes against the period roll / reabrir / fechar (exclusive), not other writes
  PERFORM pg_advisory_xact_lock_shared(public._financeiro_lock_key(v_conta));
  IF NOT EXISTS (SELECT 1 FROM public.financeiro_config c WHERE c.conta_id = v_conta AND c.seeded_at IS NOT NULL) THEN
    RAISE EXCEPTION 'nao_configurado' USING ERRCODE = 'P0001';
  END IF;

  BEGIN
    IF p_id IS NULL THEN
      INSERT INTO public.financeiro_funcoes (conta_id, nome, ordem)
      VALUES (v_conta, trim(p_nome),
              coalesce(p_ordem, (SELECT coalesce(max(f.ordem) + 1, 0) FROM public.financeiro_funcoes f
                                  WHERE f.conta_id = v_conta)))
      RETURNING id INTO v_id;
    ELSE
      UPDATE public.financeiro_funcoes f
         SET nome = trim(p_nome),
             ordem = coalesce(p_ordem, f.ordem)
       WHERE f.id = p_id AND f.conta_id = v_conta
      RETURNING f.id INTO v_id;
      IF v_id IS NULL THEN
        RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
      END IF;
    END IF;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'funcao_duplicada' USING ERRCODE = 'P0001';
  END;

  RETURN v_id;
END;
$$;

-- Delete a funcao. The acordo FK is ON DELETE SET NULL (funcao_id): members fall to
-- "sem funcao" from every live period on; closed snapshots embed the names.
CREATE OR REPLACE FUNCTION public.financeiro_funcao_excluir(p_id bigint)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conta uuid := public.get_my_conta_id();
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
  -- shared: serializes against the period roll / reabrir / fechar (exclusive), not other writes
  PERFORM pg_advisory_xact_lock_shared(public._financeiro_lock_key(v_conta));
  IF NOT EXISTS (SELECT 1 FROM public.financeiro_config c WHERE c.conta_id = v_conta AND c.seeded_at IS NOT NULL) THEN
    RAISE EXCEPTION 'nao_configurado' USING ERRCODE = 'P0001';
  END IF;

  DELETE FROM public.financeiro_funcoes f WHERE f.id = p_id AND f.conta_id = v_conta;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
END;
$$;

-- ===========================================================================
-- Effective-dated writes
-- ===========================================================================

-- Fee, payment day and status of a client from p_vale_desde on (upsert on
-- (cliente_id, vale_desde)). Encerrado ends every assignment of the client from
-- that start on: rows starting at or after it are deleted (a same-period row would
-- otherwise be a zero-length interval), and rows still running past it get
-- ate = p_vale_desde. Assignments are not restored if the client later returns.
CREATE OR REPLACE FUNCTION public.financeiro_cliente_salvar(
  p_cliente_id bigint, p_vale_desde date, p_valor_mensal numeric, p_dia_pagamento int, p_status text)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conta  uuid := public.get_my_conta_id();
  v_aberto date;
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
  -- shared: serializes against the period roll / reabrir / fechar (exclusive), not other writes
  PERFORM pg_advisory_xact_lock_shared(public._financeiro_lock_key(v_conta));
  IF NOT EXISTS (SELECT 1 FROM public.financeiro_config c WHERE c.conta_id = v_conta AND c.seeded_at IS NOT NULL) THEN
    RAISE EXCEPTION 'nao_configurado' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public._financeiro_inicio_editavel(v_conta, p_vale_desde) THEN
    RAISE EXCEPTION 'periodo_fechado' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.clientes c WHERE c.id = p_cliente_id AND c.conta_id = v_conta) THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.financeiro_cliente_versoes
    (conta_id, cliente_id, vale_desde, valor_mensal, dia_pagamento, status, created_by)
  VALUES (v_conta, p_cliente_id, p_vale_desde, p_valor_mensal, p_dia_pagamento, p_status, auth.uid())
  ON CONFLICT (cliente_id, vale_desde) DO UPDATE
     SET valor_mensal = EXCLUDED.valor_mensal,
         dia_pagamento = EXCLUDED.dia_pagamento,
         status = EXCLUDED.status,
         created_by = EXCLUDED.created_by;

  IF p_status = 'encerrado' THEN
    DELETE FROM public.financeiro_atribuicoes t
     WHERE t.conta_id = v_conta AND t.cliente_id = p_cliente_id AND t.desde >= p_vale_desde;
    UPDATE public.financeiro_atribuicoes t
       SET ate = p_vale_desde
     WHERE t.conta_id = v_conta AND t.cliente_id = p_cliente_id
       AND t.desde < p_vale_desde AND (t.ate IS NULL OR t.ate > p_vale_desde);
  END IF;

  SELECT p.inicio INTO v_aberto FROM public.financeiro_periodos p
   WHERE p.conta_id = v_conta AND p.status = 'aberto' ORDER BY p.inicio DESC LIMIT 1;
  IF v_aberto IS NOT NULL THEN
    PERFORM public._financeiro_sincronizar_legado(v_conta, v_aberto);
  END IF;
END;
$$;

-- A member's acordo from p_vale_desde on (upsert on (membro_id, vale_desde)). The
-- version is replaced whole: a key missing from p_acordo is stored as NULL. Keys:
-- funcao_id, modelo, valor, unidade, meta_quantidade, meta_periodo, limite_clientes,
-- dia_pagamento, vigencia_inicio, vigencia_fim, arquivo_path. Value checks are the
-- table's CHECK constraints.
CREATE OR REPLACE FUNCTION public.financeiro_acordo_salvar(p_membro_id bigint, p_vale_desde date, p_acordo jsonb)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conta  uuid := public.get_my_conta_id();
  v_funcao bigint;
  v_aberto date;
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
  -- shared: serializes against the period roll / reabrir / fechar (exclusive), not other writes
  PERFORM pg_advisory_xact_lock_shared(public._financeiro_lock_key(v_conta));
  IF NOT EXISTS (SELECT 1 FROM public.financeiro_config c WHERE c.conta_id = v_conta AND c.seeded_at IS NOT NULL) THEN
    RAISE EXCEPTION 'nao_configurado' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public._financeiro_inicio_editavel(v_conta, p_vale_desde) THEN
    RAISE EXCEPTION 'periodo_fechado' USING ERRCODE = 'P0001';
  END IF;
  IF p_acordo IS NULL OR jsonb_typeof(p_acordo) <> 'object' THEN
    RAISE EXCEPTION 'acordo_invalido' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.membros m WHERE m.id = p_membro_id AND m.conta_id = v_conta) THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  v_funcao := (p_acordo->>'funcao_id')::bigint;
  IF v_funcao IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.financeiro_funcoes f WHERE f.id = v_funcao AND f.conta_id = v_conta
  ) THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.financeiro_acordo_versoes
    (conta_id, membro_id, vale_desde, funcao_id, modelo, valor, unidade, meta_quantidade, meta_periodo,
     limite_clientes, dia_pagamento, vigencia_inicio, vigencia_fim, arquivo_path, created_by)
  VALUES (v_conta, p_membro_id, p_vale_desde, v_funcao,
          p_acordo->>'modelo',
          (p_acordo->>'valor')::numeric,
          p_acordo->>'unidade',
          (p_acordo->>'meta_quantidade')::int,
          p_acordo->>'meta_periodo',
          (p_acordo->>'limite_clientes')::int,
          (p_acordo->>'dia_pagamento')::smallint,
          (p_acordo->>'vigencia_inicio')::date,
          (p_acordo->>'vigencia_fim')::date,
          p_acordo->>'arquivo_path',
          auth.uid())
  ON CONFLICT (membro_id, vale_desde) DO UPDATE
     SET funcao_id = EXCLUDED.funcao_id,
         modelo = EXCLUDED.modelo,
         valor = EXCLUDED.valor,
         unidade = EXCLUDED.unidade,
         meta_quantidade = EXCLUDED.meta_quantidade,
         meta_periodo = EXCLUDED.meta_periodo,
         limite_clientes = EXCLUDED.limite_clientes,
         dia_pagamento = EXCLUDED.dia_pagamento,
         vigencia_inicio = EXCLUDED.vigencia_inicio,
         vigencia_fim = EXCLUDED.vigencia_fim,
         arquivo_path = EXCLUDED.arquivo_path,
         created_by = EXCLUDED.created_by;

  SELECT p.inicio INTO v_aberto FROM public.financeiro_periodos p
   WHERE p.conta_id = v_conta AND p.status = 'aberto' ORDER BY p.inicio DESC LIMIT 1;
  IF v_aberto IS NOT NULL THEN
    PERFORM public._financeiro_sincronizar_legado(v_conta, v_aberto);
  END IF;
END;
$$;

-- Who serves whom, from p_vale_desde on. p_mudancas = [{membro_id, cliente_id, ativo}],
-- all applied in this one transaction (one bad entry rolls back the batch). Per pair:
--   ativo:   the pair must be active from v until the client ends. A client whose
--            effective version at v is encerrado is rejected (cliente_encerrado).
--            Rows starting after v are subsumed and deleted; then a row covering v, or
--            one ending exactly at v, is extended, otherwise a row (desde = v) is
--            inserted. Either way ate = the client's first encerrado version after v
--            (NULL when there is none), so an assignment never outlives an encerrado
--            cutoff and does not come back if the client is reactivated later.
--   inativo: the pair must be inactive from v on. Rows starting at or after v are
--            deleted (on and off from the same start leaves nothing); a row running
--            past v gets ate = v.
CREATE OR REPLACE FUNCTION public.financeiro_atribuicoes_salvar(p_vale_desde date, p_mudancas jsonb)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conta   uuid := public.get_my_conta_id();
  v_mudanca jsonb;
  v_membro  bigint;
  v_cliente bigint;
  v_ativo   boolean;
  v_id      bigint;
  v_corte   date;
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
  -- shared: serializes against the period roll / reabrir / fechar (exclusive), not other writes
  PERFORM pg_advisory_xact_lock_shared(public._financeiro_lock_key(v_conta));
  IF NOT EXISTS (SELECT 1 FROM public.financeiro_config c WHERE c.conta_id = v_conta AND c.seeded_at IS NOT NULL) THEN
    RAISE EXCEPTION 'nao_configurado' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public._financeiro_inicio_editavel(v_conta, p_vale_desde) THEN
    RAISE EXCEPTION 'periodo_fechado' USING ERRCODE = 'P0001';
  END IF;
  IF p_mudancas IS NULL OR jsonb_typeof(p_mudancas) <> 'array' THEN
    RAISE EXCEPTION 'mudancas_invalidas' USING ERRCODE = 'P0001';
  END IF;

  FOR v_mudanca IN SELECT e FROM jsonb_array_elements(p_mudancas) e LOOP
    IF jsonb_typeof(v_mudanca) <> 'object' OR jsonb_typeof(v_mudanca->'ativo') IS DISTINCT FROM 'boolean' THEN
      RAISE EXCEPTION 'mudancas_invalidas' USING ERRCODE = 'P0001';
    END IF;
    v_membro := (v_mudanca->>'membro_id')::bigint;
    v_cliente := (v_mudanca->>'cliente_id')::bigint;
    v_ativo := (v_mudanca->>'ativo')::boolean;
    IF NOT EXISTS (SELECT 1 FROM public.membros m WHERE m.id = v_membro AND m.conta_id = v_conta)
       OR NOT EXISTS (SELECT 1 FROM public.clientes c WHERE c.id = v_cliente AND c.conta_id = v_conta) THEN
      RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
    END IF;

    IF v_ativo THEN
      IF (SELECT cv.status FROM public.financeiro_cliente_versoes cv
           WHERE cv.conta_id = v_conta AND cv.cliente_id = v_cliente AND cv.vale_desde <= p_vale_desde
           ORDER BY cv.vale_desde DESC LIMIT 1) = 'encerrado' THEN
        RAISE EXCEPTION 'cliente_encerrado' USING ERRCODE = 'P0001';
      END IF;
      SELECT min(cv.vale_desde) INTO v_corte FROM public.financeiro_cliente_versoes cv
       WHERE cv.conta_id = v_conta AND cv.cliente_id = v_cliente
         AND cv.status = 'encerrado' AND cv.vale_desde > p_vale_desde;

      DELETE FROM public.financeiro_atribuicoes t
       WHERE t.conta_id = v_conta AND t.membro_id = v_membro AND t.cliente_id = v_cliente
         AND t.desde > p_vale_desde;
      v_id := NULL;
      SELECT t.id INTO v_id FROM public.financeiro_atribuicoes t
       WHERE t.conta_id = v_conta AND t.membro_id = v_membro AND t.cliente_id = v_cliente
         AND t.desde <= p_vale_desde AND (t.ate IS NULL OR t.ate >= p_vale_desde)
       ORDER BY t.ate IS NULL DESC, t.ate DESC
       LIMIT 1;
      IF v_id IS NULL THEN
        INSERT INTO public.financeiro_atribuicoes (conta_id, membro_id, cliente_id, desde, ate)
        VALUES (v_conta, v_membro, v_cliente, p_vale_desde, v_corte);
      ELSE
        UPDATE public.financeiro_atribuicoes t SET ate = v_corte
         WHERE t.id = v_id AND t.ate IS DISTINCT FROM v_corte;
      END IF;
    ELSE
      DELETE FROM public.financeiro_atribuicoes t
       WHERE t.conta_id = v_conta AND t.membro_id = v_membro AND t.cliente_id = v_cliente
         AND t.desde >= p_vale_desde;
      UPDATE public.financeiro_atribuicoes t
         SET ate = p_vale_desde
       WHERE t.conta_id = v_conta AND t.membro_id = v_membro AND t.cliente_id = v_cliente
         AND (t.ate IS NULL OR t.ate > p_vale_desde);
    END IF;
  END LOOP;
END;
$$;

-- Manual delivery counts of one member for the period starting at p_inicio.
-- p_itens = [{cliente_id, quantidade}]: a number upserts, NULL deletes. A number
-- needs an assignment of the pair active at p_inicio (desde <= p_inicio < ate),
-- else sem_atribuicao: a quantity there would count nowhere.
CREATE OR REPLACE FUNCTION public.financeiro_entregas_salvar(p_inicio date, p_membro_id bigint, p_itens jsonb)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conta   uuid := public.get_my_conta_id();
  v_item    jsonb;
  v_cliente bigint;
  v_qtd     int;
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
  -- shared: serializes against the period roll / reabrir / fechar (exclusive), not other writes
  PERFORM pg_advisory_xact_lock_shared(public._financeiro_lock_key(v_conta));
  IF NOT EXISTS (SELECT 1 FROM public.financeiro_config c WHERE c.conta_id = v_conta AND c.seeded_at IS NOT NULL) THEN
    RAISE EXCEPTION 'nao_configurado' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public._financeiro_inicio_editavel(v_conta, p_inicio) THEN
    RAISE EXCEPTION 'periodo_fechado' USING ERRCODE = 'P0001';
  END IF;
  IF p_itens IS NULL OR jsonb_typeof(p_itens) <> 'array' THEN
    RAISE EXCEPTION 'itens_invalidos' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.membros m WHERE m.id = p_membro_id AND m.conta_id = v_conta) THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;

  FOR v_item IN SELECT e FROM jsonb_array_elements(p_itens) e LOOP
    IF jsonb_typeof(v_item) <> 'object' THEN
      RAISE EXCEPTION 'itens_invalidos' USING ERRCODE = 'P0001';
    END IF;
    v_cliente := (v_item->>'cliente_id')::bigint;
    v_qtd := (v_item->>'quantidade')::int;
    IF NOT EXISTS (SELECT 1 FROM public.clientes c WHERE c.id = v_cliente AND c.conta_id = v_conta) THEN
      RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
    END IF;

    IF v_qtd IS NULL THEN
      DELETE FROM public.financeiro_entregas_manuais e
       WHERE e.conta_id = v_conta AND e.membro_id = p_membro_id AND e.cliente_id = v_cliente
         AND e.periodo_inicio = p_inicio;
    ELSE
      IF NOT EXISTS (
        SELECT 1 FROM public.financeiro_atribuicoes t
         WHERE t.conta_id = v_conta AND t.membro_id = p_membro_id AND t.cliente_id = v_cliente
           AND t.desde <= p_inicio AND (t.ate IS NULL OR t.ate > p_inicio)
      ) THEN
        RAISE EXCEPTION 'sem_atribuicao' USING ERRCODE = 'P0001';
      END IF;
      INSERT INTO public.financeiro_entregas_manuais (conta_id, periodo_inicio, membro_id, cliente_id, quantidade)
      VALUES (v_conta, p_inicio, p_membro_id, v_cliente, v_qtd)
      ON CONFLICT (membro_id, cliente_id, periodo_inicio) DO UPDATE
         SET quantidade = EXCLUDED.quantidade;
    END IF;
  END LOOP;
END;
$$;

-- ===========================================================================
-- Grants
-- ===========================================================================
REVOKE ALL ON FUNCTION public.financeiro_config_salvar(int, numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.financeiro_funcao_salvar(bigint, text, int) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.financeiro_funcao_excluir(bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.financeiro_cliente_salvar(bigint, date, numeric, int, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.financeiro_acordo_salvar(bigint, date, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.financeiro_atribuicoes_salvar(date, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.financeiro_entregas_salvar(date, bigint, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.financeiro_config_salvar(int, numeric) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.financeiro_funcao_salvar(bigint, text, int) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.financeiro_funcao_excluir(bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.financeiro_cliente_salvar(bigint, date, numeric, int, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.financeiro_acordo_salvar(bigint, date, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.financeiro_atribuicoes_salvar(date, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.financeiro_entregas_salvar(date, bigint, jsonb) TO authenticated, service_role;

DO $$
DECLARE
  v_fn text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY['public._financeiro_inicio_editavel(uuid,date)',
                              'public._financeiro_sincronizar_legado(uuid,date)'] LOOP
    IF has_function_privilege('authenticated', v_fn, 'EXECUTE')
       OR has_function_privilege('anon', v_fn, 'EXECUTE')
       OR NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '%: grants are not service_role only', v_fn;
    END IF;
  END LOOP;
  FOREACH v_fn IN ARRAY ARRAY['public.financeiro_config_salvar(int,numeric)',
                              'public.financeiro_funcao_salvar(bigint,text,int)',
                              'public.financeiro_funcao_excluir(bigint)',
                              'public.financeiro_cliente_salvar(bigint,date,numeric,int,text)',
                              'public.financeiro_acordo_salvar(bigint,date,jsonb)',
                              'public.financeiro_atribuicoes_salvar(date,jsonb)',
                              'public.financeiro_entregas_salvar(date,bigint,jsonb)'] LOOP
    IF has_function_privilege('anon', v_fn, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', v_fn, 'EXECUTE')
       OR NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '%: grants are not authenticated + service_role', v_fn;
    END IF;
  END LOOP;
END
$$;
