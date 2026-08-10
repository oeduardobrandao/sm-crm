import { entitlementMessage, mapEntitlementError } from '../../lib/entitlement-errors';
import { computeEffectiveInviteStatus } from '../configuracao/inviteHelpers';

export type SeatStatus = 'loading' | 'unavailable' | 'unlimited' | 'ok' | 'full';

export interface SeatState {
  status: SeatStatus;
  used: number;
  limit: number | null;
  remaining: number | null;
}

/**
 * Seat usage = workspace users + pending invites, against max_team_members.
 * `limits === null` from useWorkspaceLimits is ambiguous (loading, fetch
 * failure, or unlimited plan): unlimited is ONLY the isUnlimited flag or an
 * explicit max_team_members null; anything else unresolved is 'unavailable'
 * so the invite switch never enables on a failed limits fetch.
 */
export function computeSeatState(args: {
  isLoading: boolean;
  isUnlimited: boolean;
  maxTeamMembers: number | null | undefined;
  membersCount: number;
  pendingCount: number;
}): SeatState {
  const used = args.membersCount + args.pendingCount;
  if (args.isLoading) return { status: 'loading', used, limit: null, remaining: null };
  if (args.isUnlimited || args.maxTeamMembers === null) {
    return { status: 'unlimited', used, limit: null, remaining: null };
  }
  if (args.maxTeamMembers === undefined) {
    return { status: 'unavailable', used, limit: null, remaining: null };
  }
  const remaining = Math.max(0, args.maxTeamMembers - used);
  return {
    status: remaining <= 0 ? 'full' : 'ok',
    used,
    limit: args.maxTeamMembers,
    remaining,
  };
}

/**
 * Pending-invite rows split for the Equipe page. `display` hides invites whose
 * expires_at already passed (they must not RENDER as pending); `seatCount` is
 * the RAW row count, because the server seat pre-check (_shared/
 * invite-actions.ts) counts every status='pending' row regardless of expiry:
 * an expired-but-unprocessed invite still consumes a seat until revoked or
 * replaced. Counting filtered here would show capacity the server refuses.
 */
export function derivePendingInvites<T extends { status: string; expires_at?: string | null }>(
  rows: T[],
): { display: T[]; seatCount: number } {
  return {
    display: computeEffectiveInviteStatus(rows).filter((i) => i.status === 'pending'),
    seatCount: rows.length,
  };
}

/** Toast copy when the membro saved but the invite call failed. */
export function membroInviteErrorMessage(err: unknown): string {
  const mapped = mapEntitlementError(err);
  const detail = mapped
    ? entitlementMessage(mapped)
    : err instanceof Error && err.message
      ? err.message
      : 'erro desconhecido';
  return `Membro salvo, mas o convite falhou: ${detail}`;
}
