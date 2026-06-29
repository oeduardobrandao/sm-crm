-- =============================================
-- Invite onboarding completion flag
-- =============================================
-- Clicking a Supabase invite link confirms the user's e-mail and mints a
-- session BEFORE any password is set. A user who abandons the set-password
-- form is therefore left "confirmed with no password", which surfaced on login
-- as "Invalid login credentials" ("wrong password"). The invite-user function
-- previously branched on email_confirmed_at and silently treated any confirmed
-- user as fully onboarded, so re-inviting such a user never re-sent a
-- set-password link.
--
-- This adds an explicit completion flag. invite-user now branches on it instead
-- of email_confirmed_at: a never-onboarded invitee is re-invited with a fresh
-- set-password link; only a fully-onboarded user is added to a workspace
-- directly. The flag is set when the user actually sets a password
-- (accept-invite / configurar-senha).

-- 1. Column. Default false so newly-created (invited) users start incomplete.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS onboarding_complete boolean NOT NULL DEFAULT false;

-- 2. Backfill: every existing profile belongs to a user who already got in, so
--    mark them complete. This is the safety guard that prevents the new
--    "re-invite wipes the user" path from ever deleting a real, working account
--    (e.g. an existing member invited to a second workspace).
UPDATE profiles SET onboarding_complete = true WHERE onboarding_complete = false;

-- 3. Trigger: set the flag at profile-creation time.
--    - Invited users  -> false (they must still set a password).
--    - New owner signup -> true (signUp already carried a password).
--    Superset of 20260421000002_fix_trigger_role_cast.sql; everything else is
--    unchanged.
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

    INSERT INTO profiles (id, conta_id, role, nome, active_workspace_id, onboarding_complete)
    VALUES (
      NEW.id,
      meta_conta_id,
      meta_role::user_role,
      COALESCE(NEW.raw_user_meta_data ->> 'nome', split_part(NEW.email, '@', 1)),
      CASE WHEN ws_exists THEN meta_conta_id ELSE NULL END,
      false
    )
    ON CONFLICT (id) DO UPDATE SET
      conta_id = meta_conta_id,
      role = meta_role::user_role,
      active_workspace_id = CASE WHEN ws_exists THEN meta_conta_id ELSE NULL END;
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
