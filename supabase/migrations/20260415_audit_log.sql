CREATE TABLE IF NOT EXISTS audit_log (
  id bigserial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  conta_id uuid REFERENCES workspaces(id) ON DELETE SET NULL,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text,
  metadata jsonb
);

-- Only service role can insert; no one can update or delete
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_insert" ON audit_log
  FOR INSERT TO service_role WITH CHECK (true);

CREATE POLICY "owner_admin_select" ON audit_log
  FOR SELECT USING (
    auth.uid() IN (
      SELECT id FROM profiles
      WHERE conta_id = audit_log.conta_id
      AND role IN ('owner', 'admin')
    )
  );

CREATE INDEX idx_audit_log_conta_id ON audit_log (conta_id);
CREATE INDEX idx_audit_log_actor ON audit_log (actor_user_id);
CREATE INDEX idx_audit_log_created_at ON audit_log (created_at);
