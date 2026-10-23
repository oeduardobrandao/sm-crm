SET LOCAL lock_timeout = '5s';

-- Financeiro v2: calculation layer.
-- Section 1 (this block): period helpers. Pure IMMUTABLE date functions, no auth
-- and no table access, so they are not SECURITY DEFINER. p_dia is always 1..28
-- (the config CHECK guarantees it), so there is no missing day 29..31 to handle.
-- Section 2: allocation core (_financeiro_calcular) and the read RPCs.

-- ===========================================================================
-- Section 1: period helpers
-- ===========================================================================

-- End (exclusive) of the period starting at p_inicio: one month later when the
-- start already sits on p_dia, otherwise the first date after p_inicio on p_dia
-- (the transition period when periodo_dia changes).
CREATE OR REPLACE FUNCTION public.financeiro_periodo_fim(p_inicio date, p_dia int)
RETURNS date
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN extract(day FROM p_inicio)::int = p_dia
      THEN (p_inicio + interval '1 month')::date
    WHEN make_date(extract(year FROM p_inicio)::int, extract(month FROM p_inicio)::int, p_dia) > p_inicio
      THEN make_date(extract(year FROM p_inicio)::int, extract(month FROM p_inicio)::int, p_dia)
    ELSE (make_date(extract(year FROM p_inicio)::int, extract(month FROM p_inicio)::int, p_dia)
          + interval '1 month')::date
  END;
$$;

-- Start of the period containing p_data: the latest date <= p_data on p_dia.
CREATE OR REPLACE FUNCTION public.financeiro_periodo_inicio_de(p_data date, p_dia int)
RETURNS date
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN make_date(extract(year FROM p_data)::int, extract(month FROM p_data)::int, p_dia) <= p_data
      THEN make_date(extract(year FROM p_data)::int, extract(month FROM p_data)::int, p_dia)
    ELSE (make_date(extract(year FROM p_data)::int, extract(month FROM p_data)::int, p_dia)
          - interval '1 month')::date
  END;
$$;

-- Label: 'out 2026' for a full calendar month, else '15 out a 14 nov'; the year
-- goes on both sides only when the first and last day fall in different years.
-- Explicit month array on purpose: to_char(..., 'TMmon') depends on the server locale.
CREATE OR REPLACE FUNCTION public.financeiro_periodo_rotulo(p_inicio date, p_fim date)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  WITH m AS (
    SELECT ARRAY['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'] AS nomes
  ), u AS (
    SELECT p_fim - 1 AS ultimo
  )
  SELECT CASE
    WHEN extract(day FROM p_inicio)::int = 1 AND p_fim = (p_inicio + interval '1 month')::date
      THEN m.nomes[extract(month FROM p_inicio)::int] || ' ' || extract(year FROM p_inicio)::int
    WHEN extract(year FROM p_inicio) <> extract(year FROM u.ultimo)
      THEN extract(day FROM p_inicio)::int || ' ' || m.nomes[extract(month FROM p_inicio)::int]
           || ' ' || extract(year FROM p_inicio)::int
           || ' a ' ||
           extract(day FROM u.ultimo)::int || ' ' || m.nomes[extract(month FROM u.ultimo)::int]
           || ' ' || extract(year FROM u.ultimo)::int
    ELSE extract(day FROM p_inicio)::int || ' ' || m.nomes[extract(month FROM p_inicio)::int]
         || ' a ' ||
         extract(day FROM u.ultimo)::int || ' ' || m.nomes[extract(month FROM u.ultimo)::int]
  END
  FROM m, u;
$$;

-- Pro-rata factor: days in the period / days in the month starting at p_inicio.
-- 1 for a full period.
CREATE OR REPLACE FUNCTION public.financeiro_periodo_fator(p_inicio date, p_fim date)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT (p_fim - p_inicio)::numeric
       / ((p_inicio + interval '1 month')::date - p_inicio)::numeric;
$$;

