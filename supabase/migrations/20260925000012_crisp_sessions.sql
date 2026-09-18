-- crisp_sessions (spec docs/superpowers/specs/2026-09-17-crisp-session-continuity-design.md).
-- Per-user random token for Crisp Session Continuity (window.CRISP_TOKEN_ID): the same
-- support conversation follows a CRM user across browsers, devices and cookie clears.
-- One row per user who has ever loaded the CRM post-login, minted by gen_random_uuid()
-- and handed out by crisp-identity's get-or-create upsert.
--
-- NOT a profiles column: production's live policy "Users can view own workspace profiles"
-- lets any teammate read a colleague's full profiles row, and this token is a bearer
-- credential to a conversation that already carries its owner's Verified identity.
CREATE TABLE IF NOT EXISTS crisp_sessions (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  token      uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE crisp_sessions ENABLE ROW LEVEL SECURITY;

-- No policy for authenticated/anon: only crisp-identity's service-role client ever
-- touches this table. Hosted Supabase grants anon/authenticated/service_role
-- EXPLICITLY on every new table via pg_default_acl -- not via the implicit PUBLIC
-- pseudo-role -- so REVOKE ... FROM PUBLIC alone would leave anon/authenticated
-- fully able to read/write this table. Name the roles explicitly instead.
REVOKE ALL ON crisp_sessions FROM anon, authenticated;
GRANT ALL ON crisp_sessions TO service_role;

DROP POLICY IF EXISTS crisp_sessions_service_role ON crisp_sessions;
CREATE POLICY crisp_sessions_service_role ON crisp_sessions
  FOR ALL TO service_role USING (true) WITH CHECK (true);
