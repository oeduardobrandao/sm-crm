import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const RESOURCE_COLUMNS = [
  "max_clients", "max_team_members", "max_workflow_templates",
  "max_active_workflows_per_client", "max_instagram_accounts", "max_leads",
  "max_hub_tokens", "storage_quota_bytes", "max_custom_properties_per_template",
  "max_posts_per_workflow", "max_workspaces_per_user",
] as const;

const FEATURE_COLUMNS = [
  "feature_instagram", "feature_instagram_ai", "feature_analytics_reports",
  "feature_best_times", "feature_audience_demographics", "feature_hub_portal",
  "feature_leads", "feature_financial", "feature_contracts", "feature_ideas",
  "feature_workflow_gantt", "feature_workflow_recurrence", "feature_csv_import",
  "feature_custom_properties", "feature_post_scheduling", "feature_auto_sync_cron",
  "feature_post_tagging", "feature_brand_customization",
] as const;

const RATE_COLUMNS = [
  "rate_instagram_syncs_per_day", "rate_ai_analyses_per_month",
  "rate_report_generations_per_month",
] as const;

type PlanRow = Record<string, unknown>;

function extractLimits(plan: PlanRow): Record<string, number | null> {
  const limits: Record<string, number | null> = {};
  for (const col of [...RESOURCE_COLUMNS, ...RATE_COLUMNS]) {
    limits[col] = (plan[col] as number | null) ?? null;
  }
  return limits;
}

function extractFeatures(plan: PlanRow): Record<string, boolean> {
  const features: Record<string, boolean> = {};
  for (const col of FEATURE_COLUMNS) {
    features[col] = (plan[col] as boolean) ?? false;
  }
  return features;
}

Deno.serve(async (req: Request) => {
  const corsHeaders = buildCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const headers = { "Content-Type": "application/json", ...corsHeaders };

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers });
    }

    const token = authHeader.replace("Bearer ", "");
    const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: { user }, error: authError } = await svc.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers });
    }

    const { data: profile } = await svc
      .from("profiles")
      .select("conta_id")
      .eq("id", user.id)
      .single();

    if (!profile?.conta_id) {
      return new Response(JSON.stringify({
        plan_name: null,
        limits: null,
        features: null,
      }), { status: 200, headers });
    }

    const workspaceId = profile.conta_id;

    const { data: override } = await svc
      .from("workspace_plan_overrides")
      .select("plan_id, resource_overrides, feature_overrides")
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    let plan: PlanRow | null = null;

    if (override) {
      const { data: planData } = await svc
        .from("plans")
        .select("*")
        .eq("id", override.plan_id)
        .single();
      plan = planData;
    } else {
      const { data: defaultPlan } = await svc
        .from("plans")
        .select("*")
        .eq("is_default", true)
        .maybeSingle();
      plan = defaultPlan;
    }

    if (!plan) {
      return new Response(JSON.stringify({
        plan_name: null,
        limits: null,
        features: null,
      }), { status: 200, headers });
    }

    const resolvedLimits = { ...extractLimits(plan), ...(override?.resource_overrides || {}) };
    const resolvedFeatures = { ...extractFeatures(plan), ...(override?.feature_overrides || {}) };

    return new Response(JSON.stringify({
      plan_name: plan.name as string,
      limits: resolvedLimits,
      features: resolvedFeatures,
    }), { status: 200, headers });
  } catch (err) {
    console.error("[workspace-limits] error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500, headers });
  }
});
