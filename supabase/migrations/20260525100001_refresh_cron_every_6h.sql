-- Increase instagram-refresh-cron frequency from daily to every 6 hours.
-- If the cron fails on one run, the token gets 3 more chances before expiring.

SELECT cron.unschedule('instagram-refresh-cron-daily');

SELECT cron.schedule(
  'instagram-refresh-cron-6h',
  '0 */6 * * *',
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
