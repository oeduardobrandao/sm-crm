import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  };

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers });
    }

    // Verify the caller is authenticated and has owner/admin role
    const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await anonClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers });
    }

    const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Get caller's profile to check role and conta_id
    const { data: callerProfile, error: profileError } = await serviceClient
      .from("profiles")
      .select("role, conta_id")
      .eq("id", user.id)
      .single();

    if (profileError || !callerProfile) {
      return new Response(JSON.stringify({ error: "Profile not found" }), { status: 403, headers });
    }

    if (callerProfile.role !== "owner" && callerProfile.role !== "admin") {
      return new Response(JSON.stringify({ error: "Insufficient permissions" }), { status: 403, headers });
    }

    const body = await req.json();
    const { action, targetUserId, role } = body;

    if (!targetUserId) {
      return new Response(JSON.stringify({ error: "targetUserId is required" }), { status: 400, headers });
    }

    // Verify target user belongs to the same workspace
    const { data: targetProfile, error: targetError } = await serviceClient
      .from("profiles")
      .select("role, conta_id")
      .eq("id", targetUserId)
      .single();

    if (targetError || !targetProfile) {
      return new Response(JSON.stringify({ error: "Target user not found" }), { status: 404, headers });
    }

    if (targetProfile.conta_id !== callerProfile.conta_id) {
      return new Response(JSON.stringify({ error: "Target user not in same workspace" }), { status: 403, headers });
    }

    // Cannot modify an owner (unless caller is also owner)
    if (targetProfile.role === "owner" && callerProfile.role !== "owner") {
      return new Response(JSON.stringify({ error: "Cannot modify workspace owner" }), { status: 403, headers });
    }

    // Cannot modify yourself
    if (targetUserId === user.id) {
      return new Response(JSON.stringify({ error: "Cannot modify your own account" }), { status: 400, headers });
    }

    if (action === "update-role") {
      if (!role) {
        return new Response(JSON.stringify({ error: "role is required" }), { status: 400, headers });
      }
      // Only owner can assign owner role
      if (role === "owner" && callerProfile.role !== "owner") {
        return new Response(JSON.stringify({ error: "Only owner can assign owner role" }), { status: 403, headers });
      }

      const { error: updateError } = await serviceClient
        .from("profiles")
        .update({ role })
        .eq("id", targetUserId);

      if (updateError) throw updateError;

      return new Response(JSON.stringify({ message: "Permissão atualizada com sucesso." }), { status: 200, headers });

    } else if (action === "remove") {
      const { error: removeError } = await serviceClient
        .from("profiles")
        .update({ conta_id: null })
        .eq("id", targetUserId);

      if (removeError) throw removeError;

      return new Response(JSON.stringify({ message: "Usuário removido do workspace." }), { status: 200, headers });

    } else {
      return new Response(JSON.stringify({ error: "Invalid action. Use 'update-role' or 'remove'." }), { status: 400, headers });
    }

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return new Response(JSON.stringify({ error: message }), { status: 500, headers });
  }
});
