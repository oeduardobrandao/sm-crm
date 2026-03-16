-- =============================================
-- Multi-Workspace Support
-- =============================================

-- 1. Workspaces table
CREATE TABLE IF NOT EXISTS workspaces (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  logo_url text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now()
);

-- 2. Junction table for workspace membership
CREATE TABLE IF NOT EXISTS workspace_members (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'agent')),
  joined_at timestamptz DEFAULT now(),
  UNIQUE(user_id, workspace_id)
);

CREATE INDEX idx_workspace_members_user ON workspace_members (user_id);
CREATE INDEX idx_workspace_members_workspace ON workspace_members (workspace_id);

-- 3. Active workspace tracker on profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS active_workspace_id uuid REFERENCES workspaces(id);

-- 4. Migrate existing data: create a workspace per unique conta_id
-- Use conta_id as workspace id to preserve FK references in invites table
INSERT INTO workspaces (id, name, created_by)
SELECT DISTINCT ON (p.conta_id)
  p.conta_id,
  COALESCE(NULLIF(p.empresa, ''), 'Workspace'),
  p.id
FROM profiles p
WHERE p.conta_id IS NOT NULL
  AND p.role = 'owner'
ON CONFLICT (id) DO NOTHING;

-- Handle workspaces where no owner profile exists (fallback)
INSERT INTO workspaces (id, name, created_by)
SELECT DISTINCT p.conta_id, 'Workspace', p.id
FROM profiles p
WHERE p.conta_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM workspaces w WHERE w.id = p.conta_id)
ON CONFLICT (id) DO NOTHING;

-- 5. Migrate workspace memberships
INSERT INTO workspace_members (user_id, workspace_id, role)
SELECT id, conta_id, COALESCE(role, 'agent')
FROM profiles
WHERE conta_id IS NOT NULL
ON CONFLICT (user_id, workspace_id) DO NOTHING;

-- 6. Set active workspace to current conta_id
UPDATE profiles SET active_workspace_id = conta_id WHERE conta_id IS NOT NULL;

-- 7. Update get_my_conta_id() to return active_workspace_id
-- This is the KEY change: all existing RLS policies continue working without modification
CREATE OR REPLACE FUNCTION public.get_my_conta_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT active_workspace_id FROM profiles WHERE id = auth.uid();
$$;

-- 8. RLS for workspaces table
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ws_select_member" ON workspaces
  FOR SELECT USING (
    id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())
  );

-- Only service role can insert/update/delete workspaces
CREATE POLICY "ws_no_client_insert" ON workspaces
  FOR INSERT WITH CHECK (false);

CREATE POLICY "ws_update_owner" ON workspaces
  FOR UPDATE USING (
    id IN (
      SELECT workspace_id FROM workspace_members
      WHERE user_id = auth.uid() AND role = 'owner'
    )
  );

CREATE POLICY "ws_no_client_delete" ON workspaces
  FOR DELETE USING (false);

-- 9. RLS for workspace_members table
ALTER TABLE workspace_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wm_select_same_workspace" ON workspace_members
  FOR SELECT USING (
    workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())
  );

-- Only service role can insert/update/delete members
CREATE POLICY "wm_no_client_insert" ON workspace_members
  FOR INSERT WITH CHECK (false);

CREATE POLICY "wm_no_client_update" ON workspace_members
  FOR UPDATE USING (false);

CREATE POLICY "wm_no_client_delete" ON workspace_members
  FOR DELETE USING (false);

-- 10. Trigger to validate active_workspace_id on switch
CREATE OR REPLACE FUNCTION public.validate_active_workspace()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.active_workspace_id IS DISTINCT FROM OLD.active_workspace_id
     AND NEW.active_workspace_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM workspace_members
       WHERE user_id = NEW.id AND workspace_id = NEW.active_workspace_id
     ) THEN
    RAISE EXCEPTION 'User is not a member of this workspace';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_active_workspace
  BEFORE UPDATE OF active_workspace_id ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_active_workspace();

-- 11. Auto-create workspace on new user signup (via trigger)
CREATE OR REPLACE FUNCTION public.handle_new_user_workspace()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ws_id uuid;
  meta_conta_id uuid;
  meta_role user_role;
BEGIN
  -- Check if this user was invited (has conta_id in metadata)
  meta_conta_id := (NEW.raw_user_meta_data ->> 'conta_id')::uuid;
  meta_role := COALESCE(NEW.raw_user_meta_data ->> 'role', 'agent')::user_role;

  IF meta_conta_id IS NOT NULL THEN
    -- Profile FIRST (workspace_members has FK to profiles)
    INSERT INTO profiles (id, conta_id, role, nome, active_workspace_id)
    VALUES (
      NEW.id,
      meta_conta_id,
      meta_role,
      COALESCE(NEW.raw_user_meta_data ->> 'nome', split_part(NEW.email, '@', 1)),
      meta_conta_id
    )
    ON CONFLICT (id) DO UPDATE SET
      conta_id = meta_conta_id,
      role = meta_role,
      active_workspace_id = meta_conta_id;

    INSERT INTO workspace_members (user_id, workspace_id, role)
    VALUES (NEW.id, meta_conta_id, meta_role)
    ON CONFLICT (user_id, workspace_id) DO NOTHING;
  ELSE
    -- New signup: create workspace
    ws_id := gen_random_uuid();
    INSERT INTO workspaces (id, name, created_by)
    VALUES (ws_id, COALESCE(NEW.raw_user_meta_data ->> 'empresa', 'Meu Workspace'), NEW.id);

    -- Profile FIRST
    INSERT INTO profiles (id, conta_id, role, nome, empresa, active_workspace_id)
    VALUES (
      NEW.id,
      ws_id,
      'owner',
      COALESCE(NEW.raw_user_meta_data ->> 'nome', split_part(NEW.email, '@', 1)),
      COALESCE(NEW.raw_user_meta_data ->> 'empresa', ''),
      ws_id
    )
    ON CONFLICT (id) DO UPDATE SET
      conta_id = ws_id,
      role = 'owner',
      active_workspace_id = ws_id;

    INSERT INTO workspace_members (user_id, workspace_id, role)
    VALUES (NEW.id, ws_id, 'owner');
  END IF;

  RETURN NEW;
END;
$$;

-- Replace existing trigger if any, or create new
DROP TRIGGER IF EXISTS on_auth_user_created_workspace ON auth.users;
CREATE TRIGGER on_auth_user_created_workspace
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user_workspace();
