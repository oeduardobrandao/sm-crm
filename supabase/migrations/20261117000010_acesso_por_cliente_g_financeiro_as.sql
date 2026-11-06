-- Acesso por cliente, Migração G (financeiro do MCP): as variantes _as do
-- Financeiro (service_role, chamadas pelo mcp com p_user = o ator) aplicam o
-- mesmo escopo das gêmeas authenticated (20261117000009), julgado para p_user
-- em p_conta:
--   * leitura (financeiro_rentabilidade_as): só os clientes do ator
--     (actor_cliente_ids: NULL para dono e 'todos'; sem membership, lista vazia,
--     nunca todos);
--   * escrita: cliente da linha acessível ao ator (can_access_cliente(uuid,
--     uuid, bigint)); linha sem cliente ou com efeito sobre outros clientes
--     (acordo, atribuições, status do cliente, config, função, seed, período,
--     recorrente, agendamento) só para quem vê todos; client_scope_restricted.
-- Hoje as ferramentas financeiro:* do MCP são só do dono e _financeiro_exigir_dono
-- roda antes (dono é sempre irrestrito), então nada muda para quem chama: o
-- escopo vem DEPOIS da checagem de dono, que segue dando owner_only a todo não
-- dono (mensagem do mcp inalterada). É defesa em profundidade para o dia em que
-- a regra de dono afrouxar; o teste troca _financeiro_exigir_dono por um no-op
-- dentro da transação para exercitar o escopo.
-- financeiro_periodos_listar_as / _editaveis_as: só datas e status, inalteradas.
-- Corpo de cada RPC = definição atual (pg_get_functiondef) + as linhas
-- "[escopo]"; CREATE OR REPLACE mantém assinatura, volatilidade e ACL.
-- Spec: docs/superpowers/specs/2026-11-03-acesso-por-cliente-design.md

