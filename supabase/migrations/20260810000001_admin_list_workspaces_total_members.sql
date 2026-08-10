-- Adds `total_members` to admin_list_workspaces: the membership count across the
-- whole *filtered* set (not just the returned page). The admin dashboard's
-- "Total Users" KPI previously summed member_count over the first page only, so
-- it under-counted as soon as the platform had more workspaces than the page size.
-- Like `total`, it respects p_search/p_plan_id; with no filters it is platform-wide.
CREATE OR REPLACE FUNCTION admin_list_workspaces(
  p_search  text DEFAULT NULL,
  p_plan_id text DEFAULT NULL,
  p_offset  int  DEFAULT 0,
  p_limit   int  DEFAULT 20
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
WITH default_plan AS (
  SELECT id, name FROM plans WHERE is_default = true LIMIT 1
),
filtered AS (
  SELECT w.id, w.name, w.logo_url, w.created_at, w.plan_id
    FROM workspaces w
   WHERE (p_search IS NULL OR w.name ILIKE '%' || p_search || '%')
     AND (p_plan_id IS NULL
          OR COALESCE(w.plan_id, (SELECT id FROM default_plan)) = p_plan_id)
),
page AS (
  SELECT * FROM filtered ORDER BY created_at DESC OFFSET p_offset LIMIT p_limit
),
enriched AS (
  SELECT
    p.id,
    p.name,
    p.logo_url,
    p.created_at,
    la.last_activity_at,
    (SELECT count(*) FROM workspace_members m WHERE m.workspace_id = p.id) AS member_count,
    (SELECT count(*) FROM clientes c WHERE c.conta_id = p.id)              AS client_count,
    COALESCE(pl.name, (SELECT name FROM default_plan))                     AS plan_name,
    EXISTS (
      SELECT 1 FROM workspace_plan_overrides o
       WHERE o.workspace_id = p.id
         AND (o.resource_overrides IS NOT NULL OR o.feature_overrides IS NOT NULL)
    ) AS has_overrides,
    own.owner_json AS owner,
    sub.sub_json   AS subscription
  FROM page p
  LEFT JOIN plans pl ON pl.id = p.plan_id
  LEFT JOIN LATERAL (
    SELECT a.last_activity_at
      FROM admin_workspace_last_activity(ARRAY[p.id]) a
  ) la ON true
  LEFT JOIN LATERAL (
    SELECT jsonb_build_object(
      'name',             COALESCE(pr.nome, 'Unknown'),
      'email',            COALESCE(u.email, 'Unknown'),
      'telefone',         pr.telefone,
      'marketing_opt_in', COALESCE(pr.marketing_opt_in, false)
    ) AS owner_json
      FROM workspace_members m
      LEFT JOIN profiles pr ON pr.id = m.user_id
      LEFT JOIN auth.users u ON u.id = m.user_id
     WHERE m.workspace_id = p.id AND m.role = 'owner'
     LIMIT 1
  ) own ON true
  LEFT JOIN LATERAL (
    SELECT jsonb_build_object(
      'status',           s.status,
      'plan_name',        sp.name,
      'billing_interval', s.billing_interval,
      'amount_cents',     COALESCE(
                            s.amount_cents,
                            CASE WHEN s.billing_interval = 'year'
                                 THEN sp.price_brl_annual ELSE sp.price_brl END),
      'currency',         CASE
                            WHEN s.amount_cents IS NOT NULL THEN s.currency
                            WHEN (CASE WHEN s.billing_interval = 'year'
                                       THEN sp.price_brl_annual ELSE sp.price_brl END) IS NOT NULL
                                 THEN 'brl'
                            ELSE NULL
                          END,
      'interval',         COALESCE(s.amount_interval, s.billing_interval),
      'discount_label',   s.discount_label
    ) AS sub_json
      FROM workspace_subscriptions s
      LEFT JOIN plans sp ON sp.id = s.plan_id
     WHERE s.workspace_id = p.id
  ) sub ON true
)
SELECT jsonb_build_object(
  'total',         (SELECT count(*) FROM filtered),
  'total_members', (SELECT count(*)
                      FROM workspace_members m
                      JOIN filtered f ON f.id = m.workspace_id),
  'workspaces',    COALESCE(
    (SELECT jsonb_agg(to_jsonb(e) ORDER BY e.created_at DESC) FROM enriched e),
    '[]'::jsonb)
);
$$;

-- CREATE OR REPLACE preserves the ACL set in 20260730000008, but restate it so a
-- fresh database gets the same posture even if the earlier migration's grants change.
REVOKE ALL ON FUNCTION admin_list_workspaces(text, text, int, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_list_workspaces(text, text, int, int) FROM anon;
REVOKE ALL ON FUNCTION admin_list_workspaces(text, text, int, int) FROM authenticated;
GRANT EXECUTE ON FUNCTION admin_list_workspaces(text, text, int, int) TO service_role;
