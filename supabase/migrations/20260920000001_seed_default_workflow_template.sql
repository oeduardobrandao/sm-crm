-- Seed a default workflow template ("Padrão") for every brand-new workspace
-- created at self-signup. Mirrors the 'aprovacao-dupla' preset's field
-- conventions (apps/crm/src/pages/entregas/wizard/presets.ts): content steps
-- uteis/padrao, approval steps corridos/aprovacao_cliente.
--
-- This re-declares handle_new_user_workspace() in full (copied verbatim from
-- 20260719000002_signup_marketing_opt_in.sql) and adds exactly one new block
-- after the workspace_members INSERT, inside the fresh-signup / owner branch
-- only. The invited-user branch (joins a workspace that may already have
-- templates) is untouched.

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
      telefone,
      marketing_opt_in,
      active_workspace_id,
      onboarding_complete
    )
    VALUES (
      NEW.id,
      ws_id,
      'owner'::user_role,
      COALESCE(NEW.raw_user_meta_data ->> 'nome', split_part(NEW.email, '@', 1)),
      ws_name,
      NULLIF(NEW.raw_user_meta_data ->> 'telefone', ''),
      COALESCE((NEW.raw_user_meta_data ->> 'marketing_opt_in')::boolean, false),
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

    -- Seed the workspace's first workflow template ("Padrão"). Fully normal, editable,
    -- deletable — no locked flag. Wrapped because this runs inside an AFTER INSERT ON
    -- auth.users trigger: any unhandled exception here would abort the signup itself.
    -- trg_limit_templates can legitimately raise (effective_plan_limit fails closed to 0
    -- when there's no is_default plan, or a 0/malformed workspace override) — a signup
    -- must never fail because of this convenience seed.
    BEGIN
      INSERT INTO workflow_templates (user_id, conta_id, nome, etapas, modo_prazo)
      VALUES (
        NEW.id,
        ws_id,
        'Padrão',
        '[
          {"nome":"Copy","prazo_dias":3,"tipo_prazo":"uteis","tipo":"padrao"},
          {"nome":"Aprovação da Copy","prazo_dias":2,"tipo_prazo":"corridos","tipo":"aprovacao_cliente"},
          {"nome":"Mídia","prazo_dias":3,"tipo_prazo":"uteis","tipo":"padrao"},
          {"nome":"Aprovação da Mídia","prazo_dias":2,"tipo_prazo":"corridos","tipo":"aprovacao_cliente"},
          {"nome":"Agendamento","prazo_dias":1,"tipo_prazo":"uteis","tipo":"padrao"}
        ]'::jsonb,
        'padrao'
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'default workflow template seed skipped for workspace %: %', ws_id, SQLERRM;
    END;
  END IF;

  RETURN NEW;
END;
$$;
