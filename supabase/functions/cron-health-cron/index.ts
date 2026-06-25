import { createClient } from "npm:@supabase/supabase-js@2";
import { timingSafeEqual } from "../_shared/crypto.ts";
import { reportCronFailure } from "../_shared/triage.ts";
import { createCronHealthHandler, type CronFailureRow, scanAndReport } from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? (() => { throw new Error("CRON_SECRET is required"); })();

const SELF_JOB_NAME = "cron-health-cron";
// Window should be >= the monitor's own cadence so every failed run is seen once.
const WINDOW_MINUTES = Number(Deno.env.get("CRON_HEALTH_WINDOW_MINUTES") ?? "70") || 70;

Deno.serve(createCronHealthHandler({
  cronSecret: CRON_SECRET,
  timingSafeEqual,
  run: async () => {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    try {
      const { scanned, reported } = await scanAndReport({
        fetchFailures: async () => {
          const { data, error } = await supabase.rpc("recent_cron_failures", {
            p_window_minutes: WINDOW_MINUTES,
          });
          if (error) throw new Error(error.message);
          return (data ?? []) as CronFailureRow[];
        },
        report: async (jobname, firstLine) => {
          await reportCronFailure(supabase, jobname, {
            total: 1,
            failed: 1,
            errors: [{ error: firstLine }],
          });
        },
        selfJobName: SELF_JOB_NAME,
      });

      return new Response(JSON.stringify({ success: true, scanned, reported }), {
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
      return new Response(JSON.stringify({ error: message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  },
}));
