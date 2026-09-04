-- admin_mcp_oauth_grants (spec docs/superpowers/specs/2026-09-04-mcp-admin-design.md §3.1).
-- Consent grant de um platform_admin para um OAuth client (claude.ai / Claude Code / Codex)
-- no servidor mcp-admin. Espelha mcp_oauth_grants, sem conta_id: os recursos do admin são
-- globais. O par (user_id, client_id) é o limite de confiança: tokens OAuth do Supabase não
-- carregam audience (sem RFC 8707), então o resource server mcp-admin só consulta ESTA tabela
-- e o mcp de workspace só consulta a dele.
CREATE TABLE IF NOT EXISTS admin_mcp_oauth_grants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id   text NOT NULL,
  scopes      text[] NOT NULL DEFAULT '{}',
  revoked_at  timestamptz,
  revoked_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, client_id)
);

CREATE INDEX IF NOT EXISTS admin_mcp_oauth_grants_lookup_idx
  ON admin_mcp_oauth_grants (user_id, client_id);

ALTER TABLE admin_mcp_oauth_grants ENABLE ROW LEVEL SECURITY;

-- Sem policy para authenticated/anon: toda leitura e escrita passa pelas edge functions
-- (mcp-oauth-consent grava, mcp-admin lê) com service role. REVOKE só de anon/authenticated:
-- revogar de PUBLIC também tiraria do service_role.
REVOKE ALL ON admin_mcp_oauth_grants FROM anon, authenticated;
GRANT ALL ON admin_mcp_oauth_grants TO service_role;

DROP POLICY IF EXISTS admin_mcp_oauth_grants_service_role ON admin_mcp_oauth_grants;
CREATE POLICY admin_mcp_oauth_grants_service_role ON admin_mcp_oauth_grants
  FOR ALL TO service_role USING (true) WITH CHECK (true);
