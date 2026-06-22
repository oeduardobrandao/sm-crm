import { SupabaseClient } from "npm:@supabase/supabase-js@2";

export const RESOURCE_COLUMNS = [
  "max_clients", "max_team_members", "max_workflow_templates",
  "max_active_workflows_per_client", "max_instagram_accounts", "max_leads",
  "max_hub_tokens", "storage_quota_bytes", "max_custom_properties_per_template",
  "max_posts_per_workflow", "max_workspaces_per_user", "max_mcp_keys",
] as const;
export const RATE_COLUMNS = [
  "rate_instagram_syncs_per_day", "rate_ai_analyses_per_month",
  "rate_report_generations_per_month",
] as const;
export const FEATURE_COLUMNS = [
  "feature_instagram", "feature_instagram_ai", "feature_analytics_reports",
  "feature_best_times", "feature_audience_demographics", "feature_hub_portal",
  "feature_leads", "feature_financial", "feature_contracts", "feature_ideas",
  "feature_workflow_gantt", "feature_workflow_recurrence", "feature_csv_import",
  "feature_custom_properties", "feature_post_scheduling", "feature_auto_sync_cron",
  "feature_post_tagging", "feature_brand_customization", "feature_mcp",
] as const;

type PlanRow = Record<string, unknown>;
export interface Entitlements {
  planName: string | null;
  limits: Record<string, number | null>;
  features: Record<string, boolean>;
}

export function mergeEntitlements(
  plan: PlanRow,
  resourceOverrides: Record<string, number> | null,
  featureOverrides: Record<string, boolean> | null,
): Entitlements {
  const limits: Record<string, number | null> = {};
  for (const col of [...RESOURCE_COLUMNS, ...RATE_COLUMNS]) {
    limits[col] = (plan[col] as number | null) ?? null;
  }
  const features: Record<string, boolean> = {};
  for (const col of FEATURE_COLUMNS) {
    features[col] = (plan[col] as boolean) ?? false;
  }
  return {
    planName: (plan.name as string) ?? null,
    limits: { ...limits, ...(resourceOverrides ?? {}) },
    features: { ...features, ...(featureOverrides ?? {}) },
  };
}

/** Resolves a workspace's effective entitlements (plan + overrides). null plan => all-null. */
export async function resolveEntitlements(
  svc: SupabaseClient, workspaceId: string,
): Promise<Entitlements | null> {
  const { data: ws } = await svc.from("workspaces").select("plan_id").eq("id", workspaceId).single();
  const { data: override } = await svc.from("workspace_plan_overrides")
    .select("resource_overrides, feature_overrides").eq("workspace_id", workspaceId).maybeSingle();
  let plan: PlanRow | null = null;
  if (ws?.plan_id) {
    const { data } = await svc.from("plans").select("*").eq("id", ws.plan_id).single();
    plan = data;
  } else {
    const { data } = await svc.from("plans").select("*").eq("is_default", true).maybeSingle();
    plan = data;
  }
  if (!plan) return null;
  return mergeEntitlements(plan, override?.resource_overrides ?? null, override?.feature_overrides ?? null);
}

export class FeatureDisabledError extends Error {
  constructor(public feature: string) { super(`feature_disabled:${feature}`); }
}

/** Throws FeatureDisabledError if the workspace's effective plan lacks `flag`. */
export async function assertPlanFeature(
  svc: SupabaseClient, workspaceId: string, flag: string,
): Promise<void> {
  const ent = await resolveEntitlements(svc, workspaceId);
  if (!ent || ent.features[flag] !== true) throw new FeatureDisabledError(flag);
}

/** Standard 403 JSON body for a disabled feature. */
export function featureDisabledResponse(flag: string, headers: Record<string, string>): Response {
  return new Response(JSON.stringify({ error: "feature_disabled", feature: flag }),
    { status: 403, headers });
}
