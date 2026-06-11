import { toast } from 'sonner';
import { mapEntitlementError, entitlementMessage } from './entitlement-errors';

/**
 * If `err` is an entitlement error, shows an upgrade toast and returns true.
 * Owners get a "Fazer upgrade" action to /configuracao/cobranca; non-owner copy
 * is handled by the upgrade-unlock screen (Plan 2) — here we always offer the link,
 * since only owners trigger plan-limited create flows in practice.
 */
export function handleEntitlementMutationError(err: unknown): boolean {
  const mapped = mapEntitlementError(err);
  if (!mapped) return false;
  toast.error(entitlementMessage(mapped), {
    action: { label: 'Fazer upgrade', onClick: () => { window.location.href = '/configuracao/cobranca'; } },
  });
  return true;
}
