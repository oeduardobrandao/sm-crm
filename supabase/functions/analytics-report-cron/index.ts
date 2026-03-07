import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// --- Monthly Report Cron ---
// Run on 1st of each month. Generates PDF reports for all connected accounts.
Deno.serve(async (_req) => {
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Previous month
    const now = new Date();
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const month = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;

    // Get all connected Instagram accounts
    const { data: accounts, error } = await supabase
      .from('instagram_accounts')
      .select('id, client_id');

    if (error) throw error;
    if (!accounts || accounts.length === 0) {
      return new Response(JSON.stringify({ message: "No accounts to process" }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    let generated = 0;
    let skipped = 0;
    let failed = 0;

    for (const account of accounts) {
      try {
        // Check if report already exists
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

        // Get client's conta_id
        const { data: cliente } = await supabase
          .from('clientes')
          .select('conta_id')
          .eq('id', account.client_id)
          .single();

        if (!cliente) {
          skipped++;
          continue;
        }

        // Create report record
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

        // Call the report generator function
        const genUrl = `${SUPABASE_URL}/functions/v1/instagram-report-generator/generate/${account.client_id}?month=${month}`;
        const genRes = await fetch(genUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
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

    return new Response(JSON.stringify({
      success: true,
      month,
      generated,
      skipped,
      failed,
      total: accounts.length,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (err: any) {
    console.error("Report Cron Job Failed:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
