// cron-health-cron: scans pg_cron run history for FAILED runs and routes each
// failing job through reportCronFailure() (email + GitHub triage). This is the
// dead-man's-switch for the crons themselves -- a job that fails at the SQL
// layer (before its net.http_post fires) never reaches its own in-function
// alert, so without this monitor such failures are invisible.

export interface CronFailureRow {
  jobname: string;
  status: string;
  return_message: string | null;
  start_time: string;
}

export interface ScanDeps {
  /** Fetch recent FAILED cron runs (newest first). */
  fetchFailures: () => Promise<CronFailureRow[]>;
  /** Emit one alert for a failing job. */
  report: (jobname: string, firstLine: string, row: CronFailureRow) => Promise<void>;
  /** The monitor's own job name, excluded to avoid self-referential alerts. */
  selfJobName?: string;
}

/**
 * Collapse the window's failed runs to one alert per distinct job (the every-
 * minute publish cron could otherwise produce dozens of rows per window), keep
 * the newest run's message, and report each. Pure except for the injected deps,
 * so it is unit-testable without a DB or network.
 */
export async function scanAndReport(
  deps: ScanDeps,
): Promise<{ scanned: number; reported: string[] }> {
  const rows = await deps.fetchFailures();
  const byJob = new Map<string, CronFailureRow>();
  for (const r of rows) {
    if (deps.selfJobName && r.jobname === deps.selfJobName) continue;
    // rows arrive newest-first; keep the first (latest) per job.
    if (!byJob.has(r.jobname)) byJob.set(r.jobname, r);
  }

  const reported: string[] = [];
  for (const [jobname, row] of byJob) {
    const firstLine = (row.return_message ?? "cron run failed")
      .split("\n")[0]
      .slice(0, 500);
    await deps.report(jobname, firstLine, row);
    reported.push(jobname);
  }
  return { scanned: rows.length, reported };
}

export interface CronHealthHandlerDeps {
  cronSecret: string;
  timingSafeEqual: (a: string, b: string) => boolean;
  run: (req: Request) => Promise<Response>;
}

export function createCronHealthHandler(deps: CronHealthHandlerDeps) {
  return async (req: Request): Promise<Response> => {
    if (!deps.timingSafeEqual(req.headers.get("x-cron-secret") ?? "", deps.cronSecret)) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    return deps.run(req);
  };
}
