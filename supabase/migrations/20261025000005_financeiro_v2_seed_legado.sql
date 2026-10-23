SET LOCAL lock_timeout = '5s';

-- Financeiro v2: seed and legacy capture (spec
-- docs/superpowers/specs/2026-10-23-financeiro-rentabilidade-design.md).
--
-- financeiro_seed ("Montar a partir dos dados atuais") builds v2 from today's
-- clientes.valor_mensal / membros.custo_mensal in one idempotent step: the config
-- row, the five default funcoes, the first (open) period, one version per client
-- and one mensal_meta acordo per member, every vale_desde at that period's start.
-- No assignments: the owner ticks them on the new screen.
--
-- The legacy columns keep being written by the old screens, CSV import, lead
-- conversion and the MCP. Once a workspace is seeded, the triggers below turn such a
-- write into a version at the current open period (the latest 'aberto' row), whatever
-- the flag is, so v2 never drifts from what the old screens show. The v2 write RPCs
-- write the same columns back (_financeiro_sincronizar_legado, 20261025000004); the
-- trigger then finds the values equal to the effective version and does nothing.
-- That compare-and-skip is the loop guard.
--
-- Legacy values are normalized the same way in the seed and in the trigger, so a
-- write-through always compares equal: fee coalesce(x, 0) rounded to cents (never
-- below 0), payment day kept when 1..31 and NULL otherwise (a NULL legacy day stays
-- NULL: the write-through copies the version's day back verbatim, so the seed must
-- carry every legacy day), status 1:1 for ativo / pausado / encerrado and ativo for
-- anything else (NULL included).

-- ===========================================================================
-- Internal helpers (service_role only)
-- ===========================================================================

