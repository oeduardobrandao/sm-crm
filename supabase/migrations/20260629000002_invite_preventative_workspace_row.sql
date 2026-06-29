-- =============================================
-- Preventative fix: invited users must never get a NULL active_workspace_id
-- =============================================
-- get_my_conta_id() returns profiles.active_workspace_id, and every data-table
-- RLS policy gates on it. The prior invited-user trigger set
-- active_workspace_id = CASE WHEN ws_exists THEN meta_conta_id ELSE NULL END,
-- so an invite into a conta that has no matching `workspaces` row (a legacy /
-- manually-created conta) left active_workspace_id NULL -> the user could log
-- in but every protected query returned zero rows ("working app, no data").
-- The ELSE-NULL branch existed only because profiles.active_workspace_id has an
-- FK to workspaces(id); setting it without a workspaces row failed the insert.
--
-- Fix: when the invite's workspaces row is missing, CREATE it first, then set
-- active_workspace_id unconditionally. The common path (workspaces row already
-- exists) is unchanged. Trigger-only change; existing rows are not touched.
-- Superset of 20260629000001_invite_onboarding_complete.sql.
CREATE OR REPLACE FUNCTION public.handle_new_user_workspace()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ws_id uuid;
  meta_conta_id uuid;
  meta_role text;
  ws_name text;
  ws_slug text;
  ws_exists boolean;
BEGIN
  meta_conta_id := (NEW.raw_user_meta_data ->> 'conta_id')::uuid;
  meta_role := COALESCE(NEW.raw_user_meta_data ->> 'role', 'agent');

  IF meta_conta_id IS NOT NULL THEN
    SELECT EXISTS(SELECT 1 FROM workspaces WHERE id = meta_conta_id) INTO ws_exists;

    -- Preventative: create the missing workspaces row so active_workspace_id
    -- can always be set (FK to workspaces + non-NULL for RLS to grant data).
    IF NOT ws_exists THEN
      SELECT nome INTO ws_name FROM contas WHERE id = meta_conta_id;
      ws_name := COALESCE(ws_name, 'Workspace');
      ws_slug := regexp_replace(lower(ws_name), '[^a-z0-9]+', '-', 'g');
      ws_slug := trim(both '-' from ws_slug);
      IF ws_slug = '' THEN ws_slug := 'workspace'; END IF;
      ws_slug := ws_slug || '-' || substr(replace(meta_conta_id::text, '-', ''), 1, 8);

      INSERT INTO workspaces (id, name, created_by, slug)
      VALUES (meta_conta_id, ws_name, NEW.id, ws_slug)
      ON CONFLICT (id) DO NOTHING;

      ws_exists := true;
    END IF;

    INSERT INTO profiles (id, conta_id, role, nome, active_workspace_id, onboarding_complete)
    VALUES (
      NEW.id,
      meta_conta_id,
      meta_role::user_role,
      COALESCE(NEW.raw_user_meta_data ->> 'nome', split_part(NEW.email, '@', 1)),
      meta_conta_id,
      false
    )
    ON CONFLICT (id) DO UPDATE SET
      conta_id = meta_conta_id,
      role = meta_role::user_role,
      active_workspace_id = meta_conta_id;
      -- Deliberately NOT resetting onboarding_complete on conflict: never
      -- downgrade a user who has already completed onboarding.

  ELSE
    ws_id := gen_random_uuid();
    ws_name := COALESCE(NEW.raw_user_meta_data ->> 'empresa', 'Meu Workspace');
    ws_slug := regexp_replace(lower(ws_name), '[^a-z0-9]+', '-', 'g');
    ws_slug := trim(both '-' from ws_slug);
    IF ws_slug = '' THEN ws_slug := 'workspace'; END IF;
    ws_slug := ws_slug || '-' || substr(replace(ws_id::text, '-', ''), 1, 8);

    INSERT INTO contas (id, nome, slug) VALUES (ws_id, ws_name, ws_slug);

    INSERT INTO workspaces (id, name, created_by, slug) VALUES (ws_id, ws_name, NEW.id, ws_slug);

    INSERT INTO profiles (id, conta_id, role, nome, empresa, active_workspace_id, onboarding_complete)
    VALUES (
      NEW.id, ws_id, 'owner'::user_role,
      COALESCE(NEW.raw_user_meta_data ->> 'nome', split_part(NEW.email, '@', 1)),
      ws_name, ws_id, true
    )
    -- Like the invited branch, do NOT set onboarding_complete on conflict, so an
    -- existing owner's completion flag is never downgraded.
    ON CONFLICT (id) DO UPDATE SET conta_id = ws_id, role = 'owner'::user_role, active_workspace_id = ws_id;

    INSERT INTO workspace_members (user_id, workspace_id, role) VALUES (NEW.id, ws_id, 'owner');
  END IF;

  RETURN NEW;
END;
$$;
