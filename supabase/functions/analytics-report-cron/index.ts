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
        .select('id, client_id');

      if (error) throw error;
      if (!accounts || accounts.length === 0) {
        return json({ message: "No accounts to process" });
      }

      let generated = 0;
      let skipped = 0;
      let failed = 0;

      for (const account of accounts) {
        try {
          const { data: existing } = await supabase
            .from('analytics_reports')
            .select('id')
            .eq('instagram_account_id', account.id)
            .eq('report_month', month)
            .single();

          if (existing) {
            skipped++;
            continue;
          }

          const { data: cliente } = await supabase
            .from('clientes')
            .select('conta_id')
            .eq('id', account.client_id)
            .single();

          if (!cliente) {
            skipped++;
            continue;
          }

          const { data: report } = await supabase
            .from('analytics_reports')
            .insert({
              conta_id: cliente.conta_id,
              client_id: account.client_id,
              instagram_account_id: account.id,
              report_month: month,
              status: 'generating',
            })
            .select()
            .single();

          if (!report) {
            failed++;
            continue;
          }

          const genUrl = `${SUPABASE_URL}/functions/v1/instagram-report-generator/generate/${account.client_id}?month=${month}`;
          const genRes = await fetch(genUrl, {
            method: 'POST',
            headers: {
              'X-Internal-Token': INTERNAL_FUNCTION_SECRET,
              'apikey': SUPABASE_ANON_KEY,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ reportId: report.id }),
          });

          if (genRes.ok) {
            generated++;
          } else {
            await supabase.from('analytics_reports').update({ status: 'failed' }).eq('id', report.id);
            failed++;
          }
        } catch (err) {
          console.error(`Failed to generate report for account ${account.id}:`, err);
          failed++;
        }
      }

      return json({ success: true, month, generated, skipped, failed, total: accounts.length });
    } catch (err: any) {
      console.error("Report Cron Job Failed:", err);
      return json({ error: err.message }, 500);
    }
  },
}));
