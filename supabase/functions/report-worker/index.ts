import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { timingSafeEqual } from "../_shared/crypto.ts";
import { reportCronFailure } from "../_shared/triage.ts";

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
      await reportCronFailure(supabase, "report-worker", {
        total: 1,
        failed: 1,
        errors: [{ accountId: String(claimed.id), error: `Network error after ${newRetryCount} attempts: ${message}` }],
        stack: fetchErr instanceof Error ? fetchErr.stack : undefined,
      });
    }

    return json({ error: "Generator network error" }, 500);
  }

  // ---------------------------------------------------------------------------
  // 3. Handle generator response
  // ---------------------------------------------------------------------------
  if (genRes.ok) {
    console.log(`[report-worker] Report ${claimed.id} generated successfully`);

    // --- Auto-email if both workspace and client flags are enabled ---
    try {
      const { data: reportRow } = await supabase
        .from('analytics_reports')
        .select('client_id, conta_id, report_month, storage_path, ai_content')
        .eq('id', claimed.id)
        .single();

      if (reportRow) {
        const { data: wsFlags } = await supabase
          .from('workspaces')
          .select('send_report_email, name, brand_color, logo_url')
          .eq('id', reportRow.conta_id)
          .single();

        const { data: clientFlags } = await supabase
          .from('clientes')
          .select('send_report_email, nome, email')
          .eq('id', reportRow.client_id)
          .eq('conta_id', reportRow.conta_id)
          .single();

        if (wsFlags?.send_report_email && clientFlags?.send_report_email && clientFlags?.email) {
          const { buildReportEmail } = await import("../_shared/report-template/email.ts");

          let pdfUrl = '';
          if (reportRow.storage_path) {
            const { data: signedUrl } = await supabase.storage
              .from('analytics-reports')
              .createSignedUrl(reportRow.storage_path, 7 * 24 * 60 * 60);
            pdfUrl = signedUrl?.signedUrl ?? '';
          }

          const emailHtml = buildReportEmail({
            clientName: clientFlags.nome,
            month: reportRow.report_month,
            workspaceName: wsFlags.name ?? 'Mesaas',
            brandColor: wsFlags.brand_color ?? '#eab308',
            logoUrl: wsFlags.logo_url ?? null,
            aiSummary: reportRow.ai_content?.executive_summary ?? null,
            pdfUrl,
            hubUrl: '',
          });

          const [year, mm] = reportRow.report_month.split('-');
          const monthLabel = new Date(parseInt(year), parseInt(mm) - 1, 1)
            .toLocaleDateString('pt-BR', { month: 'long' });

          const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
          if (RESEND_API_KEY) {
            const emailRes = await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${RESEND_API_KEY}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                from: `${wsFlags.name ?? 'Mesaas'} <relatorios@mesaas.com.br>`,
                to: [clientFlags.email],
                subject: `Seu relatório de ${monthLabel} está pronto!`,
                html: emailHtml,
              }),
            });

            if (emailRes.ok) {
              await supabase.from('analytics_reports')
                .update({ last_emailed_at: new Date().toISOString() })
                .eq('id', claimed.id);
              console.log(`[report-worker] Auto-email sent for report ${claimed.id}`);
            } else {
              console.error(`[report-worker] Auto-email failed: ${emailRes.status}`);
            }
          }
        }
      }
    } catch (emailErr: unknown) {
      const msg = emailErr instanceof Error ? emailErr.message : String(emailErr);
      console.error(`[report-worker] Auto-email error (non-fatal): ${msg}`);
    }

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
    await reportCronFailure(supabase, "report-worker", {
      total: 1,
      failed: 1,
      errors: [{ accountId: String(claimed.id), error: `Generator error after ${newRetryCount} attempts: ${errorBody}`.slice(0, 500) }],
    });
  }

  return json({
    processed: false,
    reason: "generator_error",
    reportId: claimed.id,
    retryCount: newRetryCount,
  }, 500);
});
