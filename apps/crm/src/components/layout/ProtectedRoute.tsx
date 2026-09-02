import { Navigate, useLocation } from 'react-router-dom';
import { ReactNode } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useWorkspaceLimits } from '../../hooks/useWorkspaceLimits';
import { Spinner } from '@/components/ui/spinner';
import { UpgradeLockedScreen } from '@/components/paywall/UpgradeLockedScreen';
import { resolveRouteGate } from './routePermissions';

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

  if (!isUnlimited && features) {
    for (const [path, { flag, label }] of Object.entries(FEATURE_GATED)) {
      if (pathname.startsWith(path) && features[flag as keyof typeof features] === false) {
        return <UpgradeLockedScreen featureLabel={label} feature={flag} />;
      }
    }
  }

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
