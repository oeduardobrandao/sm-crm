-- Plan flags for the Google integrations: YouTube (Shorts) and Google Meu Negócio
-- (spec docs/superpowers/specs/2026-10-29-youtube-google-meu-negocio-design.md, section 4.5).
--
-- Both are born false on every plan (ship dark) and are piloted per workspace through
-- workspace_plan_overrides.feature_overrides ({"feature_youtube": true} /
-- {"feature_google_business": true}); effective_plan_feature() reads them like any other flag.
-- Deploy order: this migration (staging, then prod) -> redeploy of every function that imports
-- _shared/entitlements.ts, now that FEATURE_COLUMNS lists both keys (platform-admin spreads
-- FEATURE_COLUMNS into plan inserts/updates, so the columns must exist before that redeploy).

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS feature_youtube boolean NOT NULL DEFAULT false;
ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS feature_google_business boolean NOT NULL DEFAULT false;
