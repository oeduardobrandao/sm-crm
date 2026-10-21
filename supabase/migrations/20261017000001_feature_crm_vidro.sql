-- Flag de rollout do visual "Vidro" do CRM desktop
-- (spec docs/superpowers/specs/2026-10-12-desktop-vidro-design.md).
-- Nasce desligada em todos os planos e é ligada por workspace via
-- workspace_plan_overrides.feature_overrides ({"feature_crm_vidro": true}),
-- no mesmo desenho de feature_hub_pauta. Lançamento = ligar a coluna nos planos;
-- desligar = kill switch. Só muda aparência: nenhuma escrita é bloqueada por ela.
-- Ordem de deploy: esta migração (staging, depois prod) -> redeploy de
-- workspace-limits e platform-admin -> merge -> override do workspace piloto.
-- Esta migração é pré-requisito DURO do redeploy do platform-admin:
-- plan-mutations.ts espalha FEATURE_COLUMNS no insert e no update de planos,
-- então sem a coluna todo salvamento de plano no Admin responde 400.
-- Importam _shared/entitlements.ts: automation-media, data-import, mcp-keys,
-- mcp-oauth-consent, paywall-report, platform-admin e workspace-limits
-- (mcp-admin não: usa entitlements-rpc.ts). Só workspace-limits e
-- platform-admin precisam de redeploy por esta flag: os demais nunca a leem
-- (a allowlist do paywall-report só importa para flags que bloqueiam algo).

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS feature_crm_vidro boolean NOT NULL DEFAULT false;
