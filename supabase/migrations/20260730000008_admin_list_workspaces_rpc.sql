-- One-round-trip replacement for platform-admin's list-workspaces N+1
-- (7 queries per workspace + an Auth Admin call + live Stripe per paying row).
-- Subscription amounts come from the workspace_subscriptions mirror columns
-- (20260730000007), falling back to the plan's catalog price when unpriced.
--
-- Deliberate behavior fix vs the TypeScript path it replaces: the plan filter
-- applies BEFORE pagination, and `total` is the filtered count. A workspace
-- with plan_id NULL matches the default plan's id, mirroring the old
-- name-fallback semantics.
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
  'total',      (SELECT count(*) FROM filtered),
  'workspaces', COALESCE(
    (SELECT jsonb_agg(to_jsonb(e) ORDER BY e.created_at DESC) FROM enriched e),
    '[]'::jsonb)
);
$$;

-- SECURITY DEFINER reads auth.users and bypasses RLS across every workspace:
-- reachable only through platform-admin's service-role client.
-- NOTE: revoking PUBLIC also strips service_role; the GRANT below restores it.
REVOKE ALL ON FUNCTION admin_list_workspaces(text, text, int, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_list_workspaces(text, text, int, int) FROM anon;
REVOKE ALL ON FUNCTION admin_list_workspaces(text, text, int, int) FROM authenticated;
GRANT EXECUTE ON FUNCTION admin_list_workspaces(text, text, int, int) TO service_role;
