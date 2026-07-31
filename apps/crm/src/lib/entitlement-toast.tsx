import { toast } from 'sonner';
import { mapEntitlementError, entitlementMessage } from './entitlement-errors';
import { reportPaywallHit } from './paywall-report';

/**
 * If `err` is an entitlement error, shows an upgrade toast and returns true.
 * Owners get a "Fazer upgrade" action to /configuracao/cobranca; non-owner copy
 * is handled by the upgrade-unlock screen (Plan 2) — here we always offer the link,
 * since only owners trigger plan-limited create flows in practice.
 *
 * Also records feature denials for the `paywall_hit` marketing trigger.
 *
 * Wiring this into App.tsx's global MutationCache.onError covers far less than
 * it looks: useMutation exists at only seven non-test CRM call sites, and NONE
 * of them is a trigger-gated surface. The gates in
 * 20260611140003_feature_triggers.sql fire on direct client writes made from
 * plain store/*.ts functions in event handlers, which never reach the mutation
 * cache. So this function is called EXPLICITLY from each gated catch block --
 * HubTab (hub token, brand save, logo upload), LeadsPage, FinanceiroPage,
 * ContratosPage, PropertyDefinitionPanel. Do not delete those calls as
 * redundant with the global hook; the global hook does not see them.
 *
 * For feature_brand_customization and feature_custom_properties the catch site
 * is the ONLY observation point. For leads/financial/contracts it is the
 * stale-entitlement backstop -- ProtectedRoute's UpgradeLockedScreen reports
 * the common case, before the user can reach the write at all.
 *
 * Limit errors are deliberately NOT reported: limit gates are slice 2.
 */
export function handleEntitlementMutationError(err: unknown, workspaceId: string | null): boolean {
  const mapped = mapEntitlementError(err);
  if (!mapped) return false;

  if (mapped.kind === 'feature' && workspaceId) {
    reportPaywallHit({ workspaceId, feature: mapped.key });
  }

  toast.error(entitlementMessage(mapped), {
    action: {
      label: 'Fazer upgrade',
      onClick: () => {
        window.location.href = '/configuracao/cobranca';
      },
    },
  });
  return true;
}
