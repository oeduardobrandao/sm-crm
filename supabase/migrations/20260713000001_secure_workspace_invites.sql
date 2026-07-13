-- Derive invited-user authorization from server-persisted invitations.
-- User-editable auth metadata may select an invitation, but never supplies its role.

CREATE OR REPLACE FUNCTION public.get_my_conta_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.active_workspace_id
  FROM profiles p
  WHERE p.id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM workspace_members wm
      WHERE wm.user_id = auth.uid()
        AND wm.workspace_id = p.active_workspace_id
    );
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user_workspace()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ws_id uuid;
  meta_conta_id uuid;
  ws_name text;
  ws_slug text;
  ws_exists boolean;
  ws_created_by uuid;
  v_invite public.invites%ROWTYPE;
BEGIN
  BEGIN
    meta_conta_id := NULLIF(NEW.raw_user_meta_data ->> 'conta_id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'invalid_workspace_invitation';
  END;

  IF meta_conta_id IS NOT NULL THEN
    SELECT i.*
    INTO v_invite
    FROM public.invites i
    WHERE lower(i.email) = lower(NEW.email)
      AND i.conta_id = meta_conta_id
      AND i.status = 'pending'
      AND i.expires_at > now()
    ORDER BY i.created_at DESC
    LIMIT 1
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'invalid_workspace_invitation';
    END IF;

    SELECT EXISTS(
      SELECT 1 FROM workspaces w WHERE w.id = v_invite.conta_id
    ) INTO ws_exists;

    IF NOT ws_exists THEN
      SELECT c.nome INTO ws_name
      FROM contas c
      WHERE c.id = v_invite.conta_id;

      IF ws_name IS NULL THEN
        RAISE EXCEPTION 'invalid_workspace_invitation';
      END IF;

      SELECT p.id INTO ws_created_by
      FROM profiles p
      WHERE p.conta_id = v_invite.conta_id
        AND p.role = 'owner'::user_role
      ORDER BY p.created_at
      LIMIT 1;

      ws_slug := trim(both '-' from regexp_replace(lower(ws_name), '[^a-z0-9]+', '-', 'g'));
      IF ws_slug = '' THEN ws_slug := 'workspace'; END IF;
      ws_slug := ws_slug || '-' || substr(replace(v_invite.conta_id::text, '-', ''), 1, 8);

      INSERT INTO workspaces (id, name, created_by, slug)
      VALUES (v_invite.conta_id, ws_name, COALESCE(ws_created_by, NEW.id), ws_slug)
      ON CONFLICT (id) DO NOTHING;
    END IF;

    INSERT INTO profiles (id, conta_id, role, nome, active_workspace_id, onboarding_complete)
    VALUES (
      NEW.id,
      v_invite.conta_id,
      v_invite.role::user_role,
      COALESCE(NEW.raw_user_meta_data ->> 'nome', split_part(NEW.email, '@', 1)),
      v_invite.conta_id,
      false
    )
    ON CONFLICT (id) DO UPDATE SET
      conta_id = EXCLUDED.conta_id,
      role = EXCLUDED.role,
      active_workspace_id = EXCLUDED.active_workspace_id;
  ELSE
    ws_id := gen_random_uuid();
    ws_name := COALESCE(NEW.raw_user_meta_data ->> 'empresa', 'Meu Workspace');
    ws_slug := trim(both '-' from regexp_replace(lower(ws_name), '[^a-z0-9]+', '-', 'g'));
    IF ws_slug = '' THEN ws_slug := 'workspace'; END IF;
    ws_slug := ws_slug || '-' || substr(replace(ws_id::text, '-', ''), 1, 8);

    INSERT INTO contas (id, nome, slug)
    VALUES (ws_id, ws_name, ws_slug);

    INSERT INTO workspaces (id, name, created_by, slug)
    VALUES (ws_id, ws_name, NEW.id, ws_slug);

    INSERT INTO profiles (
      id,
      conta_id,
      role,
      nome,
      empresa,
      active_workspace_id,
      onboarding_complete
    )
    VALUES (
      NEW.id,
      ws_id,
      'owner'::user_role,
      COALESCE(NEW.raw_user_meta_data ->> 'nome', split_part(NEW.email, '@', 1)),
      ws_name,
      ws_id,
      true
    )
    ON CONFLICT (id) DO UPDATE SET
      conta_id = EXCLUDED.conta_id,
      role = EXCLUDED.role,
      active_workspace_id = EXCLUDED.active_workspace_id;

    INSERT INTO workspace_members (user_id, workspace_id, role)
    VALUES (NEW.id, ws_id, 'owner')
    ON CONFLICT (user_id, workspace_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

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
