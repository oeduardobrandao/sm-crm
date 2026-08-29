-- Automações de comentário -> DM: agent ganha escrita completa (criar, editar,
-- ligar/desligar, excluir), igual owner/admin. Migration 20260815000002 restringia
-- INSERT/UPDATE/DELETE a owner/admin de propósito (agent só lia, "para acompanhar
-- resultados"); decisão de produto revertida -- agora qualquer membro do
-- workspace pode gerenciar, mesmo padrão de workspace_posts_all (20260402).

DROP POLICY IF EXISTS ica_insert ON instagram_comment_automations;
CREATE POLICY ica_insert ON instagram_comment_automations
  FOR INSERT WITH CHECK (conta_id IN (SELECT public.get_my_conta_id()));

DROP POLICY IF EXISTS ica_update ON instagram_comment_automations;
CREATE POLICY ica_update ON instagram_comment_automations
  FOR UPDATE USING (conta_id IN (SELECT public.get_my_conta_id()))
  WITH CHECK (conta_id IN (SELECT public.get_my_conta_id()));

DROP POLICY IF EXISTS ica_delete ON instagram_comment_automations;
CREATE POLICY ica_delete ON instagram_comment_automations
  FOR DELETE USING (conta_id IN (SELECT public.get_my_conta_id()));
