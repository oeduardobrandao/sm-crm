-- Rollback of supabase/migrations/20261029000002_financeiro_v2_rpc_as.sql.
-- Run by hand: psql "$DB_URL" -v ON_ERROR_STOP=1 -f docs/superpowers/rollbacks/20261029000002_financeiro_v2_rpc_as.down.sql
-- Then delete the version row if the migration history must forget it:
--   DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261029000002';
--
-- Order: 1. the public v2 RPCs back to their last definitions before 20261029000002
-- (copied verbatim from 20261027000003 / 000004 / 000005 / 000006, with their
-- original REVOKE / GRANT lines), so none of them calls a core any more;
-- 2. DROP FUNCTION of every _as entry point, every _core and _financeiro_exigir_dono.
-- Anything else that calls an _as function (the MCP edge function) must be rolled
-- back first, and so must 20261029000003 (its _as functions call
-- _financeiro_exigir_dono): run 20261029000003_financeiro_mcp_lancamentos.down.sql
-- before this file.
--
-- Tests after this rollback: 99_financeiro_v2_seed_legado.sql targets the
-- post-migration shape. Its seed_locks_legacy_rows block pins the lock order in
-- _financeiro_seed_core's source, which this file drops, so that one block fails here
-- (the restored financeiro_seed below carries the same FOR SHARE locks inline, as in
-- 20261027000005); its behavioural blocks and the other 99_financeiro_v2_*.sql suites
-- pass. Rolling back for real also means pointing that block back at
-- public.financeiro_seed(int), or the next CI run fails.

BEGIN;
SET LOCAL lock_timeout = '5s';

-- ===========================================================================
-- 1. Public RPCs: original definitions
-- ===========================================================================

-- From 20261027000004_financeiro_v2_escrita.sql
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

      -- bounded by the cutoff: a re-assignment after a later encerrado gap is kept
      DELETE FROM public.financeiro_atribuicoes t
       WHERE t.conta_id = v_conta AND t.membro_id = v_membro AND t.cliente_id = v_cliente
         AND t.desde > p_vale_desde
         AND (v_corte IS NULL OR t.desde < v_corte);
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

