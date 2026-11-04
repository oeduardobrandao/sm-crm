-- Acesso por cliente: índice de notifications por (workspace, cliente), depois
-- do backfill (20261115000013), para o índice ser construído uma vez sobre os
-- valores finais em vez de mantido linha a linha durante o UPDATE.
-- Spec: docs/superpowers/specs/2026-11-03-acesso-por-cliente-design.md
--
-- CREATE INDEX comum (CONCURRENTLY não roda dentro da transação da
-- migração): pega SHARE em notifications durante a construção. O sino lê
-- normalmente; INSERT/UPDATE em notifications (emissores, marcar como lida)
-- esperam o fim da construção. Confira o tamanho da tabela antes do deploy
-- (CLAUDE.md, passo 0).
CREATE INDEX IF NOT EXISTS idx_notifications_workspace_cliente
  ON public.notifications (workspace_id, cliente_id);
