import { Navigate, useLocation } from 'react-router-dom';
import { ReactNode } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useWorkspaceLimits } from '../../hooks/useWorkspaceLimits';
import { Spinner } from '@/components/ui/spinner';
import { UpgradeLockedScreen } from '@/components/paywall/UpgradeLockedScreen';
import { resolveRouteGate } from './routePermissions';
import { isLayoutGuardedPath } from './AppLayout';

const FEATURE_GATED: Record<string, { flag: string; label: string }> = {
  '/analytics': { flag: 'feature_analytics_reports', label: 'Relatórios e Analytics' },
  '/analytics-fluxos': { flag: 'feature_analytics_reports', label: 'Relatórios e Analytics' },
  '/relatorios': { flag: 'feature_analytics_reports', label: 'Relatórios e Analytics' },
  '/leads': { flag: 'feature_leads', label: 'Leads' },
  '/financeiro': { flag: 'feature_financial', label: 'Financeiro' },
  '/contratos': { flag: 'feature_contracts', label: 'Contratos' },
  '/ideias': { flag: 'feature_ideas', label: 'Ideias' },
  '/post-express': { flag: 'feature_post_scheduling', label: 'Agendamento de Posts' },
  '/mensagens': { flag: 'feature_mensagens', label: 'Mensagens' },
};

export default function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, profile, role, can, loading } = useAuth();
  const location = useLocation();
  const { features, isLoading: limitsLoading, isUnlimited } = useWorkspaceLimits();

  if (loading || limitsLoading) {
    return (
      <div
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}
      >
        <Spinner size="lg" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // App.tsx declares routes lowercase with no `caseSensitive`, so React Router
  // matches `/Financeiro` to the same page as `/financeiro`. Lowercase the
  // pathname before matching here too, or a capitalized URL bypasses both the
  // feature gate and the permission gate below.
  const pathname = location.pathname.toLowerCase();

  // Permission gate runs BEFORE the feature-gate loop below, on purpose: this
  // restores the ordering the pre-permission-model `AGENT_BLOCKED` check had
  // (it ran before FEATURE_GATED too). With the loop first, a role without
  // access to a route that is ALSO feature-gated (e.g. an agent at `/leads`
  // on a plan with `feature_leads` off) would see the upgrade screen instead
  // of being redirected -- a regression nothing exercised before this file
  // grew a `can()`-based gate. See ProtectedRoute.test.tsx's "ordering" test.
  //
  // `/financeiro` and `/contratos` are EXEMPT from this gate entirely: they
  // are `AppLayout`'s territory, via its own three-state guards
  // (`financialGuardOutcome` / `contractGuardOutcome`, content/loading/denied
  // -> `FinancialRestrictionScreen`), which already fully decide access for
  // EVERY role -- including a restricted admin, who this gate would
  // otherwise redirect to /dashboard, silently replacing that dedicated
  // screen with a bare bounce. Each of the two now reads its OWN capability
  // (`financeiro:ver` / `contratos:ver`); letting `resolveRouteGate` still
  // classify both paths keeps `nav-data.ts` and the route table honest, and
  // only the ENFORCEMENT here is skipped. See `isLayoutGuardedPath` in
  // `AppLayout.tsx`.
  if (!isLayoutGuardedPath(pathname)) {
    const gate = resolveRouteGate(pathname);
    if (gate === 'unmapped') {
      if (import.meta.env.DEV) {
        console.error(`[ProtectedRoute] rota sem entrada no mapa de permissões: ${pathname}`);
      }
      return <Navigate to="/dashboard" replace />;
    }
    if (gate !== 'open') {
      const allowed = can(gate.module, gate.action);
      // 'unknown' falha NEUTRO (render): igual ao guard financeiro do AppLayout.
      if (allowed === false) return <Navigate to="/dashboard" replace />;
    }
  }

  if (!isUnlimited && features) {
    for (const [path, { flag, label }] of Object.entries(FEATURE_GATED)) {
      if (pathname.startsWith(path) && features[flag as keyof typeof features] === false) {
        return <UpgradeLockedScreen featureLabel={label} feature={flag} />;
      }
    }
  }

  const needsSetup =
    role === 'owner' &&
    profile !== null &&
    !(profile as any).empresa &&
    location.pathname !== '/workspace-setup';

  if (needsSetup) {
    return <Navigate to="/workspace-setup" replace />;
  }

  return <>{children}</>;
}
