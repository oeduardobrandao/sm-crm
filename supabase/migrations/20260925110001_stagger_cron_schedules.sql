-- Stagger pg_cron schedules so fewer jobs start in the same minute.
--
-- cron.use_background_workers is off, so pg_cron opens one libpq connection per
-- job run. The prod instance allows 60 connections and ~40 are held at idle
-- (PostgREST's pool alone is 18), so when many jobs start on the same tick some
-- of them fail with "connection failed" before their net.http_post ever runs.
-- Seen 2026-09-18, 2026-09-21 19:17-19:25 and 2026-09-23 12:40/12:45; every
-- failure landed on a minute where */5, */15 and hourly jobs piled on top of the
-- three every-minute crons (up to ten jobs at the top of the hour).
--
-- The every-minute jobs (instagram-publish, tiktok-publish, report-worker-tick)
-- stay as they are. Everything else moves to its own minute, so no minute starts
-- more than five jobs (was up to ten). This lowers the odds, it does not remove
-- them: 12:40 on 2026-09-23 had five starts and one still failed. The real fix
-- is connection headroom; cron-health-cron also stops alerting on a lone
-- recovered "connection failed" (migration 20260925110002).
--
-- None of these jobs aligns its work to the schedule: they read cursors, age
-- windows or "due" flags, so a few minutes' shift is harmless.
--
-- cron.alter_job keeps each job's command (which holds the vault lookups) and
-- only touches the schedule. Jobs are looked up by name, so a job that does not
-- exist in an environment (staging and prod differ slightly) is skipped.
--
-- Rollback: re-run the same loop with the old schedules listed at the right.

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT j.jobid, v.schedule
    FROM (VALUES
      ('instagram-automation-cron',    '1-59/5 * * * *'),   -- was */5
      ('notification-email-cron',      '2-59/5 * * * *'),   -- was */5
      ('client-event-email-cron',      '3-59/15 * * * *'),  -- was */15
      ('crisp-sync-cron',              '4-59/15 * * * *'),  -- was */15
      ('lifecycle-email-cron',         '9-59/15 * * * *'),  -- was */15
      ('loops-sync-cron',              '13-59/15 * * * *'), -- was */15 (staging only)
      ('post-media-cleanup-hourly',    '5 * * * *'),        -- was 0 * * * * (prod)
      ('post-media-cleanup',           '5 3 * * *'),        -- was 0 3 * * * (staging, fresh DBs)
      ('tarefas-recorrentes-generate', '8 * * * *'),        -- was 7 * * * *
      ('instagram-refresh-cron-6h',    '10 */6 * * *'),     -- was 0 */6 * * *
      ('expire-and-cleanup-invites',   '20 */6 * * *'),     -- was 0 */6 * * *
      ('notification-deadline-cron',   '14 12 * * *'),      -- was 0 12 * * *
      ('retention-radar-cron',         '17 12 * * 1'),      -- was 0 12 * * 1
      ('billing-downgrade-cron',       '22 6 * * *')        -- was 0 6 * * *
    ) AS v(jobname, schedule)
    JOIN cron.job j ON j.jobname = v.jobname
  LOOP
    PERFORM cron.alter_job(job_id := r.jobid, schedule := r.schedule);
  END LOOP;
END
$$;
