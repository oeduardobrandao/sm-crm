-- Fix instagram-publish-cron: vault.decrypted_secret() function does not exist
-- on this Supabase instance. Use the view-based subselect instead.

SELECT cron.unschedule('instagram-publish-cron');

SELECT cron.schedule(
  'instagram-publish-cron',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url')
            || '/functions/v1/instagram-publish-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
