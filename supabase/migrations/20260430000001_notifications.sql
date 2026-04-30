-- =====================================================================
-- 20260430000001_notifications.sql
-- Notification system: table + RLS + indexes + column grants.
-- Subsequent sections (helpers, triggers, membros ALTER, RPC) are
-- appended in later tasks of the implementation plan.
-- =====================================================================

-- ---------- Table -----------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type          text NOT NULL,
  metadata      jsonb DEFAULT '{}'::jsonb,
  link          text,
  read_at       timestamptz,
  dismissed_at  timestamptz,
  created_at    timestamptz DEFAULT now()
);

-- ---------- Type CHECK -----------------------------------------------
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (
  type IN (
    'post_approved', 'post_correction', 'post_message',
    'idea_submitted', 'briefing_answered',
    'step_activated', 'step_completed', 'post_assigned',
    'workflow_completed', 'deadline_approaching',
    'invite_accepted', 'member_role_changed', 'member_removed'
  )
);

-- ---------- Indexes ---------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notifications (user_id, created_at DESC)
  WHERE read_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_user_visible
  ON notifications (user_id, created_at DESC)
  WHERE dismissed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_cleanup
  ON notifications (created_at);

-- ---------- RLS + grants ---------------------------------------------
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notifications_select ON notifications;
CREATE POLICY notifications_select ON notifications
  FOR SELECT USING (user_id = auth.uid());

-- No INSERT policy — SECURITY DEFINER trigger functions (owned by postgres)
-- and the service role are the only writers.

-- No DELETE policy — cleanup cron uses service role.

-- Column-level grants: authenticated can only update read_at + dismissed_at.
REVOKE UPDATE ON notifications FROM authenticated;
GRANT UPDATE (read_at, dismissed_at) ON notifications TO authenticated;

DROP POLICY IF EXISTS notifications_update ON notifications;
CREATE POLICY notifications_update ON notifications
  FOR UPDATE USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- =====================================================================
-- membros.crm_user_id + privileged RPC
-- =====================================================================

-- Add nullable crm_user_id (links membro → CRM auth user).
-- Distinct from the existing membros.user_id column (which tracks who
-- created the membro record — different concept entirely).
ALTER TABLE membros
  ADD COLUMN IF NOT EXISTS crm_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- Existing membros RLS lets any workspace member UPDATE any membro row.
-- Strip authenticated's UPDATE access to crm_user_id specifically so
-- agents cannot redirect admin notifications to themselves.
REVOKE UPDATE (crm_user_id) ON membros FROM authenticated;

-- Privileged setter — only owners/admins can change crm_user_id.
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

  UPDATE membros SET crm_user_id = p_crm_user_id WHERE id = p_membro_id;
END;
$$;

