import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { timingSafeEqual } from "../_shared/crypto.ts";
import { notifyCronFailure } from "../_shared/notify.ts";

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ??
  (() => { throw new Error("CRON_SECRET is required"); })();
const INTERNAL_FUNCTION_SECRET = Deno.env.get("INTERNAL_FUNCTION_SECRET") ??
  (() => { throw new Error("INTERNAL_FUNCTION_SECRET is required"); })();

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  // --- Auth: x-cron-secret header ---
  const cronSecret = req.headers.get("x-cron-secret") ?? "";
  if (!timingSafeEqual(cronSecret, CRON_SECRET)) {
    return json({ error: "Unauthorized" }, 401);
  }

  // --- Worker ID for this invocation ---
  const workerId = crypto.randomUUID();
  console.log(`[report-worker] Starting invocation with worker_id=${workerId}`);

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // ---------------------------------------------------------------------------
  // 1. Atomically claim one pending report (optimistic locking)
  // ---------------------------------------------------------------------------
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();

  const { data: candidates, error: queryError } = await supabase
    .from("analytics_reports")
    .select("id, status, locked_at, retry_count")
    .or(
      `status.eq.pending,` +
      `and(status.eq.failed,retry_count.lt.3),` +
      `and(status.eq.generating,locked_at.lt.${tenMinutesAgo})`
    )
    .order("status", { ascending: true }) // pending < failed < generating alphabetically
    .order("generated_at", { ascending: true, nullsFirst: true })
    .limit(5);

  if (queryError) {
    console.error("[report-worker] Failed to query candidates:", queryError);
    return json({ error: "Failed to query reports" }, 500);
  }

  if (!candidates || candidates.length === 0) {
    console.log("[report-worker] No pending reports found");
    return json({ processed: false, reason: "no_pending_reports" });
  }

  // Try to claim one candidate with optimistic lock
  let claimed: Record<string, unknown> | null = null;
  for (const candidate of candidates) {
    const { data, error } = await supabase
      .from("analytics_reports")
      .update({
        status: "generating",
        locked_at: new Date().toISOString(),
        locked_by: workerId,
      })
      .eq("id", candidate.id)
      .eq("status", candidate.status) // Only claim if still in same status
      .select()
      .single();

    if (data && !error) {
      claimed = data;
      break;
    }
  }

  if (!claimed) {
    console.log("[report-worker] All candidates already claimed by another worker");
    return json({ processed: false, reason: "no_pending_reports" });
  }

  console.log(`[report-worker] Claimed report ${claimed.id} (worker_id=${workerId})`);

  // ---------------------------------------------------------------------------
  // 2. Invoke the generator function
  // ---------------------------------------------------------------------------
  const genUrl = `${SUPABASE_URL}/functions/v1/instagram-report-generator-v2`;

  let genRes: Response;
  try {
    genRes = await fetch(genUrl, {
      method: "POST",
      headers: {
        "X-Internal-Token": INTERNAL_FUNCTION_SECRET,
        "apikey": SUPABASE_ANON_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ reportId: claimed.id }),
    });
  } catch (fetchErr: unknown) {
    const message = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
    console.error(`[report-worker] Network error calling generator for report ${claimed.id}:`, message);

    const newRetryCount = ((claimed.retry_count as number) ?? 0) + 1;
    await supabase.from("analytics_reports").update({
      status: "failed",
      generation_error: `Network error: ${message}`.substring(0, 500),
      retry_count: newRetryCount,
      locked_at: null,
      locked_by: null,
    }).eq("id", claimed.id);

    if (newRetryCount >= 3) {
      await notifyCronFailure("report-worker", {
        total: 1,
        failed: 1,
        errors: [{ accountId: String(claimed.id), error: `Network error after ${newRetryCount} attempts: ${message}` }],
      });
    }

    return json({ error: "Generator network error" }, 500);
  }

  // ---------------------------------------------------------------------------
  // 3. Handle generator response
  // ---------------------------------------------------------------------------
  if (genRes.ok) {
    // Generator sets status to 'ready' — nothing more to do
    console.log(`[report-worker] Report ${claimed.id} generated successfully`);
    return json({ processed: true, reportId: claimed.id, workerId });
  }

  // Generator returned an error — mark as failed and maybe notify
  const errorBody = await genRes.text().catch(() => "Unknown error");
  console.error(
    `[report-worker] Generator failed for report ${claimed.id}: HTTP ${genRes.status} — ${errorBody.substring(0, 200)}`
  );

  const newRetryCount = ((claimed.retry_count as number) ?? 0) + 1;
  await supabase.from("analytics_reports").update({
    status: "failed",
    generation_error: errorBody.substring(0, 500),
    retry_count: newRetryCount,
    locked_at: null,
    locked_by: null,
  }).eq("id", claimed.id);

  if (newRetryCount >= 3) {
    console.warn(`[report-worker] Report ${claimed.id} exhausted retries (${newRetryCount}), sending alert`);
    await notifyCronFailure("report-worker", {
      total: 1,
      failed: 1,
      errors: [{
        accountId: String(claimed.id),
        error: `Exhausted ${newRetryCount} retries. Last error: ${errorBody.substring(0, 200)}`,
      }],
    });
  }

  return json({
    processed: false,
    reason: "generator_error",
    reportId: claimed.id,
    retryCount: newRetryCount,
  }, 500);
});
