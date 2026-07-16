-- Admin Workspaces list: "last activity" per workspace.
--
-- The first cut read audit_log alone. That was wrong: the CRM writes its everyday records
-- (clientes, workflow_posts, contratos, briefings) client-side through RLS, never touching an
-- edge function, so none of that work produces an audit row. Workspaces in daily use read as
-- "Nunca". This aggregates the timestamps real work actually leaves behind.
--
-- Deliberately excluded: instagram_accounts.last_synced_at and any other cron-written column —
-- a background job touching a row is not a human using the workspace, and including it would
-- make every workspace look alive. instagram_accounts.created_at IS included (via clientes)
-- because connecting an account is a real human action, and it is the only trace such a
-- connection leaves that is attributable to a workspace.

-- Supporting indexes: each subquery below is a max() over one workspace's rows.
-- designs already has designs_conta_idx (conta_id, updated_at DESC).
CREATE INDEX IF NOT EXISTS idx_workflow_posts_conta_updated
  ON workflow_posts (conta_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_clientes_conta_created
  ON clientes (conta_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contratos_conta_created
  ON contratos (conta_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_briefings_conta_created
  ON briefings (conta_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_instagram_accounts_client
  ON instagram_accounts (client_id);

-- GREATEST ignores NULLs, returning NULL only when every source is NULL — i.e. a workspace
-- where genuinely nothing has ever happened.
CREATE OR REPLACE FUNCTION admin_workspace_last_activity(workspace_ids uuid[])
RETURNS TABLE (workspace_id uuid, last_activity_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    w.id,
    GREATEST(
      (SELECT max(updated_at) FROM workflow_posts WHERE conta_id = w.id),
      (SELECT max(updated_at) FROM designs        WHERE conta_id = w.id),
      (SELECT max(created_at) FROM clientes       WHERE conta_id = w.id),
      (SELECT max(created_at) FROM contratos      WHERE conta_id = w.id),
      (SELECT max(created_at) FROM briefings      WHERE conta_id = w.id),
      (SELECT max(created_at) FROM audit_log      WHERE conta_id = w.id),
      (SELECT max(ia.created_at)
         FROM instagram_accounts ia
         JOIN clientes c ON c.id = ia.client_id
        WHERE c.conta_id = w.id)
    )
  FROM workspaces w
  WHERE w.id = ANY(workspace_ids);
$$;

-- SECURITY DEFINER bypasses RLS, so this must never be reachable by a workspace user: it would
-- expose activity across every workspace. Platform admins reach it through platform-admin,
-- which authenticates first and calls with the service role.
REVOKE ALL ON FUNCTION admin_workspace_last_activity(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_workspace_last_activity(uuid[]) FROM anon;
REVOKE ALL ON FUNCTION admin_workspace_last_activity(uuid[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION admin_workspace_last_activity(uuid[]) TO service_role;