REVOKE ALL ON FUNCTION public.financeiro_periodo_fim(date, int) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.financeiro_periodo_inicio_de(date, int) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.financeiro_periodo_rotulo(date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.financeiro_periodo_fator(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.financeiro_periodo_fim(date, int) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.financeiro_periodo_inicio_de(date, int) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.financeiro_periodo_rotulo(date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.financeiro_periodo_fator(date, date) TO authenticated, service_role;

-- ===========================================================================
-- Section 2: allocation core and read RPCs
-- ===========================================================================
-- _financeiro_calcular is the ONE calculation of a period: the live screens
-- (financeiro_rentabilidade) and the close job's frozen snapshots (pg_cron) both
-- call it, so a closed period and the live screen can never disagree on a rule.
--
-- Rules (spec "Cost allocation" and "Paused and ended clients"):
--   * The effective version of a client or acordo at a period is the row with the
--     greatest vale_desde <= inicio. Clients / members with none are not listed.
--   * An assignment is active when desde <= inicio AND (ate IS NULL OR ate > inicio).
--   * Clients listed: status ativo or pausado (encerrado omitted), ordered by nome.
--     Receita = valor_mensal x fator for ativo, 0 for pausado.
--   * Monthly members (mensal_meta / mensal_limite) cost valor x fator, split evenly
--     over their assigned ATIVO clients (n_clientes). regra 'exclusivo' when that is
--     one client, else 'rateio'. Pausado clients are out of every split.
--   * Por entrega members cost quantidade x valor per assigned client (not pro-rated).
--     No quantity on an ativo client: valor 0 and a_informar. A quantity entered for
--     a pausado client still counts on that client (it is a delivery, not a split).
--   * A member with no funcao has no client allocation: their whole cost is
--     custo_sem_cliente, as is a monthly member with zero ativo clients.
--   * Money is computed at full precision and each output cell is rounded to 2
--     decimals on its own; totals come from the unrounded values. So column sums can
--     differ from a total by a cent, but custo_total is always the exact sum of the
--     members' costs and custo_clientes + custo_sem_cliente = custo_total.
--   * margem = lucro / receita rounded to 4 decimals, null when receita = 0.

-- Internal: no auth calls, the workspace is explicit. service_role only.
CREATE OR REPLACE FUNCTION public._financeiro_calcular(p_conta uuid, p_inicio date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_dia       int;
  v_meta      numeric;
  v_fim       date;
  v_status    text;
  v_transicao boolean;
  v_fator     numeric;
  v_result    jsonb;
BEGIN
  IF p_conta IS NULL OR p_inicio IS NULL THEN
    RAISE EXCEPTION 'periodo_invalido' USING ERRCODE = 'P0001';
  END IF;

  SELECT c.periodo_dia, c.meta_margem INTO v_dia, v_meta
    FROM public.financeiro_config c WHERE c.conta_id = p_conta;
  v_dia := coalesce(v_dia, 1);
  v_meta := coalesce(v_meta, 55);

  SELECT p.fim, p.status, p.transicao INTO v_fim, v_status, v_transicao
    FROM public.financeiro_periodos p WHERE p.conta_id = p_conta AND p.inicio = p_inicio;
  IF NOT FOUND THEN
    -- projected period (no row yet)
    v_fim := public.financeiro_periodo_fim(p_inicio, v_dia);
    v_status := 'futuro';
    v_transicao := v_fim <> (p_inicio + interval '1 month')::date;
  END IF;
  v_fator := public.financeiro_periodo_fator(p_inicio, v_fim);

  WITH
  fn AS (
    SELECT f.id, f.nome, f.ordem FROM public.financeiro_funcoes f WHERE f.conta_id = p_conta
  ),
  cv AS (
    SELECT DISTINCT ON (v.cliente_id) v.cliente_id, v.valor_mensal, v.status
      FROM public.financeiro_cliente_versoes v
     WHERE v.conta_id = p_conta AND v.vale_desde <= p_inicio
     ORDER BY v.cliente_id, v.vale_desde DESC
  ),
  cli AS (
    SELECT c.id AS cliente_id, c.nome, cv.status,
           CASE WHEN cv.status = 'ativo' THEN cv.valor_mensal * v_fator ELSE 0 END AS receita
      FROM cv JOIN public.clientes c ON c.id = cv.cliente_id AND c.conta_id = p_conta
     WHERE cv.status IN ('ativo', 'pausado')
  ),
  av AS (
    SELECT DISTINCT ON (a.membro_id) a.membro_id, a.funcao_id, a.modelo, a.valor, a.limite_clientes
      FROM public.financeiro_acordo_versoes a
     WHERE a.conta_id = p_conta AND a.vale_desde <= p_inicio
     ORDER BY a.membro_id, a.vale_desde DESC
  ),
  mem AS (
    SELECT m.id AS membro_id, m.nome, fn.id AS funcao_id, fn.ordem AS funcao_ordem,
           av.modelo, av.valor, av.limite_clientes
      FROM av JOIN public.membros m ON m.id = av.membro_id AND m.conta_id = p_conta
      LEFT JOIN fn ON fn.id = av.funcao_id
  ),
  -- active assignments between listed members and listed clients
  par AS (
    SELECT DISTINCT t.membro_id, t.cliente_id, cli.status AS cliente_status
      FROM public.financeiro_atribuicoes t
      JOIN mem ON mem.membro_id = t.membro_id
      JOIN cli ON cli.cliente_id = t.cliente_id
     WHERE t.conta_id = p_conta AND t.desde <= p_inicio AND (t.ate IS NULL OR t.ate > p_inicio)
  ),
  nc AS (
    SELECT par.membro_id, count(*) FILTER (WHERE par.cliente_status = 'ativo') AS n
      FROM par GROUP BY par.membro_id
  ),
  aloc AS (
    SELECT par.membro_id, par.cliente_id, par.cliente_status,
           mem.funcao_id, mem.modelo, mem.valor, coalesce(nc.n, 0) AS n, e.quantidade,
           CASE WHEN mem.modelo = 'por_entrega' THEN 'entrega'
                WHEN coalesce(nc.n, 0) = 1 THEN 'exclusivo'
                ELSE 'rateio' END AS regra,
           CASE WHEN mem.modelo = 'por_entrega' THEN coalesce(e.quantidade, 0) * mem.valor
                WHEN par.cliente_status = 'ativo' AND nc.n > 0 THEN mem.valor * v_fator / nc.n
                ELSE 0 END AS valor_cli
      FROM par
      JOIN mem ON mem.membro_id = par.membro_id
      LEFT JOIN nc ON nc.membro_id = par.membro_id
      LEFT JOIN public.financeiro_entregas_manuais e
        ON e.conta_id = p_conta AND e.periodo_inicio = p_inicio
       AND e.membro_id = par.membro_id AND e.cliente_id = par.cliente_id
  ),
  -- the lines that land on a client: members with a funcao, on an ativo client, or a
  -- per-delivery quantity entered for a pausado one
  linha AS (
    SELECT * FROM aloc
     WHERE funcao_id IS NOT NULL
       AND (cliente_status = 'ativo' OR (modelo = 'por_entrega' AND quantidade IS NOT NULL))
  ),
  ent AS (
    SELECT aloc.membro_id, sum(aloc.valor_cli) AS custo,
           bool_or(aloc.cliente_status = 'ativo' AND aloc.quantidade IS NULL) AS falta
      FROM aloc WHERE aloc.modelo = 'por_entrega' GROUP BY aloc.membro_id
  ),
  mc AS (
    SELECT mem.membro_id, mem.nome, mem.funcao_id, mem.funcao_ordem, mem.modelo, mem.limite_clientes,
           coalesce(nc.n, 0) AS n,
           CASE WHEN mem.modelo = 'por_entrega' THEN coalesce(ent.custo, 0)
                ELSE mem.valor * v_fator END AS custo,
           coalesce(ent.falta, false) AS a_informar
      FROM mem
      LEFT JOIN nc ON nc.membro_id = mem.membro_id
      LEFT JOIN ent ON ent.membro_id = mem.membro_id
  ),
  -- client x funcao cost, every pair (0 when nobody), computed once
  cf AS (
    SELECT cli.cliente_id, fn.id AS funcao_id, coalesce(sum(l.valor_cli), 0) AS v
      FROM cli CROSS JOIN fn
      LEFT JOIN linha l ON l.cliente_id = cli.cliente_id AND l.funcao_id = fn.id
     GROUP BY cli.cliente_id, fn.id
  ),
  cpf AS (
    SELECT cf.cliente_id, jsonb_object_agg(cf.funcao_id::text, trim_scale(round(cf.v, 2))) AS obj
      FROM cf GROUP BY cf.cliente_id
  ),
  -- who serves each listed client: every assigned member with a funcao, on any client
  -- status. A pausado client keeps its people (at valor 0 unless a per-delivery quantity
  -- was entered) so the screens show the assignments it resumes with; costs and totals
  -- stay on `linha`.
  pes AS (
    SELECT l.cliente_id,
           jsonb_agg(jsonb_build_object(
             'membro_id', l.membro_id,
             'nome', mc.nome,
             'funcao_id', l.funcao_id,
             'regra', l.regra,
             'valor', trim_scale(round(l.valor_cli, 2)),
             'total', trim_scale(round(mc.custo, 2)),
             'n_clientes', mc.n,
             'quantidade', CASE WHEN l.modelo = 'por_entrega' THEN l.quantidade END,
             'valor_unitario', CASE WHEN l.modelo = 'por_entrega' THEN trim_scale(round(l.valor, 2)) END
           ) ORDER BY mc.funcao_ordem, mc.nome, l.membro_id) AS arr
      FROM aloc l JOIN mc ON mc.membro_id = l.membro_id
     WHERE l.funcao_id IS NOT NULL
     GROUP BY l.cliente_id
  ),
  cagg AS (
    SELECT cli.cliente_id, cli.nome, cli.status, cli.receita,
           coalesce(sum(l.valor_cli), 0) AS custo,
           coalesce(bool_or(l.modelo = 'por_entrega' AND l.quantidade IS NULL), false) AS a_informar
      FROM cli LEFT JOIN linha l ON l.cliente_id = cli.cliente_id
     GROUP BY cli.cliente_id, cli.nome, cli.status, cli.receita
  ),
  tot AS (
    SELECT (SELECT coalesce(sum(cli.receita), 0) FROM cli) AS receita,
           (SELECT coalesce(sum(linha.valor_cli), 0) FROM linha) AS custo_clientes,
           (SELECT coalesce(sum(mc.custo), 0) FROM mc) AS custo_total
  )
  SELECT jsonb_build_object(
    'seeded', true,
    'periodo', jsonb_build_object(
      'inicio', p_inicio,
      'fim', v_fim,
      'rotulo', public.financeiro_periodo_rotulo(p_inicio, v_fim),
      'status', v_status,
      'transicao', v_transicao,
      'fator', trim_scale(round(v_fator, 4))),
    'meta_margem', trim_scale(v_meta),
    'funcoes', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', fn.id, 'nome', fn.nome, 'ordem', fn.ordem) ORDER BY fn.ordem, fn.id)
        FROM fn), '[]'::jsonb),
    'clientes', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'cliente_id', ca.cliente_id,
               'nome', ca.nome,
               'status', ca.status,
               'receita', trim_scale(round(ca.receita, 2)),
               'custo', trim_scale(round(ca.custo, 2)),
               'lucro', trim_scale(round(ca.receita - ca.custo, 2)),
               'margem', CASE WHEN ca.receita = 0 THEN NULL
                              ELSE trim_scale(round((ca.receita - ca.custo) / ca.receita, 4)) END,
               'a_informar', ca.a_informar,
               'por_funcao', coalesce(cpf.obj, '{}'::jsonb),
               'pessoas', coalesce(pes.arr, '[]'::jsonb)
             ) ORDER BY ca.nome, ca.cliente_id)
        FROM cagg ca
        LEFT JOIN cpf ON cpf.cliente_id = ca.cliente_id
        LEFT JOIN pes ON pes.cliente_id = ca.cliente_id), '[]'::jsonb),
    'membros', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'membro_id', mc.membro_id,
               'nome', mc.nome,
               'funcao_id', mc.funcao_id,
               'modelo', mc.modelo,
               'custo', trim_scale(round(mc.custo, 2)),
               'n_clientes', mc.n,
               'limite_clientes', mc.limite_clientes,
               'por_cliente', CASE WHEN mc.modelo <> 'por_entrega' AND mc.funcao_id IS NOT NULL AND mc.n > 0
                                   THEN trim_scale(round(mc.custo / mc.n, 2)) END,
               'a_informar', mc.a_informar
             ) ORDER BY mc.funcao_ordem NULLS LAST, mc.nome, mc.membro_id)
        FROM mc), '[]'::jsonb),
    'totais', (
      SELECT jsonb_build_object(
               'receita', trim_scale(round(tot.receita, 2)),
               'custo_clientes', trim_scale(round(tot.custo_clientes, 2)),
               'custo_sem_cliente', trim_scale(round(tot.custo_total - tot.custo_clientes, 2)),
               'custo_total', trim_scale(round(tot.custo_total, 2)),
               'lucro', trim_scale(round(tot.receita - tot.custo_total, 2)),
               'margem', CASE WHEN tot.receita = 0 THEN NULL
                              ELSE trim_scale(round((tot.receita - tot.custo_total) / tot.receita, 4)) END,
               'por_funcao', coalesce((
                 SELECT jsonb_object_agg(s.funcao_id::text, trim_scale(round(s.v, 2)))
                   FROM (SELECT fn.id AS funcao_id, coalesce(sum(cf.v), 0) AS v
                           FROM fn LEFT JOIN cf ON cf.funcao_id = fn.id
                          GROUP BY fn.id) s), '{}'::jsonb))
        FROM tot),
    'incompleto', EXISTS (SELECT 1 FROM cagg WHERE cagg.a_informar)
                  OR EXISTS (SELECT 1 FROM mc WHERE mc.a_informar)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- Editable periods: every reaberto period, the current aberto one (the latest open
-- row: while the close job is late an ended period can still be aberto, and only
-- the newest is offered) and the next 2 projected starts (status 'futuro'), which
-- begin at the newest row's fim, or at the period containing today (Sao Paulo)
-- when the workspace has no period row yet. Chronological (oldest first).
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

