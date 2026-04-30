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

-- =====================================================================
-- membros.crm_user_id + privileged RPC
-- =====================================================================

-- Add nullable crm_user_id (links membro → CRM auth user).
-- Distinct from the existing membros.user_id column (which tracks who
-- created the membro record — different concept entirely).
ALTER TABLE membros
  ADD COLUMN IF NOT EXISTS crm_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- Existing membros RLS lets any workspace member UPDATE any membro row.
-- Strip authenticated's UPDATE access to crm_user_id specifically so
-- agents cannot redirect admin notifications to themselves.
REVOKE UPDATE (crm_user_id) ON membros FROM authenticated;

-- Privileged setter — only owners/admins can change crm_user_id.
CREATE OR REPLACE FUNCTION set_membro_crm_user(
  p_membro_id bigint,
  p_crm_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role text;
  v_membro_conta uuid;
BEGIN
  SELECT conta_id INTO v_membro_conta FROM membros WHERE id = p_membro_id;
  IF v_membro_conta IS NULL THEN
    RAISE EXCEPTION 'Membro not found';
  END IF;

  SELECT role INTO v_caller_role
    FROM workspace_members
    WHERE user_id = auth.uid()
      AND workspace_id = v_membro_conta;

  IF v_caller_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Insufficient permissions';
  END IF;

  UPDATE membros SET crm_user_id = p_crm_user_id WHERE id = p_membro_id;
END;
$$;

REVOKE ALL ON FUNCTION set_membro_crm_user(bigint, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_membro_crm_user(bigint, uuid) TO authenticated;
