-- admin_list_workspaces v9: multi-select filters on the Admin workspaces list.
--
-- p_plan_id, p_status and p_activity now accept a comma-separated list as well as a single
-- value (OR within a filter, AND across filters). The signature is unchanged on purpose: a
-- text[] parameter would add a second overload for PostgREST to choose between, and keeping
-- text means platform-admin (list-workspaces.ts) passes the lists through without a redeploy.
-- Every single-value call keeps its old result (tests 70 and 72), so this is safe to apply
-- before the frontend that sends lists. Body = v8 (20261030000001) plus the `args` CTE.
--
-- Deploy order: this migration -> merge. A frontend that sends lists against v8 would get
-- zero rows for a multi Plano and an unfiltered list for multi Status/Atividade.

CREATE OR REPLACE FUNCTION admin_list_workspaces(
  p_search        text        DEFAULT NULL,
  p_plan_id       text        DEFAULT NULL,
  p_offset        int         DEFAULT 0,
  p_limit         int         DEFAULT 20,
  p_as_of         timestamptz DEFAULT NULL,
  p_status        text        DEFAULT NULL,
  p_has_overrides boolean     DEFAULT NULL,
  p_activity      text        DEFAULT NULL,
  p_created_since timestamptz DEFAULT NULL,
  p_sort          text        DEFAULT 'created_at',
  p_dir           text        DEFAULT 'desc'
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
args AS (
  -- v9: p_plan_id, p_status and p_activity each take one value or a comma-separated list
  -- (OR within a filter, AND across filters). Blank entries are dropped; unknown status and
  -- activity values are ignored, so a list with no known value does not filter (the same
  -- "unknown means no filter" rule v5 had for a single value). Plan ids are not validated:
  -- an unknown id matches nothing, as before. NULL, '' and an all-blank list mean no filter.
  -- Readers write `= ANY((SELECT x FROM args)::text[])`: without the cast Postgres reads
  -- ANY(subquery) and compares text to text[].
  SELECT
    NULLIF(ARRAY(SELECT DISTINCT btrim(x) FROM unnest(string_to_array(p_plan_id, ',')) x
                  WHERE btrim(x) <> ''), '{}') AS plan_ids,
    NULLIF(ARRAY(SELECT DISTINCT btrim(x) FROM unnest(string_to_array(p_status, ',')) x
                  WHERE btrim(x) IN ('ativo', 'teste', 'pendente', 'cancelado', 'sem_assinatura')),
           '{}') AS statuses,
    NULLIF(ARRAY(SELECT DISTINCT btrim(x) FROM unnest(string_to_array(p_activity, ',')) x
                  WHERE btrim(x) IN ('7d', '30d', 'dormente', 'nunca')), '{}') AS activities
),
flags AS (
  -- NULL-safe: p_sort may arrive as a literal NULL, and NULL here would make the CASEs below
  -- take their ELSE arm silently. IS NOT DISTINCT FROM keeps this a plain boolean.
  SELECT ((SELECT activities FROM args) IS NOT NULL
          OR p_sort IS NOT DISTINCT FROM 'last_activity_at') AS needs_full
),
base AS (
  SELECT b.*
    FROM (
      SELECT
        w.id,
        w.name,
        w.logo_url,
        w.created_at,
        w.created_by,
        (SELECT count(*) FROM workspace_members m WHERE m.workspace_id = w.id) AS member_count,
        (SELECT count(*) FROM clientes c WHERE c.conta_id = w.id)              AS client_count,
        COALESCE(pl.name, (SELECT name FROM default_plan))                     AS plan_name,
        w.plan_source,
        EXISTS (
          SELECT 1 FROM workspace_plan_overrides o
           WHERE o.workspace_id = w.id
             AND (o.resource_overrides IS NOT NULL OR o.feature_overrides IS NOT NULL)
        ) AS has_overrides,
        s.status AS sub_status
        FROM workspaces w
        LEFT JOIN plans pl ON pl.id = w.plan_id
        -- At most one subscription row per workspace: the previous revision's LATERAL had no
        -- LIMIT either, so it relied on the same invariant. A plain join cannot multiply rows.
        LEFT JOIN workspace_subscriptions s ON s.workspace_id = w.id
       WHERE (p_search IS NULL
              OR w.name ILIKE '%' || p_search || '%'
              OR EXISTS (
                   SELECT 1
                     FROM workspace_members m
                     JOIN auth.users u ON u.id = m.user_id
                    WHERE m.workspace_id = w.id
                      AND m.role = 'owner'
                      AND u.email ILIKE '%' || p_search || '%'))
         AND ((SELECT plan_ids FROM args) IS NULL
              OR COALESCE(w.plan_id, (SELECT id FROM default_plan)) = ANY((SELECT plan_ids FROM args)::text[]))
         AND w.created_at <= COALESCE(p_as_of, now())
         AND (p_created_since IS NULL OR w.created_at >= p_created_since)
         -- One arm per group, ORed: sem_assinatura is an IS NULL check, so the groups cannot
         -- collapse into a single `s.status = ANY(...)`.
         AND ((SELECT statuses FROM args) IS NULL
              OR ('ativo'          = ANY((SELECT statuses FROM args)::text[]) AND s.status = 'active')
              OR ('teste'          = ANY((SELECT statuses FROM args)::text[]) AND s.status = 'trialing')
              OR ('pendente'       = ANY((SELECT statuses FROM args)::text[])
                  AND s.status IN ('past_due', 'unpaid', 'incomplete'))
              OR ('cancelado'      = ANY((SELECT statuses FROM args)::text[])
                  AND s.status IN ('canceled', 'incomplete_expired', 'paused'))
              -- Covers both "no row" (LEFT JOIN miss) and "row with NULL status".
              OR ('sem_assinatura' = ANY((SELECT statuses FROM args)::text[]) AND s.status IS NULL))
    ) b
   -- has_overrides is a target-list expression, so it is filtered one level up rather than
   -- spelling the EXISTS out twice.
   WHERE (p_has_overrides IS NULL OR b.has_overrides = p_has_overrides)
),
prepage AS (
  -- Cheap ranking, used only when last_activity_at is not part of the ordering or the filters.
  SELECT b.id, row_number() OVER (
    ORDER BY
      CASE WHEN p_dir = 'asc' THEN (CASE p_sort WHEN 'client_count' THEN b.client_count
                                                WHEN 'member_count' THEN b.member_count END) END ASC  NULLS LAST,
      CASE WHEN p_dir IS DISTINCT FROM 'asc' THEN (CASE p_sort WHEN 'client_count' THEN b.client_count
                                                 WHEN 'member_count' THEN b.member_count END) END DESC NULLS LAST,
      CASE WHEN p_dir = 'asc' THEN (CASE p_sort WHEN 'name' THEN lower(b.name)
                                                WHEN 'plan' THEN lower(b.plan_name) END) END ASC  NULLS LAST,
      CASE WHEN p_dir IS DISTINCT FROM 'asc' THEN (CASE p_sort WHEN 'name' THEN lower(b.name)
                                                 WHEN 'plan' THEN lower(b.plan_name) END) END DESC NULLS LAST,
      CASE WHEN p_dir = 'asc' THEN (CASE p_sort WHEN 'created_at' THEN b.created_at END) END ASC  NULLS FIRST,
      CASE WHEN p_dir IS DISTINCT FROM 'asc' THEN (CASE p_sort WHEN 'created_at' THEN b.created_at END) END DESC NULLS LAST,
      b.created_at DESC,
      b.id ASC
  ) AS rn
  FROM base b
  WHERE NOT (SELECT needs_full FROM flags)
),
target_ids AS (
  SELECT COALESCE(
    CASE WHEN (SELECT needs_full FROM flags)
         THEN (SELECT array_agg(b.id) FROM base b)
         ELSE (SELECT array_agg(p.id) FROM prepage p
                WHERE p.rn > p_offset AND p.rn <= p_offset + p_limit)
    END, '{}'::uuid[]) AS ids
),
activity AS (
  SELECT a.workspace_id, a.last_activity_at
    FROM admin_workspace_last_activity((SELECT ids FROM target_ids)) a
),
filtered AS (
  SELECT b.*, la.last_activity_at
    FROM base b
    LEFT JOIN activity la ON la.workspace_id = b.id
   WHERE ((SELECT activities FROM args) IS NULL
          OR ('7d'       = ANY((SELECT activities FROM args)::text[])
              AND la.last_activity_at >= now() - interval '7 days')
          OR ('30d'      = ANY((SELECT activities FROM args)::text[])
              AND la.last_activity_at >= now() - interval '30 days')
          OR ('dormente' = ANY((SELECT activities FROM args)::text[])
              AND la.last_activity_at <  now() - interval '30 days')
          OR ('nunca'    = ANY((SELECT activities FROM args)::text[]) AND la.last_activity_at IS NULL))
),
page AS (
  SELECT f.*, row_number() OVER (
    ORDER BY
      CASE WHEN p_dir = 'asc' THEN (CASE p_sort WHEN 'client_count' THEN f.client_count
                                                WHEN 'member_count' THEN f.member_count END) END ASC  NULLS LAST,
      CASE WHEN p_dir IS DISTINCT FROM 'asc' THEN (CASE p_sort WHEN 'client_count' THEN f.client_count
                                                 WHEN 'member_count' THEN f.member_count END) END DESC NULLS LAST,
      CASE WHEN p_dir = 'asc' THEN (CASE p_sort WHEN 'name' THEN lower(f.name)
                                                WHEN 'plan' THEN lower(f.plan_name) END) END ASC  NULLS LAST,
      CASE WHEN p_dir IS DISTINCT FROM 'asc' THEN (CASE p_sort WHEN 'name' THEN lower(f.name)
                                                 WHEN 'plan' THEN lower(f.plan_name) END) END DESC NULLS LAST,
      -- NULLS FIRST on asc: "least active first" must surface never-active workspaces.
      CASE WHEN p_dir = 'asc' THEN (CASE p_sort WHEN 'created_at'       THEN f.created_at
                                                WHEN 'last_activity_at' THEN f.last_activity_at END) END ASC  NULLS FIRST,
      CASE WHEN p_dir IS DISTINCT FROM 'asc' THEN (CASE p_sort WHEN 'created_at'       THEN f.created_at
                                                 WHEN 'last_activity_at' THEN f.last_activity_at END) END DESC NULLS LAST,
      f.created_at DESC,
      f.id ASC
  ) AS rn
  FROM filtered f
)
SELECT jsonb_build_object(
  'total',                (SELECT count(*) FROM filtered),
  'total_members',        (SELECT COALESCE(sum(member_count), 0) FROM filtered),
  'total_clients',        (SELECT COALESCE(sum(client_count), 0) FROM filtered),
  'total_instagram_accounts',        (SELECT count(*)
                                        FROM instagram_accounts ia
                                        JOIN clientes c ON c.id = ia.client_id
                                       WHERE c.conta_id IN (SELECT id FROM filtered)),
  'total_instagram_accounts_active', (SELECT count(*)
                                        FROM instagram_accounts ia
                                        JOIN clientes c ON c.id = ia.client_id
                                       WHERE c.conta_id IN (SELECT id FROM filtered)
                                         AND ia.authorization_status = 'active'),
  'total_with_overrides', (SELECT count(*) FROM filtered WHERE has_overrides),
  'workspaces',           COALESCE(
    (SELECT jsonb_agg(
              jsonb_build_object(
                'id',               p.id,
                'name',             p.name,
                'logo_url',         p.logo_url,
                'created_at',       p.created_at,
                'last_activity_at', p.last_activity_at,
                'member_count',     p.member_count,
                'client_count',     p.client_count,
                'plan_name',        p.plan_name,
                'plan_source',      p.plan_source,
                'has_overrides',    p.has_overrides,
                'owner',            own.owner_json,
                'subscription',     sub.sub_json
              ) ORDER BY p.rn)
       -- The page window is applied BEFORE the LATERALs so the owner lookup and the
       -- subscription JSON are built only for the rows actually returned.
       FROM (SELECT * FROM page WHERE rn > p_offset AND rn <= p_offset + p_limit) p
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
          ORDER BY (m.user_id = p.created_by) DESC, m.joined_at ASC, m.user_id ASC
          LIMIT 1
       ) own ON true
       LEFT JOIN LATERAL (
         SELECT jsonb_build_object(
           'provider',             s.provider,
           'status',               s.status,
           'plan_name',            sp.name,
           'billing_interval',     s.billing_interval,
           'amount_cents',         COALESCE(
                                     s.amount_cents,
                                     CASE WHEN s.billing_interval = 'year'
                                          THEN sp.price_brl_annual ELSE sp.price_brl END),
           'currency',             CASE
                                     WHEN s.amount_cents IS NOT NULL THEN s.currency
                                     WHEN (CASE WHEN s.billing_interval = 'year'
                                                THEN sp.price_brl_annual ELSE sp.price_brl END) IS NOT NULL
                                          THEN 'brl'
                                     ELSE NULL
                                   END,
           'interval',             COALESCE(s.amount_interval, s.billing_interval),
           'discount_label',       s.discount_label,
           'failed_payment_count', COALESCE(s.failed_payment_count, 0),
           'current_period_end',   s.current_period_end
         ) AS sub_json
           FROM workspace_subscriptions s
           LEFT JOIN plans sp ON sp.id = s.plan_id
          WHERE s.workspace_id = p.id
       ) sub ON true),
    '[]'::jsonb)
);
$$;

REVOKE ALL ON FUNCTION admin_list_workspaces(text, text, int, int, timestamptz, text, boolean, text, timestamptz, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_list_workspaces(text, text, int, int, timestamptz, text, boolean, text, timestamptz, text, text) FROM anon;
REVOKE ALL ON FUNCTION admin_list_workspaces(text, text, int, int, timestamptz, text, boolean, text, timestamptz, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION admin_list_workspaces(text, text, int, int, timestamptz, text, boolean, text, timestamptz, text, text) TO service_role;
