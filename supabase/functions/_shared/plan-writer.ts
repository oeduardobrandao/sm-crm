import { SupabaseClient } from "npm:@supabase/supabase-js@2";

/** Effective-plan write, guarded so admin comps (plan_source='manual') are never overridden. */
export async function writeWorkspacePlan(
  svc: SupabaseClient,
  workspaceId: string,
  planId: string,
  planSource: "stripe" | "pagarme",
) {
  const { data: ws } = await svc
    .from("workspaces").select("plan_source").eq("id", workspaceId).single();
  if (ws?.plan_source === "manual") return;
  await svc.from("workspaces")
    .update({ plan_id: planId, plan_source: planSource }).eq("id", workspaceId);
}
