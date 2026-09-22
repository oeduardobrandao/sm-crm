-- supabase/migrations/20260925100001_refresh_attempt_stamps.sql
-- instagram-refresh-cron and tiktok-refresh-cron order their candidates select by expiry
-- ascending and cap it at REFRESH_BATCH_LIMIT (Task 7, 2026-09-22-q1-limits-fixes). A cap alone
-- starves: an account that fails refresh with a transient error never advances its expiry
-- column, so it (and everything with an earlier expiry) keeps sorting at the head of the
-- window and re-consumes the whole batch every run forever, while accounts later in expiry
-- order are never attempted and their tokens silently expire.
--
-- instagram-sync-cron/select.ts already documents and fixes this exact starvation mode for the
-- sync cron via `last_sync_attempt_at`, stamped for the whole batch BEFORE any work starts
-- (instagram-sync-cron/index.ts, "Stamp the attempt for the WHOLE batch before any syncing
-- starts"). This column mirrors that pattern for both refresh crons: ordering keys off
-- attempts, not outcomes, so a persistently failing account still rotates to the back of the
-- queue on the very next run instead of pinning the head.
--
-- Additive and nullable only, no backfill: NULL just means "never attempted", which both
-- crons already need to treat as sorting first (ahead of every real timestamp).

ALTER TABLE public.instagram_accounts
  ADD COLUMN IF NOT EXISTS last_refresh_attempt_at timestamptz;

COMMENT ON COLUMN public.instagram_accounts.last_refresh_attempt_at IS
  'Stamped now() for the whole selected batch before instagram-refresh-cron attempts any '
  'refresh, success or failure — see instagram-sync-cron/select.ts for the precedent. Orders '
  'the candidates select (NULL/least-recent first) so persistently failing accounts rotate to '
  'the back instead of starving the rest of the batch.';

ALTER TABLE public.tiktok_accounts
  ADD COLUMN IF NOT EXISTS last_refresh_attempt_at timestamptz;

COMMENT ON COLUMN public.tiktok_accounts.last_refresh_attempt_at IS
  'Stamped now() for the whole selected batch before tiktok-refresh-cron attempts any refresh, '
  'success or failure — see instagram-sync-cron/select.ts for the precedent. Orders the '
  'candidates select (NULL/least-recent first) so persistently failing accounts rotate to the '
  'back instead of starving the rest of the batch.';
