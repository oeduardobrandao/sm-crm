import { SupabaseClient } from "npm:@supabase/supabase-js@2";

/** Calls the SQL effective_plan_limit(); returns null for unlimited. */
export async function effectivePlanLimit(
  svc: SupabaseClient, workspaceId: string, limitKey: string,
): Promise<number | null> {
  const { data, error } = await svc.rpc("effective_plan_limit", {
    ws_id: workspaceId, limit_key: limitKey,
  });
  if (error) throw error;
  return data === null ? null : Number(data);
}

export async function effectivePlanFeature(
  svc: SupabaseClient, workspaceId: string, featureKey: string,
): Promise<boolean> {
  const { data, error } = await svc.rpc("effective_plan_feature", {
    ws_id: workspaceId, feature_key: featureKey,
  });
  if (error) throw error;
  return data === true;
}
