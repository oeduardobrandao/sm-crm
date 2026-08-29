import { ReactNode, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { Button } from '@/components/ui/button';
import { reportPaywallHit } from '../../lib/paywall-report';

/**
 * Route-level paywall. `feature` is optional so existing callers that only have
 * a label keep working, but ProtectedRoute passes it: this screen is the FIRST
 * and, for most gated routes, the ONLY place a denial is observable.
 *
 * The DB triggers in 20260611140003_feature_triggers.sql fire on writes to
 * ideias / transacoes / contratos / leads, but ProtectedRoute already sends a
 * user whose flag is off to this screen, so in the ordinary case they never
 * reach the page that performs the write. The per-page catch-site reporting is
 * the backstop for the stale-entitlement window (flag flips mid-session, or the
 * workspace is `isUnlimited` and skips this gate); THIS is the common path.
 */
export function UpgradeLockedScreen({
  featureLabel,
  feature,
  children,
}: {
  featureLabel: string;
  feature?: string;
  children?: ReactNode;
}) {
  const navigate = useNavigate();
  // workspaceRole (workspace_members do workspace ATIVO), não `role`:
  // profiles.role fica obsoleto após trocar de workspace (contrato documentado
  // no AuthContext). null (não resolvido) falha fechado como não-owner.
  const { workspaceRole, profile } = useAuth();
  const isOwner = workspaceRole === 'owner';
  const workspaceId = profile?.conta_id ?? null;

  // Reported from an effect, not during render, and deduped per session inside
  // reportPaywallHit — same reasoning as FeatureGate: render stays side-effect
  // free and StrictMode's double-invoke is absorbed.
  useEffect(() => {
    if (feature && workspaceId) reportPaywallHit({ workspaceId, feature });
  }, [feature, workspaceId]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center gap-3 p-8">
      <h1 className="text-xl font-bold">{featureLabel} não está no seu plano</h1>
      {children}
      {isOwner ? (
        <>
          <p className="text-muted-foreground">Faça upgrade para desbloquear este recurso.</p>
          <Button
            onClick={() => {
              // An upgrade CLICK is strictly higher intent than a render and is
              // never swallowed by the render dedupe.
              if (feature && workspaceId) {
                reportPaywallHit({ workspaceId, feature, clickedUpgrade: true });
              }
              navigate('/configuracao/cobranca');
            }}
          >
            Fazer upgrade
          </Button>
        </>
      ) : (
        <p className="text-muted-foreground">
          Fale com o dono do workspace para liberar este recurso.
        </p>
      )}
    </div>
  );
}
