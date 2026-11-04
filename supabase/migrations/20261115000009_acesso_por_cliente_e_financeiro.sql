-- Acesso por cliente, Migração E (financeiro): o Financeiro de um membro restrito
-- cobre só os clientes atribuídos a ele (spec, "Financeiro restrito").
--   * _financeiro_calcular fica INTOCADO: é o rateio único e o fechamento do
--     pg_cron (financeiro_rolar_periodos, sem JWT) congela o snapshot com ele.
--     O filtro é da camada de leitura: _financeiro_rentabilidade_core ganha
--     p_cliente_ids (NULL = todos) e filtra o JSON do período aberto E o
--     snapshot do período fechado com _financeiro_filtrar_clientes.
--   * restrito: só as linhas dos clientes dele; custo de membro e despesa sem
--     cliente não entram, só o rateio que cai nos clientes dele; membros e
--     totais recalculados sobre esses clientes. Sem "é dele" no financeiro.
--   * escritas: todo financeiro_*_salvar recusa linha de cliente que ele não
--     acessa; escrita sem cliente ou cujo efeito se espalha pelos outros
--     clientes (acordo, atribuições, mudança de status do cliente, config,
--     função, seed, fechar e reabrir período) recusa o restrito:
--     client_scope_restricted (42501). Entregas manuais ficam por cliente: o
--     custo por entrega é quantidade x valor no próprio cliente, sem rateio.
--   * leitura direta: versões, atribuições e entregas por cliente; acordos
--     (custo de membro), períodos (snapshot completo) e recorrentes (despesa
--     sem cliente) nada; membros_v.custo_mensal NULL e escrita dele recusada;
--     transacoes e contratos com o predicado da Task 4, estrito (cliente NULL
--     some para o restrito).
--   * dono e "todos": saem no primeiro my_client_scope_all(), nenhuma outra
--     leitura, resultado byte a byte igual ao de antes.
-- As variantes _as (MCP, service_role) ficam com a migração 20261115000010.
-- Inventário: docs/superpowers/plans/2026-11-03-acesso-por-cliente-inventario.md
-- Spec: docs/superpowers/specs/2026-11-03-acesso-por-cliente-design.md

-- -------------------------------------------------------------
-- 0. Helpers (EXECUTE só service_role; as RPCs DEFINER os chamam como dono)
-- -------------------------------------------------------------
-- Escopo de um ator explícito (MCP / RPCs): true para dono e 'todos' na conta;
-- sem membership, false (nunca "todos").
CREATE OR REPLACE FUNCTION public.actor_client_scope_all(p_user uuid, p_conta uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_members wm
     WHERE wm.user_id = p_user AND wm.workspace_id = p_conta
       AND (wm.role = 'owner' OR wm.client_scope = 'todos')
  );
$$;

-- Clientes do ator na conta: NULL = todos; senão a lista (vazia se nenhuma
-- atribuição ou sem membership; nunca cai para todos).
CREATE OR REPLACE FUNCTION public.actor_cliente_ids(p_user uuid, p_conta uuid)
RETURNS bigint[]
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN public.actor_client_scope_all(p_user, p_conta) THEN NULL
    ELSE coalesce((SELECT array_agg(wmc.cliente_id ORDER BY wmc.cliente_id)
                     FROM public.workspace_member_clientes wmc
                    WHERE wmc.workspace_id = p_conta AND wmc.user_id = p_user), '{}'::bigint[])
  END;
$$;

-- Escrita financeira do ator: cada cliente da linha tem de ser acessível.
-- p_clientes NULL = linha sem cliente (custo de membro, configuração, período):
-- só quem vê todos.
CREATE OR REPLACE FUNCTION public._financeiro_exigir_clientes(p_user uuid, p_conta uuid, p_clientes bigint[])
RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.actor_client_scope_all(p_user, p_conta) THEN
    RETURN;
  END IF;
  IF p_clientes IS NULL OR EXISTS (
    SELECT 1 FROM unnest(p_clientes) x
     WHERE x IS NULL OR NOT public.can_access_cliente(p_user, p_conta, x)
  ) THEN
    RAISE EXCEPTION 'client_scope_restricted' USING ERRCODE = '42501';
  END IF;
END;
$$;

