-- tiktok-sync-cron moves from a daily run (06:30) to the hourly, batch-limited model of
-- instagram-sync-cron (docs/superpowers/specs/2026-11-10-hub-contas-conectadas-design.md).
--
-- 1. last_sync_attempt_at: stamped for the whole claimed batch BEFORE any sync work and used as
--    the queue order, so an account that keeps failing rotates to the back instead of pinning
--    the head. It doubles as the claim: the conditional UPDATE only wins rows still stale.
-- 2. Reschedule the cron to run at minute 30 of every hour.
--
-- Uses the vault.decrypted_secrets subselect form (see 20260720000007).
-- Idempotent: safe to apply twice.

ALTER TABLE public.tiktok_accounts ADD COLUMN IF NOT EXISTS last_sync_attempt_at timestamptz;

COMMENT ON COLUMN public.tiktok_accounts.last_sync_attempt_at IS
  'When tiktok-sync-cron last tried this account, success or failure. Stamped for the whole batch before any sync work and doubles as the claim, so overlapping or crashed runs never re-pick the same accounts.';

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'tiktok-sync-cron') THEN
    PERFORM cron.unschedule('tiktok-sync-cron');
  END IF;
END $$;

SELECT cron.schedule(
  'tiktok-sync-cron',
  '30 * * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url')
            || '/functions/v1/tiktok-sync-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
