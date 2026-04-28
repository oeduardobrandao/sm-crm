-- Schedule instagram-publish-cron to run every 5 minutes.
-- Picks up posts with status 'agendado' whose scheduled_at has passed,
-- creates Instagram containers, publishes them, and handles retries.
--
-- Prerequisites:
--   - Vault secrets 'project_url' and 'cron_secret' must exist
--   - CRON_SECRET env var must match the vault secret value
--   - Edge function instagram-publish-cron must be deployed with --no-verify-jwt

SELECT cron.schedule(
  'instagram-publish-cron',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := vault.decrypted_secret('project_url') || '/functions/v1/instagram-publish-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', vault.decrypted_secret('cron_secret')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
