import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { insertAuditLog } from "../_shared/audit.ts";
import { revertPlanTarget } from "./revert-target.ts";
import { endReverseTrialByAdmin } from "./reverse-trial.ts";

// Comp (plan_source='manual') and un-comp. Lives outside index.ts so it can be tested:
// index.ts calls Deno.serve on import.
//
// Reverse trial (spec 2026-11-24-reverse-trial-design, Part 6): comping a workspace in the
// trial ends the trial first with outcome 'ended_by_admin' (end_reverse_trial compare-and-sets
// on plan_source='trial', so it must run before the 'manual' write), and un-comping never
// puts a workspace back in the trial (revertPlanTarget has no 'trial' target).

type Headers = Record<string, string>;

const json = (body: unknown, status: number, headers: Headers) =>
  new Response(JSON.stringify(body), { status, headers });

export async function handleSetWorkspacePlan(
  svc: SupabaseClient,
  body: { workspace_id: string; plan_id: string },
  ids: { adminId: string; userId: string },
  headers: Headers,
) {
  const { workspace_id, plan_id } = body;
  if (!workspace_id || !plan_id) {
    return json({ error: "workspace_id and plan_id are required" }, 400, headers);
  }

  const { data: current, error: readErr } = await svc
    .from("workspaces")
    .select("plan_source")
    .eq("id", workspace_id)
    .maybeSingle();
  if (readErr) throw readErr;

  if (current?.plan_source === "trial") {
    // False = the trial ended in between (a conversion won the lock): the comp still applies.
    const ended = await endReverseTrialByAdmin(svc, workspace_id);
    if (ended) {
      await insertAuditLog(svc, {
        action: "admin-end-reverse-trial",
        actor_user_id: ids.userId,
        resource_type: "workspace",
        resource_id: workspace_id,
        metadata: { reason: "comp", plan_id },
      });
    }
  }

  const { error: wErr } = await svc
    .from("workspaces")
    .update({ plan_id, plan_source: "manual" })
    .eq("id", workspace_id);
  if (wErr) throw wErr;

  const { data: existing } = await svc
    .from("workspace_plan_overrides")
    .select("id")
    .eq("workspace_id", workspace_id)
    .maybeSingle();

  if (existing) {
    const { error } = await svc
      .from("workspace_plan_overrides")
      .update({
        resource_overrides: null,
        feature_overrides: null,
        notes: null,
        updated_by: ids.adminId,
        updated_at: new Date().toISOString(),
      })
      .eq("workspace_id", workspace_id);
    if (error) throw error;
  } else {
    const { error } = await svc
      .from("workspace_plan_overrides")
      .insert({ workspace_id, updated_by: ids.adminId });
    if (error) throw error;
  }

  return json({ message: "Workspace plan updated" }, 200, headers);
}

export async function handleUnsetWorkspacePlan(
  svc: SupabaseClient,
  body: { workspace_id: string },
  adminId: string,
  headers: Headers,
) {
  const { workspace_id } = body;
  if (!workspace_id) {
    return json({ error: "workspace_id is required" }, 400, headers);
  }

  const { data: current, error: readErr } = await svc
    .from("workspaces")
    .select("plan_source")
    .eq("id", workspace_id)
    .maybeSingle();
  if (readErr) throw readErr;
  if (current?.plan_source === "trial") {
    // Writing system/stripe here would end the trial with no outcome. "Encerrar agora" is the tool.
    return json(
      {
        error: "Este workspace está no teste sem cartão. Use Encerrar agora para terminar o teste.",
        code: "in_reverse_trial",
      },
      409,
      headers,
    );
  }

  const { data: sub } = await svc
    .from("workspace_subscriptions")
    .select("status, plan_id, provider, cancel_at_period_end, current_period_end")
    .eq("workspace_id", workspace_id)
    .maybeSingle();

  const { data: def } = await svc
    .from("plans")
    .select("id")
    .eq("is_default", true)
    .maybeSingle();

  const target = revertPlanTarget(
    sub as {
      status?: string;
      plan_id?: string;
      provider?: string;
      cancel_at_period_end?: boolean;
      current_period_end?: string;
    } | null,
    (def?.id as string) ?? "free",
    new Date(),
  );

  const { error: wErr } = await svc
    .from("workspaces")
    .update({ plan_id: target.plan_id, plan_source: target.plan_source })
    .eq("id", workspace_id);
  if (wErr) throw wErr;

  // clear any manual granular overrides left from the comp
  await svc
    .from("workspace_plan_overrides")
    .update({
      resource_overrides: null,
      feature_overrides: null,
      notes: null,
      updated_by: adminId,
      updated_at: new Date().toISOString(),
    })
    .eq("workspace_id", workspace_id);

  return json({ message: "Comp removed", plan_source: target.plan_source }, 200, headers);
}
