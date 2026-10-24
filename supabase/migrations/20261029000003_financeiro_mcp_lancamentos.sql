SET LOCAL lock_timeout = '5s';

-- Financeiro MCP: the two lançamento writes that must be atomic (spec
-- docs/superpowers/specs/2026-10-23-mcp-financeiro-design.md, "RPCs de escrita dos
-- lançamentos" and "Confirmar agendamento"). Both are service_role only, for the MCP edge
-- function: feature_financial of p_conta, then p_user must be the owner of p_conta
-- (_financeiro_exigir_dono, 42501 owner_only). The caller's active workspace is never read.
--
--   financeiro_agendamento_confirmar_as(p_conta, p_user, p_origem, p_id, p_hoje)
--     Confirms the CURRENT month's agendado (America/Sao_Paulo; p_hoje only pins "today"
--     for tests, the tool never passes it) of a cliente / membro / recorrente as a paid
--     transacoes row, the same row the CRM writes when confirming its projection
--     (apps/crm/src/store/computed.ts projetarAgendamentos): same descricao, valor, tipo,
--     categoria, detalhe, day least(dia, last day of the month) and referencia_agendamento
--     ('<origem>_<id>_<yyyy>_<mm>'). Serialized per reference by an advisory lock, then
--     refused with ja_confirmado when a row with that reference already exists in the
--     workspace. No unique index (prod may hold old duplicates), and the CRM's own confirm
--     keeps going without the lock, as before.
--   financeiro_recorrente_criar_as(p_conta, p_user, ...)
--     Creates the recorrente template and, when asked, its first paid occurrence
--     (detalhe 'Recorrente', reference of p_data_primeiro's month) in the same transaction.
--     No idempotency key: a repeat creates another template.

-- ===========================================================================
-- Confirmar agendamento
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.financeiro_agendamento_confirmar_as(
  p_conta uuid, p_user uuid, p_origem text, p_id bigint, p_hoje date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_hoje      date := coalesce(p_hoje, (now() AT TIME ZONE 'America/Sao_Paulo')::date);
  v_mes       date;
  v_ultimo    int;
  v_achou     boolean := false;
  v_agendado  boolean := false;
  v_dia       int;
  v_valor     numeric;
  v_descricao text;
  v_tipo      text;
  v_detalhe   text := 'Agendamento automático';
  v_categoria text := 'Agendamento';
  v_ref       text;
  t           public.transacoes%ROWTYPE;
BEGIN
  IF public.effective_plan_feature(p_conta, 'feature_financial') IS NOT TRUE THEN
    RAISE EXCEPTION 'feature_disabled:feature_financial' USING ERRCODE = 'P0001';
  END IF;
  PERFORM public._financeiro_exigir_dono(p_conta, p_user);

  IF p_origem IS NULL OR p_origem NOT IN ('cliente', 'membro', 'recorrente') THEN
    RAISE EXCEPTION 'origem_invalida' USING ERRCODE = 'P0001';
  END IF;

  v_mes := date_trunc('month', v_hoje)::date;
  v_ultimo := extract(day FROM (v_mes + interval '1 month' - interval '1 day'))::int;

  -- Eligibility mirrors projetarAgendamentos for this month.
  IF p_origem = 'cliente' THEN
    SELECT true, c.status = 'ativo' AND c.data_pagamento >= 1, c.data_pagamento, c.valor_mensal, c.nome, 'entrada'
      INTO v_achou, v_agendado, v_dia, v_valor, v_descricao, v_tipo
      FROM public.clientes c
     WHERE c.id = p_id AND c.conta_id = p_conta;
  ELSIF p_origem = 'membro' THEN
    SELECT true, m.data_pagamento >= 1, m.data_pagamento, m.custo_mensal, m.nome, 'saida'
      INTO v_achou, v_agendado, v_dia, v_valor, v_descricao, v_tipo
      FROM public.membros m
     WHERE m.id = p_id AND m.conta_id = p_conta;
  ELSE
    SELECT true, r.inicio <= v_mes AND (r.fim IS NULL OR r.fim >= v_mes), r.dia, r.valor, r.descricao, r.tipo,
           'Recorrente', r.categoria
      INTO v_achou, v_agendado, v_dia, v_valor, v_descricao, v_tipo, v_detalhe, v_categoria
      FROM public.transacoes_recorrentes r
     WHERE r.id = p_id AND r.conta_id = p_conta;
  END IF;

  IF v_achou IS NOT TRUE THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_agendado IS NOT TRUE THEN
    RAISE EXCEPTION 'nao_agendado' USING ERRCODE = 'P0001';
  END IF;
  -- A null or zero value (member paid per delivery, client without a fee) is not
  -- confirmed as R$ 0.
  IF v_valor IS NULL OR v_valor <= 0 THEN
    RAISE EXCEPTION 'valor_indefinido' USING ERRCODE = 'P0001';
  END IF;

  v_ref := format('%s_%s_%s', p_origem, p_id, to_char(v_mes, 'YYYY_MM'));

  PERFORM pg_advisory_xact_lock(hashtextextended('agendamento:' || p_conta::text || ':' || v_ref, 0));
  IF EXISTS (SELECT 1 FROM public.transacoes x WHERE x.conta_id = p_conta AND x.referencia_agendamento = v_ref) THEN
    RAISE EXCEPTION 'ja_confirmado' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.transacoes
    (user_id, conta_id, data, descricao, detalhe, categoria, tipo, valor, status, referencia_agendamento)
  VALUES
    (p_user, p_conta, to_char(v_mes + (least(v_dia, v_ultimo) - 1), 'YYYY-MM-DD'), v_descricao, v_detalhe,
     v_categoria, v_tipo, v_valor, 'pago', v_ref)
  RETURNING * INTO t;

  RETURN jsonb_build_object(
    'id', t.id, 'data', t.data, 'descricao', t.descricao, 'detalhe', t.detalhe, 'categoria', t.categoria,
    'tipo', t.tipo, 'valor', t.valor, 'status', t.status, 'referencia_agendamento', t.referencia_agendamento);
END;
$$;

-- ===========================================================================
-- Criar recorrente (+ first paid occurrence)
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.financeiro_recorrente_criar_as(
  p_conta uuid, p_user uuid, p_tipo text, p_descricao text, p_categoria text, p_valor numeric,
  p_dia int, p_inicio date, p_registrar_primeiro_pago boolean, p_data_primeiro date)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r          public.transacoes_recorrentes%ROWTYPE;
  t          public.transacoes%ROWTYPE;
  v_lanc     jsonb := NULL;
BEGIN
  IF public.effective_plan_feature(p_conta, 'feature_financial') IS NOT TRUE THEN
    RAISE EXCEPTION 'feature_disabled:feature_financial' USING ERRCODE = 'P0001';
  END IF;
  PERFORM public._financeiro_exigir_dono(p_conta, p_user);

  -- The table's CHECKs validate tipo, descricao, valor, dia and inicio (23514).
  INSERT INTO public.transacoes_recorrentes (conta_id, user_id, tipo, descricao, categoria, valor, dia, inicio)
  VALUES (p_conta, p_user, p_tipo, trim(p_descricao), coalesce(p_categoria, ''), p_valor, p_dia, p_inicio)
  RETURNING * INTO r;

  IF p_registrar_primeiro_pago IS TRUE THEN
    -- The first payment is the starting month's occurrence; in any other month the template
    -- would still project its first month as agendado and the payment would not count for it.
    IF p_data_primeiro IS NULL OR date_trunc('month', p_data_primeiro)::date <> r.inicio THEN
      RAISE EXCEPTION USING ERRCODE = 'check_violation',
        MESSAGE = 'p_data_primeiro must fall in the month of p_inicio';
    END IF;
    INSERT INTO public.transacoes
      (user_id, conta_id, data, descricao, detalhe, categoria, tipo, valor, status, referencia_agendamento)
    VALUES
      (p_user, p_conta, to_char(p_data_primeiro, 'YYYY-MM-DD'), r.descricao, 'Recorrente', r.categoria, r.tipo,
       r.valor, 'pago', format('recorrente_%s_%s', r.id, to_char(p_data_primeiro, 'YYYY_MM')))
    RETURNING * INTO t;
    v_lanc := jsonb_build_object(
      'id', t.id, 'data', t.data, 'descricao', t.descricao, 'detalhe', t.detalhe, 'categoria', t.categoria,
      'tipo', t.tipo, 'valor', t.valor, 'status', t.status, 'referencia_agendamento', t.referencia_agendamento);
  END IF;

  RETURN jsonb_build_object(
    'recorrente', jsonb_build_object(
      'id', r.id, 'tipo', r.tipo, 'descricao', r.descricao, 'categoria', r.categoria, 'valor', r.valor,
      'dia', r.dia, 'inicio', r.inicio, 'fim', r.fim),
    'lancamento', v_lanc);
END;
$$;

-- ===========================================================================
-- Grants: service_role only
-- ===========================================================================

REVOKE ALL ON FUNCTION public.financeiro_agendamento_confirmar_as(uuid, uuid, text, bigint, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.financeiro_recorrente_criar_as(uuid, uuid, text, text, text, numeric, int, date, boolean, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.financeiro_agendamento_confirmar_as(uuid, uuid, text, bigint, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.financeiro_recorrente_criar_as(uuid, uuid, text, text, text, numeric, int, date, boolean, date) TO service_role;

DO $$
DECLARE
  v_fn text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY['public.financeiro_agendamento_confirmar_as(uuid,uuid,text,bigint,date)',
                              'public.financeiro_recorrente_criar_as(uuid,uuid,text,text,text,numeric,int,date,boolean,date)'] LOOP
    IF has_function_privilege('authenticated', v_fn, 'EXECUTE')
       OR has_function_privilege('anon', v_fn, 'EXECUTE')
       OR NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '%: grants are not service_role only', v_fn;
    END IF;
  END LOOP;
END
$$;

-- Rollback: docs/superpowers/rollbacks/20261029000003_financeiro_mcp_lancamentos.down.sql
