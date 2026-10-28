-- 20261103000001_tiktok_post_metrics_daily.sql
-- Per-video daily TikTok metric snapshots
-- (spec: docs/superpowers/specs/2026-10-28-tiktok-analytics-and-multiplatform-reports-design.md, section A1)
--
-- Why this exists: the per-video history cannot be backfilled later (the TikTok
-- API only returns lifetime totals), so collection starts now even though v1
-- reads nothing from it. A later version can show views gained in a window.
--
-- Why there is NO foreign key to tiktok_posts: disconnecting a TikTok account
-- deletes that account's tiktok_posts rows, and the history has to survive a
-- disconnect/reconnect, the same way tiktok_follower_history does. The row is
-- keyed by the TikTok video id instead. It still cascades from tiktok_accounts,
-- so deleting the account (not merely disconnecting it) removes its history.
--
-- Service-role only: written by the sync cron, never queried by clients.

CREATE TABLE public.tiktok_post_metrics_daily (
  tiktok_account_id uuid NOT NULL REFERENCES public.tiktok_accounts(id) ON DELETE CASCADE,
  tiktok_video_id text NOT NULL,
  snapshot_date date NOT NULL,
  views bigint,
  likes int,
  comments int,
  shares int,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tiktok_account_id, tiktok_video_id, snapshot_date)
);

-- RLS on with no policies: nothing but a role that bypasses RLS can touch it.
ALTER TABLE public.tiktok_post_metrics_daily ENABLE ROW LEVEL SECURITY;

-- REVOKE FROM PUBLIC does not touch grants made directly to anon/authenticated
-- (hosted default ACL), so name the roles explicitly.
REVOKE ALL ON public.tiktok_post_metrics_daily FROM PUBLIC, anon, authenticated;

-- Defensive: hosted projects grant service_role through the default ACL, local
-- stacks may not.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tiktok_post_metrics_daily TO service_role;
