-- Run instagram-publish-cron every minute (was */5).
--
-- The 5-minute cadence was a structural source of publishing delay: a post is not
-- looked at until the next tick, and when an Instagram media container is still
-- transcoding the cron bails for a whole cycle. At 1-minute cadence (combined with
-- in-run container polling + front-loaded container creation in the edge functions)
-- most posts publish within ~1-2 min of their scheduled time.
--
-- Idempotent: unschedule the existing job, then reschedule. Reuses the working
-- vault.decrypted_secrets subselect body from 20260428000003 (NOT the broken
-- vault.decrypted_secret(...) function form, which does not exist on this instance).

SELECT cron.unschedule('instagram-publish-cron');

SELECT cron.schedule(
  'instagram-publish-cron',
  '* * * * *',
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
