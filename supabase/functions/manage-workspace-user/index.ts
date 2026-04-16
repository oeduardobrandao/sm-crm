import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { insertAuditLog } from "../_shared/audit.ts";

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
    const { action, targetUserId, role, inviteId } = body;

    // --- Accept Invite (called by the invited user themselves) ---
    if (action === "accept-invite") {
      const { email } = body;
      if (!email) {
        return new Response(JSON.stringify({ error: "email is required" }), { status: 400, headers });
      }
      // Mark all pending invites for this email+workspace as accepted
      const { error: acceptError } = await serviceClient
        .from("invites")
        .update({ status: "accepted", accepted_at: new Date().toISOString() })
        .eq("email", email.toLowerCase())
        .eq("status", "pending")
        .eq("conta_id", callerProfile.conta_id);

      if (acceptError) throw acceptError;

      await insertAuditLog(serviceClient, {
        conta_id: callerProfile.conta_id,
        actor_user_id: user.id,
        action: 'accept-invite',
        resource_type: 'invite',
        metadata: { email: email },
      });

      return new Response(JSON.stringify({ message: "Convite aceito." }), { status: 200, headers });
    }

    // --- Cancel Invite (does not require targetUserId) ---
    if (action === "cancel-invite") {
      if (!inviteId) {
        return new Response(JSON.stringify({ error: "inviteId is required" }), { status: 400, headers });
      }
      // Verify invite belongs to caller's workspace
      const { data: invite, error: inviteError } = await serviceClient
        .from("invites")
        .select("id, conta_id, status")
        .eq("id", inviteId)
        .single();

      if (inviteError || !invite) {
        return new Response(JSON.stringify({ error: "Convite não encontrado." }), { status: 404, headers });
      }
      if (invite.conta_id !== callerProfile.conta_id) {
        return new Response(JSON.stringify({ error: "Convite não pertence a este workspace." }), { status: 403, headers });
      }
      if (invite.status !== "pending") {
        return new Response(JSON.stringify({ error: "Convite não está pendente." }), { status: 400, headers });
      }

      const { error: cancelError } = await serviceClient
        .from("invites")
        .update({ status: "expired" })
        .eq("id", inviteId);

      if (cancelError) throw cancelError;

      return new Response(JSON.stringify({ message: "Convite cancelado." }), { status: 200, headers });
    }

    if (!targetUserId) {
      return new Response(JSON.stringify({ error: "targetUserId is required" }), { status: 400, headers });
    }

    // Verify target user belongs to the same workspace (via workspace_members)
    const { data: targetMembership, error: targetError } = await serviceClient
      .from("workspace_members")
      .select("role, workspace_id")
      .eq("user_id", targetUserId)
      .eq("workspace_id", callerProfile.conta_id)
      .single();

    if (targetError || !targetMembership) {
      return new Response(JSON.stringify({ error: "Target user not found in this workspace" }), { status: 404, headers });
    }

    // Cannot modify an owner (unless caller is also owner)
    if (targetMembership.role === "owner" && callerProfile.role !== "owner") {
      return new Response(JSON.stringify({ error: "Cannot modify workspace owner" }), { status: 403, headers });
    }

    // Cannot modify yourself
    if (targetUserId === user.id) {
      return new Response(JSON.stringify({ error: "Cannot modify your own account" }), { status: 400, headers });
    }

    if (action === "update-role") {
      const ALLOWED_ROLES = ["owner", "admin", "agent"];
      if (!role || !ALLOWED_ROLES.includes(role)) {
        return new Response(JSON.stringify({ error: "role must be one of: owner, admin, agent" }), { status: 400, headers });
      }
      // Only owner can assign owner role
      if (role === "owner" && callerProfile.role !== "owner") {
        return new Response(JSON.stringify({ error: "Only owner can assign owner role" }), { status: 403, headers });
      }

      const { error: updateError } = await serviceClient
        .from("workspace_members")
        .update({ role })
        .eq("user_id", targetUserId)
        .eq("workspace_id", callerProfile.conta_id);

      if (updateError) throw updateError;

      // Sync role to profiles so the app picks it up immediately
      const { error: profileUpdateError } = await serviceClient
        .from("profiles")
        .update({ role })
        .eq("id", targetUserId)
        .eq("conta_id", callerProfile.conta_id);

      if (profileUpdateError) throw profileUpdateError;

      await insertAuditLog(serviceClient, {
        conta_id: callerProfile.conta_id,
        actor_user_id: user.id,
        action: 'update-role',
        resource_type: 'workspace_member',
        resource_id: targetUserId,
        metadata: { new_role: role, workspace_id: callerProfile.conta_id },
      });

      return new Response(JSON.stringify({ message: "Permissão atualizada com sucesso." }), { status: 200, headers });

    } else if (action === "remove") {
      // Remove from workspace_members
      const { error: removeError } = await serviceClient
        .from("workspace_members")
        .delete()
        .eq("user_id", targetUserId)
        .eq("workspace_id", callerProfile.conta_id);

      if (removeError) throw removeError;

      // If user's active_workspace_id was this workspace, switch to another or null
      const { data: otherMembership } = await serviceClient
        .from("workspace_members")
        .select("workspace_id")
        .eq("user_id", targetUserId)
        .limit(1)
        .maybeSingle();

      await serviceClient
        .from("profiles")
        .update({
          active_workspace_id: otherMembership?.workspace_id || null,
          conta_id: otherMembership?.workspace_id || null,
        })
        .eq("id", targetUserId);

      await insertAuditLog(serviceClient, {
        conta_id: callerProfile.conta_id,
        actor_user_id: user.id,
        action: 'remove-user',
        resource_type: 'workspace_member',
        resource_id: targetUserId,
        metadata: { workspace_id: callerProfile.conta_id },
      });

      return new Response(JSON.stringify({ message: "Usuário removido do workspace." }), { status: 200, headers });

    } else {
      return new Response(JSON.stringify({ error: "Invalid action. Use 'update-role', 'remove', 'cancel-invite', or 'accept-invite'." }), { status: 400, headers });
    }

  } catch (err: unknown) {
    console.error('[manage-workspace-user] error:', err);
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500, headers });
  }
});
