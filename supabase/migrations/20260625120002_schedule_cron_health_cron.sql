-- Schedule the cron-health monitor hourly, using the CORRECT vault view form.
-- It scans recent FAILED pg_cron runs (via public.recent_cron_failures) and
-- routes each failing job through reportCronFailure() -- closing the blind spot
-- where a cron failing at the SQL layer never reaches its own in-function alert.
--
-- PREREQUISITES (run before applying this migration):
--   1. Deploy the edge function (handles its own auth):
--        npx supabase functions deploy cron-health-cron --no-verify-jwt
--   2. Vault secrets 'project_url' + 'cron_secret' must exist (they already do --
--      reused by the working instagram-publish-cron / instagram-sync-cron jobs).
--
-- The edge function's scan window defaults to 70 min, which is >= this hourly
-- cadence, so every failed run is observed exactly once.
SELECT cron.schedule(
  'cron-health-cron',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url')
            || '/functions/v1/cron-health-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
