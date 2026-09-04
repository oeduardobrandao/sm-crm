-- global_banners: os CHECKs de targeting usavam array_length(...) > 0, que é NULL (passa)
-- para '{}' -- um banner com target_mode = 'plan' e lista vazia nascia invisível. Mesmo
-- padrão coalesce já usado em 20260907000010_global_popups.sql.
ALTER TABLE global_banners DROP CONSTRAINT IF EXISTS global_banners_plan_targets_check;
ALTER TABLE global_banners ADD CONSTRAINT global_banners_plan_targets_check
  CHECK (target_mode <> 'plan' OR coalesce(array_length(target_plan_ids, 1), 0) > 0);
ALTER TABLE global_banners DROP CONSTRAINT IF EXISTS global_banners_workspace_targets_check;
ALTER TABLE global_banners ADD CONSTRAINT global_banners_workspace_targets_check
  CHECK (target_mode <> 'workspace' OR coalesce(array_length(target_workspace_ids, 1), 0) > 0);