-- p_status difere do status vigente do cliente em p_vale_desde (ou o cliente
-- ainda não tem versão)? Mudança de status entra/sai do rateio dos membros.
CREATE OR REPLACE FUNCTION public._financeiro_status_muda(p_conta uuid, p_cliente_id bigint, p_vale_desde date, p_status text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_status IS DISTINCT FROM (
    SELECT cv.status FROM public.financeiro_cliente_versoes cv
     WHERE cv.conta_id = p_conta AND cv.cliente_id = p_cliente_id AND cv.vale_desde <= p_vale_desde
     ORDER BY cv.vale_desde DESC LIMIT 1);
$$;

-- O resultado de _financeiro_calcular (ou o snapshot de um período fechado)
-- reduzido aos clientes de p_cliente_ids (NULL = intacto):
--   clientes: só os da lista, cada um igual à linha original, exceto
--     pessoas[].total / n_clientes / regra, recalculados sobre a lista (o total
--     original revelaria o custo do membro, e n_clientes ou um "rateio" que
--     vem dos clientes ocultos revelaria que ele atende outros clientes);
--   membros: só quem tem linha num cliente da lista, com custo = soma das
--     linhas dele na lista, n_clientes = clientes ativos dele na lista;
--   totais: receita e custo sobre a lista; custo_sem_cliente = 0, custo_total
--     = custo dos clientes; por_funcao somado das linhas; incompleto idem.
-- Somas partem dos valores já arredondados da linha (centavos).
CREATE OR REPLACE FUNCTION public._financeiro_filtrar_clientes(p_doc jsonb, p_cliente_ids bigint[])
RETURNS jsonb
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
  WITH
  cli AS (
    SELECT x.c, x.ord
      FROM jsonb_array_elements(coalesce(p_doc->'clientes', '[]'::jsonb)) WITH ORDINALITY x(c, ord)
     WHERE (x.c->>'cliente_id')::bigint = ANY (p_cliente_ids)
  ),
  pes AS (
    SELECT (cli.c->>'cliente_id')::bigint AS cliente_id, cli.c->>'status' AS cstatus, y.p
      FROM cli, jsonb_array_elements(coalesce(cli.c->'pessoas', '[]'::jsonb)) y(p)
  ),
  mem AS (
    SELECT (pes.p->>'membro_id')::bigint AS membro_id,
           coalesce(sum((pes.p->>'valor')::numeric), 0) AS custo,
           count(DISTINCT pes.cliente_id) FILTER (WHERE pes.cstatus = 'ativo') AS n,
           coalesce(bool_or(pes.cstatus = 'ativo' AND pes.p->>'valor_unitario' IS NOT NULL
                            AND pes.p->>'quantidade' IS NULL), false) AS a_informar
      FROM pes
     GROUP BY 1
  ),
  cli2 AS (
    SELECT cli.ord,
           cli.c || jsonb_build_object('pessoas', coalesce((
             SELECT jsonb_agg(y.p || jsonb_build_object(
                      'total', trim_scale(round(mem.custo, 2)),
                      'n_clientes', mem.n,
                      'regra', CASE WHEN y.p->>'regra' = 'entrega' THEN 'entrega'
                                    WHEN mem.n = 1 THEN 'exclusivo'
                                    ELSE 'rateio' END) ORDER BY y.o)
               FROM jsonb_array_elements(coalesce(cli.c->'pessoas', '[]'::jsonb)) WITH ORDINALITY y(p, o)
               JOIN mem ON mem.membro_id = (y.p->>'membro_id')::bigint), '[]'::jsonb)) AS c
      FROM cli
  ),
  mem2 AS (
    SELECT z.o,
           z.m || jsonb_build_object(
             'custo', trim_scale(round(mem.custo, 2)),
             'n_clientes', mem.n,
             'por_cliente', CASE WHEN z.m->>'modelo' <> 'por_entrega' AND z.m->>'funcao_id' IS NOT NULL AND mem.n > 0
                                 THEN trim_scale(round(mem.custo / mem.n, 2)) END,
             'a_informar', mem.a_informar) AS m
      FROM jsonb_array_elements(coalesce(p_doc->'membros', '[]'::jsonb)) WITH ORDINALITY z(m, o)
      JOIN mem ON mem.membro_id = (z.m->>'membro_id')::bigint
  ),
  tot AS (
    SELECT coalesce(sum((cli.c->>'receita')::numeric), 0) AS receita,
           coalesce(sum((cli.c->>'custo')::numeric), 0) AS custo
      FROM cli
  ),
  pf AS (
    SELECT k.k, coalesce((SELECT sum((cli.c->'por_funcao'->>k.k)::numeric) FROM cli), 0) AS v
      FROM jsonb_object_keys(coalesce(p_doc->'totais'->'por_funcao', '{}'::jsonb)) k(k)
  )
  SELECT CASE
    WHEN p_cliente_ids IS NULL OR p_doc IS NULL OR NOT (p_doc ? 'clientes') THEN p_doc
    ELSE p_doc || jsonb_build_object(
      'clientes', coalesce((SELECT jsonb_agg(cli2.c ORDER BY cli2.ord) FROM cli2), '[]'::jsonb),
      'membros', coalesce((SELECT jsonb_agg(mem2.m ORDER BY mem2.o) FROM mem2), '[]'::jsonb),
      'totais', coalesce(p_doc->'totais', '{}'::jsonb) || (
        SELECT jsonb_build_object(
                 'receita', trim_scale(round(tot.receita, 2)),
                 'custo_clientes', trim_scale(round(tot.custo, 2)),
                 'custo_sem_cliente', 0,
                 'custo_total', trim_scale(round(tot.custo, 2)),
                 'lucro', trim_scale(round(tot.receita - tot.custo, 2)),
                 'margem', CASE WHEN tot.receita = 0 THEN NULL
                                ELSE trim_scale(round((tot.receita - tot.custo) / tot.receita, 4)) END,
                 'por_funcao', coalesce((SELECT jsonb_object_agg(pf.k, trim_scale(round(pf.v, 2))) FROM pf), '{}'::jsonb))
          FROM tot),
      'incompleto', EXISTS (SELECT 1 FROM cli WHERE (cli.c->>'a_informar')::boolean)
                    OR EXISTS (SELECT 1 FROM mem WHERE mem.a_informar))
  END;
$$;

REVOKE ALL ON FUNCTION public.actor_client_scope_all(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.actor_client_scope_all(uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.actor_cliente_ids(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.actor_cliente_ids(uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public._financeiro_exigir_clientes(uuid, uuid, bigint[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._financeiro_exigir_clientes(uuid, uuid, bigint[]) TO service_role;
REVOKE ALL ON FUNCTION public._financeiro_status_muda(uuid, bigint, date, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._financeiro_status_muda(uuid, bigint, date, text) TO service_role;
REVOKE ALL ON FUNCTION public._financeiro_filtrar_clientes(jsonb, bigint[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._financeiro_filtrar_clientes(jsonb, bigint[]) TO service_role;

-- -------------------------------------------------------------
-- 1. Leitura: _financeiro_rentabilidade_core(p_cliente_ids)
-- -------------------------------------------------------------
-- Assinatura nova: DROP da antiga para não ficar sobrecarga ambígua. Chamadas
-- com 3 argumentos (financeiro_rentabilidade_as até a 20261115000010) caem no
-- DEFAULT NULL = todos.
DROP FUNCTION public._financeiro_rentabilidade_core(uuid, uuid, date);
CREATE FUNCTION public._financeiro_rentabilidade_core(
  p_conta uuid, p_user uuid, p_inicio date, p_cliente_ids bigint[] DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_conta    uuid := p_conta;
  v_seeded   timestamptz;
  v_dia      int;
  v_inicio   date;
  v_status   text;
  v_snapshot jsonb;
  v_result   jsonb;
BEGIN
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
      v_result := jsonb_set(v_snapshot, '{periodo,status}', to_jsonb(v_status));
    END IF;
  ELSIF p_inicio IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(public._financeiro_periodos_editaveis_core(v_conta, p_user)) e
     WHERE (e->>'inicio')::date = p_inicio
  ) THEN
    RAISE EXCEPTION 'periodo_invalido' USING ERRCODE = 'P0001';
  END IF;

  IF v_result IS NULL THEN
    v_result := public._financeiro_calcular(v_conta, v_inicio);
  END IF;
  -- [escopo] só os clientes do restrito (aberto e fechado); NULL = intacto
  IF p_cliente_ids IS NOT NULL THEN
    RETURN public._financeiro_filtrar_clientes(v_result, p_cliente_ids);
  END IF;
  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION public._financeiro_rentabilidade_core(uuid, uuid, date, bigint[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._financeiro_rentabilidade_core(uuid, uuid, date, bigint[]) TO service_role;

CREATE OR REPLACE FUNCTION public.financeiro_rentabilidade(p_inicio date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  -- [escopo] NULL para quem vê todos; senão os clientes dele (vazio = nenhum)
  RETURN public._financeiro_rentabilidade_core(v_conta, auth.uid(), p_inicio,
    CASE WHEN (SELECT public.my_client_scope_all()) THEN NULL
         ELSE public.actor_cliente_ids(auth.uid(), v_conta) END);
END;
$function$;

-- financeiro_periodos_listar / _editaveis: só datas e status de período, nenhum
-- número de cliente. Ficam como estão.

-- -------------------------------------------------------------
-- 2. Escritas (authenticated)
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.financeiro_cliente_salvar(p_cliente_id bigint, p_vale_desde date, p_valor_mensal numeric, p_dia_pagamento integer, p_status text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  -- [escopo] cliente da linha acessível; mudar o status (ativo, pausado,
  -- encerrado) muda o rateio dos membros dele nos outros clientes: só quem vê
  -- todos. Valor e dia de pagamento só mexem no cliente dele.
  IF NOT (SELECT public.my_client_scope_all()) THEN
    PERFORM public._financeiro_exigir_clientes(auth.uid(), v_conta, ARRAY[p_cliente_id]);
    IF public._financeiro_status_muda(v_conta, p_cliente_id, p_vale_desde, p_status) THEN
      PERFORM public._financeiro_exigir_clientes(auth.uid(), v_conta, NULL);
    END IF;
  END IF;
  PERFORM public._financeiro_cliente_salvar_core(
    v_conta, auth.uid(), p_cliente_id, p_vale_desde, p_valor_mensal, p_dia_pagamento, p_status);
END;
$function$;

CREATE OR REPLACE FUNCTION public.financeiro_atribuicoes_salvar(p_vale_desde date, p_mudancas jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  -- [escopo] atribuir ou tirar um membro de um cliente muda o rateio dele em
  -- todos os outros clientes, inclusive os ocultos: só quem vê todos, mesmo
  -- que a mudança seja num cliente dele
  IF NOT (SELECT public.my_client_scope_all()) THEN
    PERFORM public._financeiro_exigir_clientes(auth.uid(), v_conta, NULL);
  END IF;
  PERFORM public._financeiro_atribuicoes_salvar_core(v_conta, auth.uid(), p_vale_desde, p_mudancas);
END;
$function$;

CREATE OR REPLACE FUNCTION public.financeiro_entregas_salvar(p_inicio date, p_membro_id bigint, p_itens jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  -- [escopo] todo cliente_id dos itens
  IF NOT (SELECT public.my_client_scope_all()) THEN
    PERFORM public._financeiro_exigir_clientes(auth.uid(), v_conta, (
      SELECT coalesce(array_agg(CASE WHEN e->>'cliente_id' ~ '^[0-9]{1,18}$' THEN (e->>'cliente_id')::bigint END),
                      '{}'::bigint[])
        FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_itens) = 'array' THEN p_itens
                                       ELSE '[]'::jsonb END) e));
  END IF;
  PERFORM public._financeiro_entregas_salvar_core(v_conta, auth.uid(), p_inicio, p_membro_id, p_itens);
END;
$function$;

-- Escritas sem cliente: o restrito não vê esses números, não grava.
CREATE OR REPLACE FUNCTION public.financeiro_acordo_salvar(p_membro_id bigint, p_vale_desde date, p_acordo jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  -- [escopo] custo de membro: sem cliente
  IF NOT (SELECT public.my_client_scope_all()) THEN
    PERFORM public._financeiro_exigir_clientes(auth.uid(), v_conta, NULL);
  END IF;
  PERFORM public._financeiro_acordo_salvar_core(v_conta, auth.uid(), p_membro_id, p_vale_desde, p_acordo);
END;
$function$;

CREATE OR REPLACE FUNCTION public.financeiro_config_salvar(p_periodo_dia integer, p_meta_margem numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  -- [escopo] configuração do workspace: sem cliente
  IF NOT (SELECT public.my_client_scope_all()) THEN
    PERFORM public._financeiro_exigir_clientes(auth.uid(), v_conta, NULL);
  END IF;
  PERFORM public._financeiro_config_salvar_core(v_conta, auth.uid(), p_periodo_dia, p_meta_margem);
END;
$function$;

CREATE OR REPLACE FUNCTION public.financeiro_funcao_salvar(p_id bigint, p_nome text, p_ordem integer)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  -- [escopo] função (rótulo do workspace): sem cliente
  IF NOT (SELECT public.my_client_scope_all()) THEN
    PERFORM public._financeiro_exigir_clientes(auth.uid(), v_conta, NULL);
  END IF;
  RETURN public._financeiro_funcao_salvar_core(v_conta, auth.uid(), p_id, p_nome, p_ordem);
END;
$function$;

CREATE OR REPLACE FUNCTION public.financeiro_funcao_excluir(p_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  -- [escopo] função (rótulo do workspace): sem cliente
  IF NOT (SELECT public.my_client_scope_all()) THEN
    PERFORM public._financeiro_exigir_clientes(auth.uid(), v_conta, NULL);
  END IF;
  PERFORM public._financeiro_funcao_excluir_core(v_conta, auth.uid(), p_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.financeiro_seed(p_periodo_dia integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  -- [escopo] o seed copia todos os clientes e membros: só quem vê todos
  IF NOT (SELECT public.my_client_scope_all()) THEN
    PERFORM public._financeiro_exigir_clientes(auth.uid(), v_conta, NULL);
  END IF;
  RETURN public._financeiro_seed_core(v_conta, auth.uid(), p_periodo_dia);
END;
$function$;

CREATE OR REPLACE FUNCTION public.financeiro_periodo_fechar(p_inicio date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_conta uuid := public.get_my_conta_id();
  v_role  text;
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
  -- [escopo] o fechamento congela o período inteiro (admin pode ser restrito)
  IF NOT (SELECT public.my_client_scope_all()) THEN
    PERFORM public._financeiro_exigir_clientes(auth.uid(), v_conta, NULL);
  END IF;
  PERFORM public._financeiro_periodo_fechar_core(v_conta, auth.uid(), p_inicio);
END;
$function$;

CREATE OR REPLACE FUNCTION public.financeiro_periodo_reabrir(p_inicio date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_conta uuid := public.get_my_conta_id();
  v_role  text;
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
  -- [escopo] reabrir destrava o período inteiro (admin pode ser restrito)
  IF NOT (SELECT public.my_client_scope_all()) THEN
    PERFORM public._financeiro_exigir_clientes(auth.uid(), v_conta, NULL);
  END IF;
  PERFORM public._financeiro_periodo_reabrir_core(v_conta, auth.uid(), p_inicio);
END;
$function$;

-- -------------------------------------------------------------
-- 3. Leitura direta das tabelas financeiro_* (SELECT para authenticated)
-- -------------------------------------------------------------
-- Com cliente: só as linhas dos clientes dele.
ALTER POLICY financeiro_cliente_versoes_select ON public.financeiro_cliente_versoes
  USING ((conta_id IN (SELECT public.get_my_conta_id()))
         AND (SELECT public.effective_plan_feature(financeiro_cliente_versoes.conta_id, 'feature_financial'::text))
         AND (SELECT public.effective_plan_feature(financeiro_cliente_versoes.conta_id, 'feature_financeiro_v2'::text))
         AND (SELECT public.can_see_financials())
         AND ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(cliente_id)));
ALTER POLICY financeiro_atribuicoes_select ON public.financeiro_atribuicoes
  USING ((conta_id IN (SELECT public.get_my_conta_id()))
         AND (SELECT public.effective_plan_feature(financeiro_atribuicoes.conta_id, 'feature_financial'::text))
         AND (SELECT public.effective_plan_feature(financeiro_atribuicoes.conta_id, 'feature_financeiro_v2'::text))
         AND (SELECT public.can_see_financials())
         AND ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(cliente_id)));
ALTER POLICY financeiro_entregas_manuais_select ON public.financeiro_entregas_manuais
  USING ((conta_id IN (SELECT public.get_my_conta_id()))
         AND (SELECT public.effective_plan_feature(financeiro_entregas_manuais.conta_id, 'feature_financial'::text))
         AND (SELECT public.effective_plan_feature(financeiro_entregas_manuais.conta_id, 'feature_financeiro_v2'::text))
         AND (SELECT public.can_see_financials())
         AND ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(cliente_id)));
-- Sem cliente: acordos (custo de membro) e períodos (o snapshot congela o
-- cálculo do workspace inteiro; o CRM lê períodos só pelas RPCs).
ALTER POLICY financeiro_acordo_versoes_select ON public.financeiro_acordo_versoes
  USING ((conta_id IN (SELECT public.get_my_conta_id()))
         AND (SELECT public.effective_plan_feature(financeiro_acordo_versoes.conta_id, 'feature_financial'::text))
         AND (SELECT public.effective_plan_feature(financeiro_acordo_versoes.conta_id, 'feature_financeiro_v2'::text))
         AND (SELECT public.can_see_financials())
         AND (SELECT public.my_client_scope_all()));
ALTER POLICY financeiro_periodos_select ON public.financeiro_periodos
  USING ((conta_id IN (SELECT public.get_my_conta_id()))
         AND (SELECT public.effective_plan_feature(financeiro_periodos.conta_id, 'feature_financial'::text))
         AND (SELECT public.effective_plan_feature(financeiro_periodos.conta_id, 'feature_financeiro_v2'::text))
         AND (SELECT public.can_see_financials())
         AND (SELECT public.my_client_scope_all()));
-- financeiro_config e financeiro_funcoes: sem valores, ficam como estão.

-- -------------------------------------------------------------
-- 4. Legado: transacoes e contratos (predicados da Task 4, estritos: sem
--    "é dele", cliente NULL só para quem vê todos); recorrentes não têm
--    cliente (despesa do workspace): só quem vê todos
-- -------------------------------------------------------------
ALTER POLICY transacoes_select ON public.transacoes
  USING ((conta_id IN (SELECT public.get_my_conta_id())) AND (SELECT public.can_see_financials())
         AND ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(cliente_id)));
ALTER POLICY transacoes_insert ON public.transacoes
  WITH CHECK ((conta_id IN (SELECT public.get_my_conta_id())) AND (SELECT public.can_see_financials())
              AND (SELECT public.has_permission('financeiro'::text, 'editar'::text))
              AND ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(cliente_id)));
ALTER POLICY transacoes_update ON public.transacoes
  USING ((conta_id IN (SELECT public.get_my_conta_id())) AND (SELECT public.can_see_financials())
         AND (SELECT public.has_permission('financeiro'::text, 'editar'::text))
         AND ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(cliente_id)))
  WITH CHECK ((conta_id IN (SELECT public.get_my_conta_id())) AND (SELECT public.can_see_financials())
              AND (SELECT public.has_permission('financeiro'::text, 'editar'::text))
              AND ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(cliente_id)));
ALTER POLICY transacoes_delete ON public.transacoes
  USING ((conta_id IN (SELECT public.get_my_conta_id())) AND (SELECT public.can_see_financials())
         AND (SELECT public.has_permission('financeiro'::text, 'editar'::text))
         AND ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(cliente_id)));

ALTER POLICY contratos_select ON public.contratos
  USING ((conta_id IN (SELECT public.get_my_conta_id())) AND (SELECT public.has_permission('contratos'::text, 'ver'::text))
         AND ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(cliente_id)));
ALTER POLICY contratos_insert ON public.contratos
  WITH CHECK ((conta_id IN (SELECT public.get_my_conta_id())) AND (SELECT public.has_permission('contratos'::text, 'editar'::text))
              AND ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(cliente_id)));
ALTER POLICY contratos_update ON public.contratos
  USING ((conta_id IN (SELECT public.get_my_conta_id())) AND (SELECT public.has_permission('contratos'::text, 'editar'::text))
         AND ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(cliente_id)))
  WITH CHECK ((conta_id IN (SELECT public.get_my_conta_id())) AND (SELECT public.has_permission('contratos'::text, 'editar'::text))
              AND ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(cliente_id)));
ALTER POLICY contratos_delete ON public.contratos
  USING ((conta_id IN (SELECT public.get_my_conta_id())) AND (SELECT public.has_permission('contratos'::text, 'editar'::text))
         AND ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(cliente_id)));

ALTER POLICY transacoes_recorrentes_select ON public.transacoes_recorrentes
  USING ((conta_id IN (SELECT public.get_my_conta_id())) AND (SELECT public.can_see_financials())
         AND (SELECT public.my_client_scope_all()));
ALTER POLICY transacoes_recorrentes_insert ON public.transacoes_recorrentes
  WITH CHECK ((conta_id IN (SELECT public.get_my_conta_id())) AND (SELECT public.can_see_financials())
              AND (SELECT public.has_permission('financeiro'::text, 'editar'::text))
              AND (SELECT public.my_client_scope_all()));
ALTER POLICY transacoes_recorrentes_update ON public.transacoes_recorrentes
  USING ((conta_id IN (SELECT public.get_my_conta_id())) AND (SELECT public.can_see_financials())
         AND (SELECT public.has_permission('financeiro'::text, 'editar'::text))
         AND (SELECT public.my_client_scope_all()))
  WITH CHECK ((conta_id IN (SELECT public.get_my_conta_id())) AND (SELECT public.can_see_financials())
              AND (SELECT public.has_permission('financeiro'::text, 'editar'::text))
              AND (SELECT public.my_client_scope_all()));
ALTER POLICY transacoes_recorrentes_delete ON public.transacoes_recorrentes
  USING ((conta_id IN (SELECT public.get_my_conta_id())) AND (SELECT public.can_see_financials())
         AND (SELECT public.has_permission('financeiro'::text, 'editar'::text))
         AND (SELECT public.my_client_scope_all()));

-- -------------------------------------------------------------
-- 5. Custo de membro na coluna legada (membros_v, dashboard, agendamentos)
-- -------------------------------------------------------------
-- Mesma definição de 20261002000001 + "[escopo]": o restrito lê custo NULL.
CREATE OR REPLACE VIEW public.membros_v WITH (security_barrier = true) AS
  SELECT m.id, m.user_id, m.conta_id, m.nome, m.cargo, m.tipo,
         m.avatar_url, m.data_pagamento, m.created_at, m.crm_user_id,
         CASE WHEN (SELECT public.can_see_financials()) AND (SELECT public.my_client_scope_all()) -- [escopo]
              THEN m.custo_mensal ELSE NULL END AS custo_mensal
  FROM public.membros m
  WHERE m.conta_id = public.get_my_conta_id();

-- E não grava o que não lê: um formulário de membro com o custo em branco
-- zeraria o custo real (e, pelo trigger legado, o acordo do período aberto).
CREATE OR REPLACE FUNCTION public.guard_financial_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  col     text := TG_ARGV[0];
  old_val numeric;
  new_val numeric;
BEGIN
  IF auth.role() = 'service_role'
     OR current_user IN ('postgres', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  EXECUTE format('SELECT ($1).%I', col) INTO new_val USING NEW;
  IF TG_OP = 'UPDATE' THEN
    EXECUTE format('SELECT ($1).%I', col) INTO old_val USING OLD;
  END IF;

  -- Only a CHANGE to the financial value is guarded. An INSERT carrying NULL,
  -- or an UPDATE that leaves the column alone, passes untouched — otherwise a
  -- restricted admin could not change a phone number.
  IF (TG_OP = 'INSERT' AND new_val IS NOT NULL)
     OR (TG_OP = 'UPDATE' AND new_val IS DISTINCT FROM old_val) THEN
    -- Migração B: exige EDITAR (era can_see_financials(), i.e. VER).
    IF public.has_permission('financeiro', 'editar') IS NOT TRUE THEN
      RAISE EXCEPTION 'financial_access_denied'
        USING HINT = format('column %s requires financial access', col);
    END IF;
    -- [escopo] custo de membro não tem cliente: o restrito não o vê (membros_v)
    -- nem o grava. Valor de cliente (clientes) já passa pela RLS do cliente.
    IF TG_TABLE_NAME = 'membros' AND NOT public.my_client_scope_all() THEN
      RAISE EXCEPTION 'client_scope_restricted' USING ERRCODE = '42501',
        HINT = format('column %s has no client', col);
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- -------------------------------------------------------------
-- 6. Status do cliente pelo caminho legado (UPDATE em clientes)
-- -------------------------------------------------------------
-- Mesma definição de 20261027000005 (pg_get_functiondef) + "[escopo]".
CREATE OR REPLACE FUNCTION public._financeiro_v2_legado_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  -- shared, before reading the latest aberto period: waits for a running roll /
  -- reabrir / fechar of this workspace (exclusive, same key). Unseeded workspaces
  -- (most legacy writes) never take it.
  PERFORM pg_advisory_xact_lock_shared(public._financeiro_lock_key(NEW.conta_id));
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
    -- [escopo] mudar o status do cliente (UPDATE direto em clientes) muda o rateio
    -- dos membros nos outros clientes: só quem vê todos, como em
    -- financeiro_cliente_salvar. Valor e dia seguem. Cron e service role
    -- (auth.uid() NULL) passam em my_client_scope_all().
    IF (NOT v_achou OR v_cur_status IS DISTINCT FROM v_status)
       AND NOT public.my_client_scope_all() THEN
      RAISE EXCEPTION 'client_scope_restricted' USING ERRCODE = '42501';
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
$function$;

-- -------------------------------------------------------------
-- 7. Status do cliente conferido de novo sob lock
-- -------------------------------------------------------------
-- Mesma definição de 20261029000002 (pg_get_functiondef) + "[escopo]".
CREATE OR REPLACE FUNCTION public._financeiro_cliente_salvar_core(p_conta uuid, p_user uuid, p_cliente_id bigint, p_vale_desde date, p_valor_mensal numeric, p_dia_pagamento integer, p_status text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_conta  uuid := p_conta;
  v_aberto date;
BEGIN
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
  -- [escopo] o wrapper já recusou a mudança de status do restrito, mas leu o
  -- status antes deste lock: trava a linha do cliente (todo caminho que grava a
  -- versão do cliente passa por ela: este core e o trigger legado, que roda
  -- num UPDATE da própria linha) e confere de novo aqui dentro.
  PERFORM 1 FROM public.clientes c WHERE c.id = p_cliente_id AND c.conta_id = v_conta FOR UPDATE;
  IF NOT public.actor_client_scope_all(p_user, v_conta)
     AND public._financeiro_status_muda(v_conta, p_cliente_id, p_vale_desde, p_status) THEN
    RAISE EXCEPTION 'client_scope_restricted' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.financeiro_cliente_versoes
    (conta_id, cliente_id, vale_desde, valor_mensal, dia_pagamento, status, created_by)
  VALUES (v_conta, p_cliente_id, p_vale_desde, p_valor_mensal, p_dia_pagamento, p_status, p_user)
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
$function$;

-- -------------------------------------------------------------
-- 8. Storage: contratos dos acordos (financeiro-acordos)
-- -------------------------------------------------------------
-- <conta_id>/<membro_id>/<uuid>.<ext>: o contrato mostra o custo cheio do
-- membro, sem cliente. Mesma definição de 20261027000007 + "[escopo]": só quem
-- vê todos lista, baixa ou envia. Não há policy de UPDATE nem DELETE no bucket.
DROP POLICY IF EXISTS "financeiro_acordos_select" ON storage.objects;
CREATE POLICY "financeiro_acordos_select"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'financeiro-acordos'
    AND (storage.foldername(name))[1] = (SELECT public.get_my_conta_id())::text
    AND EXISTS (
      SELECT 1 FROM public.membros m
      WHERE m.id::text = (storage.foldername(name))[2]
        AND m.conta_id = (SELECT public.get_my_conta_id())
    )
    AND (SELECT public.effective_plan_feature((SELECT public.get_my_conta_id()), 'feature_financial'))
    AND (SELECT public.effective_plan_feature((SELECT public.get_my_conta_id()), 'feature_financeiro_v2'))
    AND (SELECT public.can_see_financials())
    AND (SELECT public.my_client_scope_all()) -- [escopo]
  );

DROP POLICY IF EXISTS "financeiro_acordos_insert" ON storage.objects;
CREATE POLICY "financeiro_acordos_insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'financeiro-acordos'
    AND (storage.foldername(name))[1] = (SELECT public.get_my_conta_id())::text
    AND EXISTS (
      SELECT 1 FROM public.membros m
      WHERE m.id::text = (storage.foldername(name))[2]
        AND m.conta_id = (SELECT public.get_my_conta_id())
    )
    AND (SELECT public.effective_plan_feature((SELECT public.get_my_conta_id()), 'feature_financial'))
    AND (SELECT public.effective_plan_feature((SELECT public.get_my_conta_id()), 'feature_financeiro_v2'))
    AND (SELECT public.has_permission('financeiro', 'editar'))
    AND (SELECT public.my_client_scope_all()) -- [escopo]
  );
