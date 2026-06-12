import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { resolveEntitlements } from "../_shared/entitlements.ts";

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

    const ent = await resolveEntitlements(svc, workspaceId);
    if (!ent) {
      return new Response(JSON.stringify({ plan_name: null, limits: null, features: null }),
        { status: 200, headers });
    }
    return new Response(JSON.stringify({
      plan_name: ent.planName, limits: ent.limits, features: ent.features,
    }), { status: 200, headers });
  } catch (err) {
    console.error("[workspace-limits] error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500, headers });
  }
});
