// deno-lint-ignore-file no-explicit-any

/**
 * Caller resolution for the active-workspace model. profiles.role and
 * profiles.conta_id go stale after a workspace switch; authority must come
 * from workspace_members for profiles.active_workspace_id (same rule
 * manage-workspace-user documents).
 */
export interface ActiveCaller {
  workspaceId: string;
  role: "owner" | "admin" | "agent";
}

export async function resolveActiveCaller(
  adminClient: any,
  userId: string,
): Promise<ActiveCaller | null> {
  const { data: prof } = await adminClient
    .from("profiles").select("active_workspace_id").eq("id", userId).maybeSingle();
  const workspaceId = prof?.active_workspace_id;
  if (!workspaceId) return null;
  const { data: membership } = await adminClient
    .from("workspace_members").select("role")
    .eq("user_id", userId).eq("workspace_id", workspaceId).maybeSingle();
  if (!membership?.role) return null;
  return { workspaceId, role: membership.role };
}

export type MembroValidation =
  | { ok: true }
  | { ok: false; reason: "not_found" | "already_linked" | "pending_conflict" | "membro_has_pending" };

/**
 * Pre-invite validation for a membroId sent from the Equipe form.
 * - not_found also covers a membro from another workspace (no detail leak).
 * - pending_conflict: this email's pending invite points at a DIFFERENT
 *   membro; proceeding would silently transfer the link (spec rule).
 * - membro_has_pending: this membro already has a pending invite to a
 *   different email; two pending invites racing for one membro is refused.
 */
export async function validateMembroForInvite(
  adminClient: any,
  args: { membroId: number; workspaceId: string; email: string },
): Promise<MembroValidation> {
  const { data: membro } = await adminClient
    .from("membros").select("id, conta_id, crm_user_id")
    .eq("id", args.membroId).eq("conta_id", args.workspaceId).maybeSingle();
  if (!membro) return { ok: false, reason: "not_found" };
  if (membro.crm_user_id) return { ok: false, reason: "already_linked" };

  const { data: emailConflict } = await adminClient
    .from("invites").select("id")
    .eq("conta_id", args.workspaceId).eq("email", args.email).eq("status", "pending")
    .not("membro_id", "is", null).neq("membro_id", args.membroId).maybeSingle();
  if (emailConflict) return { ok: false, reason: "pending_conflict" };

  const { data: membroConflict } = await adminClient
    .from("invites").select("id")
    .eq("conta_id", args.workspaceId).eq("membro_id", args.membroId).eq("status", "pending")
    .neq("email", args.email).maybeSingle();
  if (membroConflict) return { ok: false, reason: "membro_has_pending" };

  return { ok: true };
}
