import { toast } from 'sonner';
import { mapEntitlementError, entitlementMessage } from './entitlement-errors';
import { reportPaywallHit } from './paywall-report';

/**
 * If `err` is an entitlement error, shows an upgrade toast and returns true.
 * Owners get a "Fazer upgrade" action to /configuracao/cobranca; non-owner copy
 * is handled by the upgrade-unlock screen (Plan 2) — here we always offer the link,
 * since only owners trigger plan-limited create flows in practice.
 *
 * Also records feature denials for the `paywall_hit` marketing trigger. This is
 * the ONLY observation point for the trigger-based gates in
 * 20260611140003_feature_triggers.sql (hub portal, ideias, financial, contracts,
 * leads, brand, custom properties): those are DB triggers fired by direct client
 * writes, with no edge function in the path. FeatureGate covers only
 * feature_csv_import and feature_mcp.
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
