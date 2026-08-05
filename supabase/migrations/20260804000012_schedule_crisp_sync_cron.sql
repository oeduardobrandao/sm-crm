-- Schedule crisp-sync-cron every 15 minutes.
-- Spec: docs/superpowers/specs/2026-08-03-crisp-customer-sync-design.md
--
-- Apply ONLY AFTER the crisp-sync-cron function is deployed AND 20260804000011
-- is applied: cron.schedule fires immediately, with no grace period.
--
-- Before applying, the rollout requires invoking the function BY HAND TWICE and
-- confirming the second run reports upserted: 0. That is the check the entire
-- quota argument rests on -- steady state must cost approximately zero vendor
-- calls, and a second run that re-pushes the same users means the payload
-- fingerprint is not stable. Done on prod 2026-08-05: run 1 upserted 53 /
-- failed 0, run 2 upserted 0 / failed 0, 53 of 53 ledger rows fully synced.
--
-- Rollback order is the REVERSE: SELECT cron.unschedule('crisp-sync-cron')
-- first, then undeploy. KEEP the crisp_contacts rows -- they are the record of
-- what was pushed to a foreign vendor, and deleting them destroys the only
-- handle for erasing those profiles later.
--
-- STAGING: this schedule is deliberately NOT wanted on staging today, because
-- apps/crm/index.html hardcodes one Crisp website id, so both environments share
-- a single Crisp workspace and a staging sweep writes test users into the real
-- support inbox. If you push migrations to staging, unschedule it there:
--   SELECT cron.unschedule('crisp-sync-cron');
--
-- Uses the vault.decrypted_secrets subselect form, NOT vault.decrypted_secret(...)
-- (that function form does not exist on this instance).
--
-- NOTE: vault `cron_secret` must match the edge function's CRON_SECRET env var,
-- or every tick returns 401 while cron.job_run_details still reports
-- `succeeded` -- it only records that net.http_post was queued. Verify with:
--   select status_code, count(*) from net._http_response
--    where created > now() - interval '1 hour' group by status_code;
--
-- Idempotent: safe to apply twice.

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'crisp-sync-cron') THEN
    PERFORM cron.unschedule('crisp-sync-cron');
  END IF;
END $$;

SELECT cron.schedule(
  'crisp-sync-cron',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url')
            || '/functions/v1/crisp-sync-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