-- From 20261027000005_financeiro_v2_seed_legado.sql
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
    PERFORM public._financeiro_encerrar_atribuicoes(v_conta, p_cliente_id, p_vale_desde);
  END IF;

  SELECT p.inicio INTO v_aberto FROM public.financeiro_periodos p
   WHERE p.conta_id = v_conta AND p.status = 'aberto' ORDER BY p.inicio DESC LIMIT 1;
  IF v_aberto IS NOT NULL THEN
    PERFORM public._financeiro_sincronizar_legado(v_conta, v_aberto);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.financeiro_seed(p_periodo_dia int)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conta  uuid := public.get_my_conta_id();
  v_novo   uuid;
  v_inicio date;
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
  -- exclusive: the seed creates the first period (same key as the roll, 20261027000006)
  PERFORM pg_advisory_xact_lock(public._financeiro_lock_key(v_conta));
  IF p_periodo_dia IS NULL OR p_periodo_dia NOT BETWEEN 1 AND 28 THEN
    RAISE EXCEPTION 'periodo_dia_invalido' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.financeiro_config AS c (conta_id, periodo_dia, seeded_at)
  VALUES (v_conta, p_periodo_dia, now())
  ON CONFLICT (conta_id) DO UPDATE
     SET periodo_dia = EXCLUDED.periodo_dia,
         seeded_at = EXCLUDED.seeded_at,
         updated_at = now()
   WHERE c.seeded_at IS NULL
  RETURNING c.conta_id INTO v_novo;
  IF v_novo IS NULL THEN
    RETURN jsonb_build_object('seeded', true, 'ja_existia', true);
  END IF;

  -- The legacy trigger returns early while seeded_at is unset (it takes no lock), so a
  -- legacy UPDATE committed between the copies below and this commit would be lost.
  -- Lock the source rows first: such an UPDATE now waits for the seed to commit and its
  -- trigger then sees seeded_at set. No deadlock: the unseeded trigger takes no lock.
  PERFORM 1 FROM public.clientes c WHERE c.conta_id = v_conta FOR SHARE;
  PERFORM 1 FROM public.membros m WHERE m.conta_id = v_conta FOR SHARE;

  v_inicio := public.financeiro_periodo_inicio_de((now() AT TIME ZONE 'America/Sao_Paulo')::date, p_periodo_dia);
  INSERT INTO public.financeiro_periodos (conta_id, inicio, fim)
  VALUES (v_conta, v_inicio, (v_inicio + interval '1 month')::date)
  ON CONFLICT (conta_id, inicio) DO NOTHING;

  IF NOT EXISTS (SELECT 1 FROM public.financeiro_funcoes f WHERE f.conta_id = v_conta) THEN
    INSERT INTO public.financeiro_funcoes (conta_id, nome, ordem) VALUES
      (v_conta, 'Videomaker', 0),
      (v_conta, 'Design', 1),
      (v_conta, 'Edição de vídeo', 2),
      (v_conta, 'Copy', 3),
      (v_conta, 'Gestão de projetos', 4);
  END IF;

  INSERT INTO public.financeiro_cliente_versoes
    (conta_id, cliente_id, vale_desde, valor_mensal, dia_pagamento, status, created_by)
  SELECT v_conta, c.id, v_inicio,
         greatest(round(coalesce(c.valor_mensal, 0), 2), 0),
         CASE WHEN c.data_pagamento BETWEEN 1 AND 31 THEN c.data_pagamento END,
         CASE WHEN c.status IN ('ativo', 'pausado', 'encerrado') THEN c.status ELSE 'ativo' END,
         auth.uid()
    FROM public.clientes c
   WHERE c.conta_id = v_conta
  ON CONFLICT (cliente_id, vale_desde) DO NOTHING;

  INSERT INTO public.financeiro_acordo_versoes
    (conta_id, membro_id, vale_desde, funcao_id, modelo, valor, dia_pagamento, created_by)
  SELECT v_conta, m.id, v_inicio,
         (SELECT f.id FROM public.financeiro_funcoes f
           WHERE f.conta_id = v_conta
             AND public._financeiro_normalizar(f.nome) = public._financeiro_normalizar(m.cargo)
           ORDER BY f.ordem, f.id LIMIT 1),
         'mensal_meta',
         greatest(round(coalesce(m.custo_mensal, 0), 2), 0),
         CASE WHEN m.data_pagamento BETWEEN 1 AND 31 THEN m.data_pagamento END,
         auth.uid()
    FROM public.membros m
   WHERE m.conta_id = v_conta
  ON CONFLICT (membro_id, vale_desde) DO NOTHING;

  RETURN jsonb_build_object('seeded', true, 'ja_existia', false);
END;
$$;

REVOKE ALL ON FUNCTION public.financeiro_seed(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.financeiro_seed(int) TO authenticated, service_role;

-- From 20261027000006_financeiro_v2_periodos_job.sql
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

-- From 20261027000003_financeiro_v2_calculo.sql
CREATE OR REPLACE FUNCTION public.financeiro_periodos_editaveis()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conta uuid := public.get_my_conta_id();
  v_dia   int;
  v_p1    date;
  v_f1    date;
  v_f2    date;
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

  SELECT c.periodo_dia INTO v_dia FROM public.financeiro_config c WHERE c.conta_id = v_conta;
  v_dia := coalesce(v_dia, 1);
  SELECT max(p.fim) INTO v_p1 FROM public.financeiro_periodos p WHERE p.conta_id = v_conta;
  IF v_p1 IS NULL THEN
    v_p1 := public.financeiro_periodo_inicio_de((now() AT TIME ZONE 'America/Sao_Paulo')::date, v_dia);
  END IF;
  v_f1 := public.financeiro_periodo_fim(v_p1, v_dia);
  v_f2 := public.financeiro_periodo_fim(v_f1, v_dia);

  RETURN (
    WITH lista AS (
      SELECT p.inicio, p.fim, p.status, p.transicao
        FROM public.financeiro_periodos p
       WHERE p.conta_id = v_conta AND p.status = 'reaberto'
      UNION ALL
      (SELECT p.inicio, p.fim, p.status, p.transicao
         FROM public.financeiro_periodos p
        WHERE p.conta_id = v_conta AND p.status = 'aberto'
        ORDER BY p.inicio DESC LIMIT 1)
      UNION ALL
      SELECT v_p1, v_f1, 'futuro', v_f1 <> (v_p1 + interval '1 month')::date
      UNION ALL
      SELECT v_f1, v_f2, 'futuro', v_f2 <> (v_f1 + interval '1 month')::date
    )
    SELECT jsonb_agg(jsonb_build_object(
             'inicio', l.inicio,
             'fim', l.fim,
             'rotulo', public.financeiro_periodo_rotulo(l.inicio, l.fim),
             'status', l.status,
             'transicao', l.transicao
           ) ORDER BY l.inicio)
      FROM lista l
  );
END;
$$;

-- Every period row of the workspace, newest first.
CREATE OR REPLACE FUNCTION public.financeiro_periodos_listar()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
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
  IF public.can_see_financials() IS NOT TRUE THEN
    RAISE EXCEPTION 'financial_access_denied' USING ERRCODE = '42501';
  END IF;

  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
             'inicio', p.inicio,
             'fim', p.fim,
             'rotulo', public.financeiro_periodo_rotulo(p.inicio, p.fim),
             'status', p.status,
             'transicao', p.transicao
           ) ORDER BY p.inicio DESC)
      FROM public.financeiro_periodos p
     WHERE p.conta_id = v_conta), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.financeiro_periodos_listar() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.financeiro_periodos_editaveis() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.financeiro_periodos_listar() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.financeiro_periodos_editaveis() TO authenticated, service_role;

