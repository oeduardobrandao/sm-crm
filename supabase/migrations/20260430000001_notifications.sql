-- =====================================================================
-- 20260430000001_notifications.sql
-- Notification system: table + RLS + indexes + column grants.
-- Subsequent sections (helpers, triggers, membros ALTER, RPC) are
-- appended in later tasks of the implementation plan.
-- =====================================================================

-- ---------- Table -----------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type          text NOT NULL,
  metadata      jsonb DEFAULT '{}'::jsonb,
  link          text,
  read_at       timestamptz,
  dismissed_at  timestamptz,
  created_at    timestamptz DEFAULT now()
);

-- ---------- Type CHECK -----------------------------------------------
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (
  type IN (
    'post_approved', 'post_correction', 'post_message',
    'idea_submitted', 'briefing_answered',
    'step_activated', 'step_completed', 'post_assigned',
    'workflow_completed', 'deadline_approaching',
    'invite_accepted', 'member_role_changed', 'member_removed'
  )
);

-- ---------- Indexes ---------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notifications (user_id, created_at DESC)
  WHERE read_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_user_visible
  ON notifications (user_id, created_at DESC)
  WHERE dismissed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_cleanup
  ON notifications (created_at);

-- ---------- RLS + grants ---------------------------------------------
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notifications_select ON notifications;
CREATE POLICY notifications_select ON notifications
  FOR SELECT USING (user_id = auth.uid());

-- No INSERT policy — SECURITY DEFINER trigger functions (owned by postgres)
-- and the service role are the only writers.

-- No DELETE policy — cleanup cron uses service role.

-- Column-level grants: authenticated can only update read_at + dismissed_at.
REVOKE UPDATE ON notifications FROM authenticated;
GRANT UPDATE (read_at, dismissed_at) ON notifications TO authenticated;

DROP POLICY IF EXISTS notifications_update ON notifications;
CREATE POLICY notifications_update ON notifications
  FOR UPDATE USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