REVOKE ALL ON FUNCTION set_membro_crm_user(bigint, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_membro_crm_user(bigint, uuid) TO authenticated;

-- =====================================================================
-- Helper functions (SECURITY DEFINER, owned by postgres)
-- =====================================================================

-- Resolve recipients for a notification.
-- Returns a deduped uuid[] of CRM user_ids to notify:
--   1. If p_responsavel_id is given, append membros.crm_user_id (may be NULL → skipped)
--   2. Append workspace_members.user_id where role IN p_roles_filter
CREATE OR REPLACE FUNCTION resolve_notification_targets(
  p_workspace_id uuid,
  p_responsavel_id bigint,
  p_roles_filter text[]
)
RETURNS uuid[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_targets uuid[] := '{}';
  v_responsavel_user uuid;
BEGIN
  IF p_responsavel_id IS NOT NULL THEN
    SELECT crm_user_id INTO v_responsavel_user
      FROM membros
      WHERE id = p_responsavel_id;
    IF v_responsavel_user IS NOT NULL THEN
      v_targets := array_append(v_targets, v_responsavel_user);
    END IF;
  END IF;

  IF p_roles_filter IS NOT NULL AND array_length(p_roles_filter, 1) > 0 THEN
    SELECT array_agg(DISTINCT user_id) INTO v_targets
      FROM (
        SELECT unnest(v_targets) AS user_id
        UNION
        SELECT user_id
          FROM workspace_members
          WHERE workspace_id = p_workspace_id
            AND role = ANY (p_roles_filter)
      ) s
      WHERE user_id IS NOT NULL;
  END IF;

  RETURN COALESCE(v_targets, '{}');
END;
$$;

-- Insert one row per user_id. NULLs in array are skipped.
-- p_exclude_actor (if non-NULL) is removed from the recipient set so
-- users do not notify themselves on CRM-originated actions.
CREATE OR REPLACE FUNCTION insert_notification_batch(
  p_workspace_id uuid,
  p_user_ids uuid[],
  p_type text,
  p_link text,
  p_metadata jsonb,
  p_exclude_actor uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_user_ids IS NULL OR array_length(p_user_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO notifications (workspace_id, user_id, type, metadata, link)
  SELECT p_workspace_id, u, p_type, COALESCE(p_metadata, '{}'::jsonb), p_link
    FROM unnest(p_user_ids) AS u
   WHERE u IS NOT NULL
     AND (p_exclude_actor IS NULL OR u <> p_exclude_actor);
END;
$$;

REVOKE ALL ON FUNCTION resolve_notification_targets(uuid, bigint, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION insert_notification_batch(uuid, uuid[], text, text, jsonb, uuid) FROM PUBLIC;
-- These helpers are only called from trigger functions (also SECURITY DEFINER)
-- so no broader EXECUTE grant is needed.

-- =====================================================================
-- Hub / Client triggers
-- All wrapped in EXCEPTION blocks so notification failures never
-- roll back the underlying business operation.
-- =====================================================================

-- post_approvals AFTER INSERT → post_approved | post_correction | post_message
CREATE OR REPLACE FUNCTION trg_notify_post_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_responsavel_id bigint;
  v_workflow_id    bigint;
  v_conta_id       uuid;
  v_cliente_id     bigint;
  v_post_title     text;
  v_client_name    text;
  v_targets        uuid[];
  v_type           text;
  v_link           text;
  v_metadata       jsonb;
BEGIN
  BEGIN
    SELECT wp.responsavel_id, wp.workflow_id, wp.titulo,
           w.conta_id, w.cliente_id
      INTO v_responsavel_id, v_workflow_id, v_post_title, v_conta_id, v_cliente_id
      FROM workflow_posts wp
      JOIN workflows w ON w.id = wp.workflow_id
     WHERE wp.id = NEW.post_id;

    IF v_conta_id IS NULL THEN
      RETURN NEW;
    END IF;

    SELECT nome INTO v_client_name FROM clientes WHERE id = v_cliente_id;

    v_type := CASE NEW.action
      WHEN 'aprovado' THEN 'post_approved'
      WHEN 'correcao' THEN 'post_correction'
      WHEN 'mensagem' THEN 'post_message'
      ELSE NULL
    END;

    IF v_type IS NULL THEN
      RETURN NEW;
    END IF;

    v_targets := resolve_notification_targets(v_conta_id, v_responsavel_id, ARRAY['owner','admin']);
    v_link := '/workflows/' || v_workflow_id || '/posts/' || NEW.post_id;
    v_metadata := jsonb_build_object(
      'client_name', v_client_name,
      'post_title',  v_post_title,
      'workflow_id', v_workflow_id,
      'post_id',     NEW.post_id
    );

    IF v_type IN ('post_correction', 'post_message') THEN
      v_metadata := v_metadata || jsonb_build_object('comentario', NEW.comentario);
    END IF;

    PERFORM insert_notification_batch(v_conta_id, v_targets, v_type, v_link, v_metadata, NULL);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'trg_notify_post_approval failed: % %', SQLERRM, SQLSTATE;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_post_approval ON post_approvals;
CREATE TRIGGER notify_post_approval
  AFTER INSERT ON post_approvals
  FOR EACH ROW EXECUTE FUNCTION trg_notify_post_approval();

-- ideias AFTER INSERT (status = 'nova') → idea_submitted
CREATE OR REPLACE FUNCTION trg_notify_idea_submitted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_name text;
  v_targets     uuid[];
BEGIN
  BEGIN
    IF NEW.status IS DISTINCT FROM 'nova' THEN
      RETURN NEW;
    END IF;

    SELECT nome INTO v_client_name FROM clientes WHERE id = NEW.cliente_id;

    v_targets := resolve_notification_targets(NEW.workspace_id, NULL, ARRAY['owner','admin']);

    PERFORM insert_notification_batch(
      NEW.workspace_id,
      v_targets,
      'idea_submitted',
      '/ideias/' || NEW.id,
      jsonb_build_object(
        'client_name', v_client_name,
        'idea_title',  NEW.titulo,
        'idea_id',     NEW.id
      ),
      NULL
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'trg_notify_idea_submitted failed: % %', SQLERRM, SQLSTATE;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_idea_submitted ON ideias;
CREATE TRIGGER notify_idea_submitted
  AFTER INSERT ON ideias
  FOR EACH ROW EXECUTE FUNCTION trg_notify_idea_submitted();

-- hub_briefing_questions AFTER UPDATE (answer NULL→non-NULL) → briefing_answered
CREATE OR REPLACE FUNCTION trg_notify_briefing_answered()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_workspace_id uuid;
  v_client_name  text;
  v_targets      uuid[];
BEGIN
  BEGIN
    SELECT c.conta_id, c.nome
      INTO v_workspace_id, v_client_name
      FROM clientes c
     WHERE c.id = NEW.cliente_id;

    IF v_workspace_id IS NULL THEN
      RETURN NEW;
    END IF;

    v_targets := resolve_notification_targets(v_workspace_id, NULL, ARRAY['owner','admin']);

    PERFORM insert_notification_batch(
      v_workspace_id,
      v_targets,
      'briefing_answered',
      '/clientes/' || NEW.cliente_id,
      jsonb_build_object(
        'client_name',   v_client_name,
        'question_text', NEW.question
      ),
      NULL
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'trg_notify_briefing_answered failed: % %', SQLERRM, SQLSTATE;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_briefing_answered ON hub_briefing_questions;
CREATE TRIGGER notify_briefing_answered
  AFTER UPDATE ON hub_briefing_questions
  FOR EACH ROW
  WHEN (OLD.answer IS NULL AND NEW.answer IS NOT NULL)
  EXECUTE FUNCTION trg_notify_briefing_answered();

-- =====================================================================
-- Workflow / Team triggers (actor excluded via auth.uid())
-- =====================================================================

-- workflow_etapas: status → 'ativo' (step_activated)
CREATE OR REPLACE FUNCTION trg_notify_step_activated()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conta_id      uuid;
  v_client_name   text;
  v_workflow_title text;
  v_targets       uuid[];
BEGIN
  BEGIN
    SELECT w.conta_id, c.nome, w.titulo
      INTO v_conta_id, v_client_name, v_workflow_title
      FROM workflows w
      LEFT JOIN clientes c ON c.id = w.cliente_id
     WHERE w.id = NEW.workflow_id;

    IF v_conta_id IS NULL THEN
      RETURN NEW;
    END IF;

    v_targets := resolve_notification_targets(v_conta_id, NEW.responsavel_id, ARRAY['owner','admin']);

    PERFORM insert_notification_batch(
      v_conta_id,
      v_targets,
      'step_activated',
      '/workflows/' || NEW.workflow_id,
      jsonb_build_object(
        'client_name',     v_client_name,
        'workflow_title',  v_workflow_title,
        'step_name',       NEW.titulo,
        'workflow_id',     NEW.workflow_id,
        'etapa_id',        NEW.id
      ),
      auth.uid()
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'trg_notify_step_activated failed: % %', SQLERRM, SQLSTATE;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_step_activated ON workflow_etapas;
CREATE TRIGGER notify_step_activated
  AFTER UPDATE ON workflow_etapas
  FOR EACH ROW
  WHEN (NEW.status = 'ativo' AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION trg_notify_step_activated();

-- workflow_etapas: status → 'concluido' (step_completed, owners/admins only)
CREATE OR REPLACE FUNCTION trg_notify_step_completed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conta_id      uuid;
  v_client_name   text;
  v_workflow_title text;
  v_targets       uuid[];
BEGIN
  BEGIN
    SELECT w.conta_id, c.nome, w.titulo
      INTO v_conta_id, v_client_name, v_workflow_title
      FROM workflows w
      LEFT JOIN clientes c ON c.id = w.cliente_id
     WHERE w.id = NEW.workflow_id;

    IF v_conta_id IS NULL THEN
      RETURN NEW;
    END IF;

    v_targets := resolve_notification_targets(v_conta_id, NULL, ARRAY['owner','admin']);

    PERFORM insert_notification_batch(
      v_conta_id,
      v_targets,
      'step_completed',
      '/workflows/' || NEW.workflow_id,
      jsonb_build_object(
        'client_name',     v_client_name,
        'workflow_title',  v_workflow_title,
        'step_name',       NEW.titulo,
        'workflow_id',     NEW.workflow_id,
        'etapa_id',        NEW.id
      ),
      auth.uid()
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'trg_notify_step_completed failed: % %', SQLERRM, SQLSTATE;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_step_completed ON workflow_etapas;
CREATE TRIGGER notify_step_completed
  AFTER UPDATE ON workflow_etapas
  FOR EACH ROW
  WHEN (NEW.status = 'concluido' AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION trg_notify_step_completed();

-- workflow_posts: responsavel_id changed (and not → NULL) (post_assigned)
CREATE OR REPLACE FUNCTION trg_notify_post_assigned()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conta_id    uuid;
  v_client_name text;
  v_targets     uuid[];
BEGIN
  BEGIN
    SELECT w.conta_id, c.nome
      INTO v_conta_id, v_client_name
      FROM workflows w
      LEFT JOIN clientes c ON c.id = w.cliente_id
     WHERE w.id = NEW.workflow_id;

    IF v_conta_id IS NULL THEN
      RETURN NEW;
    END IF;

    v_targets := resolve_notification_targets(v_conta_id, NEW.responsavel_id, ARRAY['owner','admin']);

    PERFORM insert_notification_batch(
      v_conta_id,
      v_targets,
      'post_assigned',
      '/workflows/' || NEW.workflow_id || '/posts/' || NEW.id,
      jsonb_build_object(
        'client_name', v_client_name,
        'post_title',  NEW.titulo,
        'workflow_id', NEW.workflow_id,
        'post_id',     NEW.id
      ),
      auth.uid()
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'trg_notify_post_assigned failed: % %', SQLERRM, SQLSTATE;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_post_assigned ON workflow_posts;
CREATE TRIGGER notify_post_assigned
  AFTER UPDATE ON workflow_posts
  FOR EACH ROW
  WHEN (NEW.responsavel_id IS DISTINCT FROM OLD.responsavel_id AND NEW.responsavel_id IS NOT NULL)
  EXECUTE FUNCTION trg_notify_post_assigned();

-- workflows: status → 'concluido' (workflow_completed)
CREATE OR REPLACE FUNCTION trg_notify_workflow_completed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_name text;
  v_targets     uuid[];
BEGIN
  BEGIN
    SELECT nome INTO v_client_name FROM clientes WHERE id = NEW.cliente_id;

    v_targets := resolve_notification_targets(NEW.conta_id, NULL, ARRAY['owner','admin']);

    PERFORM insert_notification_batch(
      NEW.conta_id,
      v_targets,
      'workflow_completed',
      '/workflows/' || NEW.id,
      jsonb_build_object(
        'client_name',    v_client_name,
        'workflow_title', NEW.titulo,
        'workflow_id',    NEW.id
      ),
      auth.uid()
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'trg_notify_workflow_completed failed: % %', SQLERRM, SQLSTATE;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_workflow_completed ON workflows;
CREATE TRIGGER notify_workflow_completed
  AFTER UPDATE ON workflows
  FOR EACH ROW
  WHEN (NEW.status = 'concluido' AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION trg_notify_workflow_completed();
