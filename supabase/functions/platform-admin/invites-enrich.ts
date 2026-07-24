import type { InviteOutcome, InviteRoute } from "../_shared/invite-actions.ts";

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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type CreateInviteValidation =
  | { ok: false; status: number; error: string }
  | { ok: true; workspaceId: string; email: string; role: "admin" | "agent" };

/**
 * Validate + normalise an admin-create-invite body BEFORE any DB or auth work.
 * Pure, so every branch is unit-tested without a live DB.
 *
 * The email type check is load-bearing: a truthy non-string reached
 * `email.toLowerCase()` and threw a TypeError -> opaque 500. The shape check
 * earns its keep because findAuthUserByEmail pages through EVERY auth user
 * before concluding "not found", so junk input buys a full scan. It
 * deliberately does not try to catch typos — `iara41.ia@` and `iara41.ai@` are
 * both valid addresses, which is the whole reason this panel exists.
 *
 * workspaceId is lower-cased on the success path, same as email: UUID_RE's
 * `/i` flag accepts an uppercase uuid, but Postgres returns canonical
 * lowercase for workspace_members.workspace_id and captureOrphanImpact
 * filters "other" workspaces with a JS string `!==` against contaId — an
 * un-normalised uppercase id would make the target workspace itself fail
 * that filter and count as other.
 */
export function validateCreateInvite(body: {
  workspace_id?: unknown;
  email?: unknown;
  role?: unknown;
}): CreateInviteValidation {
  const rawWorkspaceId = body.workspace_id;
  if (typeof rawWorkspaceId !== "string" || !UUID_RE.test(rawWorkspaceId)) {
    return { ok: false, status: 400, error: "workspace_id must be a valid uuid" };
  }
  const workspaceId = rawWorkspaceId.toLowerCase();
  const rawEmail = body.email;
  if (typeof rawEmail !== "string") {
    return { ok: false, status: 400, error: "A valid email is required" };
  }
  const email = rawEmail.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return { ok: false, status: 400, error: "A valid email is required" };
  }
  const role = body.role;
  // 'owner' is rejected explicitly, not merely absent from the allow-list:
  // granting ownership of a customer's workspace is billing-adjacent and does
  // not belong in a support tool.
  if (role !== "admin" && role !== "agent") {
    return { ok: false, status: 400, error: "role must be admin or agent" };
  }
  return { ok: true, workspaceId, email, role };
}

/**
 * 409 payload when a reinvite would reach other workspaces and the caller has
 * not confirmed. Null for every other route. Shared by both admin actions —
 * create and resend hit the same destructive path through the same primitive.
 * `other_workspace_count` is machine-readable on purpose: the UI names it in
 * its confirmation prompt.
 */
function confirmationRequired(
  outcome: InviteOutcome,
): { status: number; body: Record<string, unknown> } | null {
  if (outcome.route !== "needs-confirmation") return null;
  const count = outcome.affectedWorkspaceIds?.length ?? 0;
  return {
    status: 409,
    body: {
      error: "cross_workspace_confirmation_required",
      route: outcome.route,
      other_workspace_count: count,
      message:
        `This email has an unconfirmed account tied to ${count} other workspace(s). Sending will delete that account — removing its memberships and killing its pending invite links there. Nothing has been changed yet.`,
    },
  };
}

/** Map an admin-RESEND outcome, gating first. */
export function resendOutcomeMessage(outcome: InviteOutcome): { status: number; body: Record<string, unknown> } {
  return confirmationRequired(outcome) ?? resendMessage(outcome.route);
}

/**
 * Map an admin-CREATE outcome to an HTTP status + body. Delegates to
 * resendMessage for every route whose copy is already route-accurate; overrides
 * only the gate and the one line that reads wrong for a create.
 */
export function createMessage(outcome: InviteOutcome): { status: number; body: Record<string, unknown> } {
  const gate = confirmationRequired(outcome);
  if (gate) return gate;

  if (outcome.route === "already-onboarded") {
    // resendMessage says "The pending invite was left in place" — for a create
    // there was no pending invite to leave.
    return {
      status: 200,
      body: {
        success: true,
        route: outcome.route,
        message:
          "This person already has an account and was NOT added to the workspace. No invite was created.",
      },
    };
  }

  return resendMessage(outcome.route);
}
