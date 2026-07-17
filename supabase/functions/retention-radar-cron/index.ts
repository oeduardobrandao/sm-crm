import { createClient } from "npm:@supabase/supabase-js@2";
import { timingSafeEqual } from "../_shared/crypto.ts";
import { bucketWorkspace } from "../_shared/radar-logic.ts";
import { createRetentionRadarCronHandler } from "./handler.ts";
import { buildRadarEmail, type RadarRow } from "./email.ts";
import { reportCronFailure } from "../_shared/triage.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? (() => { throw new Error("CRON_SECRET is required"); })();

Deno.serve(createRetentionRadarCronHandler({
  cronSecret: CRON_SECRET,
  timingSafeEqual,
  run: async () => {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    try {
      // Paying and trialing only. A dormant Free workspace is an activation failure, not churn
      // risk, and would drown the list — PostHog measures that population instead.
      const { data: subs, error: subsErr } = await supabase
        .from("workspace_subscriptions")
        .select("workspace_id, status, plan_id, current_period_end, failed_payment_count")
        .in("status", ["active", "trialing", "past_due"]);
      if (subsErr) throw subsErr;

      const subRows = (subs ?? []) as Array<{
        workspace_id: string;
        status: string | null;
        plan_id: string | null;
        current_period_end: string | null;
        failed_payment_count: number;
      }>;
      if (subRows.length === 0) {
        return new Response(JSON.stringify({ success: true, reported: 0, failed: 0 }), {
          status: 200, headers: { "Content-Type": "application/json" },
        });
      }

      const ids = subRows.map((s) => s.workspace_id);

      const { data: wsData, error: wsErr } = await supabase
        .from("workspaces").select("id, name, created_at").in("id", ids);
      if (wsErr) throw wsErr;
      const wsById = new Map(
        (wsData ?? []).map((w) => [w.id as string, w as { id: string; name: string; created_at: string }]),
      );

      // Reuses the admin's RPC rather than restating its GREATEST-over-work-artifacts logic.
      const { data: activity, error: actErr } = await supabase
        .rpc("admin_workspace_last_activity", { workspace_ids: ids });
      if (actErr) throw actErr;
      const activityById = new Map(
        ((activity ?? []) as Array<{ workspace_id: string; last_activity_at: string | null }>)
          .map((a) => [a.workspace_id, a.last_activity_at]),
      );

      const now = new Date();
      const rows: RadarRow[] = [];
      let failed = 0;

      for (const sub of subRows) {
        try {
          const ws = wsById.get(sub.workspace_id);
          if (!ws) continue;

          const bucket = bucketWorkspace({
            status: sub.status,
            currentPeriodEnd: sub.current_period_end,
            lastActivityAt: activityById.get(sub.workspace_id) ?? null,
            createdAt: ws.created_at,
          }, now);
          if (!bucket) continue;

          let ownerEmail = "—";
          const { data: ownerMember, error: memberErr } = await supabase
            .from("workspace_members").select("user_id")
            .eq("workspace_id", sub.workspace_id).eq("role", "owner").limit(1).maybeSingle();
          if (memberErr) throw memberErr;
          if (ownerMember?.user_id) {
            const { data: ownerUser } = await supabase.auth.admin.getUserById(ownerMember.user_id as string);
            ownerEmail = ownerUser?.user?.email ?? "—";
          }

          rows.push({
            bucket,
            workspaceName: ws.name,
            ownerEmail,
            planId: sub.plan_id,
            status: sub.status,
            lastActivityAt: activityById.get(sub.workspace_id) ?? null,
            failedPaymentCount: sub.failed_payment_count,
          });
        } catch (workspaceErr) {
          failed++;
          const m = workspaceErr instanceof Error ? workspaceErr.message : "unknown";
          console.error(`retention-radar-cron: workspace_id=${sub.workspace_id} failed:`, m);
        }
      }

      const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
      const ALERT_EMAIL = Deno.env.get("ALERT_EMAIL");
      if (RESEND_API_KEY && ALERT_EMAIL) {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: "Mesaas Alerts <alertas@mesaas.com.br>",
            to: [ALERT_EMAIL],
            subject: `[Mesaas] Radar de retenção — ${rows.length} workspace(s) em risco`,
            html: buildRadarEmail(rows),
          }),
        });
        if (!res.ok) console.error(`[retention-radar-cron] Resend error: ${res.status}`);
      }

      return new Response(JSON.stringify({ success: true, reported: rows.length, failed }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("retention-radar-cron failed:", message);
      await reportCronFailure(supabase, "retention-radar-cron", {
        stack: message,
      });
      return new Response(JSON.stringify({ error: "Internal server error" }), {
        status: 500, headers: { "Content-Type": "application/json" },
      });
    }
  },
}));
