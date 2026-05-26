import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { timingSafeEqual } from "../_shared/crypto.ts";
import { createAnalyticsReportCronHandler } from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? (() => { throw new Error('CRON_SECRET is required'); })();
const INTERNAL_FUNCTION_SECRET = Deno.env.get('INTERNAL_FUNCTION_SECRET') ?? (() => { throw new Error('INTERNAL_FUNCTION_SECRET is required'); })();

Deno.serve(createAnalyticsReportCronHandler({
  buildCorsHeaders,
  cronSecret: CRON_SECRET,
  timingSafeEqual,
  run: async (_req, json) => {
    try {
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

      const now = new Date();
      const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const month = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;

      const { data: accounts, error } = await supabase
        .from('instagram_accounts')
        .select('id, client_id')
        .not('access_token_enc', 'is', null);

      if (error) throw error;
      if (!accounts || accounts.length === 0) {
        return json({ message: "No accounts to process" });
      }

      let queued = 0;
      let skipped = 0;
      let failed = 0;

      for (const account of accounts) {
        try {
          const { data: cliente } = await supabase
            .from('clientes')
            .select('conta_id, include_ai_analysis')
            .eq('id', account.client_id)
            .single();

          if (!cliente) {
            skipped++;
            continue;
          }

          const { error: upsertError } = await supabase
            .from('analytics_reports')
            .upsert(
              {
                conta_id: cliente.conta_id,
                client_id: account.client_id,
                instagram_account_id: account.id,
                report_month: month,
                status: 'pending',
                include_ai: cliente.include_ai_analysis,
              },
              { onConflict: 'instagram_account_id,report_month', ignoreDuplicates: true }
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

      // Kick off the report worker to start processing pending reports
      if (queued > 0) {
        try {
          const workerUrl = `${SUPABASE_URL}/functions/v1/report-worker`;
          const workerRes = await fetch(workerUrl, {
            method: 'POST',
            headers: {
              'X-Internal-Token': INTERNAL_FUNCTION_SECRET,
              'apikey': SUPABASE_ANON_KEY,
              'Content-Type': 'application/json',
            },
          });

          if (!workerRes.ok) {
            console.error(`Failed to invoke report-worker: ${workerRes.status}`);
          }
        } catch (err) {
          console.error('Failed to invoke report-worker:', err);
        }
      }

      return json({ success: true, month, queued, skipped, failed, total: accounts.length });
    } catch (err: any) {
      console.error("Report Cron Job Failed:", err);
      return json({ error: err.message }, 500);
    }
  },
}));
