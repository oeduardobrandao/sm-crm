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
