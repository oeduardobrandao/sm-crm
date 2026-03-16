-- =============================================
-- Invite Status Tracking
-- =============================================

CREATE TABLE IF NOT EXISTS invites (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  conta_id uuid NOT NULL,
  email text NOT NULL,
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'agent')),
  invited_by uuid NOT NULL REFERENCES auth.users(id),
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired')),
  created_at timestamptz DEFAULT now(),
  accepted_at timestamptz,
  expires_at timestamptz DEFAULT (now() + interval '7 days')
);

-- Index for common lookups
CREATE INDEX idx_invites_conta_status ON invites (conta_id, status);
CREATE INDEX idx_invites_email_status ON invites (email, status);

ALTER TABLE invites ENABLE ROW LEVEL SECURITY;

-- Workspace members can view invites for their workspace
CREATE POLICY "invites_select_same_workspace" ON invites
  FOR SELECT USING (conta_id = public.get_my_conta_id());

-- Only edge functions (service role) can insert/update/delete
CREATE POLICY "invites_no_client_insert" ON invites
  FOR INSERT WITH CHECK (false);

CREATE POLICY "invites_no_client_update" ON invites
  FOR UPDATE USING (false);

CREATE POLICY "invites_no_client_delete" ON invites
  FOR DELETE USING (false);

-- Function to auto-expire pending invites and clean up old expired ones
CREATE OR REPLACE FUNCTION public.expire_and_cleanup_invites()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Mark pending invites as expired if past expiry date
  UPDATE invites
  SET status = 'expired'
  WHERE status = 'pending' AND expires_at < now();

  -- Delete expired invites older than 30 days
  DELETE FROM invites
  WHERE status = 'expired' AND expires_at < (now() - interval '30 days');
END;
$$;
