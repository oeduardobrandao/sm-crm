-- Re-schedule cron jobs to pass x-cron-secret header for authentication.
--
-- IMPORTANT: Two storage mechanisms are used for the cron secret:
--   1. Deno env var CRON_SECRET  — read by the edge function at runtime.
--   2. Vault secret 'cron_secret' — read by pg_cron SQL via vault.decrypted_secret().
-- Both MUST hold the same value. Before running this migration:
--   a) Set the env var:  supabase secrets set CRON_SECRET="<value>"
--   b) Store in vault (run in SQL console):
--        SELECT vault.create_secret('<value>', 'cron_secret');
--      or update if it already exists:
--        UPDATE vault.secrets SET secret = '<value>' WHERE name = 'cron_secret';

-- Re-schedule cleanup cron with authentication header
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'post-media-cleanup') THEN
    PERFORM cron.unschedule('post-media-cleanup');
  END IF;
END $$;
SELECT cron.schedule(
  'post-media-cleanup',
  '0 3 * * *',
  $$
  SELECT net.http_post(
    url := vault.decrypted_secret('project_url') || '/functions/v1/post-media-cleanup-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', vault.decrypted_secret('cron_secret')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);

-- Re-schedule analytics report cron with authentication header
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'analytics-report-cron-monthly') THEN
    PERFORM cron.unschedule('analytics-report-cron-monthly');
  END IF;
END $$;
SELECT cron.schedule(
  'analytics-report-cron-monthly',
  '0 6 1 * *',
  $$
  SELECT net.http_post(
    url := vault.decrypted_secret('project_url') || '/functions/v1/analytics-report-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', vault.decrypted_secret('cron_secret')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
