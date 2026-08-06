-- Cron-health monitor support: expose recent FAILED pg_cron runs to the
-- cron-health-cron edge function.
--
-- pg_cron's run history lives in the `cron` schema, which PostgREST does not
-- expose to the API roles. This SECURITY DEFINER function (owned by the
-- migration role, which can read `cron`) returns failed runs in a recent window
-- so the edge function can route them through reportCronFailure() (email +
-- GitHub triage). This is the piece that was missing: a job failing at the SQL
-- layer (e.g. the vault.decrypted_secret bug) never reaches its own in-function
-- alert, so without this monitor such failures are completely silent.

CREATE OR REPLACE FUNCTION public.recent_cron_failures(p_window_minutes int DEFAULT 90)
RETURNS TABLE (
  jobname        text,
  status         text,
  return_message text,
  start_time     timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT j.jobname, d.status, d.return_message, d.start_time
  FROM cron.job_run_details d
  JOIN cron.job j ON j.jobid = d.jobid
  WHERE d.status = 'failed'
    AND d.start_time >= pg_catalog.now() - pg_catalog.make_interval(mins => p_window_minutes)
  ORDER BY d.start_time DESC
$$;

-- Only the service-role (used by the edge function) may call this. Never expose
-- pg_cron internals to anon/authenticated API callers.
REVOKE ALL ON FUNCTION public.recent_cron_failures(int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recent_cron_failures(int) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recent_cron_failures(int) TO service_role;
