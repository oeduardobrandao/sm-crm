import { ReactNode, useContext, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useEntitlements } from '../../hooks/useEntitlements';
import { AuthContext } from '../../context/AuthContext';
import { reportPaywallHit } from '../../lib/paywall-report';

/** Renders children only if the feature is enabled; otherwise an inline upgrade nudge. */
export function FeatureGate({
  flag,
  label,
  children,
}: {
  flag: string;
  label?: string;
  children: ReactNode;
}) {
  const { hasFeature, isLoading } = useEntitlements();
  const navigate = useNavigate();
  // Read the context directly (not useAuth) so the gate stays usable outside
  // an AuthProvider (e.g. in isolated component tests) — mirrors the pattern
  // in hooks/useWorkspaceLimits.ts.
  const auth = useContext(AuthContext);
  const workspaceId = auth?.profile?.conta_id ?? null;
  const locked = !isLoading && !hasFeature(flag);

  // Reported from an effect, not during render: render must stay side-effect
  // free, and StrictMode double-invokes render in dev. The per-session dedupe in
  // reportPaywallHit absorbs the effect's own double-invoke.
  useEffect(() => {
    if (locked && workspaceId) reportPaywallHit({ workspaceId, feature: flag });
  }, [locked, workspaceId, flag]);

  if (isLoading || hasFeature(flag)) return <>{children}</>;
  return (
    <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
      <p>{label ?? 'Este recurso'} não está disponível no seu plano.</p>
      <button
        className="mt-2 underline text-primary"
        onClick={() => {
          if (workspaceId) {
            reportPaywallHit({ workspaceId, feature: flag, clickedUpgrade: true });
          }
          navigate('/configuracao/cobranca');
        }}
      >
        Fazer upgrade
      </button>
    </div>
  );
}
