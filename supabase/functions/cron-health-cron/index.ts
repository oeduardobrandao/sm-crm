import { createClient } from "npm:@supabase/supabase-js@2";
import { timingSafeEqual } from "../_shared/crypto.ts";
import { computeSignature, reportCronFailure } from "../_shared/triage.ts";
import { buildFailureDetail, createCronHealthHandler, type CronFailureRow, scanAndReport } from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? (() => { throw new Error("CRON_SECRET is required"); })();

const SELF_JOB_NAME = "cron-health-cron";
const DB_TIMEOUT_MS = 10_000;
// Window must cover the monitor's hourly cadence plus TRANSIENT_SETTLE_MS
// (handler.ts), so a deferred transient failure is still seen on a later tick.
const WINDOW_MINUTES = Number(Deno.env.get("CRON_HEALTH_WINDOW_MINUTES") ?? "130") || 130;

Deno.serve(createCronHealthHandler({
  cronSecret: CRON_SECRET,
  timingSafeEqual,
  run: async () => {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    try {
      const { scanned, reported, suppressed } = await scanAndReport({
        fetchFailures: async () => {
          const { data, error } = await supabase
            .rpc("recent_cron_failures", { p_window_minutes: WINDOW_MINUTES })
            .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
          if (error) throw new Error(error.message);
          return (data ?? []) as CronFailureRow[];
        },
        fetchLastSuccess: async () => {
          const { data, error } = await supabase
            .rpc("recent_cron_last_success", { p_window_minutes: WINDOW_MINUTES })
            .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
          if (error) throw new Error(error.message);
          const rows = (data ?? []) as Array<{ jobname: string; last_success: string }>;
          return new Map(rows.map((r) => [r.jobname, r.last_success]));
        },
        alreadyReported: async (jobname, firstLine, row) => {
          const { hash } = computeSignature(jobname, firstLine);
          const { data, error } = await supabase
            .from("cron_failures")
            .select("id")
            .eq("signature_hash", hash)
            // Exact run identity, not alert timing: a newer run still executing
            // at the previous tick must not be mistaken for an already-alerted one.
            .eq("error_detail->context->>run_start_time", row.start_time)
            .limit(1)
            .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
          // Fail open: a duplicate alert is better than a missed one.
          if (error) {
            console.error("[CRON-HEALTH] dedup lookup failed");
            return false;
          }
          return (data?.length ?? 0) > 0;
        },
        report: async (jobname, firstLine, row) => {
          await reportCronFailure(supabase, jobname, buildFailureDetail(jobname, firstLine, row));
        },
        selfJobName: SELF_JOB_NAME,
      });

      return new Response(JSON.stringify({ success: true, scanned, reported, suppressed }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown";
      console.error("[CRON-HEALTH] failed", err);
      // Best-effort self-report so a failure of the monitor itself is still visible.
      try {
        await reportCronFailure(supabase, SELF_JOB_NAME, {
          total: 0,
          failed: 1,
          errors: [{ error: message }],
          stack: err instanceof Error ? err.stack : undefined,
        });
      } catch { /* noop */ }
      return new Response(JSON.stringify({ error: "Internal error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  },
}));
