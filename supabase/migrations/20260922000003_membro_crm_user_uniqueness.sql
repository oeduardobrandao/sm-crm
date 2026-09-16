-- Guard against two membros rows in the same workspace being linked to the
-- same CRM login. Nothing enforced this before: `set_membro_crm_user` did a
-- bare UPDATE with no conflict check, and `accept_workspace_invite`'s
-- membro-link step only checked the TARGET membro row was unlinked, never
-- whether the accepting user was already linked to a DIFFERENT membro in the
-- same conta. Confirmed on prod: two separate workspaces each had a login
-- linked to two membros rows at once, so every message/comment/approval that
-- user sent came back duplicated -- once per linked membro -- from
-- get_mensagens_feed's `LEFT JOIN membros mb ON mb.crm_user_id = f.f_author`
-- (20260830000003_avulso_notifications_folders_views.sql), which assumes
-- 0-or-1 membro per (conta, crm_user_id) and silently fans out otherwise.
-- Both prod duplicates were cleaned up by hand before this migration; see
-- the incident writeup for detail. The index below is what makes it stay
-- clean.

-- Per-conta, not global: the same person can legitimately be a membro of
-- multiple contas (see 20260903000030_workflow_analytics_events.sql's note
-- that crm_user_id is not unique ACROSS contas -- that's expected).
CREATE UNIQUE INDEX IF NOT EXISTS membros_conta_crm_user_unique
  ON public.membros (conta_id, crm_user_id)
  WHERE crm_user_id IS NOT NULL;

-- Privileged setter — only owners/admins can change crm_user_id. Same body
-- as 20260430000001_notifications.sql, plus a conflict check before the
-- UPDATE so callers get a clear error instead of a raw unique_violation.
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
  v_conflict_membro_id bigint;
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

  IF p_crm_user_id IS NOT NULL THEN
    SELECT id INTO v_conflict_membro_id
      FROM membros
      WHERE conta_id = v_membro_conta
        AND crm_user_id = p_crm_user_id
        AND id <> p_membro_id;

    IF v_conflict_membro_id IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'P0409', MESSAGE = 'crm_user_already_linked';
    END IF;
  END IF;

  UPDATE membros SET crm_user_id = p_crm_user_id WHERE id = p_membro_id;
END;
$$;

REVOKE ALL ON FUNCTION set_membro_crm_user(bigint, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_membro_crm_user(bigint, uuid) TO authenticated;

-- Same body as 20260903000002_workspace_roles_a_additive.sql, with one
-- change to the membro-link block: also skip the link when p_user_id is
-- already linked to a DIFFERENT membro in this conta. Without this, that
-- UPDATE would hit membros_conta_crm_user_unique and abort the whole accept
-- (the workspace_members/profiles writes above would roll back too) -- and
-- letting someone into their own workspace matters more than this roster
-- display link, so we leave the target membro row unlinked instead of
-- failing the accept. An admin can link it by hand afterwards.
CREATE OR REPLACE FUNCTION public.accept_workspace_invite(p_user_id uuid)
RETURNS TABLE (
  invite_id uuid,
  conta_id uuid,
  role text,
  email text,
  already_accepted boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text;
  v_conta_id uuid;
  v_invite public.invites%ROWTYPE;
BEGIN
  SELECT lower(u.email)
  INTO v_email
  FROM auth.users u
  WHERE u.id = p_user_id;

  IF v_email IS NULL THEN
    RAISE EXCEPTION 'invite_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT p.conta_id
  INTO v_conta_id
  FROM profiles p
  WHERE p.id = p_user_id
  FOR UPDATE;

  IF v_conta_id IS NULL THEN
    RAISE EXCEPTION 'invite_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT i.*
  INTO v_invite
  FROM invites i
  WHERE lower(i.email) = v_email
    AND i.conta_id = v_conta_id
    AND i.status = 'pending'
    AND i.expires_at > now()
  ORDER BY i.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    SELECT i.*
    INTO v_invite
    FROM invites i
    WHERE lower(i.email) = v_email
      AND i.conta_id = v_conta_id
      AND i.status = 'accepted'
      AND EXISTS (
        SELECT 1
        FROM workspace_members wm
        WHERE wm.user_id = p_user_id
          AND wm.workspace_id = i.conta_id
      )
    ORDER BY i.accepted_at DESC NULLS LAST, i.created_at DESC
    LIMIT 1;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'invite_not_found' USING ERRCODE = 'P0002';
    END IF;

    invite_id := v_invite.id;
    conta_id := v_invite.conta_id;
    role := v_invite.role;
    email := v_email;
    already_accepted := true;
    RETURN NEXT;
    RETURN;
  END IF;

  INSERT INTO workspace_members (user_id, workspace_id, role, role_id)
  VALUES (p_user_id, v_invite.conta_id,
          CASE WHEN v_invite.role_id IS NOT NULL THEN 'agent' ELSE v_invite.role END,
          v_invite.role_id)
  ON CONFLICT (user_id, workspace_id) DO UPDATE
  SET role = EXCLUDED.role, role_id = EXCLUDED.role_id;

  UPDATE profiles
  SET conta_id = v_invite.conta_id,
      active_workspace_id = v_invite.conta_id,
      role = CASE WHEN v_invite.role_id IS NOT NULL
                THEN 'agent'::user_role ELSE v_invite.role::user_role END,
      onboarding_complete = true
  WHERE id = p_user_id;

  UPDATE invites
  SET status = 'accepted',
      accepted_at = now()
  WHERE id = v_invite.id;

  -- Link the membro this invite was sent for. Guarded by crm_user_id IS NULL
  -- so a manual link made in the meantime wins; conta_id guard keeps the
  -- update inside the invite's workspace; the NOT EXISTS guard skips the
  -- link (rather than failing the whole accept) when p_user_id is already
  -- linked to a different membro in this conta -- see migration header.
  IF v_invite.membro_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM membros m2
       WHERE m2.conta_id = v_invite.conta_id
         AND m2.crm_user_id = p_user_id
         AND m2.id <> v_invite.membro_id
     )
  THEN
    UPDATE membros m
    SET crm_user_id = p_user_id
    WHERE m.id = v_invite.membro_id
      AND m.conta_id = v_invite.conta_id
      AND m.crm_user_id IS NULL;
  END IF;

  invite_id := v_invite.id;
  conta_id := v_invite.conta_id;
  role := v_invite.role;
  email := v_email;
  already_accepted := false;
  RETURN NEXT;
END;
$$;
