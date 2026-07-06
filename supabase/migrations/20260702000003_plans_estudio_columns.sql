-- Estúdio entitlements on plans (docs/estudio-design.md §4.3).
-- effective_plan_feature()/effective_plan_limit() read plan columns dynamically, so adding
-- these columns is enough for gating + the ai_image_generations count trigger to work.
--
-- Two flags, not one — AI image generation has real marginal cost and will tier
-- independently of the editor, matching the existing feature_instagram / feature_instagram_ai
-- split.

ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS feature_estudio          boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS feature_ai_images        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rate_ai_images_per_month int;

-- NULL means UNLIMITED in effective_plan_limit — never leave the quota column NULL by accident.
UPDATE plans SET rate_ai_images_per_month = 0 WHERE rate_ai_images_per_month IS NULL;

-- Seeds are PLACEHOLDERS pending a product decision (design §14a) — both flags ship false and
-- quota 0 everywhere until that decision is made; flipping them on is a follow-up migration
-- or an admin-panel edit, not blocked by this one. Left commented as the intended shape:
--
-- UPDATE plans SET feature_estudio = true WHERE id IN ('pro', 'max', 'lifetime');
-- UPDATE plans SET feature_ai_images = true, rate_ai_images_per_month = 100
--   WHERE id IN ('max', 'lifetime');
--
-- 'lifetime' (an out-of-catalog, prod-only comp plan seeded outside any migration — see
-- 20260622140000_lifetime_feature_mcp.sql) MUST be included explicitly if/when these seeds
-- run; it was missed by the original feature_mcp rollout and needed a follow-up migration.
