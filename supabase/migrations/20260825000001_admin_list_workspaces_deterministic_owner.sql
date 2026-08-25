-- Makes the "owner" picked by admin_list_workspaces deterministic. workspace_members only
-- constrains UNIQUE(user_id, workspace_id) -- nothing stops a workspace from ending up with
-- more than one role='owner' row (an existing owner can promote another member to 'owner'
-- via manage-workspace-user's update-role action), and the previous version's `own` LATERAL
-- picked one with an unordered LIMIT 1, i.e. an arbitrary row. Ties are now broken by
-- preferring the owner-role member who is also the workspace's creator (workspaces.created_by),
-- falling back to earliest joined_at then user_id when the creator isn't among the owner-role
-- rows (or created_by is null) -- the same convention already used in
-- 20260803000004_loops_sync_rpcs.sql, 20260730000001_lifecycle_emails.sql and
-- 20260730000003_thankyou_candidates_plan_info.sql for the Loops marketing-email pipeline, and
-- mirrored by the platform-admin fetchOwnerContacts helper
-- (supabase/functions/platform-admin/owner-contact.ts) for the MRR/Trials owner enrichment, so
-- all paths agree on "the owner" for a given workspace.
--
-- Also adds `id` as a secondary sort key to the pagination and final-aggregation ORDER BYs,
-- which previously ordered by created_at alone. created_at has no uniqueness guarantee (two
-- workspaces can be created in the same instant, e.g. bulk seeding), so ties made pagination
-- non-deterministic across separate offset/limit calls -- harmless for a human clicking through
-- one page at a time, but a real correctness risk for the new admin Workspaces CSV export
-- (apps/admin/src/pages/WorkspacesPage.tsx), which assembles a full export from several
-- sequential offset/limit calls and needs every row counted exactly once.
--
-- Finally, adds an optional p_as_of snapshot timestamp. Without it, a workspace created
-- between two of the export's sequential offset/limit calls shifts every existing row's
-- position (newest-first ordering), which can duplicate a row across pages even with the id
-- tiebreaker above -- the *set* changed mid-export, not just a tie within it. Passing the
-- export's start time as p_as_of freezes the filtered set to "as it existed at that instant"
-- for every page of that one export, so later signups can't perturb it. Omitting p_as_of (all
-- existing callers -- the on-screen Workspaces table, the Dashboard) is unaffected: created_at
-- can never be in the future, so `created_at <= COALESCE(p_as_of, now())` is always true for
-- existing rows and changes nothing observable for a single, non-paginated-across-calls read.
--
-- Known residual gap: p_as_of only pins created_at, which is immutable once a row exists.
-- name and plan_id are still read live, so a workspace matching the export's search/plan
-- filter can still enter or leave the filtered set mid-export if it's renamed or its plan is
-- reassigned between two page calls -- same duplicate/omit symptom as the created_at race
-- above, just triggered by an edit instead of a new signup. Closing this fully needs real
-- cursor pagination (compute the matching id set once, paginate a fixed list across calls,
-- since each RPC call is its own transaction with no way to hold one Postgres snapshot open
-- across them) -- a bigger redesign than this migration, and not pursued here: the exposure
-- is narrower than the created_at race (it needs an admin plan reassignment or a rename, not
-- just organic signups, to land in the same few-second export window). Accepted as a known
-- limitation; revisit with real cursor-based pagination if it ever causes a problem in practice.
--
-- This changes the function's signature (4 params -> 5), which CREATE OR REPLACE does not
-- retarget -- Postgres would otherwise leave the old 4-arg overload in place, ungoverned by
-- this file's REVOKE/GRANT block below, and ambiguous against callers that omit p_as_of. The
-- DROP below removes it explicitly.
DROP FUNCTION IF EXISTS admin_list_workspaces(text, text, int, int);

CREATE OR REPLACE FUNCTION admin_list_workspaces(
  p_search  text DEFAULT NULL,
  p_plan_id text DEFAULT NULL,
  p_offset  int  DEFAULT 0,
  p_limit   int  DEFAULT 20,
  p_as_of   timestamptz DEFAULT NULL
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
  SELECT w.id, w.name, w.logo_url, w.created_at, w.plan_id, w.created_by
    FROM workspaces w
   WHERE (p_search IS NULL OR w.name ILIKE '%' || p_search || '%')
     AND (p_plan_id IS NULL
          OR COALESCE(w.plan_id, (SELECT id FROM default_plan)) = p_plan_id)
     AND w.created_at <= COALESCE(p_as_of, now())
),
page AS (
  SELECT * FROM filtered ORDER BY created_at DESC, id ASC OFFSET p_offset LIMIT p_limit
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
     ORDER BY (m.user_id = p.created_by) DESC, m.joined_at ASC, m.user_id ASC
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
  'total',               (SELECT count(*) FROM filtered),
  'total_members',       (SELECT count(*)
                            FROM workspace_members m
                            JOIN filtered f ON f.id = m.workspace_id),
  'total_clients',       (SELECT count(*)
                            FROM clientes c
                            JOIN filtered f ON f.id = c.conta_id),
  'total_with_overrides', (SELECT count(*)
                             FROM filtered f
                            WHERE EXISTS (
                              SELECT 1 FROM workspace_plan_overrides o
                               WHERE o.workspace_id = f.id
                                 AND (o.resource_overrides IS NOT NULL
                                      OR o.feature_overrides IS NOT NULL))),
  'workspaces',          COALESCE(
    (SELECT jsonb_agg(to_jsonb(e) ORDER BY e.created_at DESC, e.id ASC) FROM enriched e),
    '[]'::jsonb)
);
$$;

REVOKE ALL ON FUNCTION admin_list_workspaces(text, text, int, int, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_list_workspaces(text, text, int, int, timestamptz) FROM anon;
REVOKE ALL ON FUNCTION admin_list_workspaces(text, text, int, int, timestamptz) FROM authenticated;
GRANT EXECUTE ON FUNCTION admin_list_workspaces(text, text, int, int, timestamptz) TO service_role;
