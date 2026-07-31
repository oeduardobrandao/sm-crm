-- Link workspace invites to membros da equipe.
--
-- invites.membro_id records which membro an invite was sent for (from the
-- Equipe form). accept_workspace_invite then links the membro to the new
-- user (membros.crm_user_id) at acceptance time.
--
-- The RPC body is copied from its CURRENT deployed definition
-- (20260720000004_reconcile_prod_missing_functions.sql), NOT the original
-- 20260713000001 version, with only the membro-link block added.

ALTER TABLE public.invites
  ADD COLUMN membro_id bigint REFERENCES public.membros(id) ON DELETE SET NULL;

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

  INSERT INTO workspace_members (user_id, workspace_id, role)
  VALUES (p_user_id, v_invite.conta_id, v_invite.role)
  ON CONFLICT (user_id, workspace_id) DO UPDATE
  SET role = EXCLUDED.role;

  UPDATE profiles
  SET conta_id = v_invite.conta_id,
      active_workspace_id = v_invite.conta_id,
      role = v_invite.role::user_role,
      onboarding_complete = true
  WHERE id = p_user_id;

  UPDATE invites
  SET status = 'accepted',
      accepted_at = now()
  WHERE id = v_invite.id;

  -- Link the membro this invite was sent for. Guarded by crm_user_id IS NULL
  -- so a manual link made in the meantime wins; conta_id guard keeps the
  -- update inside the invite's workspace.
  IF v_invite.membro_id IS NOT NULL THEN
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

REVOKE ALL ON FUNCTION public.accept_workspace_invite(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_workspace_invite(uuid) TO service_role;
