import { createClient } from "npm:@supabase/supabase-js@2";
import { getAuthStatesByEmails, cancelInvite, inviteOrResend } from "../_shared/invite-actions.ts";
import { insertAuditLog } from "../_shared/audit.ts";
import { computeInviteFlags, resendMessage, validateResendTarget } from "./invites-enrich.ts";

export async function handleGetWorkspaceInvites(
  svc: ReturnType<typeof createClient>,
  body: { workspace_id?: string },
  headers: Record<string, string>,
) {
  if (!body.workspace_id) {
    return new Response(JSON.stringify({ error: "workspace_id is required" }), { status: 400, headers });
  }
  const { count } = await svc.from("invites")
    .select("*", { count: "exact", head: true }).eq("conta_id", body.workspace_id);
  const { data: rows, error } = await svc.from("invites")
    .select("id, email, role, status, created_at, accepted_at, expires_at, invited_by")
    .eq("conta_id", body.workspace_id)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;

  const invites = rows ?? [];
  const states = await getAuthStatesByEmails(svc, invites.map((r) => r.email));

  // Which of these users are members of THIS workspace?
  const userIds = [...states.values()].map((s) => s.user_id);
  const memberIds = new Set<string>();
  if (userIds.length) {
    const { data: members } = await svc.from("workspace_members")
      .select("user_id").eq("workspace_id", body.workspace_id).in("user_id", userIds);
    for (const m of members ?? []) memberIds.add(m.user_id);
  }

  const enriched = invites.map((r) => {
    const auth = states.get(r.email.toLowerCase()) ?? null;
    const flags = computeInviteFlags(r); // link_expired from the invite's own created_at
    return {
      ...r,
      silent_add: flags.silent_add,
      link_expired: flags.link_expired,
      auth_state: auth ? { ...auth, is_member: memberIds.has(auth.user_id) } : null,
    };
  });

  return new Response(JSON.stringify({ invites: enriched, total: count ?? enriched.length }), { status: 200, headers });
}

export async function handleAdminCancelInvite(
  svc: ReturnType<typeof createClient>,
  body: { workspace_id?: string; invite_id?: string },
  adminUserId: string,
  headers: Record<string, string>,
) {
  if (!body.workspace_id || !body.invite_id) {
    return new Response(JSON.stringify({ error: "workspace_id and invite_id are required" }), { status: 400, headers });
  }
  let result;
  try {
    result = await cancelInvite(svc, { inviteId: body.invite_id, contaId: body.workspace_id });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === "invite_not_found") {
      return new Response(JSON.stringify({ error: "Invite not found" }), { status: 404, headers });
    }
    if (msg === "invite_not_cancellable") {
      return new Response(JSON.stringify({ error: "Only pending or expired invites can be cancelled" }), { status: 400, headers });
    }
    throw err;
  }

  const operationId = crypto.randomUUID();
  for (const wsId of result.affectedWorkspaceIds) {
    await insertAuditLog(svc, {
      action: "admin-cancel-invite",
      conta_id: wsId,
      actor_user_id: adminUserId,
      resource_type: "invite",
      resource_id: body.invite_id,
      metadata: { email: result.email, operation_id: operationId, deleted_user: result.deletedUser },
    });
  }

  return new Response(JSON.stringify({ success: true, deleted_user: result.deletedUser }), { status: 200, headers });
}

export async function handleAdminResendInvite(
  svc: ReturnType<typeof createClient>,
  body: { workspace_id?: string; invite_id?: string },
  adminUserId: string,
  headers: Record<string, string>,
) {
  if (!body.workspace_id || !body.invite_id) {
    return new Response(JSON.stringify({ error: "workspace_id and invite_id are required" }), { status: 400, headers });
  }

  const { data: invite } = await svc.from("invites")
    .select("id, conta_id, email, role, status, invited_by")
    .eq("id", body.invite_id).eq("conta_id", body.workspace_id).maybeSingle();
  const invalid = validateResendTarget(invite);
  if (invalid) {
    return new Response(JSON.stringify({ error: invalid.error }), { status: invalid.status, headers });
  }
  // validateResendTarget returned null ⇒ invite is present and resendable.
  // Re-assert for the type-checker (it does not narrow through the helper).
  if (!invite) {
    return new Response(JSON.stringify({ error: "Invite not found" }), { status: 404, headers });
  }

  const redirectBase = Deno.env.get("OAUTH_REDIRECT_BASE") || "http://localhost:5173";
  const outcome = await inviteOrResend(svc, {
    contaId: invite.conta_id,
    email: invite.email,
    role: invite.role,
    invitedBy: invite.invited_by, // preserve the ORIGINAL inviter
    redirectBase,
  }, { addOnboarded: false }); // admin resend never adds a member (finding 1)

  const mapped = resendMessage(outcome.route);
  if (mapped.status < 300) {
    // The reinvited route may have deleted a never-confirmed user from other
    // workspaces — audit each affected workspace, sharing one operation_id
    // (finding 5, symmetric with cancel). Other routes affect only this one.
    const operationId = crypto.randomUUID();
    const workspaces = outcome.affectedWorkspaceIds?.length
      ? outcome.affectedWorkspaceIds
      : [body.workspace_id];
    for (const wsId of workspaces) {
      await insertAuditLog(svc, {
        action: "admin-resend-invite",
        conta_id: wsId,
        actor_user_id: adminUserId,
        resource_type: "invite",
        resource_id: body.invite_id,
        metadata: { email: invite.email, route: outcome.route, operation_id: operationId },
      });
    }
  }
  return new Response(JSON.stringify(mapped.body), { status: mapped.status, headers });
}
