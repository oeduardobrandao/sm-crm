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

/**
 * Remove financial keys from a write payload when the caller lacks access.
 *
 * OMITS the key rather than nulling or zeroing it, so the database write guard
 * sees no financial column in the statement at all and lets ordinary edits
 * through. Hiding the input alone is insufficient — the forms send a literal `0`
 * for a blank field.
 */
export function stripFinancialFields<T extends Record<string, unknown>>(
  payload: T,
  access: FinancialAccess,
  keys: string[],
): Partial<T> {
  if (access === true) return payload;
  const out = { ...payload };
  for (const k of keys) delete out[k];
  return out;
}

/**
 * Reject a CSV import that carries a protected column the caller cannot write.
 *
 * MUST be called on the parsed rows BEFORE the first insert. Both importers loop
 * row-by-row with no enclosing transaction, so a per-row check would commit
 * every preceding row before failing.
 *
 * Rejects the whole file rather than silently stripping: stripping reports
 * success while discarding exactly the data the user believed they imported.
 */
export function assertNoFinancialColumns(
  rows: Record<string, unknown>[],
  access: FinancialAccess,
  keys: string[],
): void {
  if (access === true) return;
  const present = keys.filter((k) => rows.some((r) => k in r));
  if (present.length > 0) {
    throw new Error(
      `Importação cancelada: seu acesso não permite enviar a coluna "${present.join('", "')}". ` +
        `Remova-a do arquivo e tente novamente. Nenhum registro foi importado.`,
    );
  }
}
