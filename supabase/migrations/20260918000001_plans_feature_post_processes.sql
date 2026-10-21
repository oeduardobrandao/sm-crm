-- Flag de rollout dos processos individuais de producao (spec
-- 2026-09-10-posts-individuais-fluxos-design.md, secao 11). Nasce false em
-- todos os planos e so e ligada por workspace via
-- workspace_plan_overrides.feature_overrides (Admin da plataforma), no mesmo
-- desenho de feature_instagram_automation (20260815000002). O gate de
-- criacao (BEFORE INSERT em post_processes) vem em 20260918000002; desligar
-- a flag bloqueia so execucoes novas.
ALTER TABLE plans ADD COLUMN IF NOT EXISTS feature_post_processes boolean NOT NULL DEFAULT false;
