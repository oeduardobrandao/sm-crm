import type { MyMembership } from '@/store/workspace';

/**
 * Whether the current user may see financial values.
 *
 * `'unknown'` is a real, distinct state — not a placeholder. It means the
 * membership lookup has not resolved (hydration in flight, or a transient
 * failure). A bare boolean is unsafe in both directions: defaulting `true`
 * briefly exposes restricted values from cache, defaulting `false` renders
 * restriction UI at owners.
 */
export type FinancialAccess = boolean | 'unknown';

export const MASKED_BRL = 'R$ •••••';

/**
 * Mirror of the SQL predicate `public.can_see_financials()`. Keep the two in
 * step: this is the only place the role semantics are encoded client-side.
 *
 * `can_see_financials` on the row is meaningful for admins ONLY. Owners always
 * see financials; agents never do, whatever the column says.
 */
export function deriveFinancialAccess(membership: MyMembership | null): FinancialAccess {
  if (!membership) return 'unknown';
  switch (membership.role) {
    case 'owner':
      return true;
    case 'admin':
      return membership.can_see_financials;
    default:
      // Agents, and any role added later: deny rather than fall through.
      return false;
  }
}

/**
 * Format a monetary value, masking unless access is explicitly granted.
 *
 * Fails CLOSED: anything that is not literal `true` masks, because rendering a
 * real figure to someone who may be restricted is the harm. (The route guard
 * fails *neutral* instead — see AppLayout.)
 *
 * Replaces `formatBRL` from store/core.ts, which read a mutable module global
 * (`currentUserRole`) that is not reactive and goes stale after live revocation
 * or sign-out. An explicit parameter cannot go stale.
 */
export function formatFinancialBRL(
  val: number | null | undefined,
  access: FinancialAccess,
): string {
  if (access !== true) return MASKED_BRL;
  return (val ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
