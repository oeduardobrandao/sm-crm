-- =============================================
-- Fix: handle_new_user_workspace trigger used
-- non-existent `user_role` enum type. Replace
-- with `text` (profiles.role is already text).
-- =============================================

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
BEGIN
  -- Check if this user was invited (has conta_id in metadata)
  meta_conta_id := (NEW.raw_user_meta_data ->> 'conta_id')::uuid;
  meta_role := COALESCE(NEW.raw_user_meta_data ->> 'role', 'agent');

  IF meta_conta_id IS NOT NULL THEN
    -- Profile FIRST (workspace_members has FK to profiles)
    INSERT INTO profiles (id, conta_id, role, nome, active_workspace_id)
    VALUES (
      NEW.id,
      meta_conta_id,
      meta_role::user_role,
      COALESCE(NEW.raw_user_meta_data ->> 'nome', split_part(NEW.email, '@', 1)),
      meta_conta_id
    )
    ON CONFLICT (id) DO UPDATE SET
      conta_id = meta_conta_id,
      role = meta_role::user_role,
      active_workspace_id = meta_conta_id;

    INSERT INTO workspace_members (user_id, workspace_id, role)
    VALUES (NEW.id, meta_conta_id, meta_role)
    ON CONFLICT (user_id, workspace_id) DO NOTHING;
  ELSE
    -- New signup: create conta + workspace (same id)
    ws_id := gen_random_uuid();

    INSERT INTO contas (id, nome)
    VALUES (ws_id, COALESCE(NEW.raw_user_meta_data ->> 'empresa', 'Meu Workspace'));

    INSERT INTO workspaces (id, name, created_by)
    VALUES (ws_id, COALESCE(NEW.raw_user_meta_data ->> 'empresa', 'Meu Workspace'), NEW.id);

    -- Profile FIRST
    INSERT INTO profiles (id, conta_id, role, nome, empresa, active_workspace_id)
    VALUES (
      NEW.id,
      ws_id,
      'owner'::user_role,
      COALESCE(NEW.raw_user_meta_data ->> 'nome', split_part(NEW.email, '@', 1)),
      COALESCE(NEW.raw_user_meta_data ->> 'empresa', ''),
      ws_id
    )
    ON CONFLICT (id) DO UPDATE SET
      conta_id = ws_id,
      role = 'owner'::user_role,
      active_workspace_id = ws_id;

    INSERT INTO workspace_members (user_id, workspace_id, role)
    VALUES (NEW.id, ws_id, 'owner');
  END IF;

  RETURN NEW;
END;
$$;
