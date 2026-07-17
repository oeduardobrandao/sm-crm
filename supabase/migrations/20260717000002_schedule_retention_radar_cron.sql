-- Weekly at-risk digest to ALERT_EMAIL: Mondays 12:00 UTC (09:00 Brasília), the same hour as the
-- existing deadline cron.
--
-- Must be applied AFTER supabase/config.toml's [functions.retention-radar-cron] entry has been
-- deployed — the schedule fires immediately.
--
-- Uses the vault.decrypted_secrets subselect form, NOT vault.decrypted_secret(...) (that function
-- form does not exist on this instance — see 20260428000003). pg_cron-layer failures are silent,
-- so getting this wrong produces a cron that simply never runs and never reports.
--
-- Idempotent: safe to apply twice.

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'retention-radar-cron') THEN
    PERFORM cron.unschedule('retention-radar-cron');
  END IF;
END $$;

SELECT cron.schedule(
  'retention-radar-cron',
  '0 12 * * 1',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url')
            || '/functions/v1/retention-radar-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
