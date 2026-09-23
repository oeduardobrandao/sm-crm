import { assert, assertEquals } from "./assert.ts";
import {
  buildFailureDetail,
  type CronFailureRow,
  createCronHealthHandler,
  isTransientStartFailure,
  scanAndReport,
} from "../cron-health-cron/handler.ts";

function row(jobname: string, message: string | null, start_time: string): CronFailureRow {
  return { jobname, status: "failed", return_message: message, start_time };
}

Deno.test("scanAndReport reports one alert per distinct failing job", async () => {
  const calls: Array<{ jobname: string; firstLine: string }> = [];
  const { scanned, reported } = await scanAndReport({
    fetchFailures: () =>
      Promise.resolve([
        row("instagram-refresh-cron-6h", "ERROR: function vault.decrypted_secret(unknown) does not exist", "2026-06-25T18:00:00Z"),
        row("notification-cleanup-cron", "ERROR: function vault.decrypted_secret(unknown) does not exist", "2026-06-25T03:00:00Z"),
      ]),
    report: (jobname, firstLine) => {
      calls.push({ jobname, firstLine });
      return Promise.resolve();
    },
  });

  assertEquals(scanned, 2);
  assertEquals(reported.sort(), ["instagram-refresh-cron-6h", "notification-cleanup-cron"]);
  assertEquals(calls.length, 2);
});

Deno.test("scanAndReport de-dups multiple failed runs of the same job, keeping the newest", async () => {
  const seen: string[] = [];
  const { reported } = await scanAndReport({
    fetchFailures: () =>
      Promise.resolve([
        // newest first
        row("instagram-publish-cron", "ERROR: newest failure", "2026-06-25T19:17:00Z"),
        row("instagram-publish-cron", "ERROR: older failure", "2026-06-25T19:16:00Z"),
        row("instagram-publish-cron", "ERROR: oldest failure", "2026-06-25T19:15:00Z"),
      ]),
    report: (_jobname, firstLine) => {
      seen.push(firstLine);
      return Promise.resolve();
    },
  });

  assertEquals(reported, ["instagram-publish-cron"]);
  assertEquals(seen, ["ERROR: newest failure"]);
});

Deno.test("scanAndReport excludes the monitor's own job to avoid self-loops", async () => {
  const reportedJobs: string[] = [];
  const { reported } = await scanAndReport({
    fetchFailures: () =>
      Promise.resolve([
        row("cron-health-cron", "ERROR: monitor blew up", "2026-06-25T20:00:00Z"),
        row("analytics-report-cron-monthly", "ERROR: function vault.decrypted_secret(unknown) does not exist", "2026-06-01T06:00:00Z"),
      ]),
    report: (jobname) => {
      reportedJobs.push(jobname);
      return Promise.resolve();
    },
    selfJobName: "cron-health-cron",
  });

  assertEquals(reported, ["analytics-report-cron-monthly"]);
  assert(!reportedJobs.includes("cron-health-cron"));
});

Deno.test("scanAndReport collapses multi-line messages to the first line", async () => {
  let captured = "";
  await scanAndReport({
    fetchFailures: () =>
      Promise.resolve([
        row(
          "instagram-refresh-cron-6h",
          "ERROR:  function vault.decrypted_secret(unknown) does not exist\nLINE 3:     url := vault.decrypted_secret('project_url')\n  ^",
          "2026-06-25T18:00:00Z",
        ),
      ]),
    report: (_jobname, firstLine) => {
      captured = firstLine;
      return Promise.resolve();
    },
  });

  assertEquals(captured, "ERROR:  function vault.decrypted_secret(unknown) does not exist");
});

Deno.test("scanAndReport skips runs an earlier tick already alerted", async () => {
  const reportedJobs: string[] = [];
  const { reported } = await scanAndReport({
    fetchFailures: () =>
      Promise.resolve([
        row("job-a", "ERROR: boom", "2026-06-25T18:55:00Z"),
        row("job-b", "ERROR: boom", "2026-06-25T18:56:00Z"),
      ]),
    alreadyReported: (jobname) => Promise.resolve(jobname === "job-a"),
    report: (jobname) => {
      reportedJobs.push(jobname);
      return Promise.resolve();
    },
  });
  assertEquals(reported, ["job-b"]);
  assertEquals(reportedJobs, ["job-b"]);
});

Deno.test("scanAndReport falls back to a default message when return_message is null", async () => {
  let captured = "";
  await scanAndReport({
    fetchFailures: () => Promise.resolve([row("some-cron", null, "2026-06-25T18:00:00Z")]),
    report: (_jobname, firstLine) => {
      captured = firstLine;
      return Promise.resolve();
    },
  });
  assertEquals(captured, "cron run failed");
});

Deno.test("createCronHealthHandler rejects a wrong cron secret with 401", async () => {
  const handler = createCronHealthHandler({
    cronSecret: "right",
    timingSafeEqual: (a, b) => a === b,
    run: () => Promise.resolve(new Response("ran", { status: 200 })),
  });

  const res = await handler(new Request("https://x/", { headers: { "x-cron-secret": "wrong" } }));
  assertEquals(res.status, 401);
});

