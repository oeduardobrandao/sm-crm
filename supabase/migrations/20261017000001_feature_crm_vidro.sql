-- Flag de rollout do visual "Vidro" do CRM desktop
-- (spec docs/superpowers/specs/2026-10-12-desktop-vidro-design.md).
-- Nasce desligada em todos os planos e é ligada por workspace via
-- workspace_plan_overrides.feature_overrides ({"feature_crm_vidro": true}),
-- no mesmo desenho de feature_hub_pauta. Lançamento = ligar a coluna nos planos;
-- desligar = kill switch. Só muda aparência: nenhuma escrita é bloqueada por ela.
-- Depois desta migração, redeploy de workspace-limits e platform-admin
-- (plan-mutations espalha todas as colunas) e, por consistência, paywall-report,
-- mcp-admin e data-import.

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS feature_crm_vidro boolean NOT NULL DEFAULT false;
