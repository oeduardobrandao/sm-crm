-- Schedule youtube-sync-cron hourly at minute 35 (Phase 2 plan Task 7, ruling P1; spec
-- docs/superpowers/specs/2026-10-29-youtube-google-meu-negocio-design.md section 5.1).
--
-- deploy youtube-sync-cron BEFORE applying (with --no-verify-jwt: it authenticates via
-- x-cron-secret). Applied first, pg_cron calls a function that does not exist yet every hour.
--
-- Hourly, not one daily run: each run claims at most GOOGLE_SYNC_BATCH_LIMIT active channels whose
-- last successful sync is older than 20 h (or never happened, or whose data_through is NULL after
-- a reconnect), so capacity is 24 x the batch limit per day and the sync order converges on the
-- hours right after the Pacific quota reset. Minute 35 sits outside the 5-minute stagger list of
-- 20260925110001 (minutes = 1, 2 mod 5) and away from gbp-sync-cron's minute 40.
--
-- Uses the vault.decrypted_secrets subselect form, NOT vault.decrypted_secret(...) (that function
-- form does not exist on this instance), cloned from 20260720000007_tiktok_sync_cron_schedule.sql.
--
-- Idempotent: safe to apply twice.

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'youtube-sync-cron') THEN
    PERFORM cron.unschedule('youtube-sync-cron');
  END IF;
END $$;

SELECT cron.schedule(
  'youtube-sync-cron',
  '35 * * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url')
            || '/functions/v1/youtube-sync-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