CREATE OR REPLACE FUNCTION public.financeiro_acordo_salvar_as(p_conta uuid, p_user uuid, p_membro_id bigint, p_vale_desde date, p_acordo jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF public.effective_plan_feature(p_conta, 'feature_financial') IS NOT TRUE THEN
    RAISE EXCEPTION 'feature_disabled:feature_financial' USING ERRCODE = 'P0001';
  END IF;
  IF public.effective_plan_feature(p_conta, 'feature_financeiro_v2') IS NOT TRUE THEN
    RAISE EXCEPTION 'feature_disabled:feature_financeiro_v2' USING ERRCODE = 'P0001';
  END IF;
  PERFORM public._financeiro_exigir_dono(p_conta, p_user);
  -- [escopo] linha sem cliente
  PERFORM public._financeiro_exigir_clientes(p_user, p_conta, NULL);
  PERFORM public._financeiro_acordo_salvar_core(p_conta, p_user, p_membro_id, p_vale_desde, p_acordo);
END;$function$;

CREATE OR REPLACE FUNCTION public.financeiro_agendamento_confirmar_as(p_conta uuid, p_user uuid, p_origem text, p_id bigint, p_hoje date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  -- [escopo] o lançamento é gravado sem cliente (cliente_id NULL) em toda origem
  PERFORM public._financeiro_exigir_clientes(p_user, p_conta, NULL);

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
END;$function$;

CREATE OR REPLACE FUNCTION public.financeiro_atribuicoes_salvar_as(p_conta uuid, p_user uuid, p_vale_desde date, p_mudancas jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF public.effective_plan_feature(p_conta, 'feature_financial') IS NOT TRUE THEN
    RAISE EXCEPTION 'feature_disabled:feature_financial' USING ERRCODE = 'P0001';
  END IF;
  IF public.effective_plan_feature(p_conta, 'feature_financeiro_v2') IS NOT TRUE THEN
    RAISE EXCEPTION 'feature_disabled:feature_financeiro_v2' USING ERRCODE = 'P0001';
  END IF;
  PERFORM public._financeiro_exigir_dono(p_conta, p_user);
  -- [escopo] mudar atribuição muda o rateio do membro em todos os clientes:
  -- só quem vê todos, mesmo num cliente do ator
  PERFORM public._financeiro_exigir_clientes(p_user, p_conta, NULL);
  PERFORM public._financeiro_atribuicoes_salvar_core(p_conta, p_user, p_vale_desde, p_mudancas);
END;$function$;

CREATE OR REPLACE FUNCTION public.financeiro_cliente_salvar_as(p_conta uuid, p_user uuid, p_cliente_id bigint, p_vale_desde date, p_valor_mensal numeric, p_dia_pagamento integer, p_status text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF public.effective_plan_feature(p_conta, 'feature_financial') IS NOT TRUE THEN
    RAISE EXCEPTION 'feature_disabled:feature_financial' USING ERRCODE = 'P0001';
  END IF;
  IF public.effective_plan_feature(p_conta, 'feature_financeiro_v2') IS NOT TRUE THEN
    RAISE EXCEPTION 'feature_disabled:feature_financeiro_v2' USING ERRCODE = 'P0001';
  END IF;
  PERFORM public._financeiro_exigir_dono(p_conta, p_user);
  -- [escopo] cliente da linha; mudar o status muda o rateio nos outros clientes
  PERFORM public._financeiro_exigir_clientes(p_user, p_conta, ARRAY[p_cliente_id]);
  IF public._financeiro_status_muda(p_conta, p_cliente_id, p_vale_desde, p_status) THEN
    PERFORM public._financeiro_exigir_clientes(p_user, p_conta, NULL);
  END IF;
  PERFORM public._financeiro_cliente_salvar_core(
    p_conta, p_user, p_cliente_id, p_vale_desde, p_valor_mensal, p_dia_pagamento, p_status);
END;$function$;

CREATE OR REPLACE FUNCTION public.financeiro_config_salvar_as(p_conta uuid, p_user uuid, p_periodo_dia integer, p_meta_margem numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF public.effective_plan_feature(p_conta, 'feature_financial') IS NOT TRUE THEN
    RAISE EXCEPTION 'feature_disabled:feature_financial' USING ERRCODE = 'P0001';
  END IF;
  IF public.effective_plan_feature(p_conta, 'feature_financeiro_v2') IS NOT TRUE THEN
    RAISE EXCEPTION 'feature_disabled:feature_financeiro_v2' USING ERRCODE = 'P0001';
  END IF;
  PERFORM public._financeiro_exigir_dono(p_conta, p_user);
  -- [escopo] linha sem cliente
  PERFORM public._financeiro_exigir_clientes(p_user, p_conta, NULL);
  PERFORM public._financeiro_config_salvar_core(p_conta, p_user, p_periodo_dia, p_meta_margem);
END;$function$;

CREATE OR REPLACE FUNCTION public.financeiro_entregas_salvar_as(p_conta uuid, p_user uuid, p_inicio date, p_membro_id bigint, p_itens jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF public.effective_plan_feature(p_conta, 'feature_financial') IS NOT TRUE THEN
    RAISE EXCEPTION 'feature_disabled:feature_financial' USING ERRCODE = 'P0001';
  END IF;
  IF public.effective_plan_feature(p_conta, 'feature_financeiro_v2') IS NOT TRUE THEN
    RAISE EXCEPTION 'feature_disabled:feature_financeiro_v2' USING ERRCODE = 'P0001';
  END IF;
  PERFORM public._financeiro_exigir_dono(p_conta, p_user);
  -- [escopo] todo cliente_id dos itens
  PERFORM public._financeiro_exigir_clientes(p_user, p_conta, (SELECT coalesce(array_agg(CASE WHEN e->>'cliente_id' ~ '^[0-9]{1,18}$' THEN (e->>'cliente_id')::bigint END),
                      '{}'::bigint[])
        FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_itens) = 'array' THEN p_itens
                                       ELSE '[]'::jsonb END) e));
  PERFORM public._financeiro_entregas_salvar_core(p_conta, p_user, p_inicio, p_membro_id, p_itens);
END;$function$;

CREATE OR REPLACE FUNCTION public.financeiro_funcao_excluir_as(p_conta uuid, p_user uuid, p_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF public.effective_plan_feature(p_conta, 'feature_financial') IS NOT TRUE THEN
    RAISE EXCEPTION 'feature_disabled:feature_financial' USING ERRCODE = 'P0001';
  END IF;
  IF public.effective_plan_feature(p_conta, 'feature_financeiro_v2') IS NOT TRUE THEN
    RAISE EXCEPTION 'feature_disabled:feature_financeiro_v2' USING ERRCODE = 'P0001';
  END IF;
  PERFORM public._financeiro_exigir_dono(p_conta, p_user);
  -- [escopo] linha sem cliente
  PERFORM public._financeiro_exigir_clientes(p_user, p_conta, NULL);
  PERFORM public._financeiro_funcao_excluir_core(p_conta, p_user, p_id);
END;$function$;

CREATE OR REPLACE FUNCTION public.financeiro_funcao_salvar_as(p_conta uuid, p_user uuid, p_id bigint, p_nome text, p_ordem integer)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF public.effective_plan_feature(p_conta, 'feature_financial') IS NOT TRUE THEN
    RAISE EXCEPTION 'feature_disabled:feature_financial' USING ERRCODE = 'P0001';
  END IF;
  IF public.effective_plan_feature(p_conta, 'feature_financeiro_v2') IS NOT TRUE THEN
    RAISE EXCEPTION 'feature_disabled:feature_financeiro_v2' USING ERRCODE = 'P0001';
  END IF;
  PERFORM public._financeiro_exigir_dono(p_conta, p_user);
  -- [escopo] linha sem cliente
  PERFORM public._financeiro_exigir_clientes(p_user, p_conta, NULL);
  RETURN public._financeiro_funcao_salvar_core(p_conta, p_user, p_id, p_nome, p_ordem);
END;$function$;

CREATE OR REPLACE FUNCTION public.financeiro_periodo_fechar_as(p_conta uuid, p_user uuid, p_inicio date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF public.effective_plan_feature(p_conta, 'feature_financial') IS NOT TRUE THEN
    RAISE EXCEPTION 'feature_disabled:feature_financial' USING ERRCODE = 'P0001';
  END IF;
  IF public.effective_plan_feature(p_conta, 'feature_financeiro_v2') IS NOT TRUE THEN
    RAISE EXCEPTION 'feature_disabled:feature_financeiro_v2' USING ERRCODE = 'P0001';
  END IF;
  PERFORM public._financeiro_exigir_dono(p_conta, p_user);
  -- [escopo] linha sem cliente
  PERFORM public._financeiro_exigir_clientes(p_user, p_conta, NULL);
  PERFORM public._financeiro_periodo_fechar_core(p_conta, p_user, p_inicio);
END;$function$;

CREATE OR REPLACE FUNCTION public.financeiro_periodo_reabrir_as(p_conta uuid, p_user uuid, p_inicio date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF public.effective_plan_feature(p_conta, 'feature_financial') IS NOT TRUE THEN
    RAISE EXCEPTION 'feature_disabled:feature_financial' USING ERRCODE = 'P0001';
  END IF;
  IF public.effective_plan_feature(p_conta, 'feature_financeiro_v2') IS NOT TRUE THEN
    RAISE EXCEPTION 'feature_disabled:feature_financeiro_v2' USING ERRCODE = 'P0001';
  END IF;
  PERFORM public._financeiro_exigir_dono(p_conta, p_user);
  -- [escopo] linha sem cliente
  PERFORM public._financeiro_exigir_clientes(p_user, p_conta, NULL);
  PERFORM public._financeiro_periodo_reabrir_core(p_conta, p_user, p_inicio);
END;$function$;

CREATE OR REPLACE FUNCTION public.financeiro_recorrente_criar_as(p_conta uuid, p_user uuid, p_tipo text, p_descricao text, p_categoria text, p_valor numeric, p_dia integer, p_inicio date, p_registrar_primeiro_pago boolean, p_data_primeiro date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  r          public.transacoes_recorrentes%ROWTYPE;
  t          public.transacoes%ROWTYPE;
  v_lanc     jsonb := NULL;
BEGIN
  IF public.effective_plan_feature(p_conta, 'feature_financial') IS NOT TRUE THEN
    RAISE EXCEPTION 'feature_disabled:feature_financial' USING ERRCODE = 'P0001';
  END IF;
  PERFORM public._financeiro_exigir_dono(p_conta, p_user);
  -- [escopo] recorrente e lançamento sem cliente
  PERFORM public._financeiro_exigir_clientes(p_user, p_conta, NULL);

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
END;$function$;

CREATE OR REPLACE FUNCTION public.financeiro_rentabilidade_as(p_conta uuid, p_user uuid, p_inicio date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF public.effective_plan_feature(p_conta, 'feature_financial') IS NOT TRUE THEN
    RAISE EXCEPTION 'feature_disabled:feature_financial' USING ERRCODE = 'P0001';
  END IF;
  IF public.effective_plan_feature(p_conta, 'feature_financeiro_v2') IS NOT TRUE THEN
    RAISE EXCEPTION 'feature_disabled:feature_financeiro_v2' USING ERRCODE = 'P0001';
  END IF;
  PERFORM public._financeiro_exigir_dono(p_conta, p_user);
  -- [escopo] clientes do ator (NULL = todos; sem membership = nenhum)
  RETURN public._financeiro_rentabilidade_core(p_conta, p_user, p_inicio,
    public.actor_cliente_ids(p_user, p_conta));
END;$function$;

CREATE OR REPLACE FUNCTION public.financeiro_seed_as(p_conta uuid, p_user uuid, p_periodo_dia integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF public.effective_plan_feature(p_conta, 'feature_financial') IS NOT TRUE THEN
    RAISE EXCEPTION 'feature_disabled:feature_financial' USING ERRCODE = 'P0001';
  END IF;
  IF public.effective_plan_feature(p_conta, 'feature_financeiro_v2') IS NOT TRUE THEN
    RAISE EXCEPTION 'feature_disabled:feature_financeiro_v2' USING ERRCODE = 'P0001';
  END IF;
  PERFORM public._financeiro_exigir_dono(p_conta, p_user);
  -- [escopo] linha sem cliente
  PERFORM public._financeiro_exigir_clientes(p_user, p_conta, NULL);
  RETURN public._financeiro_seed_core(p_conta, p_user, p_periodo_dia);
END;$function$;
