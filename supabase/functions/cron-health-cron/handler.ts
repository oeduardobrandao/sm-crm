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

/**
 * Alert payload for one failed pg_cron run. `accountId` carries the job name so
 * the email's Account column reads as the failing job instead of "?" (the
 * monitor has no per-account context), and `run_start_time` is the moment the
 * run actually failed, not the moment this monitor noticed it.
 */
export function buildFailureDetail(jobname: string, firstLine: string, row: CronFailureRow) {
  return {
    total: 1,
    failed: 1,
    errors: [{ accountId: jobname, error: firstLine }],
    context: { run_start_time: row.start_time },
  };
}

/**
 * pg_cron start failures: the scheduler could not open the libpq connection it
 * runs each job on (typically the instance at max_connections), so the job's
 * SQL never ran. The next tick usually succeeds, so one of these on its own is
 * noise; see isTransientStartFailure() below for when it still alerts.
 */
const TRANSIENT_START_FAILURES = new Set(["connection failed"]);

export function isTransientStartFailure(firstLine: string): boolean {
  return TRANSIENT_START_FAILURES.has(firstLine.trim().toLowerCase());
}

/** Transient failures of one job within the window at which we alert anyway. */
export const TRANSIENT_ALERT_COUNT = 3;
/**
 * A transient failure younger than this with no success after it is left for
 * the next tick: the job may simply not have run again yet. The 70 min window
 * minus the hourly cadence leaves room for this, so the next tick still sees it.
 */
export const TRANSIENT_SETTLE_MS = 10 * 60_000;

function firstLineOf(row: CronFailureRow): string {
  return (row.return_message ?? "cron run failed").split("\n")[0].slice(0, 500);
}

export interface ScanDeps {
  /** Fetch recent FAILED cron runs (newest first). */
  fetchFailures: () => Promise<CronFailureRow[]>;
  /**
   * Newest successful run start per job in the window. Used only to drop
   * transient start failures the job already recovered from. Optional, and a
   * throw is treated as "no successes known", so the monitor fails open.
   */
  fetchLastSuccess?: () => Promise<Map<string, string>>;
  /** Emit one alert for a failing job. */
  report: (jobname: string, firstLine: string, row: CronFailureRow) => Promise<void>;
  /**
   * True when this exact failed run (identified by its start_time) was already
   * alerted by an earlier tick. The scan
   * window (70 min) deliberately overlaps the hourly cadence so a job firing at
   * the same instant as the monitor is never missed, which means the overlap
   * would otherwise re-alert.
   */
  alreadyReported?: (jobname: string, firstLine: string, row: CronFailureRow) => Promise<boolean>;
  /** The monitor's own job name, excluded to avoid self-referential alerts. */
  selfJobName?: string;
  /** Clock, injectable for tests. */
  now?: () => number;
}

/**
 * Collapse the window's failed runs to one alert per distinct job (the every-
 * minute publish cron could otherwise produce dozens of rows per window) and
 * report each. A real error (anything not a transient start failure) always
 * alerts, newest one first. A job whose failures are ALL transient alerts only
 * when it failed TRANSIENT_ALERT_COUNT+ times in the window, or when it has not
 * succeeded since its newest failure (a daily job that missed its only run).
 * Pure except for the injected deps, so it is unit-testable without a DB.
 */
export async function scanAndReport(
  deps: ScanDeps,
): Promise<{ scanned: number; reported: string[]; suppressed: string[] }> {
  const rows = await deps.fetchFailures();
  const byJob = new Map<string, CronFailureRow[]>();
  for (const r of rows) {
    if (deps.selfJobName && r.jobname === deps.selfJobName) continue;
    // rows arrive newest-first, so each job's list stays newest-first.
    const list = byJob.get(r.jobname);
    if (list) list.push(r);
    else byJob.set(r.jobname, [r]);
  }

  let lastSuccess: Map<string, string> | null = null;
  const loadLastSuccess = async () => {
    if (lastSuccess) return lastSuccess;
    try {
      lastSuccess = deps.fetchLastSuccess ? await deps.fetchLastSuccess() : new Map();
    } catch {
      console.error("[CRON-HEALTH] last-success lookup failed");
      lastSuccess = new Map();
    }
    return lastSuccess;
  };
  const now = deps.now ?? Date.now;

  const reported: string[] = [];
  const suppressed: string[] = [];
  for (const [jobname, jobRows] of byJob) {
    // A real error wins even over newer transient ones. If it was already
    // alerted, the dedup below skips the job entirely: it is known broken, so
    // the newer transient failures add nothing.
    let row = jobRows.find((r) => !isTransientStartFailure(firstLineOf(r)));
    if (!row) {
      const newest = jobRows[0];
      if (jobRows.length < TRANSIENT_ALERT_COUNT) {
        const succeededAt = (await loadLastSuccess()).get(jobname);
        const newestMs = Date.parse(newest.start_time);
        if (succeededAt && Date.parse(succeededAt) > newestMs) {
          suppressed.push(jobname); // recovered on a later tick
          continue;
        }
        if (now() - newestMs < TRANSIENT_SETTLE_MS) {
          suppressed.push(jobname); // too early to tell; next tick decides
          continue;
        }
      }
      row = newest;
    }
    const firstLine = firstLineOf(row);
    if (deps.alreadyReported && (await deps.alreadyReported(jobname, firstLine, row))) continue;
    await deps.report(jobname, firstLine, row);
    reported.push(jobname);
  }
  return { scanned: rows.length, reported, suppressed };
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
