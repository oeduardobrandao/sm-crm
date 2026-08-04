// Pure authorization decisions over a workspace membership row. No Supabase/env
// dependencies — unit-testable in isolation, mirroring trial.ts.

/**
 * Whether a `workspace_members.role` value authorises owner-only actions in that
 * workspace (billing above all).
 *
 * `workspace_members(user_id, workspace_id, role)` is the per-workspace source of
 * truth. `profiles.role` is NOT: it is global, and `switch_workspace` rewrites
 * `conta_id`/`active_workspace_id` without ever touching it. A user who owns
 * workspace A and is an agent in workspace B therefore keeps `role = 'owner'`
 * while working inside B — enough, before this check existed, to open a paid
 * Stripe subscription charged to a workspace they do not own.
 *
 * `admin` is deliberately NOT an owner: admins manage people and content, not the
 * card on file. A missing membership row (null/undefined) is a non-member and is
 * refused.
 */
export function isWorkspaceOwner(membershipRole: string | null | undefined): boolean {
  return membershipRole === "owner";
}
