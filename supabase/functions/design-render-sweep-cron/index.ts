import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { timingSafeEqual } from "../_shared/crypto.ts";
import { reportCronFailure } from "../_shared/triage.ts";
import {
  createDesignRenderSweepCronHandler,
  type StuckDesignRow,
} from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ??
  (() => {
    throw new Error("CRON_SECRET is required");
  })();

const STUCK_THRESHOLD_MS = 2 * 60 * 1000;

const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

Deno.serve(createDesignRenderSweepCronHandler({
  buildCorsHeaders,
  cronSecret: CRON_SECRET,
  timingSafeEqual,

  findStuckRows: async () => {
    const cutoff = new Date(Date.now() - STUCK_THRESHOLD_MS).toISOString();
    const { data, error } = await svc
      .from("designs")
      .select("id, rev")
      .or(
        `and(render_status.eq.pending,updated_at.lt.${cutoff}),` +
          `and(render_status.eq.rendering,render_started_at.lt.${cutoff})`,
      )
      .limit(200);
    if (error) throw error;
    return (data ?? []) as unknown as StuckDesignRow[];
  },

  reFire: async (designId, rev) => {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/design-render`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-cron-secret": CRON_SECRET },
      body: JSON.stringify({ design_id: designId, rev }),
    });
    if (res.status === 200) return true;
    // 409 = another worker (or a still-alive chain) already holds the claim; 204 = the row's
    // rev moved since we read it. Both are harmless no-ops — the row wasn't actually dead.
    if (res.status === 204 || res.status === 409) return false;
    throw new Error(`design-render re-fire returned ${res.status}`);
  },

  reportFailure: async (detail) => {
    await reportCronFailure(svc, "design-render-sweep-cron", detail);
  },

  logError: (context, error) => {
    console.error(`[${context}]`, error);
  },
}));
