// deno-lint-ignore-file no-explicit-any
export interface RemoveMemberInput {
  targetUserId: string;
  workspaceId: string;
}

/**
 * Dependency-injected so it can be tested behaviourally, mirroring
 * setFinancialAccess.ts in this same folder.
 *
 * Removing a user from a workspace must only touch their
 * `active_workspace_id`/`conta_id` when THAT workspace was their current
 * active one. Unconditionally recomputing it (the prior behaviour) meant
 * removing someone from a workspace they weren't even actively working in
 * could silently switch them away from wherever they were -- and, worse, a
 * later silent re-add never restored it, leaving a live session that every
 * RLS-gated query returns empty for (see invite-actions.ts's add-direct
 * restore fix, the other half of this bug).
 */
export async function removeMember(client: any, input: RemoveMemberInput): Promise<{ removed: true }> {
  const { error: removeError } = await client
    .from("workspace_members")
    .delete()
    .eq("user_id", input.targetUserId)
    .eq("workspace_id", input.workspaceId);
  if (removeError) throw removeError;

  const { data: profile } = await client
    .from("profiles")
    .select("active_workspace_id")
    .eq("id", input.targetUserId)
    .maybeSingle();

  if (profile?.active_workspace_id !== input.workspaceId) {
    // Their active workspace is unaffected by this removal -- leave it alone.
    return { removed: true };
  }

  const { data: otherMembership } = await client
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", input.targetUserId)
    .limit(1)
    .maybeSingle();

  const { error: updateError } = await client
    .from("profiles")
    .update({
      active_workspace_id: otherMembership?.workspace_id || null,
      conta_id: otherMembership?.workspace_id || null,
    })
    .eq("id", input.targetUserId);
  if (updateError) throw updateError;

  return { removed: true };
}
