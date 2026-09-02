-- Deadline math mirrored from the frontend (getDeadlineInfo / etapaDeadlineDateOf):
-- data_limite wins and means "até o fim do dia local"; otherwise iniciado_em +
-- prazo_dias (dias úteis = seg-sex, sem feriados). Weekday checks use p_tz so a
-- 22h BRT start does not flip to the next UTC day.

CREATE OR REPLACE FUNCTION add_business_days(p_start timestamptz, p_days int, p_tz text)
RETURNS timestamptz
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  remaining int := p_days;
  cursor_ts timestamptz := p_start;
BEGIN
  WHILE remaining > 0 LOOP
    cursor_ts := cursor_ts + interval '1 day';
    IF extract(isodow FROM cursor_ts AT TIME ZONE p_tz) < 6 THEN
      remaining := remaining - 1;
    END IF;
  END LOOP;
  RETURN cursor_ts;
END;
$$;

CREATE OR REPLACE FUNCTION etapa_deadline(
  p_data_limite date,
  p_iniciado_em timestamptz,
  p_prazo_dias int,
  p_tipo_prazo text,
  p_tz text
) RETURNS timestamptz
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_data_limite IS NOT NULL
      THEN ((p_data_limite + 1)::timestamp AT TIME ZONE p_tz)
    WHEN p_iniciado_em IS NULL THEN NULL
    WHEN p_tipo_prazo = 'uteis'
      THEN add_business_days(p_iniciado_em, p_prazo_dias, p_tz)
    ELSE p_iniciado_em + make_interval(days => p_prazo_dias)
  END;
$$;

