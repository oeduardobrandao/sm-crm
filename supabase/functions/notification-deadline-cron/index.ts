import { createClient } from "npm:@supabase/supabase-js@2";
import { timingSafeEqual } from "../_shared/crypto.ts";
import { createNotificationDeadlineCronHandler } from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? (() => { throw new Error("CRON_SECRET is required"); })();

Deno.serve(createNotificationDeadlineCronHandler({
  cronSecret: CRON_SECRET,
  timingSafeEqual,
  run: async () => {
    try {
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

      // Steps with data_limite = tomorrow's date (date column → timezone-safe via CURRENT_DATE + 1)
      const { data: etapas, error: fetchErr } = await supabase
        .rpc("notification_deadline_candidates");

      if (fetchErr) throw fetchErr;

      const candidates = (etapas ?? []) as Array<{
        etapa_id: number;
        workflow_id: number;
        conta_id: string;
        cliente_id: number | null;
        client_name: string | null;
        workflow_title: string | null;
        step_name: string;
        responsavel_id: number | null;
        deadline_date: string;
      }>;

      let inserted = 0;
      let skipped = 0;
      let failed = 0;

      // We pin the dedup floor to UTC midnight to match Supabase's default DB
      // timezone (UTC). If the project's Postgres `timezone` setting is changed,
      // this floor and the SQL `CURRENT_DATE + 1` filter in
      // `notification_deadline_candidates` need to align.
      const now = new Date();
      const todayUtcStartIso = new Date(Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
      )).toISOString();

      for (const c of candidates) {
        try {
          // Idempotency: skip if a deadline_approaching notification for this etapa
          // was already created today (in any timezone — server time UTC is fine).
          const { data: existing, error: existErr } = await supabase
            .from("notifications")
            .select("id")
            .eq("type", "deadline_approaching")
            .eq("metadata->>etapa_id", String(c.etapa_id))
            .gte("created_at", todayUtcStartIso)
            .limit(1);

          if (existErr) throw existErr;
          if (existing && existing.length > 0) { skipped++; continue; }

          // Resolve recipients via the SQL helper (same one triggers use).
          const { data: targets, error: targetsErr } = await supabase
            .rpc("resolve_notification_targets", {
              p_workspace_id:    c.conta_id,
              p_responsavel_id:  c.responsavel_id,
              p_roles_filter:    ["owner", "admin"],
            });

          if (targetsErr) throw targetsErr;

          const userIds = (targets ?? []) as string[];
          if (userIds.length === 0) { skipped++; continue; }

          const { error: insertErr } = await supabase.rpc("insert_notification_batch", {
            p_workspace_id: c.conta_id,
            p_user_ids:     userIds,
            p_type:         "deadline_approaching",
            p_link:         `/workflows/${c.workflow_id}`,
            p_metadata: {
              client_name:    c.client_name,
              workflow_title: c.workflow_title,
              step_name:      c.step_name,
              workflow_id:    c.workflow_id,
              etapa_id:       c.etapa_id,
              deadline_date:  c.deadline_date,
            },
            p_exclude_actor: null,
          });

          if (insertErr) throw insertErr;
          inserted += userIds.length;
        } catch (candidateErr) {
          failed++;
          const m = candidateErr instanceof Error ? candidateErr.message : "unknown";
          console.error(`notification-deadline-cron: candidate etapa_id=${c.etapa_id} failed:`, m);
        }
      }

      return new Response(JSON.stringify({ success: true, inserted, skipped, failed }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("notification-deadline-cron failed:", message);
      return new Response(JSON.stringify({ error: "Internal server error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  },
}));
