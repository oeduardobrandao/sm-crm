-- supabase/migrations/20260731000004_post_approvals_update_guard.sql
-- Companion to 20260731000003's INSERT policy: post_approvals rows are an
-- immutable feedback/audit log. The permissive workspace policy is FOR ALL
-- with conta scope only, so without these restrictive policies a workspace
-- member could UPDATE a row via direct PostgREST (forging a colleague's
-- author_user_id or flipping is_workspace_user to impersonate the client in
-- both feeds) or DELETE history. No app code path updates or deletes these
-- rows; the service role (hub functions) is unaffected.
CREATE POLICY post_approvals_authenticated_no_update ON post_approvals
  AS RESTRICTIVE
  FOR UPDATE
  TO authenticated
  USING (false);

CREATE POLICY post_approvals_authenticated_no_delete ON post_approvals
  AS RESTRICTIVE
  FOR DELETE
  TO authenticated
  USING (false);
