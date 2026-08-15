-- supabase/migrations/20260815000005_schedule_instagram_automation_cron.sql
-- Retry/manutenção da automação de comentário -> DM, a cada 5 minutos.
-- Must be applied AFTER the instagram-automation-cron function is deployed.
-- Rollback order é o INVERSO: cron.unschedule primeiro, depois undeploy.
-- vault.decrypted_secrets é VIEW (subselect form) -- ver nota em 20260617120000.
-- Idempotente: seguro aplicar duas vezes.

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'instagram-automation-cron') THEN
    PERFORM cron.unschedule('instagram-automation-cron');
  END IF;
END $$;

SELECT cron.schedule(
  'instagram-automation-cron',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url')
            || '/functions/v1/instagram-automation-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
