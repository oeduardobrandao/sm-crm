-- mcp_oauth_grants — binds an OAuth consent grant (a Mesaas user + the DCR-registered claude.ai
-- client) to a workspace + scopes. The Supabase OAuth access token carries user_id + client_id;
-- the MCP resource server looks the grant up to resolve conta_id + scopes. Because Supabase OAuth
-- tokens aren't resource-bound (no RFC 8707 audience), the (user_id, client_id) grant row IS the
-- trust boundary — sound here since the MCP server is the only resource.

CREATE TABLE IF NOT EXISTS mcp_oauth_grants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id   text NOT NULL,                 -- the DCR-registered OAuth client (e.g. claude.ai)
  conta_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  scopes      text[] NOT NULL DEFAULT '{}',
  revoked_at  timestamptz,
  revoked_by  uuid REFERENCES auth.users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, client_id)
);

CREATE INDEX IF NOT EXISTS mcp_oauth_grants_lookup_idx ON mcp_oauth_grants (user_id, client_id);
CREATE INDEX IF NOT EXISTS mcp_oauth_grants_conta_idx  ON mcp_oauth_grants (conta_id);

ALTER TABLE mcp_oauth_grants ENABLE ROW LEVEL SECURITY;

-- Workspace members may LIST their workspace's grants. All writes go through edge functions
-- (consent + revoke) using the service role, which bypasses RLS.
DROP POLICY IF EXISTS mcp_oauth_grants_select ON mcp_oauth_grants;
CREATE POLICY mcp_oauth_grants_select ON mcp_oauth_grants
  FOR SELECT USING ( conta_id IN (SELECT public.get_my_conta_id()) );

DROP POLICY IF EXISTS mcp_oauth_grants_service_role ON mcp_oauth_grants;
CREATE POLICY mcp_oauth_grants_service_role ON mcp_oauth_grants
  FOR ALL TO service_role USING (true) WITH CHECK (true);
