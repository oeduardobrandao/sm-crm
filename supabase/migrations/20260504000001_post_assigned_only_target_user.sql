-- Fix: post_assigned notification should only go to the newly assigned user,
-- not to all owners/admins in the workspace.

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

    v_targets := resolve_notification_targets(v_conta_id, NEW.responsavel_id, NULL);

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
