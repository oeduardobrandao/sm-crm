import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { timingSafeEqual } from "../_shared/crypto.ts";
import { createAnalyticsReportCronHandler } from "./handler.ts";
import { queueMonthlyReports } from "./queue.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? (() => { throw new Error('CRON_SECRET is required'); })();

Deno.serve(createAnalyticsReportCronHandler({
  buildCorsHeaders,
  cronSecret: CRON_SECRET,
  timingSafeEqual,
  run: async (_req, json) => {
    try {
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

      const result = await queueMonthlyReports({
        supabase,
        fetchFn: fetch,
        supabaseUrl: SUPABASE_URL,
        anonKey: SUPABASE_ANON_KEY,
        cronSecret: CRON_SECRET,
        now: new Date(),
      });

      if (result.kind === "empty") {
        return json({ message: "No accounts to process" });
      }

      const { month, queued, skipped, failed, total } = result;
      return json({ success: true, month, queued, skipped, failed, total });
    } catch (err: any) {
      console.error("Report Cron Job Failed:", err);
      return json({ error: "Internal server error" }, 500);
    }
  },
}));