-- Accent-, case- and edge-space-insensitive form of a name, to match a member's
-- free-text cargo against a funcao name by exact equality.
CREATE OR REPLACE FUNCTION public._financeiro_normalizar(p_texto text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT lower(trim(translate(p_texto,
    'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
    'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')));
$$;

-- An encerrado client from p_vale_desde on ends every assignment of the client:
-- rows starting at or after it are deleted (a same-period row would otherwise be a
-- zero-length interval), and rows still running past it get ate = p_vale_desde.
-- Shared by financeiro_cliente_salvar and the legacy trigger (ruling R12).
CREATE OR REPLACE FUNCTION public._financeiro_encerrar_atribuicoes(p_conta uuid, p_cliente_id bigint, p_vale_desde date)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_conta IS NULL OR p_cliente_id IS NULL OR p_vale_desde IS NULL THEN
    RETURN;
  END IF;
  DELETE FROM public.financeiro_atribuicoes t
   WHERE t.conta_id = p_conta AND t.cliente_id = p_cliente_id AND t.desde >= p_vale_desde;
  UPDATE public.financeiro_atribuicoes t
     SET ate = p_vale_desde
   WHERE t.conta_id = p_conta AND t.cliente_id = p_cliente_id
     AND t.desde < p_vale_desde AND (t.ate IS NULL OR t.ate > p_vale_desde);
END;
$$;

REVOKE ALL ON FUNCTION public._financeiro_normalizar(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._financeiro_encerrar_atribuicoes(uuid, bigint, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._financeiro_normalizar(text) TO service_role;
GRANT EXECUTE ON FUNCTION public._financeiro_encerrar_atribuicoes(uuid, bigint, date) TO service_role;

-- ===========================================================================
-- financeiro_cliente_salvar: same contract, the encerrado cutoff now lives in
-- _financeiro_encerrar_atribuicoes (shared with the legacy trigger)
-- ===========================================================================

-- Fee, payment day and status of a client from p_vale_desde on (upsert on
-- (cliente_id, vale_desde)). Encerrado ends every assignment of the client from
-- that start on (_financeiro_encerrar_atribuicoes). Assignments are not restored if
-- the client later returns.
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

-- ===========================================================================
-- Seed
-- ===========================================================================

-- Build v2 from the legacy columns. One statement, so it applies whole or not at
-- all. Already seeded: {"seeded": true, "ja_existia": true} and nothing changes. A
-- config row left unseeded by financeiro_config_salvar is completed: periodo_dia
-- takes p_periodo_dia, meta_margem is kept. Not gated on nao_configurado: this is
-- what configures. The config upsert's row lock serializes two concurrent calls; the
-- second sees seeded_at set and returns ja_existia.
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

-- ===========================================================================
-- Legacy capture
-- ===========================================================================

-- AFTER INSERT / UPDATE of the financial legacy columns on clientes and membros.
-- Acts only when the workspace is seeded and has an open period (the latest
-- 'aberto' row; its inicio is the version date). Compares the normalized NEW values
-- with the version effective at that start (greatest vale_desde <= inicio) and
-- writes nothing when they are equal: the loop guard against the v2 write-through.
--   clientes: upsert a version (fee, day, status) at inicio. Encerrado also ends the
--             client's assignments from inicio on (ruling R12).
--   membros:  no acordo yet (a member added after the seed) -> a fresh mensal_meta
--             acordo, funcao_id matched from cargo. Otherwise the effective acordo is
--             copied to inicio (upserted in place when it already starts there) with
--             only valor / dia_pagamento changed. por_entrega: custo_mensal is not
--             its price (the write-through stores NULL there), so only a payment-day
--             change is versioned (ruling R2).
-- Runs whatever the flag is, so v2 stays in sync while the feature is off.
CREATE OR REPLACE FUNCTION public._financeiro_v2_legado_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_inicio     date;
  v_dia        smallint;
  v_valor      numeric;
  v_status     text;
  v_achou      boolean;
  v_cur_valor  numeric;
  v_cur_dia    smallint;
  v_cur_status text;
  v_cur_id     bigint;
  v_cur_modelo text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.financeiro_config c
                  WHERE c.conta_id = NEW.conta_id AND c.seeded_at IS NOT NULL) THEN
    RETURN NULL;
  END IF;
  SELECT p.inicio INTO v_inicio FROM public.financeiro_periodos p
   WHERE p.conta_id = NEW.conta_id AND p.status = 'aberto' ORDER BY p.inicio DESC LIMIT 1;
  IF v_inicio IS NULL THEN
    RETURN NULL;
  END IF;

  v_dia := CASE WHEN NEW.data_pagamento BETWEEN 1 AND 31 THEN NEW.data_pagamento END;

  IF TG_TABLE_NAME = 'clientes' THEN
    v_valor := greatest(round(coalesce(NEW.valor_mensal, 0), 2), 0);
    v_status := CASE WHEN NEW.status IN ('ativo', 'pausado', 'encerrado') THEN NEW.status ELSE 'ativo' END;

    SELECT cv.valor_mensal, cv.dia_pagamento, cv.status
      INTO v_cur_valor, v_cur_dia, v_cur_status
      FROM public.financeiro_cliente_versoes cv
     WHERE cv.conta_id = NEW.conta_id AND cv.cliente_id = NEW.id AND cv.vale_desde <= v_inicio
     ORDER BY cv.vale_desde DESC LIMIT 1;
    v_achou := FOUND;
    IF v_achou AND v_cur_valor = v_valor AND v_cur_dia IS NOT DISTINCT FROM v_dia AND v_cur_status = v_status THEN
      RETURN NULL;
    END IF;

    INSERT INTO public.financeiro_cliente_versoes
      (conta_id, cliente_id, vale_desde, valor_mensal, dia_pagamento, status, created_by)
    VALUES (NEW.conta_id, NEW.id, v_inicio, v_valor, v_dia, v_status, auth.uid())
    ON CONFLICT (cliente_id, vale_desde) DO UPDATE
       SET valor_mensal = EXCLUDED.valor_mensal,
           dia_pagamento = EXCLUDED.dia_pagamento,
           status = EXCLUDED.status,
           created_by = EXCLUDED.created_by;

    IF v_status = 'encerrado' THEN
      PERFORM public._financeiro_encerrar_atribuicoes(NEW.conta_id, NEW.id, v_inicio);
    END IF;
    RETURN NULL;
  END IF;

  -- membros
  SELECT av.id, av.modelo, av.valor, av.dia_pagamento
    INTO v_cur_id, v_cur_modelo, v_cur_valor, v_cur_dia
    FROM public.financeiro_acordo_versoes av
   WHERE av.conta_id = NEW.conta_id AND av.membro_id = NEW.id AND av.vale_desde <= v_inicio
   ORDER BY av.vale_desde DESC LIMIT 1;
  v_achou := FOUND;

  IF NOT v_achou THEN
    INSERT INTO public.financeiro_acordo_versoes
      (conta_id, membro_id, vale_desde, funcao_id, modelo, valor, dia_pagamento, created_by)
    VALUES (NEW.conta_id, NEW.id, v_inicio,
            (SELECT f.id FROM public.financeiro_funcoes f
              WHERE f.conta_id = NEW.conta_id
                AND public._financeiro_normalizar(f.nome) = public._financeiro_normalizar(NEW.cargo)
              ORDER BY f.ordem, f.id LIMIT 1),
            'mensal_meta',
            greatest(round(coalesce(NEW.custo_mensal, 0), 2), 0),
            v_dia,
            auth.uid())
    ON CONFLICT (membro_id, vale_desde) DO NOTHING;
    RETURN NULL;
  END IF;

  IF v_cur_modelo = 'por_entrega' THEN
    v_valor := v_cur_valor;
  ELSE
    v_valor := greatest(round(coalesce(NEW.custo_mensal, 0), 2), 0);
  END IF;
  IF v_cur_valor = v_valor AND v_cur_dia IS NOT DISTINCT FROM v_dia THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.financeiro_acordo_versoes
    (conta_id, membro_id, vale_desde, funcao_id, modelo, valor, unidade, meta_quantidade, meta_periodo,
     limite_clientes, dia_pagamento, vigencia_inicio, vigencia_fim, arquivo_path, created_by)
  SELECT av.conta_id, av.membro_id, v_inicio, av.funcao_id, av.modelo, v_valor, av.unidade, av.meta_quantidade,
         av.meta_periodo, av.limite_clientes, v_dia, av.vigencia_inicio, av.vigencia_fim, av.arquivo_path, auth.uid()
    FROM public.financeiro_acordo_versoes av
   WHERE av.id = v_cur_id
  ON CONFLICT (membro_id, vale_desde) DO UPDATE
     SET valor = EXCLUDED.valor,
         dia_pagamento = EXCLUDED.dia_pagamento,
         created_by = EXCLUDED.created_by;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public._financeiro_v2_legado_trigger() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._financeiro_v2_legado_trigger() TO service_role;

DROP TRIGGER IF EXISTS trg_financeiro_v2_clientes_legado ON public.clientes;
CREATE TRIGGER trg_financeiro_v2_clientes_legado
  AFTER INSERT OR UPDATE OF valor_mensal, data_pagamento, status ON public.clientes
  FOR EACH ROW EXECUTE FUNCTION public._financeiro_v2_legado_trigger();

DROP TRIGGER IF EXISTS trg_financeiro_v2_membros_legado ON public.membros;
CREATE TRIGGER trg_financeiro_v2_membros_legado
  AFTER INSERT OR UPDATE OF custo_mensal, data_pagamento ON public.membros
  FOR EACH ROW EXECUTE FUNCTION public._financeiro_v2_legado_trigger();

DO $$
DECLARE
  v_fn text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY['public._financeiro_normalizar(text)',
                              'public._financeiro_encerrar_atribuicoes(uuid,bigint,date)',
                              'public._financeiro_v2_legado_trigger()'] LOOP
    IF has_function_privilege('authenticated', v_fn, 'EXECUTE')
       OR has_function_privilege('anon', v_fn, 'EXECUTE')
       OR NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '%: grants are not service_role only', v_fn;
    END IF;
  END LOOP;
  FOREACH v_fn IN ARRAY ARRAY['public.financeiro_seed(int)',
                              'public.financeiro_cliente_salvar(bigint,date,numeric,int,text)'] LOOP
    IF has_function_privilege('anon', v_fn, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', v_fn, 'EXECUTE')
       OR NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '%: grants are not authenticated + service_role', v_fn;
    END IF;
  END LOOP;
END
$$;
