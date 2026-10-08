-- Flag de rollout da identidade visual "Pauta" do Hub
-- (spec docs/superpowers/specs/2026-10-08-hub-identidade-pauta-design.md).
-- Nasce desligada em todos os planos e é ligada por workspace via
-- workspace_plan_overrides.feature_overrides ({"feature_hub_pauta": true}),
-- no mesmo desenho de feature_agenda / feature_multiplatform. Lançamento = ligar
-- a coluna nos planos. Só muda aparência: nenhuma escrita é bloqueada por ela.
--
-- A mesma migração amplia os CHECKs de fonte (20260731000001) com o par
-- "Assinatura": bricolage-grotesque (títulos) e figtree (texto). Os defaults
-- das colunas não mudam aqui; isso fica para a limpeza pós-lançamento.
-- Espelho em packages/hub-theme/theme.ts (HUB_DISPLAY_FONTS / HUB_BODY_FONTS)
-- e nos testes "font allowlist sync" de theme.test.ts.

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS feature_hub_pauta boolean NOT NULL DEFAULT false;

ALTER TABLE public.workspaces
  DROP CONSTRAINT IF EXISTS hub_font_display_allowed,
  DROP CONSTRAINT IF EXISTS hub_font_body_allowed;

ALTER TABLE public.workspaces
  ADD CONSTRAINT hub_font_display_allowed CHECK (hub_font_display IN ('fraunces','playfair-display','dm-serif-display','space-grotesk','sora','lora','bricolage-grotesque')),
  ADD CONSTRAINT hub_font_body_allowed CHECK (hub_font_body IN ('instrument-sans','inter','dm-sans','manrope','public-sans','figtree'));
