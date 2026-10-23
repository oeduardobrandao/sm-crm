-- Flag de rollout do Financeiro v2 (rentabilidade por cliente)
-- (spec docs/superpowers/specs/2026-10-23-financeiro-rentabilidade-design.md).
-- Nasce desligada em todos os planos e é ligada por workspace via
-- workspace_plan_overrides.feature_overrides ({"feature_financeiro_v2": true}),
-- no mesmo desenho de feature_hub_pauta e feature_crm_vidro. Lançamento = ligar a
-- coluna nos planos; desligar = kill switch.
-- Diferente de feature_crm_vidro, esta flag BLOQUEIA escritas: as RPCs do v2 levantam
-- feature_disabled:feature_financeiro_v2 sem ela, e as policies de SELECT das tabelas
-- v2 devolvem zero linhas.
-- Ordem de deploy: esta migração (staging, depois prod) -> redeploy de
-- workspace-limits, platform-admin e paywall-report -> merge -> override do workspace
-- piloto.
-- Esta migração é pré-requisito DURO do redeploy do platform-admin:
-- plan-mutations.ts espalha FEATURE_COLUMNS no insert e no update de planos,
-- então sem a coluna todo salvamento de plano no Admin responde 400.
-- Importam _shared/entitlements.ts: automation-media, data-import, mcp-keys,
-- mcp-oauth-consent, paywall-report, platform-admin e workspace-limits
-- (mcp-admin não: usa entitlements-rpc.ts).

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS feature_financeiro_v2 boolean NOT NULL DEFAULT false;
