-- Explicitly deny DELETE and UPDATE on audit_log for all roles.
-- Postgres RLS default-deny already prevents this, but explicit policies
-- make the intent clear and prevent accidental future policy additions.
DO $$ BEGIN
  DROP POLICY IF EXISTS "no_delete" ON audit_log;
  CREATE POLICY "no_delete" ON audit_log
    FOR DELETE USING (false);
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "no_update" ON audit_log;
  CREATE POLICY "no_update" ON audit_log
    FOR UPDATE USING (false);
END $$;
