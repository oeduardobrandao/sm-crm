import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { handleRoleAction } from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

Deno.serve(async (req: Request) => {
  const corsHeaders = buildCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const headers = {
    "Content-Type": "application/json",
    ...corsHeaders,
  };

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers });
    }

    const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await anonClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers });
    }

    const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Workspace resolved from the caller's profile, as manage-workspace-user
    // does. Ownership itself is NOT checked here — create/update/delete_workspace_role
    // are the single source of truth for that (they resolve the actor's role
    // from workspace_members and raise not_owner), so this function only
    // forwards the RPC's verdict instead of keeping a second, driftable copy
    // of the check.
    const { data: callerProfile, error: profileError } = await serviceClient
      .from("profiles")
      .select("active_workspace_id")
      .eq("id", user.id)
      .single();

    if (profileError || !callerProfile?.active_workspace_id) {
      return new Response(JSON.stringify({ error: "Profile not found" }), { status: 403, headers });
    }
    const workspaceId = callerProfile.active_workspace_id;

    const body = await req.json();

    const result = await handleRoleAction(
      { svc: serviceClient },
      { userId: user.id, workspaceId, body },
    );

    return new Response(JSON.stringify(result.body), { status: result.status, headers });
  } catch (err: unknown) {
    console.error("[manage-workspace-roles] error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500, headers });
  }
});
