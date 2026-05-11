-- Schedule instagram-refresh-cron to run daily at 04:00 UTC (01:00 BRT).
-- Refreshes long-lived Instagram tokens that expire within 30 days,
-- preventing users from having to manually reconnect accounts.
--
-- Prerequisites:
--   - Vault secrets 'project_url' and 'cron_secret' must exist
--   - CRON_SECRET env var must match the vault secret value
--   - Edge function instagram-refresh-cron must be deployed with --no-verify-jwt

SELECT cron.schedule(
  'instagram-refresh-cron-daily',
  '0 4 * * *',
  $$
  SELECT net.http_post(
    url := vault.decrypted_secret('project_url') || '/functions/v1/instagram-refresh-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', vault.decrypted_secret('cron_secret')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
