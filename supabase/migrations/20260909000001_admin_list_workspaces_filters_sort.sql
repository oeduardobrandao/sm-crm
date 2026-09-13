-- admin_list_workspaces v5: server-side filters + sorting for the admin Workspaces list.
--
-- New optional params (all DEFAULT NULL / harmless defaults, so the frontend deployed before
-- this migration keeps working unchanged):
--   p_status         status GROUP: ativo | teste | pendente | cancelado | sem_assinatura
--                    (mirror of statusGroup() in apps/admin/src/lib/subscription.ts)
--   p_has_overrides  true | false | NULL (all)
--   p_activity       7d | 30d | dormente | nunca   (buckets over last_activity_at)
--   p_created_since  created_at >= p_created_since
--   p_sort           name | plan | client_count | member_count | created_at | last_activity_at
--                    (anything else falls back to created_at)
--   p_dir            asc | desc (anything else = desc). Tiebreaker always id ASC.
--                    Compared with IS DISTINCT FROM so a literal NULL still sorts desc.
--                    last_activity_at sorts NULLS FIRST on asc and NULLS LAST on desc, so
--                    "least active first" puts never-active workspaces on top.
--   p_search         now also matches the owner's e-mail.
--
-- Subscription JSON gains failed_payment_count and current_period_end (Dashboard at-risk card).
--
-- FAST PATH -- why the body is shaped like this.
-- The expensive columns are last_activity_at (admin_workspace_last_activity runs six correlated
-- max() scans per workspace), the owner LATERAL and the subscription-JSON LATERAL. Enriching the
-- whole filtered set before pagination costs that per workspace on EVERY call, including the
-- default unfiltered list and the Dashboard's two unfiltered calls -- measured too expensive on
-- staging to keep. So the body splits the work:
--
--   base       every workspace surviving the CHEAP filters (search, plan, as_of, created_since,
--              status, has_overrides), with the cheap per-row columns the sort and the totals
--              need: member_count, client_count, plan_name, has_overrides, sub_status. Status
--              and overrides move in here because both are cheap: status is a plain LEFT JOIN
--              column and the overrides test is one index probe.
--   needs_full only p_activity or p_sort = 'last_activity_at' actually need last_activity_at for
--              the whole set -- the first filters on it, the second orders by it.
--   prepage    when NOT needs_full, ranks base by the cheap ORDER BY alone; its page window is
--              already the final page, because the only ordering key it omits is one that
--              implies needs_full.
--   target_ids all of base when needs_full, otherwise just the page's ids.
--   activity   ONE call to admin_workspace_last_activity over target_ids.
--   filtered   base LEFT JOIN activity + the p_activity bucket filter (a no-op when NULL). Rows
--              outside the page carry a NULL last_activity_at on the fast path; nothing reads it
--              there (totals do not use it, and the ordering key that would is needs_full).
--   page       the FULL ORDER BY. On the fast path it reproduces prepage's sequence exactly.
--
-- The owner and subscription LATERALs then run only for the rows that are actually returned.
-- Totals (total, total_members, total_clients, total_with_overrides) still cover the whole
-- filtered set. Suites 67-73 in supabase/tests/entitlements are the regression net for all of it.
--
-- Signature changes (5 params -> 11): DROP the old overload explicitly, as before.
DROP FUNCTION IF EXISTS admin_list_workspaces(text, text, int, int, timestamptz);

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
flags AS (
  -- NULL-safe: p_sort may arrive as a literal NULL, and NULL here would make the CASEs below
  -- take their ELSE arm silently. IS NOT DISTINCT FROM keeps this a plain boolean.
  SELECT (p_activity IS NOT NULL
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
         AND (p_plan_id IS NULL
              OR COALESCE(w.plan_id, (SELECT id FROM default_plan)) = p_plan_id)
         AND w.created_at <= COALESCE(p_as_of, now())
         AND (p_created_since IS NULL OR w.created_at >= p_created_since)
         AND (p_status IS NULL OR CASE p_status
                WHEN 'ativo'          THEN s.status = 'active'
                WHEN 'teste'          THEN s.status = 'trialing'
                WHEN 'pendente'       THEN s.status IN ('past_due', 'unpaid', 'incomplete')
                WHEN 'cancelado'      THEN s.status IN ('canceled', 'incomplete_expired', 'paused')
                -- Covers both "no row" (LEFT JOIN miss) and "row with NULL status".
                WHEN 'sem_assinatura' THEN s.status IS NULL
                ELSE true END)
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
   WHERE (p_activity IS NULL OR CASE p_activity
            WHEN '7d'       THEN la.last_activity_at >= now() - interval '7 days'
            WHEN '30d'      THEN la.last_activity_at >= now() - interval '30 days'
            WHEN 'dormente' THEN la.last_activity_at <  now() - interval '30 days'
            WHEN 'nunca'    THEN la.last_activity_at IS NULL
            ELSE true END)
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
