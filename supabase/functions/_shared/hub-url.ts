import { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { effectivePlanFeature } from "./entitlements-rpc.ts";
import { appBaseUrl } from "./app-url.ts";

/** Pure: assembles the public Hub URL. Empty string when any part is missing. */
export function buildHubUrl(baseUrl: string, slug: string | null, token: string | null): string {
  if (!slug || !token) return "";
  return `${baseUrl.replace(/\/+$/, "")}/${slug}/hub/${token}`;
}

/**
 * The client's live Hub URL, or '' when there isn't one.
 *
 * Every caller feeds this straight into buildReportEmail, which hides the button on an empty
 * string — so the failure mode is the status quo (no button) rather than a link that errors in
 * front of the agency's own client.
 *
 * Mirrors resolveHubToken's gates: an unexpired, active token AND feature_hub_portal on the plan.
 * Ordered newest-first rather than maybeSingle() on the bare filter, because nothing in the schema
 * stops a client from holding more than one token row.
 */
export async function resolveHubUrl(
  svc: SupabaseClient,
  clienteId: number,
  contaId: string,
): Promise<string> {
  const { data: ws } = await svc
    .from("workspaces").select("slug").eq("id", contaId).maybeSingle();
  const slug = (ws as { slug: string | null } | null)?.slug ?? null;
  if (!slug) return "";

  const { data: tok } = await svc
    .from("client_hub_tokens")
    .select("token")
    .eq("cliente_id", clienteId)
    .eq("conta_id", contaId)
    .eq("is_active", true)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const token = (tok as { token: string | null } | null)?.token ?? null;
  if (!token) return "";

  const featureOn = await effectivePlanFeature(svc, contaId, "feature_hub_portal");
  if (!featureOn) return "";

  return buildHubUrl(appBaseUrl(), slug, token);
}
