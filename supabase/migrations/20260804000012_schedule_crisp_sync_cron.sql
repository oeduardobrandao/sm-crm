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
-- STAGING: this migration is GATED to the prod project and is a no-op anywhere
-- else. See the block comment above the DO block for why, and for what to change
-- if a third environment appears.
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

-- GATED TO PROD, and this is a safety control rather than tidiness.
--
-- apps/crm/index.html hardcodes ONE Crisp website id, so prod and staging share
-- a single Crisp workspace. An unconditional schedule here means that applying
-- migrations to staging starts syncing staging's test accounts into the real
-- support inbox: other people's names, e-mails and phone numbers, in the wrong
-- place, mixed in with real customers.
--
-- An earlier version of this migration scheduled unconditionally and relied on
-- an operator running cron.unschedule afterwards. That is a race, not a
-- mitigation: the job can fire in the window between `db push` and the manual
-- step, and what it writes in that window is real PII. So the gate is in the
-- migration, where no one has to remember it.
--
-- Gating on the project ref in vault `project_url`. The refs are not secret --
-- .env.example documents both of them in plain text. If a third environment
-- ever appears, add its ref here deliberately; failing closed on an unknown
-- database is the intended behaviour.
--
-- To schedule this somewhere else on purpose, run cron.schedule by hand there.
DO $$
DECLARE
  v_project_url text;
BEGIN
  SELECT decrypted_secret INTO v_project_url
    FROM vault.decrypted_secrets WHERE name = 'project_url';

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'crisp-sync-cron') THEN
    PERFORM cron.unschedule('crisp-sync-cron');
  END IF;

  IF v_project_url IS NULL OR v_project_url NOT LIKE '%skjzpekeqefvlojenfsw%' THEN
    RAISE NOTICE 'crisp-sync-cron NOT scheduled: this is not the prod project (shared Crisp workspace).';
    RETURN;
  END IF;

  PERFORM cron.schedule(
    'crisp-sync-cron',
    '*/15 * * * *',
    $job$
    SELECT net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url')
              || '/functions/v1/crisp-sync-cron',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
      ),
      body := '{}'::jsonb
    ) AS request_id;
    $job$
  );
END $$;
