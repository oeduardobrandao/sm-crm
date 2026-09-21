import { assert, assertEquals } from "./assert.ts";
import {
  type CronFailureRow,
  createCronHealthHandler,
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
