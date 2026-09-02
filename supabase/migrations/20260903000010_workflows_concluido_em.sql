-- Durable workflow completion timestamp.
-- Why: completion was reconstructed as max(workflow_etapas.concluido_em), which
-- revertEtapa/reopenWorkflow null out, and the period filter used created_at.
-- The trigger covers BOTH directions: -> 'concluido' stamps now();
-- 'concluido' -> 'ativo' (reopenWorkflow) clears it. 'concluido' -> 'arquivado'
-- keeps the stamp: archiving a finished flow does not un-finish it.

ALTER TABLE workflows ADD COLUMN IF NOT EXISTS concluido_em timestamptz;

CREATE OR REPLACE FUNCTION set_workflow_concluido_em()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF old.status IS DISTINCT FROM new.status THEN
    IF new.status = 'concluido' THEN
      new.concluido_em := now();
    ELSIF old.status = 'concluido' AND new.status = 'ativo' THEN
      new.concluido_em := NULL;
    END IF;
  END IF;
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS workflows_set_concluido_em ON workflows;
CREATE TRIGGER workflows_set_concluido_em
  BEFORE UPDATE ON workflows
  FOR EACH ROW EXECUTE FUNCTION set_workflow_concluido_em();

-- Backfill: durable event wins over the lossy etapa timestamp.
--
-- Verified against 20260826000001_workflow_events.sql: the suppression GUC
-- is exactly `app.suppress_workflow_events`, and record_workflow_updated_event
-- (the workflows AFTER UPDATE trigger) has a watched-column list of titulo,
-- cliente_id, recorrente, link_notion, link_drive -- concluido_em is not in
-- it, and status does not change in this UPDATE, so this backfill would emit
-- nothing even unsuppressed. The suppression below is belt-and-braces
-- against a future change to that column list.
--
-- Deviation from plan: the plan set the GUC with a bare top-level
-- `SET LOCAL app.suppress_workflow_events = '1';` ahead of the UPDATE,
-- relying on the whole migration file executing as one transaction so the
-- LOCAL setting stays live for the following statement. That is not a
-- pattern used anywhere else in this repo's migrations, and this repo has a
-- documented case (a multi-file `db push` batch where a later file's
-- failure rolled back an earlier file's already-"recorded" DDL) that warns
-- against assuming simple, single-transaction-per-file semantics here.
-- Every other suppression call site in this codebase
-- (20260826000002_workflow_events_rpc_integration.sql,
-- 20260828000010_propagate_template_backfill_new_steps.sql) instead sets the
-- GUC via `PERFORM set_config('app.suppress_workflow_events', '1', true)`
-- inside a plpgsql body. Mirrored here in a DO block, which guarantees the
-- set_config and the UPDATE run inside the exact same statement/transaction
-- regardless of how the surrounding migration file is batched.
DO $$
BEGIN
  PERFORM set_config('app.suppress_workflow_events', '1', true);

  UPDATE workflows w
  SET concluido_em = COALESCE(
    (SELECT max(ev.created_at) FROM workflow_events ev
      WHERE ev.workflow_id = w.id AND ev.event_type = 'fluxo_concluido'),
    (SELECT max(e.concluido_em) FROM workflow_etapas e WHERE e.workflow_id = w.id)
  )
  WHERE w.status = 'concluido' AND w.concluido_em IS NULL;
END $$;

-- Workspace-wide indexes for the analytics RPC (and Fase 3's event feeds).
CREATE INDEX IF NOT EXISTS idx_workflows_conta_status_concluido
  ON workflows (conta_id, status, concluido_em);
CREATE INDEX IF NOT EXISTS idx_workflow_events_conta_created
  ON workflow_events (conta_id, created_at, id);
CREATE INDEX IF NOT EXISTS idx_post_status_events_conta_created
  ON post_status_events (conta_id, created_at);
