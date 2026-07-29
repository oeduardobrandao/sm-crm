-- Schedule lifecycle-email-cron every 15 minutes (welcome + subscription
-- thank-you sweeps; spec docs/superpowers/specs/2026-07-29-lifecycle-emails-design.md).
--
-- Must be applied AFTER the lifecycle-email-cron function is deployed AND
-- 20260730000001 (ledger + RPCs + seeds) is applied — the schedule fires
-- immediately (same ordering rule as 20260702000005).
--
-- Rollback order is the REVERSE: unschedule this job first
-- (SELECT cron.unschedule('lifecycle-email-cron')), then undeploy the
-- function. Keep the lifecycle_emails table and its rows — they are the
-- record of what was already sent; deleting them re-mails everyone on a
-- future re-rollout.
--
-- Uses the vault.decrypted_secrets subselect form, NOT vault.decrypted_secret(...)
-- (that function form does not exist on this instance — see 20260617120000's note).
--
-- Idempotent: safe to apply twice.

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lifecycle-email-cron') THEN
    PERFORM cron.unschedule('lifecycle-email-cron');
  END IF;
END $$;

SELECT cron.schedule(
  'lifecycle-email-cron',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url')
            || '/functions/v1/lifecycle-email-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
