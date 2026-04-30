-- 20260430000003_fix_notification_links.sql
--
-- Notification trigger functions in 20260430000001 constructed deep-links
-- to routes that don't exist in the CRM router (`/workflows/<id>` and
-- `/workflows/<id>/posts/<id>`). The actual deep-link convention is
-- `/entregas?drawer=<workflowId>` (used by GlobalSearchTrigger and
-- ClienteDetalhePage). Ideias has no detail page — link points at the list.
--
-- Six trigger functions are recreated below with corrected link patterns.
-- All other behavior — recipients, metadata, EXCEPTION wrappers, actor
-- exclusion — is identical to 20260430000001.

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
    v_link := '/entregas?drawer=' || v_workflow_id;
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
      '/ideias',
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
      '/entregas?drawer=' || NEW.workflow_id,
      jsonb_build_object(
        'client_name',     v_client_name,
        'workflow_title',  v_workflow_title,
        'step_name',       NEW.nome,
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
      '/entregas?drawer=' || NEW.workflow_id,
      jsonb_build_object(
        'client_name',     v_client_name,
        'workflow_title',  v_workflow_title,
        'step_name',       NEW.nome,
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
      '/entregas?drawer=' || NEW.workflow_id,
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
      '/entregas?drawer=' || NEW.id,
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
