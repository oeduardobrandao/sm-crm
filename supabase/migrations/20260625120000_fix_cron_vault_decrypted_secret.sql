-- Fix: five pg_cron jobs call vault.decrypted_secret('...'), a function that does
-- NOT exist on this Supabase instance. Every scheduled run therefore errors at the
-- SQL layer BEFORE net.http_post fires, so the target edge function is never
-- invoked. The token-refresh, notification, and analytics crons have thus never
-- run in prod. Failures were silent because reportCronFailure() lives INSIDE the
-- edge function (which is never reached) -- there is no alerting at the pg_cron
-- layer (see 20260625120001 for the cron-health monitor that closes that gap).
--
-- Correct form (already used by instagram-publish-cron / instagram-sync-cron):
--   (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = '...')
--
-- cron.schedule(name, ...) upserts by name, so re-scheduling replaces the broken
-- command body in place. Job names + schedules below match the LIVE prod jobs.

-- 1. Instagram long-lived token refresh (every 6h) -- the reported symptom.
SELECT cron.schedule(
  'instagram-refresh-cron-6h',
  '0 */6 * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url')
            || '/functions/v1/instagram-refresh-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);

-- 2. Deadline reminder notifications (daily 12:00 UTC).
SELECT cron.schedule(
  'notification-deadline-cron',
  '0 12 * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url')
            || '/functions/v1/notification-deadline-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);

-- 3. Notification 90-day cleanup (daily 03:00 UTC).
SELECT cron.schedule(
  'notification-cleanup-cron',
  '0 3 * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url')
            || '/functions/v1/notification-cleanup-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);

-- 4. Monthly analytics report (06:00 UTC on the 1st).
SELECT cron.schedule(
  'analytics-report-cron-monthly',
  '0 6 1 * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url')
            || '/functions/v1/analytics-report-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);

-- 5. Drop the broken daily 'post-media-cleanup' zombie. It has failed since
--    2026-04 with the same vault error, yet the working 'post-media-cleanup-hourly'
--    job (created later, directly in prod) already calls post-media-cleanup-cron
--    every hour -- so cleanup has been covered the whole time. Remove the redundant
--    broken job rather than fixing a duplicate.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'post-media-cleanup') THEN
    PERFORM cron.unschedule('post-media-cleanup');
  END IF;
END $$;
