-- Admin Workspaces list shows each workspace's last activity, read as the newest audit_log
-- row for that workspace. With only idx_audit_log_conta_id, Postgres has to collect every
-- audit row for the workspace and sort it to find the newest — once per row on the page.
-- This composite index makes each lookup a top-1 index hit instead.
CREATE INDEX IF NOT EXISTS idx_audit_log_conta_created
  ON audit_log (conta_id, created_at DESC);