-- The profitability of a period for the caller's workspace. p_inicio NULL = the
-- latest period that is not fechado, else the latest one (and, with no period row
-- at all, the period containing today). A fechado period returns its snapshot
-- verbatim; any other is computed live. A start that is neither a period row nor a
-- projected start of financeiro_periodos_editaveis() is periodo_invalido.
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
      RETURN v_snapshot;
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

REVOKE ALL ON FUNCTION public._financeiro_calcular(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._financeiro_calcular(uuid, date) TO service_role;
REVOKE ALL ON FUNCTION public.financeiro_rentabilidade(date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.financeiro_periodos_listar() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.financeiro_periodos_editaveis() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.financeiro_rentabilidade(date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.financeiro_periodos_listar() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.financeiro_periodos_editaveis() TO authenticated, service_role;

DO $$
DECLARE
  v_fn text;
BEGIN
  IF has_function_privilege('authenticated', 'public._financeiro_calcular(uuid,date)', 'EXECUTE')
     OR has_function_privilege('anon', 'public._financeiro_calcular(uuid,date)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public._financeiro_calcular(uuid,date)', 'EXECUTE') THEN
    RAISE EXCEPTION '_financeiro_calcular: grants are not service_role only';
  END IF;
  FOREACH v_fn IN ARRAY ARRAY['public.financeiro_rentabilidade(date)', 'public.financeiro_periodos_listar()',
                              'public.financeiro_periodos_editaveis()'] LOOP
    IF has_function_privilege('anon', v_fn, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', v_fn, 'EXECUTE')
       OR NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '%: grants are not authenticated + service_role', v_fn;
    END IF;
  END LOOP;
END
$$;
