import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

    // Get user's active workspace
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

    // Check for workspace-specific plan assignment
    const { data: override } = await svc
      .from("workspace_plan_overrides")
      .select("plan_id, resource_overrides, feature_overrides")
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    let plan = null;

    if (override) {
      const { data: planData } = await svc
        .from("plans")
        .select("name, resource_limits, feature_flags")
        .eq("id", override.plan_id)
        .single();
      plan = planData;
    } else {
      // Fallback to default plan
      const { data: defaultPlan } = await svc
        .from("plans")
        .select("name, resource_limits, feature_flags")
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

    const resolvedLimits = { ...plan.resource_limits, ...(override?.resource_overrides || {}) };
    const resolvedFeatures = { ...plan.feature_flags, ...(override?.feature_overrides || {}) };

    return new Response(JSON.stringify({
      plan_name: plan.name,
      limits: resolvedLimits,
      features: resolvedFeatures,
    }), { status: 200, headers });
  } catch (err) {
    console.error("[workspace-limits] error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500, headers });
  }
});
