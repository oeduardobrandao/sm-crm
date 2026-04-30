-- Schedule notification crons.
-- Prerequisites:
--   - Vault secrets 'project_url' and 'cron_secret' must exist
--   - Edge functions notification-deadline-cron + notification-cleanup-cron
--     must be deployed with --no-verify-jwt before this migration runs.

-- Daily deadline scan at 12:00 UTC (≈09:00 Brasília), so users see "amanhã" reminders
-- in the morning of the day before the deadline.
SELECT cron.schedule(
  'notification-deadline-cron',
  '0 12 * * *',
  $$
  SELECT net.http_post(
    url := vault.decrypted_secret('project_url') || '/functions/v1/notification-deadline-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', vault.decrypted_secret('cron_secret')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);

-- Daily 90-day cleanup at 03:00 UTC (off-peak).
SELECT cron.schedule(
  'notification-cleanup-cron',
  '0 3 * * *',
  $$
  SELECT net.http_post(
    url := vault.decrypted_secret('project_url') || '/functions/v1/notification-cleanup-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', vault.decrypted_secret('cron_secret')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
