-- Move approval notification creation to an explicit RPC callable from the
-- hub-approve edge function. The trigger previously created notifications but
-- failures were silently swallowed by the EXCEPTION block, making them
-- impossible to diagnose. Now the edge function calls this RPC and can
-- observe/log errors directly.
--
-- The trigger is updated to skip hub-originated approvals (is_workspace_user = false)
-- to avoid double-creation.

-- 1. RPC: create_post_approval_notification
-- Returns the number of notification rows created (0 means no targets found).
CREATE OR REPLACE FUNCTION create_post_approval_notification(
  p_post_id bigint,
  p_action text,
  p_comentario text DEFAULT NULL
)
RETURNS integer
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
  v_count          integer := 0;
BEGIN
  SELECT wp.responsavel_id, wp.workflow_id, wp.titulo,
         w.conta_id, w.cliente_id
    INTO v_responsavel_id, v_workflow_id, v_post_title, v_conta_id, v_cliente_id
    FROM workflow_posts wp
    JOIN workflows w ON w.id = wp.workflow_id
   WHERE wp.id = p_post_id;

  IF v_conta_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT nome INTO v_client_name FROM clientes WHERE id = v_cliente_id;

  v_type := CASE p_action
    WHEN 'aprovado' THEN 'post_approved'
    WHEN 'correcao' THEN 'post_correction'
    WHEN 'mensagem' THEN 'post_message'
    ELSE NULL
  END;

  IF v_type IS NULL THEN
    RETURN 0;
  END IF;

  v_targets := resolve_notification_targets(v_conta_id, v_responsavel_id, ARRAY['owner','admin']);

  IF v_targets IS NULL OR array_length(v_targets, 1) IS NULL THEN
    RETURN 0;
  END IF;

  v_link := '/entregas?drawer=' || v_workflow_id;
  v_metadata := jsonb_build_object(
    'client_name', v_client_name,
    'post_title',  v_post_title,
    'workflow_id', v_workflow_id,
    'post_id',     p_post_id
  );

  IF v_type IN ('post_correction', 'post_message') THEN
    v_metadata := v_metadata || jsonb_build_object('comentario', p_comentario);
  END IF;

  PERFORM insert_notification_batch(v_conta_id, v_targets, v_type, v_link, v_metadata, NULL);

  v_count := array_length(v_targets, 1);
  RETURN COALESCE(v_count, 0);
END;
$$;

REVOKE ALL ON FUNCTION create_post_approval_notification(bigint, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_post_approval_notification(bigint, text, text) TO service_role;

-- 2. Update trigger to skip hub-originated approvals (handled by edge function)
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
  -- Hub-originated approvals are handled by the edge function via
  -- create_post_approval_notification() RPC for better error visibility.
  IF NEW.is_workspace_user = false THEN
    RETURN NEW;
  END IF;

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

    PERFORM insert_notification_batch(v_conta_id, v_targets, v_type, v_link, v_metadata, auth.uid());
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'trg_notify_post_approval failed: % %', SQLERRM, SQLSTATE;
  END;
  RETURN NEW;
END;
$$;
