-- Per-post "ações após a visualização" metrics from the Instagram media insights
-- endpoint (see docs/superpowers/specs/2026-09-29-instagram-post-action-metrics-design.md).
-- Nullable on purpose: NULL = no data (never fetched, or Instagram didn't return
-- it, e.g. follows/profile_visits on Reels). The CRM renders NULL as "—"; a 0
-- would read as "this post brought no one". No backfill.
ALTER TABLE instagram_posts
  ADD COLUMN IF NOT EXISTS reposts integer,
  ADD COLUMN IF NOT EXISTS profile_visits integer,
  ADD COLUMN IF NOT EXISTS follows integer,
  ADD COLUMN IF NOT EXISTS bio_link_clicks integer;