-- Grants of the 20261027000004 RPCs (financeiro_cliente_salvar is defined above from 000005)
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

-- ===========================================================================
-- 2. Drop the _as entry points, the cores and the owner gate
-- ===========================================================================

DROP FUNCTION IF EXISTS public.financeiro_config_salvar_as(uuid, uuid, int, numeric);
DROP FUNCTION IF EXISTS public.financeiro_funcao_salvar_as(uuid, uuid, bigint, text, int);
DROP FUNCTION IF EXISTS public.financeiro_funcao_excluir_as(uuid, uuid, bigint);
DROP FUNCTION IF EXISTS public.financeiro_cliente_salvar_as(uuid, uuid, bigint, date, numeric, int, text);
DROP FUNCTION IF EXISTS public.financeiro_acordo_salvar_as(uuid, uuid, bigint, date, jsonb);
DROP FUNCTION IF EXISTS public.financeiro_atribuicoes_salvar_as(uuid, uuid, date, jsonb);
DROP FUNCTION IF EXISTS public.financeiro_entregas_salvar_as(uuid, uuid, date, bigint, jsonb);
DROP FUNCTION IF EXISTS public.financeiro_seed_as(uuid, uuid, int);
DROP FUNCTION IF EXISTS public.financeiro_periodo_reabrir_as(uuid, uuid, date);
DROP FUNCTION IF EXISTS public.financeiro_periodo_fechar_as(uuid, uuid, date);
DROP FUNCTION IF EXISTS public.financeiro_rentabilidade_as(uuid, uuid, date);
DROP FUNCTION IF EXISTS public.financeiro_periodos_listar_as(uuid, uuid);
DROP FUNCTION IF EXISTS public.financeiro_periodos_editaveis_as(uuid, uuid);
DROP FUNCTION IF EXISTS public._financeiro_config_salvar_core(uuid, uuid, int, numeric);
DROP FUNCTION IF EXISTS public._financeiro_funcao_salvar_core(uuid, uuid, bigint, text, int);
DROP FUNCTION IF EXISTS public._financeiro_funcao_excluir_core(uuid, uuid, bigint);
DROP FUNCTION IF EXISTS public._financeiro_cliente_salvar_core(uuid, uuid, bigint, date, numeric, int, text);
DROP FUNCTION IF EXISTS public._financeiro_acordo_salvar_core(uuid, uuid, bigint, date, jsonb);
DROP FUNCTION IF EXISTS public._financeiro_atribuicoes_salvar_core(uuid, uuid, date, jsonb);
DROP FUNCTION IF EXISTS public._financeiro_entregas_salvar_core(uuid, uuid, date, bigint, jsonb);
DROP FUNCTION IF EXISTS public._financeiro_seed_core(uuid, uuid, int);
DROP FUNCTION IF EXISTS public._financeiro_periodo_reabrir_core(uuid, uuid, date);
DROP FUNCTION IF EXISTS public._financeiro_periodo_fechar_core(uuid, uuid, date);
DROP FUNCTION IF EXISTS public._financeiro_rentabilidade_core(uuid, uuid, date);
DROP FUNCTION IF EXISTS public._financeiro_periodos_listar_core(uuid, uuid);
DROP FUNCTION IF EXISTS public._financeiro_periodos_editaveis_core(uuid, uuid);
DROP FUNCTION IF EXISTS public._financeiro_exigir_dono(uuid, uuid);

COMMIT;