Deno.test("createCronHealthHandler runs when the cron secret matches", async () => {
  const handler = createCronHealthHandler({
    cronSecret: "right",
    timingSafeEqual: (a, b) => a === b,
    run: () => Promise.resolve(new Response("ran", { status: 200 })),
  });

  const res = await handler(new Request("https://x/", { headers: { "x-cron-secret": "right" } }));
  assertEquals(res.status, 200);
  assertEquals(await res.text(), "ran");
});

Deno.test("buildFailureDetail names the failed job and carries the run start time", () => {
  const detail = buildFailureDetail(
    "notification-email-cron",
    "connection failed",
    row("notification-email-cron", "connection failed", "2026-09-21T19:25:00.008035+00:00"),
  );
  assertEquals(detail.errors, [{ accountId: "notification-email-cron", error: "connection failed" }]);
  assertEquals(detail.context.run_start_time, "2026-09-21T19:25:00.008035+00:00");
});

// --- transient pg_cron start failures ("connection failed") ---

const NOW = Date.parse("2026-09-23T13:00:00Z");

async function scanTransient(
  rows: CronFailureRow[],
  lastSuccess: Record<string, string> | (() => Promise<Map<string, string>>),
) {
  const reports: Array<{ jobname: string; firstLine: string; start: string }> = [];
  const result = await scanAndReport({
    fetchFailures: () => Promise.resolve(rows),
    fetchLastSuccess: typeof lastSuccess === "function"
      ? lastSuccess
      : () => Promise.resolve(new Map(Object.entries(lastSuccess))),
    report: (jobname, firstLine, row) => {
      reports.push({ jobname, firstLine, start: row.start_time });
      return Promise.resolve();
    },
    now: () => NOW,
  });
  return { ...result, reports };
}

Deno.test("isTransientStartFailure matches pg_cron's start failures only", () => {
  assert(isTransientStartFailure("connection failed"));
  assert(!isTransientStartFailure("ERROR: connection failed to foo"));
  assert(!isTransientStartFailure("ERROR: canceling statement due to statement timeout"));
});

Deno.test("scanAndReport drops a lone connection failure the job recovered from", async () => {
  const { reported, suppressed, reports } = await scanTransient(
    [row("instagram-publish-cron", "connection failed", "2026-09-23T12:45:00Z")],
    { "instagram-publish-cron": "2026-09-23T12:59:00Z" },
  );
  assertEquals(reported, []);
  assertEquals(suppressed, ["instagram-publish-cron"]);
  assertEquals(reports, []);
});

Deno.test("scanAndReport alerts when a transient failure was never followed by a success", async () => {
  // A daily job that missed its only run: there is no later tick to recover on.
  const { reported } = await scanTransient(
    [row("billing-downgrade-cron", "connection failed", "2026-09-23T12:22:00Z")],
    {},
  );
  assertEquals(reported, ["billing-downgrade-cron"]);
});

Deno.test("scanAndReport defers a fresh transient failure with no success yet", async () => {
  const { reported, suppressed } = await scanTransient(
    [row("instagram-publish-cron", "connection failed", "2026-09-23T12:58:00Z")],
    { "instagram-publish-cron": "2026-09-23T12:57:00Z" },
  );
  assertEquals(reported, []);
  assertEquals(suppressed, ["instagram-publish-cron"]);
});

Deno.test("scanAndReport alerts on repeated transient failures even after recovery", async () => {
  const { reported, reports } = await scanTransient(
    [
      row("report-worker-tick", "connection failed", "2026-09-23T12:22:00Z"),
      row("report-worker-tick", "connection failed", "2026-09-23T12:21:00Z"),
      row("report-worker-tick", "connection failed", "2026-09-23T12:20:00Z"),
    ],
    { "report-worker-tick": "2026-09-23T12:59:00Z" },
  );
  assertEquals(reported, ["report-worker-tick"]);
  assertEquals(reports[0].start, "2026-09-23T12:22:00Z");
});

Deno.test("scanAndReport reports a real error even when a newer transient one exists", async () => {
  const { reports } = await scanTransient(
    [
      row("notification-email-cron", "connection failed", "2026-09-23T12:47:00Z"),
      row("notification-email-cron", "ERROR: relation does not exist", "2026-09-23T12:42:00Z"),
    ],
    { "notification-email-cron": "2026-09-23T12:52:00Z" },
  );
  assertEquals(reports, [{
    jobname: "notification-email-cron",
    firstLine: "ERROR: relation does not exist",
    start: "2026-09-23T12:42:00Z",
  }]);
});

Deno.test("scanAndReport fails open when the last-success lookup throws", async () => {
  const { reported } = await scanTransient(
    [row("instagram-publish-cron", "connection failed", "2026-09-23T12:45:00Z")],
    () => Promise.reject(new Error("rpc down")),
  );
  assertEquals(reported, ["instagram-publish-cron"]);
});
