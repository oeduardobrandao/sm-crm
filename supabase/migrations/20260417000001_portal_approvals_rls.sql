-- VULN-002: portal_approvals was created without RLS.
-- Any authenticated user could read/write approvals across every workspace.
-- Scope access through workflow_etapas → workflows.conta_id.

ALTER TABLE portal_approvals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "portal_approvals_select" ON portal_approvals
  FOR SELECT USING (
    workflow_etapa_id IN (
      SELECT we.id FROM workflow_etapas we
      JOIN workflows w ON w.id = we.workflow_id
      WHERE w.conta_id IN (SELECT public.get_my_conta_id())
    )
  );

CREATE POLICY "portal_approvals_insert" ON portal_approvals
  FOR INSERT WITH CHECK (
    workflow_etapa_id IN (
      SELECT we.id FROM workflow_etapas we
      JOIN workflows w ON w.id = we.workflow_id
      WHERE w.conta_id IN (SELECT public.get_my_conta_id())
    )
  );

CREATE POLICY "portal_approvals_update" ON portal_approvals
  FOR UPDATE
  USING (
    workflow_etapa_id IN (
      SELECT we.id FROM workflow_etapas we
      JOIN workflows w ON w.id = we.workflow_id
      WHERE w.conta_id IN (SELECT public.get_my_conta_id())
    )
  )
  WITH CHECK (
    workflow_etapa_id IN (
      SELECT we.id FROM workflow_etapas we
      JOIN workflows w ON w.id = we.workflow_id
      WHERE w.conta_id IN (SELECT public.get_my_conta_id())
    )
  );

CREATE POLICY "portal_approvals_delete" ON portal_approvals
  FOR DELETE USING (
    workflow_etapa_id IN (
      SELECT we.id FROM workflow_etapas we
      JOIN workflows w ON w.id = we.workflow_id
      WHERE w.conta_id IN (SELECT public.get_my_conta_id())
    )
  );
