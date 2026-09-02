// Fila mensal de relatórios: enfileira um analytics_report 'pending' por conta
// de Instagram conectada e dá o primeiro kick no report-worker. O worker
// processa UM relatório por invocação; quem drena o resto da fila é o job
// pg_cron 'report-worker-tick' (a cada 5 min), não este kick.

type SupabaseLike = {
  // deno-lint-ignore no-explicit-any
  from(table: string): any;
};

export interface QueueMonthlyReportsDeps {
  supabase: SupabaseLike;
  fetchFn: typeof fetch;
  supabaseUrl: string;
  anonKey: string;
  cronSecret: string;
  now: Date;
}

export type QueueMonthlyReportsResult =
  | { kind: "empty" }
  | {
    kind: "done";
    month: string;
    queued: number;
    skipped: number;
    failed: number;
    total: number;
  };

export async function queueMonthlyReports(
  deps: QueueMonthlyReportsDeps,
): Promise<QueueMonthlyReportsResult> {
  const { supabase, fetchFn, supabaseUrl, anonKey, cronSecret, now } = deps;

  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const month = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`;

  const { data: accounts, error } = await supabase
    .from("instagram_accounts")
    .select("id, client_id")
    .not("encrypted_access_token", "is", null);

  if (error) throw error;
  if (!accounts || accounts.length === 0) {
    return { kind: "empty" };
  }

  let queued = 0;
  let skipped = 0;
  let failed = 0;

  for (const account of accounts) {
    try {
      const { data: cliente } = await supabase
        .from("clientes")
        .select("conta_id, include_ai_analysis")
        .eq("id", account.client_id)
        .single();

      if (!cliente) {
        skipped++;
        continue;
      }

      const { error: upsertError } = await supabase
        .from("analytics_reports")
        .upsert(
          {
            conta_id: cliente.conta_id,
            client_id: account.client_id,
            instagram_account_id: account.id,
            report_month: month,
            status: "pending",
            include_ai: cliente.include_ai_analysis,
          },
          { onConflict: "instagram_account_id,report_month", ignoreDuplicates: true },
        );

      if (upsertError) {
        console.error(`Failed to upsert report for account ${account.id}:`, upsertError);
        failed++;
      } else {
        queued++;
      }
    } catch (err) {
      console.error(`Failed to queue report for account ${account.id}:`, err);
      failed++;
    }
  }

  if (queued > 0) {
    try {
      // O worker autentica por x-cron-secret (não aceita X-Internal-Token).
      const workerRes = await fetchFn(`${supabaseUrl}/functions/v1/report-worker`, {
        method: "POST",
        headers: {
          "x-cron-secret": cronSecret,
          "apikey": anonKey,
          "Content-Type": "application/json",
        },
      });

      if (!workerRes.ok) {
        console.error(`Failed to invoke report-worker: ${workerRes.status}`);
      }
    } catch (err) {
      console.error("Failed to invoke report-worker:", err);
    }
  }

  return { kind: "done", month, queued, skipped, failed, total: accounts.length };
}
