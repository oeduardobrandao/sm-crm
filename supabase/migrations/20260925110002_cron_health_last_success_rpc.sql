-- Cron-health support: the newest SUCCESSFUL run per job in a recent window.
--
-- cron-health-cron uses this to tell a transient pg_cron start failure
-- ("connection failed": pg_cron could not open its libpq connection, usually
-- because the instance was at max_connections) that the job already recovered
-- from, from one that is still failing. Only the former is suppressed; see
-- cron-health-cron/handler.ts. Same security shape as recent_cron_failures().

CREATE OR REPLACE FUNCTION public.recent_cron_last_success(p_window_minutes int DEFAULT 90)
RETURNS TABLE (
  jobname      text,
  last_success timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT j.jobname, pg_catalog.max(d.start_time)
  FROM cron.job_run_details d
  JOIN cron.job j ON j.jobid = d.jobid
  WHERE d.status = 'succeeded'
    AND d.start_time >= pg_catalog.now() - pg_catalog.make_interval(mins => p_window_minutes)
  GROUP BY j.jobname
$$;

-- Only the service-role (used by the edge function) may call this.
REVOKE ALL ON FUNCTION public.recent_cron_last_success(int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recent_cron_last_success(int) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recent_cron_last_success(int) TO service_role;
