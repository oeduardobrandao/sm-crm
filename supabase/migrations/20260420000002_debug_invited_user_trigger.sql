-- Wrap trigger body in BEGIN/EXCEPTION to surface exact failure point
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
    -- Invited user path
    BEGIN
      SELECT EXISTS(SELECT 1 FROM workspaces WHERE id = meta_conta_id) INTO ws_exists;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION '[trigger] workspaces lookup failed: %', SQLERRM;
    END;

    BEGIN
      INSERT INTO profiles (id, conta_id, role, nome, active_workspace_id)
      VALUES (
        NEW.id,
        meta_conta_id,
        meta_role,
        COALESCE(NEW.raw_user_meta_data ->> 'nome', split_part(NEW.email, '@', 1)),
        CASE WHEN ws_exists THEN meta_conta_id ELSE NULL END
      )
      ON CONFLICT (id) DO UPDATE SET
        conta_id = meta_conta_id,
        role = meta_role,
        active_workspace_id = CASE WHEN ws_exists THEN meta_conta_id ELSE NULL END;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION '[trigger] profiles insert failed (ws_exists=%): %', ws_exists, SQLERRM;
    END;

    BEGIN
      INSERT INTO workspace_members (user_id, workspace_id, role)
      VALUES (NEW.id, meta_conta_id, meta_role)
      ON CONFLICT (user_id, workspace_id) DO NOTHING;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION '[trigger] workspace_members insert failed: %', SQLERRM;
    END;

  ELSE
    -- New signup path
    ws_id := gen_random_uuid();
    ws_name := COALESCE(NEW.raw_user_meta_data ->> 'empresa', 'Meu Workspace');
    ws_slug := regexp_replace(lower(ws_name), '[^a-z0-9]+', '-', 'g');
    ws_slug := trim(both '-' from ws_slug);
    IF ws_slug = '' THEN ws_slug := 'workspace'; END IF;
    ws_slug := ws_slug || '-' || substr(replace(ws_id::text, '-', ''), 1, 8);

    BEGIN
      INSERT INTO contas (id, nome, slug) VALUES (ws_id, ws_name, ws_slug);
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION '[trigger] contas insert failed: %', SQLERRM;
    END;

    BEGIN
      INSERT INTO workspaces (id, name, created_by) VALUES (ws_id, ws_name, NEW.id);
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION '[trigger] workspaces insert failed: %', SQLERRM;
    END;

    BEGIN
      INSERT INTO profiles (id, conta_id, role, nome, empresa, active_workspace_id)
      VALUES (
        NEW.id, ws_id, 'owner',
        COALESCE(NEW.raw_user_meta_data ->> 'nome', split_part(NEW.email, '@', 1)),
        ws_name, ws_id
      )
      ON CONFLICT (id) DO UPDATE SET conta_id = ws_id, role = 'owner', active_workspace_id = ws_id;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION '[trigger] profiles insert (new signup) failed: %', SQLERRM;
    END;

    BEGIN
      INSERT INTO workspace_members (user_id, workspace_id, role) VALUES (NEW.id, ws_id, 'owner');
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION '[trigger] workspace_members insert (new signup) failed: %', SQLERRM;
    END;
  END IF;

  RETURN NEW;
END;
$$;
