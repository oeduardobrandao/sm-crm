-- Schedule tiktok-sync-cron daily at 06:30 (docs/superpowers/specs/2026-07-17-tiktok-integration-design.md,
-- "pg_cron schedules" / Task C4) — offset 30 minutes after instagram-sync-cron's 06:00 slot so the
-- two daily syncs don't contend for the same minute.
--
-- Selects `active` + `auto_sync_enabled` tiktok_accounts not synced in the last 6h (further
-- filtered by the workspace's feature_auto_sync_cron flag inside the function itself), refreshes
-- profile stats + imports/refreshes videos per account, writes a tiktok_account_metrics_daily
-- snapshot + tiktok_follower_history row, and purges processed tiktok_webhook_events older than
-- 30 days.
--
-- Uses the vault.decrypted_secrets subselect form, NOT vault.decrypted_secret(...) (that
-- function form does not exist on this instance — see 20260617120000's note, cloned here from
-- 20260718000003_tiktok_cron_refresh.sql's identical block).
--
-- Idempotent: safe to apply twice.

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'tiktok-sync-cron') THEN
    PERFORM cron.unschedule('tiktok-sync-cron');
  END IF;
END $$;

SELECT cron.schedule(
  'tiktok-sync-cron',
  '30 6 * * *',
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
