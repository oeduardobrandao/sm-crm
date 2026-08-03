-- Schedule mention-email-cron every 5 minutes (unread @-mention digest email,
-- claim-first at-most-once; spec docs/superpowers/specs/2026-08-03-at-mentions-implementation-plan.md).
--
-- Must be applied AFTER the mention-email-cron function is deployed -- the
-- schedule fires immediately (same ordering rule as 20260730000002).
--
-- Rollback order is the REVERSE: unschedule this job first
-- (SELECT cron.unschedule('mention-email-cron')), then undeploy the function.
--
-- Uses the vault.decrypted_secrets subselect form, NOT vault.decrypted_secret(...)
-- (that function form does not exist on this instance -- see 20260617120000's note).
--
-- Idempotent: safe to apply twice.
--
-- NOTE ON THE PREFIX: the implementation plan named this file
-- `20260803000002_schedule_mention_email_cron.sql`, but by the time this task
-- ran, origin/main's migrations tail had already advanced to
-- `20260803000005_schedule_loops_sync_cron.sql` (paywall_hits/checkout_attempts/
-- loops_* landed on main after this feature branch diverged), so both
-- `20260803000001` and `20260803000002` collided with already-merged main
-- migrations. Both of this plan's Task 1/Task 8 migrations were renumbered to
-- sit immediately after main's tail, preserving their original relative
-- order: `mencoes.sql` (Task 1) is now `20260803000006`, and this file
-- (Task 8) is `20260803000007`.

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'mention-email-cron') THEN
    PERFORM cron.unschedule('mention-email-cron');
  END IF;
END $$;

SELECT cron.schedule(
  'mention-email-cron',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url')
            || '/functions/v1/mention-email-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
