import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { insertAuditLog } from "../_shared/audit.ts";
import { handleSetFinancialAccess } from "./setFinancialAccess.ts";
import { removeMember } from "./removeMember.ts";
import { resolveRoleUpdate, UUID_RE } from "./roleUpdate.ts";
import { hasPermissionFor } from "../_shared/permissions.ts";

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

    const body = await req.json();
    const { action, targetUserId, role, roleId, inviteId } = body;

    // --- Accept Invite (called by the invited user themselves, any role) ---
    if (action === "accept-invite") {
      const { data: acceptedRows, error: acceptError } = await serviceClient.rpc(
        "accept_workspace_invite",
        { p_user_id: user.id },
      );

      if (acceptError) {
        if (acceptError.code === "P0002" || acceptError.message === "invite_not_found") {
          return new Response(
            JSON.stringify({ error: "Convite não encontrado ou expirado." }),
            { status: 404, headers },
          );
        }
        throw acceptError;
      }

      const accepted = Array.isArray(acceptedRows) ? acceptedRows[0] : acceptedRows;
      if (!accepted) {
        return new Response(
          JSON.stringify({ error: "Convite não encontrado ou expirado." }),
          { status: 404, headers },
        );
      }

      await insertAuditLog(serviceClient, {
        conta_id: accepted.conta_id,
        actor_user_id: user.id,
        action: 'accept-invite',
        resource_type: 'invite',
        resource_id: accepted.invite_id,
        metadata: {
          email: accepted.email,
          role: accepted.role,
          already_accepted: accepted.already_accepted,
        },
      });

      return new Response(JSON.stringify({ message: "Convite aceito." }), { status: 200, headers });
    }

    // --- Set Financial Access (owner-only) ---
    //
    // Wired here, BEFORE the profiles-based caller resolution below: that
    // resolution reads profiles.role, which goes stale on workspace switch
    // (no switch path writes it). This action must not inherit that stale-role
    // check — the owner check happens inside the RPC, against
    // workspace_members, which is always current.
    if (action === "set-financial-access") {
      const { value } = body;
      if (typeof value !== "boolean") {
        return new Response(JSON.stringify({ error: "value must be a boolean" }), { status: 400, headers });
      }
      if (!targetUserId) {
        return new Response(JSON.stringify({ error: "targetUserId is required" }), { status: 400, headers });
      }

      // Resolve the workspace from the caller's own membership, not profiles.
      const { data: prof } = await serviceClient
        .from("profiles").select("active_workspace_id").eq("id", user.id).single();
      const workspaceId = prof?.active_workspace_id;
      if (!workspaceId) {
        return new Response(JSON.stringify({ error: "Workspace não encontrado." }), { status: 403, headers });
      }

      const result = await handleSetFinancialAccess(serviceClient, {
        actorUserId: user.id,
        targetUserId,
        workspaceId,
        value,
      });
      return new Response(
        JSON.stringify(result.status === 200 ? { message: result.message, changed: result.changed } : { error: result.message }),
        { status: result.status, headers },
      );
    }

    // All administrative actions below are scoped to the caller's current
    // workspace, resolved from their MEMBERSHIP rather than from profiles.
    //
    // profiles.role is global, not per-workspace: switching workspaces never
    // rewrites it, so an owner in workspace A who is an agent in workspace B
    // kept `owner` while working in B. profiles.conta_id was worse still --
    // until 20260729000002 the client could write it directly, so both the role
    // and the workspace this function trusted were attacker-controlled, and it
    // acts through a service-role client that bypasses RLS entirely.
    //
    // This mirrors set-financial-access above, which already does it correctly.
    const { data: callerProfile, error: profileError } = await serviceClient
      .from("profiles")
      .select("active_workspace_id")
      .eq("id", user.id)
      .single();

    if (profileError || !callerProfile?.active_workspace_id) {
      return new Response(JSON.stringify({ error: "Profile not found" }), { status: 403, headers });
    }
    const workspaceId = callerProfile.active_workspace_id;

    const { data: callerMembership, error: membershipError } = await serviceClient
      .from("workspace_members")
      .select("role")
      .eq("user_id", user.id)
      .eq("workspace_id", workspaceId)
      .single();

    if (membershipError || !callerMembership) {
      return new Response(JSON.stringify({ error: "Insufficient permissions" }), { status: 403, headers });
    }

    // callerRole stays loaded for the owner-protection guards below (only
    // owner assigns owner, an owner target can't be touched by a non-owner);
    // the ACTOR gate itself is now the permission model, not a role literal.
    const callerRole = callerMembership.role;
    const canManageTeam = await hasPermissionFor(serviceClient, user.id, workspaceId, "equipe", "editar");
    if (!canManageTeam) {
      return new Response(JSON.stringify({ error: "Insufficient permissions" }), { status: 403, headers });
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
      if (invite.conta_id !== workspaceId) {
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
      .eq("workspace_id", workspaceId)
      .single();

    if (targetError || !targetMembership) {
      return new Response(JSON.stringify({ error: "Target user not found in this workspace" }), { status: 404, headers });
    }

    // Cannot modify an owner (unless caller is also owner)
    if (targetMembership.role === "owner" && callerRole !== "owner") {
      return new Response(JSON.stringify({ error: "Cannot modify workspace owner" }), { status: 403, headers });
    }

    // Cannot modify yourself
    if (targetUserId === user.id) {
      return new Response(JSON.stringify({ error: "Cannot modify your own account" }), { status: 400, headers });
    }

    if (action === "update-role") {
      // roleId (custom role) resolves to a workspace_roles row scoped to this
      // workspace before the pure decision function runs -- only bother with
      // the lookup when it looks like a real UUID, matching the
      // manage-workspace-roles/handler.ts UUID_RE idiom.
      let targetRoleRow: { id: string; nome: string } | null = null;
      if (typeof roleId === "string" && UUID_RE.test(roleId)) {
        const { data: roleRow } = await serviceClient
          .from("workspace_roles")
          .select("id, nome")
          .eq("id", roleId)
          .eq("conta_id", workspaceId)
          .maybeSingle();
        targetRoleRow = roleRow ?? null;
      }

      const result = resolveRoleUpdate({ role, roleId, callerRole, targetRoleRow });
      if ("error" in result) {
        return new Response(JSON.stringify({ error: result.error }), { status: result.status, headers });
      }

      const { error: updateError } = await serviceClient
        .from("workspace_members")
        .update(result.update)
        .eq("user_id", targetUserId)
        .eq("workspace_id", workspaceId);

      if (updateError) throw updateError;

      // Sync role to profiles so the app picks it up immediately
      const { error: profileUpdateError } = await serviceClient
        .from("profiles")
        .update({ role: result.profileRole })
        .eq("id", targetUserId)
        .eq("conta_id", workspaceId);

      if (profileUpdateError) throw profileUpdateError;

      await insertAuditLog(serviceClient, {
        conta_id: workspaceId,
        actor_user_id: user.id,
        action: 'update-role',
        resource_type: 'workspace_member',
        resource_id: targetUserId,
        metadata: { ...result.audit, workspace_id: workspaceId },
      });

      return new Response(JSON.stringify({ message: "Permissão atualizada com sucesso." }), { status: 200, headers });

    } else if (action === "remove") {
      await removeMember(serviceClient, { targetUserId, workspaceId });

      await insertAuditLog(serviceClient, {
        conta_id: workspaceId,
        actor_user_id: user.id,
        action: 'remove-user',
        resource_type: 'workspace_member',
        resource_id: targetUserId,
        metadata: { workspace_id: workspaceId },
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
