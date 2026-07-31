-- Schedule loops-sync-cron every 15 minutes.
-- Spec: docs/superpowers/specs/2026-07-31-loops-lifecycle-marketing-emails-design.md
--
-- Apply ONLY AFTER the loops-sync-cron function is deployed AND 20260731000004
-- (RPCs + claim + backfill seed) is applied: the schedule fires immediately.
--
-- Rollback order is the REVERSE: SELECT cron.unschedule('loops-sync-cron')
-- first, then undeploy. Keep the lifecycle_emails and loops_contacts rows —
-- they are the record of what was already sent and synced; deleting them
-- re-mails everyone on a future re-rollout.
--
-- Uses the vault.decrypted_secrets subselect form, NOT vault.decrypted_secret(...)
-- (that function form does not exist on this instance).
--
-- Idempotent: safe to apply twice.

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'loops-sync-cron') THEN
    PERFORM cron.unschedule('loops-sync-cron');
  END IF;
END $$;

SELECT cron.schedule(
  'loops-sync-cron',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url')
            || '/functions/v1/loops-sync-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
