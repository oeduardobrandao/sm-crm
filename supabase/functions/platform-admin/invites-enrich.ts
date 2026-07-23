import type { InviteRoute } from "../_shared/invite-actions.ts";

export interface InviteFlagInput {
  status: string;
  created_at: string;
  accepted_at: string | null;
}

const SILENT_ADD_WINDOW_MS = 2_000;
const LINK_TTL_MS = 24 * 60 * 60 * 1_000;

/**
 * silent_add: an accepted invite whose accepted_at is within 2s of created_at
 *   is the add-direct signature (member added, NO email sent).
 * link_expired: a pending invite older than 24h, measured from the invite's OWN
 *   created_at — NOT the auth user's confirmation_sent_at, which is user-global
 *   and would be refreshed by a later invite from another workspace, making an
 *   old invite look freshly sent (plan-review finding 6). An invite's link is
 *   minted when its row is created, so created_at is the correct per-invite basis.
 */
export function computeInviteFlags(
  invite: InviteFlagInput,
  now: number = Date.now(),
): { silent_add: boolean; link_expired: boolean } {
  const silent_add = invite.status === "accepted" && invite.accepted_at != null &&
    Math.abs(new Date(invite.accepted_at).getTime() - new Date(invite.created_at).getTime()) < SILENT_ADD_WINDOW_MS;
  const link_expired = invite.status === "pending" &&
    (now - new Date(invite.created_at).getTime()) > LINK_TTL_MS;
  return { silent_add, link_expired };
}

/**
 * Pre-flight for admin-resend-invite: reject a missing/wrong-workspace invite
 * (404) or an already-accepted one (400). Returns null when the invite may be
 * resent. Pure so the guard is unit-tested without a live DB.
 */
export function validateResendTarget(
  invite: { status: string } | null,
): { status: number; error: string } | null {
  if (!invite) return { status: 404, error: "Invite not found" };
  if (invite.status === "accepted") return { status: 400, error: "Cannot resend an accepted invite" };
  return null;
}

/** Map an inviteOrResend route to an admin-facing HTTP status + JSON body. */
export function resendMessage(route: InviteRoute): { status: number; body: Record<string, unknown> } {
  switch (route) {
    case "plan-limit-exceeded":
      return { status: 403, body: { error: "plan_limit_exceeded", resource: "max_team_members" } };
    case "blocked-anomalous":
      return { status: 409, body: { error: "Account has a confirmed email but no profile — resolve manually." } };
    case "already-onboarded":
      // Admin resend never adds a member (finding 1) — report and leave the invite.
      return { status: 200, body: { success: true, route, message: "This person already has an account and was NOT added to the workspace. The pending invite was left in place." } };
    case "already-member":
      return { status: 200, body: { success: true, route, message: "User is already a member of this workspace." } };
    case "resent-link":
      return { status: 200, body: { success: true, route, message: "A fresh set-password link was emailed." } };
    case "added": // only reachable via the CRM path; admin uses addOnboarded:false
    case "reinvited":
    case "invited":
    default:
      return { status: 200, body: { success: true, route, message: "Invitation email sent." } };
  }
}
