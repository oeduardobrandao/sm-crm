-- mcp_api_keys — workspace-scoped API keys for the MCP server.
-- A raw token (mesaas_sk_…) is generated server-side; only its SHA-256 hash is stored.
-- All WRITES go through edge functions (service role); clients may only LIST (column-limited).

CREATE TABLE IF NOT EXISTS mcp_api_keys (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conta_id      uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_by    uuid NOT NULL REFERENCES auth.users(id),
  name          text NOT NULL,
  token_hash    text NOT NULL UNIQUE,           -- SHA-256(raw token); raw token never stored
  token_suffix  text NOT NULL,                  -- last 4 chars, for masked display only
  scopes        text[] NOT NULL DEFAULT '{}',   -- e.g. {clientes:read, posts:read, ...}
  last_used_at  timestamptz,
  expires_at    timestamptz,
  revoked_at    timestamptz,
  revoked_by    uuid REFERENCES auth.users(id), -- CRM user OR platform admin
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mcp_api_keys_token_hash_idx ON mcp_api_keys (token_hash);
CREATE INDEX IF NOT EXISTS mcp_api_keys_conta_id_idx   ON mcp_api_keys (conta_id);

ALTER TABLE mcp_api_keys ENABLE ROW LEVEL SECURITY;

-- Workspace members may LIST their workspace's keys. (No insert/update/delete policy:
-- all writes happen via edge functions using the service role, which bypasses RLS.)
CREATE POLICY mcp_keys_select ON mcp_api_keys
  FOR SELECT USING ( conta_id IN (SELECT public.get_my_conta_id()) );

CREATE POLICY mcp_keys_service_role ON mcp_api_keys
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Column-level privilege: RLS filters ROWS but does NOT hide columns. token_hash must never be
-- readable by app clients. Revoke broad select, then grant select on every column EXCEPT token_hash.
REVOKE ALL ON mcp_api_keys FROM anon;
REVOKE SELECT ON mcp_api_keys FROM authenticated;
GRANT SELECT (id, conta_id, created_by, name, token_suffix, scopes,
              last_used_at, expires_at, revoked_at, revoked_by, created_at)
  ON mcp_api_keys TO authenticated;
-- token_hash deliberately omitted → selecting it raises a permission error.

-- Plan-cap enforcement: limits are enforced by BEFORE INSERT triggers, not by
-- effective_plan_limit() alone. Count only active (non-revoked) keys, so revoking frees a slot.
DROP TRIGGER IF EXISTS trg_limit_mcp_keys ON mcp_api_keys;
CREATE TRIGGER trg_limit_mcp_keys BEFORE INSERT ON mcp_api_keys
  FOR EACH ROW EXECUTE FUNCTION
    enforce_plan_count_limit('max_mcp_keys', 'direct', 'conta_id', 'conta_id', 'revoked_at is null');
