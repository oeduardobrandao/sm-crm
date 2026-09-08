export type WorkspaceRole = "owner" | "admin" | "agent";

export interface PendingWorkspaceInviteInput {
  contaId: string;
  email: string;
  role: WorkspaceRole;
  invitedBy: string;
  redirectTo: string;
  membroId?: number | null;
  /** Custom workspace_roles.id, when the caller picked a granular role.
   * Stamped on the created invites row; deliberately NOT threaded into
   * sendAuthInvite's user_metadata (that stays the legacy role display). */
  roleId?: string | null;
}

export interface PendingWorkspaceInviteDeps {
  createPendingInvite(
    input: Omit<PendingWorkspaceInviteInput, "redirectTo">,
  ): Promise<{ id: string }>;
  sendAuthInvite(input: PendingWorkspaceInviteInput): Promise<void>;
  deletePendingInvite(id: string): Promise<void>;
}

export async function sendPendingWorkspaceInvite(
  deps: PendingWorkspaceInviteDeps,
  input: PendingWorkspaceInviteInput,
): Promise<string> {
  const invite = await deps.createPendingInvite(input);
  try {
    await deps.sendAuthInvite(input);
    return invite.id;
  } catch (error) {
    try {
      await deps.deletePendingInvite(invite.id);
    } catch (cleanupError) {
      console.error("[invite-user] pending invite cleanup failed", cleanupError);
    }
    throw error;
  }
}
