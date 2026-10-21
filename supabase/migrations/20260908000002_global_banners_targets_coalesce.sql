-- global_banners: os CHECKs de targeting usavam array_length(...) > 0, que é NULL (passa)
-- para '{}' -- um banner com target_mode = 'plan' e lista vazia nascia invisível. Mesmo
-- padrão coalesce já usado em 20260907000010_global_popups.sql.

-- Linhas legadas com array vazio eram invisíveis para todo mundo (o predicado de targeting
-- nunca casava). Arquivá-las aqui, senão o ADD CONSTRAINT abaixo falha no db push. A
-- pré-checagem manual do runbook não é garantia: o CI roda num banco vazio.
UPDATE global_banners
   SET status = 'archived', target_mode = 'all',
       target_plan_ids = NULL, target_workspace_ids = NULL
 WHERE (target_mode = 'plan' AND coalesce(array_length(target_plan_ids, 1), 0) = 0)
    OR (target_mode = 'workspace' AND coalesce(array_length(target_workspace_ids, 1), 0) = 0);

ALTER TABLE global_banners DROP CONSTRAINT IF EXISTS global_banners_plan_targets_check;
ALTER TABLE global_banners ADD CONSTRAINT global_banners_plan_targets_check
  CHECK (target_mode <> 'plan' OR coalesce(array_length(target_plan_ids, 1), 0) > 0);
ALTER TABLE global_banners DROP CONSTRAINT IF EXISTS global_banners_workspace_targets_check;
ALTER TABLE global_banners ADD CONSTRAINT global_banners_workspace_targets_check
  CHECK (target_mode <> 'workspace' OR coalesce(array_length(target_workspace_ids, 1), 0) > 0);
