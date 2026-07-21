-- Hub "Mensagens" (client messaging) entitlement.
-- effective_plan_feature()/effective_plan_limit() read plan columns dynamically, so adding
-- this column is enough for gating to work — no function changes needed.
--
-- Ships dark (default false everywhere) — same pattern as feature_tiktok
-- (20260718000002_feature_tiktok.sql). Flipping it on per-plan is a follow-up
-- migration or an admin-panel edit, not blocked by this one.
--
-- Note: the Hub's Mensagens page itself is a client-side-only mock (no backend,
-- no persistence) as of this migration — this flag controls its visibility, not
-- access to a real messaging capability yet.

ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS feature_mensagens boolean NOT NULL DEFAULT false;
