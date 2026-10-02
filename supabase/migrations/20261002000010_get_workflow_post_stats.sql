-- Performance: finding 3 of docs/superpowers/specs/2026-10-01-db-query-performance-audit.md
--
-- The Entregas board and the client Entregas tab fetched workflow_posts rows
-- six times per load (total, aprovado_cliente, cleared-by-client,
-- enviado_cliente, revisao_interna, distinct responsaveis) and counted them in
-- the browser. This returns all of it in one round trip, one row per workflow
-- that has posts. The unpaged selects it replaces were also silently capped at
-- 1000 rows by PostgREST, so large workspaces undercounted.
--
-- Predicates are pinned to the frontend's:
--   aprovado_cliente  status = 'aprovado_cliente'
--   cleared_cliente   status IN CLIENT_CLEARED_STATUSES (apps/crm/src/store/posts.ts);
--                     change both lists together
--   enviado_cliente   status = 'enviado_cliente'
--   revisao_interna   status = 'revisao_interna'
--   responsavel_ids   distinct non-null responsavel_id, ascending (only read
--                     as a set, by the board's "responsável do post" filter)
--
-- SECURITY INVOKER: workflow_posts RLS (conta_id IN (SELECT get_my_conta_id()))
-- scopes the rows exactly as the direct selects did, so ids from another
-- workspace just return no row.

CREATE OR REPLACE FUNCTION public.get_workflow_post_stats(p_workflow_ids bigint[])
RETURNS TABLE (
  workflow_id bigint,
  total integer,
  aprovado_cliente integer,
  cleared_cliente integer,
  enviado_cliente integer,
  revisao_interna integer,
  responsavel_ids bigint[]
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    wp.workflow_id,
    count(*)::integer,
    (count(*) FILTER (WHERE wp.status = 'aprovado_cliente'))::integer,
    (count(*) FILTER (
      WHERE wp.status IN ('aprovado_cliente', 'agendado', 'postado', 'falha_publicacao')
    ))::integer,
    (count(*) FILTER (WHERE wp.status = 'enviado_cliente'))::integer,
    (count(*) FILTER (WHERE wp.status = 'revisao_interna'))::integer,
    coalesce(
      array_agg(DISTINCT wp.responsavel_id ORDER BY wp.responsavel_id)
        FILTER (WHERE wp.responsavel_id IS NOT NULL),
      '{}'::bigint[]
    )
  FROM public.workflow_posts wp
  WHERE wp.workflow_id = ANY (p_workflow_ids)
  GROUP BY wp.workflow_id;
$$;

-- Hosted Supabase's default ACL grants EXECUTE to anon too; revoking from
-- PUBLIC alone leaves that grant in place.
REVOKE EXECUTE ON FUNCTION public.get_workflow_post_stats(bigint[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_workflow_post_stats(bigint[]) TO authenticated, service_role;
