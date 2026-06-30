export interface SeatsBlock {
  included: number | null;
  purchased: number;
  effective: number | null;
  used: number;
}

/**
 * Pure assembler for the workspace-limits `seats` block.
 * `included` = plan base max_team_members (override-agnostic plan column).
 * `purchased` = workspace_subscriptions.purchased_seats (EXTRA seats).
 * `effective` = effective_plan_limit('max_team_members') (NULL = unlimited).
 * `used` = active members + pending invites (matches the invite gate's count).
 */
export function buildSeatsBlock(args: {
  includedSeats: number | null;
  purchasedSeats: number;
  effectiveSeats: number | null;
  members: number;
  pendingInvites: number;
}): SeatsBlock {
  return {
    included: args.includedSeats,
    purchased: args.purchasedSeats ?? 0,
    effective: args.effectiveSeats,
    used: (args.members ?? 0) + (args.pendingInvites ?? 0),
  };
}
