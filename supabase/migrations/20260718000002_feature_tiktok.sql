-- TikTok integration entitlement (docs/superpowers/specs/2026-07-17-tiktok-integration-design.md).
-- effective_plan_feature()/effective_plan_limit() read plan columns dynamically, so adding
-- this column is enough for gating to work — no function changes needed.
--
-- Ships dark (default false everywhere) — same pattern as feature_estudio
-- (20260702000003_plans_estudio_columns.sql). Flipping it on per-plan is a follow-up
-- migration or an admin-panel edit, not blocked by this one.

ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS feature_tiktok boolean NOT NULL DEFAULT false;