-- Workspace analytics aggregate. SECURITY INVOKER + explicit conta_id filter on
-- every relation that has one; workflow_etapas (no conta_id) only via the wf join.
-- Returns NULL when there is no active workspace or the plan lacks
-- feature_analytics_reports (fail-closed; the service maps NULL -> not_entitled).
CREATE OR REPLACE FUNCTION get_workflow_analytics(
  p_from timestamptz,
  p_to timestamptz,
  p_tz text DEFAULT 'America/Sao_Paulo',
  p_cliente_id bigint DEFAULT NULL,
  p_template_id bigint DEFAULT NULL,
  p_membro_id bigint DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
WITH guard AS (
  SELECT c.conta_id
  FROM (SELECT get_my_conta_id() AS conta_id) c
  WHERE c.conta_id IS NOT NULL
    AND effective_plan_feature(c.conta_id, 'feature_analytics_reports')
),
wf AS (
  SELECT w.*
  FROM workflows w
  JOIN guard g ON w.conta_id = g.conta_id
  WHERE w.status <> 'arquivado'
    AND (p_cliente_id IS NULL OR w.cliente_id = p_cliente_id)
    AND (p_template_id IS NULL OR w.template_id = p_template_id)
),
concluidos AS (
  SELECT * FROM wf
  WHERE status = 'concluido' AND concluido_em >= p_from AND concluido_em < p_to
),
concluidos_prev AS (
  SELECT * FROM wf
  WHERE status = 'concluido'
    AND concluido_em >= p_from - (p_to - p_from) AND concluido_em < p_from
),
inicio AS (
  SELECT e.workflow_id, min(e.iniciado_em) AS iniciado_em
  FROM workflow_etapas e
  JOIN wf w ON w.id = e.workflow_id
  GROUP BY e.workflow_id
),
dur AS (
  SELECT extract(epoch FROM c.concluido_em - COALESCE(i.iniciado_em, c.created_at)) / 86400.0 AS dias
  FROM concluidos c LEFT JOIN inicio i ON i.workflow_id = c.id
),
dur_prev AS (
  SELECT extract(epoch FROM c.concluido_em - COALESCE(i.iniciado_em, c.created_at)) / 86400.0 AS dias
  FROM concluidos_prev c LEFT JOIN inicio i ON i.workflow_id = c.id
),
et_done AS (
  SELECT e.*,
         etapa_deadline(e.data_limite::date, e.iniciado_em, e.prazo_dias, e.tipo_prazo, p_tz) AS deadline
  FROM workflow_etapas e
  JOIN wf w ON w.id = e.workflow_id
  WHERE e.status = 'concluido'
    AND e.concluido_em >= p_from AND e.concluido_em < p_to
    AND (p_membro_id IS NULL OR e.responsavel_id = p_membro_id)
),
et_done_prev AS (
  SELECT e.*,
         etapa_deadline(e.data_limite::date, e.iniciado_em, e.prazo_dias, e.tipo_prazo, p_tz) AS deadline
  FROM workflow_etapas e
  JOIN wf w ON w.id = e.workflow_id
  WHERE e.status = 'concluido'
    AND e.concluido_em >= p_from - (p_to - p_from) AND e.concluido_em < p_from
    AND (p_membro_id IS NULL OR e.responsavel_id = p_membro_id)
),
etapas_agg AS (
  SELECT nome,
         avg(extract(epoch FROM concluido_em - iniciado_em) / 86400.0)
           FILTER (WHERE iniciado_em IS NOT NULL) AS media_dias,
         count(*) AS amostras,
         round(100.0 * count(*) FILTER (WHERE deadline IS NOT NULL AND concluido_em > deadline)
               / NULLIF(count(*) FILTER (WHERE deadline IS NOT NULL), 0)) AS atraso_pct
  FROM et_done
  GROUP BY nome
),
semanas AS (
  SELECT to_char(date_trunc('week', concluido_em AT TIME ZONE p_tz), 'YYYY-MM-DD') AS semana,
         count(*) AS concluidos
  FROM concluidos GROUP BY 1
),
semanas_criados AS (
  SELECT to_char(date_trunc('week', created_at AT TIME ZONE p_tz), 'YYYY-MM-DD') AS semana,
         count(*) AS criados
  FROM wf
  WHERE created_at >= p_from AND created_at < p_to
  GROUP BY 1
),
equipe AS (
  SELECT responsavel_id AS membro_id,
         count(*) AS concluidas,
         avg(extract(epoch FROM concluido_em - iniciado_em) / 86400.0)
           FILTER (WHERE iniciado_em IS NOT NULL) AS media_dias,
         count(*) FILTER (WHERE deadline IS NOT NULL AND concluido_em <= deadline) AS no_prazo,
         count(*) FILTER (WHERE deadline IS NOT NULL AND concluido_em > deadline) AS atrasadas,
         count(*) FILTER (WHERE deadline IS NOT NULL) AS avaliadas
  FROM et_done
  WHERE responsavel_id IS NOT NULL
  GROUP BY responsavel_id
)
SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM guard) THEN NULL ELSE jsonb_build_object(
  'kpis', jsonb_build_object(
    'concluidos',        (SELECT count(*) FROM concluidos),
    'concluidos_prev',   (SELECT count(*) FROM concluidos_prev),
    'ativos',            (SELECT count(*) FROM wf WHERE status = 'ativo'),
    'tempo_medio_dias',  (SELECT round(avg(dias)::numeric, 2) FROM dur),
    'tempo_medio_prev',  (SELECT round(avg(dias)::numeric, 2) FROM dur_prev),
    'pontualidade_pct',  (SELECT round(100.0 * count(*) FILTER (WHERE concluido_em <= deadline)
                                 / NULLIF(count(*) FILTER (WHERE deadline IS NOT NULL), 0))
                            FROM et_done),
    'pontualidade_prev', (SELECT round(100.0 * count(*) FILTER (WHERE concluido_em <= deadline)
                                 / NULLIF(count(*) FILTER (WHERE deadline IS NOT NULL), 0))
                            FROM et_done_prev),
    'etapas_avaliadas',  (SELECT count(*) FILTER (WHERE deadline IS NOT NULL) FROM et_done)
  ),
  'etapas', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'nome', nome,
                'media_dias', round(media_dias::numeric, 2),
                'amostras', amostras,
                'atraso_pct', atraso_pct)
              ORDER BY media_dias DESC NULLS LAST) FROM etapas_agg), '[]'::jsonb),
  'semanas', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'semana', s.semana,
                'concluidos', s.concluidos,
                'criados', COALESCE(sc.criados, 0))
              ORDER BY s.semana)
              FROM semanas s LEFT JOIN semanas_criados sc ON sc.semana = s.semana), '[]'::jsonb),
  'semanas_criados_sem_conclusao', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'semana', sc.semana, 'criados', sc.criados) ORDER BY sc.semana)
              FROM semanas_criados sc
              WHERE NOT EXISTS (SELECT 1 FROM semanas s WHERE s.semana = sc.semana)), '[]'::jsonb),
  'equipe', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'membro_id', membro_id,
                'concluidas', concluidas,
                'media_dias', round(media_dias::numeric, 2),
                'no_prazo', no_prazo,
                'atrasadas', atrasadas,
                'avaliadas', avaliadas)
              ORDER BY concluidas DESC) FROM equipe), '[]'::jsonb)
) END;
$$;

GRANT EXECUTE ON FUNCTION get_workflow_analytics(timestamptz, timestamptz, text, bigint, bigint, bigint) TO authenticated;
