import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { timingSafeEqual } from "../_shared/crypto.ts";
import {
  createExpressPostCleanupCronHandler,
  type ExpressPostCleanupDb,
  runExpressPostCleanupCron,
} from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? (() => { throw new Error("CRON_SECRET is required"); })();

Deno.serve(createExpressPostCleanupCronHandler({
  buildCorsHeaders,
  cronSecret: CRON_SECRET,
  timingSafeEqual,
  run: async (_req, json) => {
    try {
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      const result = await runExpressPostCleanupCron(
        supabase as unknown as ExpressPostCleanupDb,
        cutoff,
      );

      return json({ success: true, ...result });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("Express post cleanup failed:", message);
      return json({ error: "Internal server error" }, 500);
    }
  },
}));
