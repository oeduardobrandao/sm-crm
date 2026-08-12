import { SupabaseClient } from "npm:@supabase/supabase-js@2";

/**
 * Effective-plan write, guarded so admin comps (plan_source='manual') are never overridden.
 * Read and write errors THROW (they were silently discarded before): in stripe-webhook a
 * throw becomes a 5xx → Stripe redelivery → retried write (the Fase 2 "a failed write must
 * not ack" rule); in pagarme-checkout the caller decides (post-bind failures log CRITICAL
 * without failing the checkout).
 */
export async function writeWorkspacePlan(
  svc: SupabaseClient,
  workspaceId: string,
  planId: string,
  planSource: "stripe" | "pagarme",
) {
  const { data: ws, error: readErr } = await svc
    .from("workspaces").select("plan_source").eq("id", workspaceId).single();
  if (readErr) {
    throw new Error(`workspace read failed for ${workspaceId}: ${readErr.message}`);
  }
  if (ws?.plan_source === "manual") return;
  const { error: writeErr } = await svc.from("workspaces")
    .update({ plan_id: planId, plan_source: planSource }).eq("id", workspaceId);
  if (writeErr) {
    throw new Error(`plan write failed for ${workspaceId}: ${writeErr.message}`);
  }
}
