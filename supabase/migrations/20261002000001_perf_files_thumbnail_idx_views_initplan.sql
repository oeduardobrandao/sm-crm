-- Performance: findings 5 and 1d of docs/superpowers/specs/2026-10-01-db-query-performance-audit.md
--
-- 1) files.thumbnail_r2_key has no index. post-media-cleanup-cron's orphan scan
--    looks files up by `thumbnail_r2_key = ANY(...)` (~30k calls/week), each a full
--    seq scan of the table. Plain CREATE INDEX, not CONCURRENTLY: db push runs each
--    migration inside a transaction, and the table is ~15k rows.
--    Full index, not partial: the cron's `= ANY($1)` arrives as a bound
--    parameter, so the planner can't prove a `WHERE ... IS NOT NULL` predicate
--    for a generic plan. Same shape as files_r2_key_idx. post_media gets no
--    index: it is empty in prod.
--
-- 2) clientes_v / membros_v evaluated can_see_financials() once PER ROW (SECURITY
--    DEFINER + SET search_path, so it is never inlined; it chains into
--    has_permission_for). EXPLAIN on prod: 11.5 ms for 27 clientes, linear in the
--    client count. Wrapping it in a scalar subquery makes it a once-per-query
--    initplan. Same columns, same order, same filter, same result: the column
--    grant allowlist (20260728000002) and the authenticated SELECT grant are
--    untouched (CREATE OR REPLACE VIEW keeps grants). Bodies copied from the live
--    prod definitions (pg_get_viewdef, 2026-10-02), which match
--    20260904000001 / 20260728000001.

CREATE INDEX IF NOT EXISTS files_thumbnail_r2_key_idx
  ON public.files (thumbnail_r2_key);

CREATE OR REPLACE VIEW public.clientes_v WITH (security_barrier = true) AS
  SELECT c.id, c.user_id, c.conta_id, c.nome, c.sigla, c.cor, c.plano,
         c.email, c.telefone, c.status, c.created_at, c.notion_page_url,
         c.data_pagamento, c.especialidade, c.data_aniversario, c.dia_entrega,
         c.auto_publish_on_approval, c.send_report_email, c.include_ai_analysis,
         CASE WHEN (SELECT public.can_see_financials())
              THEN c.valor_mensal ELSE NULL END AS valor_mensal,
         c.foto_url,
         c.send_event_email, c.event_email_unsub_at
  FROM public.clientes c
  WHERE c.conta_id = public.get_my_conta_id();

CREATE OR REPLACE VIEW public.membros_v WITH (security_barrier = true) AS
  SELECT m.id, m.user_id, m.conta_id, m.nome, m.cargo, m.tipo,
         m.avatar_url, m.data_pagamento, m.created_at, m.crm_user_id,
         CASE WHEN (SELECT public.can_see_financials())
              THEN m.custo_mensal ELSE NULL END AS custo_mensal
  FROM public.membros m
  WHERE m.conta_id = public.get_my_conta_id();
