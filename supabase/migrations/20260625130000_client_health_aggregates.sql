-- One row per active client with all health aggregates computed server-side.
-- SECURITY INVOKER so RLS applies; scoped to the caller's workspace via get_my_conta_id().
-- Aggregating per-source in CTEs avoids join fan-out and the PostgREST 1000-row cap
-- that raw client-side reads would hit.
CREATE OR REPLACE FUNCTION get_client_health_aggregates(p_window_days int DEFAULT 28)
RETURNS TABLE (
  client_id bigint,
  client_name text,
  client_sigla text,
  client_cor text,
  connected boolean,
  username text,
  profile_picture_url text,
  follower_count int,
  authorization_status text,
  token_expires_at timestamptz,
  last_synced_at timestamptz,
  follower_first int,
  follower_points int,
  follower_series int[],
  interactions_cur bigint,
  reach_cur bigint,
  posts_cur int,
  reach_prev bigint,
  posts_56d int,
  last_post_at timestamptz,
  pl_agendados int,
  pl_em_producao int,
  pl_agente int,
  pl_falha int
)
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
WITH cli AS (
  SELECT c.id, c.nome, c.sigla, c.cor
  FROM clientes c
  WHERE c.status = 'ativo'
    AND c.conta_id IN (SELECT public.get_my_conta_id())
),
acc AS (
  SELECT DISTINCT ON (a.client_id)
    a.id AS account_id, a.client_id, a.username, a.profile_picture_url,
    a.follower_count, a.authorization_status, a.token_expires_at, a.last_synced_at
  FROM instagram_accounts a
  WHERE a.client_id IN (SELECT id FROM cli)
  ORDER BY a.client_id, a.last_synced_at DESC NULLS LAST, a.id
),
fh AS (
  SELECT h.instagram_account_id AS account_id,
         (array_agg(h.follower_count ORDER BY h.date))[1] AS follower_first,
         count(*)::int AS follower_points,
         array_agg(h.follower_count ORDER BY h.date)::int[] AS follower_series
  FROM instagram_follower_history h
  WHERE h.instagram_account_id IN (SELECT account_id FROM acc)
    AND h.date::date >= current_date - p_window_days
  GROUP BY h.instagram_account_id
),
pc AS (
  SELECT p.instagram_account_id AS account_id,
         sum(coalesce(p.likes,0)+coalesce(p.comments,0)+coalesce(p.saved,0)+coalesce(p.shares,0))::bigint AS interactions_cur,
         sum(coalesce(p.reach,0))::bigint AS reach_cur,
         count(*)::int AS posts_cur
  FROM instagram_posts p
  WHERE p.instagram_account_id IN (SELECT account_id FROM acc)
    AND p.posted_at >= (now() - (p_window_days * interval '1 day'))
  GROUP BY p.instagram_account_id
),
pp AS (
  SELECT p.instagram_account_id AS account_id,
         sum(coalesce(p.reach,0))::bigint AS reach_prev
  FROM instagram_posts p
  WHERE p.instagram_account_id IN (SELECT account_id FROM acc)
    AND p.posted_at >= (now() - (2 * p_window_days * interval '1 day'))
    AND p.posted_at <  (now() - (p_window_days * interval '1 day'))
  GROUP BY p.instagram_account_id
),
pall AS (
  -- Posts over 2 × p_window_days (posts_56d is "2× the window", 56 days at default)
  SELECT p.instagram_account_id AS account_id,
         count(*)::int AS posts_56d
  FROM instagram_posts p
  WHERE p.instagram_account_id IN (SELECT account_id FROM acc)
    AND p.posted_at >= (now() - (2 * p_window_days * interval '1 day'))
  GROUP BY p.instagram_account_id
),
plast AS (
  -- Unbounded last post per account — not capped to the window so Inativo detection works
  SELECT p.instagram_account_id AS account_id,
         max(p.posted_at) AS last_post_at
  FROM instagram_posts p
  WHERE p.instagram_account_id IN (SELECT account_id FROM acc)
  GROUP BY p.instagram_account_id
),
pipe AS (
  SELECT w.cliente_id AS client_id,
         count(*) FILTER (WHERE wp.status = 'agendado')::int AS pl_agendados,
         count(*) FILTER (WHERE wp.status IN ('rascunho','revisao_interna','aprovado_interno','enviado_cliente','aprovado_cliente','correcao_cliente'))::int AS pl_em_producao,
         count(*) FILTER (WHERE wp.created_via = 'agent')::int AS pl_agente,
         count(*) FILTER (WHERE wp.status = 'falha_publicacao')::int AS pl_falha
  FROM workflow_posts wp
  JOIN workflows w ON w.id = wp.workflow_id AND w.status = 'ativo'
  WHERE w.cliente_id IN (SELECT id FROM cli)
  GROUP BY w.cliente_id
)
SELECT
  cli.id::bigint,
  cli.nome,
  cli.sigla,
  cli.cor,
  (acc.account_id IS NOT NULL AND acc.authorization_status IS DISTINCT FROM 'disconnected') AS connected,
  acc.username,
  acc.profile_picture_url,
  coalesce(acc.follower_count, 0)::int,
  acc.authorization_status,
  acc.token_expires_at,
  acc.last_synced_at,
  coalesce(fh.follower_first, 0)::int,
  coalesce(fh.follower_points, 0)::int,
  coalesce(fh.follower_series, ARRAY[]::int[]),
  coalesce(pc.interactions_cur, 0)::bigint,
  coalesce(pc.reach_cur, 0)::bigint,
  coalesce(pc.posts_cur, 0)::int,
  coalesce(pp.reach_prev, 0)::bigint,
  coalesce(pall.posts_56d, 0)::int,
  plast.last_post_at,
  coalesce(pipe.pl_agendados, 0)::int,
  coalesce(pipe.pl_em_producao, 0)::int,
  coalesce(pipe.pl_agente, 0)::int,
  coalesce(pipe.pl_falha, 0)::int
FROM cli
LEFT JOIN acc  ON acc.client_id = cli.id
LEFT JOIN fh   ON fh.account_id = acc.account_id
LEFT JOIN pc   ON pc.account_id = acc.account_id
LEFT JOIN pp   ON pp.account_id = acc.account_id
LEFT JOIN pall  ON pall.account_id  = acc.account_id
LEFT JOIN plast ON plast.account_id = acc.account_id
LEFT JOIN pipe  ON pipe.client_id   = cli.id
ORDER BY cli.nome;
$$;

GRANT EXECUTE ON FUNCTION get_client_health_aggregates(int) TO authenticated;
