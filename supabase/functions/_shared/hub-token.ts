import { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { effectivePlanFeature } from "./entitlements-rpc.ts";

export interface HubToken { cliente_id: number; conta_id: string; is_active: boolean; }

/** Pure gate: active token AND feature enabled. */
export function hubTokenActive(tok: { is_active: boolean }, featureEnabled: boolean): boolean {
  return tok.is_active === true && featureEnabled === true;
}

/**
 * Resolves a hub token to its workspace and enforces feature_hub_portal.
 * Returns the token row, or null if missing/inactive/feature-disabled.
 * Pass expectedContaId when the caller already resolved the workspace
 * (hub-bootstrap resolves by slug) to preserve the slug<->token binding.
 */
export async function resolveHubToken(
  db: SupabaseClient, token: string, now: string, expectedContaId?: string,
): Promise<HubToken | null> {
  let q = db.from("client_hub_tokens")
    .select("cliente_id, conta_id, is_active")
    .eq("token", token).gt("expires_at", now);
  if (expectedContaId) q = q.eq("conta_id", expectedContaId);
  const { data } = await q.maybeSingle();
  if (!data) return null;
  const featureOn = await effectivePlanFeature(db, data.conta_id as string, "feature_hub_portal");
  if (!hubTokenActive(data, featureOn)) return null;
  return data as HubToken;
}
