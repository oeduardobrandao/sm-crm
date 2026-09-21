-- Retention for pg_cron's run history. cron.job_run_details is never trimmed by
-- pg_cron itself and only has its primary key indexed. By 2026-09-21 prod held
-- ~330k rows (265 MB) growing ~5k/day (three every-minute crons), and
-- public.recent_cron_failures (a status + start_time filter) had to seq-scan all
-- of it: ~4.9 s warm, over the API statement timeout on a cold cache. That made
-- cron-health-cron fail with "canceling statement due to statement timeout".
--
-- The table is owned by supabase_admin, so we cannot add a start_time index;
-- keeping it small is the fix. 7 days is far longer than the monitor's 70 min
-- window and still enough to investigate a weekend failure on Monday.
--
-- Idempotent: cron.schedule upserts by name, the DELETE is a no-op when nothing
-- is old enough.

-- One-time trim so the monitor recovers on the next tick rather than tomorrow.
DELETE FROM cron.job_run_details
 WHERE start_time < pg_catalog.now() - interval '7 days';

SELECT cron.schedule(
  'cron-job-run-details-purge',
  '30 3 * * *',
  $$DELETE FROM cron.job_run_details WHERE start_time < now() - interval '7 days'$$
);
