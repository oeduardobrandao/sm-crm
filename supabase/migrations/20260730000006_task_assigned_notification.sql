-- supabase/migrations/20260730000006_task_assigned_notification.sql
-- task_assigned notification: fires when a tarefa is created already assigned
-- or reassigned to a (new, non-null) responsavel. Never fires on unassignment.
-- Self-assignment is silenced by insert_notification_batch's p_exclude_actor.
-- Spec: docs/superpowers/specs/2026-07-30-tarefas-team-task-tracker-design.md

-- Type list copied from the LATEST definition (20260521000001_post_edit_suggestions.sql),
-- not the 20260430000001 original — re-adding a stale list would break newer inserts.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (
  type IN (
    'post_approved', 'post_correction', 'post_message',
    'idea_submitted', 'briefing_answered',
    'step_activated', 'step_completed', 'post_assigned',
    'workflow_completed', 'deadline_approaching',
    'invite_accepted', 'member_role_changed', 'member_removed',
    'post_edit_suggestion', 'task_assigned'
  )
);

-- Mirrors trg_notify_post_assigned (20260504000001): only the newly assigned
-- user is targeted; failures never roll back the underlying write.
CREATE OR REPLACE FUNCTION trg_notify_task_assigned()
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
    IF NEW.cliente_id IS NOT NULL THEN
      SELECT nome INTO v_client_name FROM clientes WHERE id = NEW.cliente_id;
    END IF;

    v_targets := resolve_notification_targets(NEW.conta_id, NEW.responsavel_id, NULL);

    PERFORM insert_notification_batch(
      NEW.conta_id,
      v_targets,
      'task_assigned',
      '/tarefas?tarefa=' || NEW.id,
      jsonb_build_object(
        'task_title',  NEW.titulo,
        'client_name', v_client_name,
        'task_id',     NEW.id
      ),
      auth.uid()
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'trg_notify_task_assigned failed: % %', SQLERRM, SQLSTATE;
  END;
  RETURN NEW;
END;
$$;

-- Two triggers because an INSERT trigger's WHEN clause cannot reference OLD.
DROP TRIGGER IF EXISTS notify_task_assigned_insert ON tarefas;
CREATE TRIGGER notify_task_assigned_insert
  AFTER INSERT ON tarefas
  FOR EACH ROW
  WHEN (NEW.responsavel_id IS NOT NULL)
  EXECUTE FUNCTION trg_notify_task_assigned();

DROP TRIGGER IF EXISTS notify_task_assigned_update ON tarefas;
CREATE TRIGGER notify_task_assigned_update
  AFTER UPDATE OF responsavel_id ON tarefas
  FOR EACH ROW
  WHEN (NEW.responsavel_id IS DISTINCT FROM OLD.responsavel_id AND NEW.responsavel_id IS NOT NULL)
  EXECUTE FUNCTION trg_notify_task_assigned();
