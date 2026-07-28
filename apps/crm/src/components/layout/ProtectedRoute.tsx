import { Navigate, useLocation } from 'react-router-dom';
import { ReactNode } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useWorkspaceLimits } from '../../hooks/useWorkspaceLimits';
import { Spinner } from '@/components/ui/spinner';
import { UpgradeLockedScreen } from '@/components/paywall/UpgradeLockedScreen';

const AGENT_BLOCKED = ['/financeiro', '/contratos', '/leads', '/equipe'];

const FEATURE_GATED: Record<string, { flag: string; label: string }> = {
  '/analytics': { flag: 'feature_analytics_reports', label: 'Relatórios e Analytics' },
  '/analytics-fluxos': { flag: 'feature_analytics_reports', label: 'Relatórios e Analytics' },
  '/leads': { flag: 'feature_leads', label: 'Leads' },
  '/financeiro': { flag: 'feature_financial', label: 'Financeiro' },
  '/contratos': { flag: 'feature_contracts', label: 'Contratos' },
  '/ideias': { flag: 'feature_ideas', label: 'Ideias' },
  '/post-express': { flag: 'feature_post_scheduling', label: 'Agendamento de Posts' },
};

export default function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, profile, role, loading } = useAuth();
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

  // React Router matches routes case-insensitively by default (no `caseSensitive`
  // prop is set in App.tsx), so `/Financeiro` renders the same page as
  // `/financeiro` while `location.pathname` keeps the literal casing the user
  // typed. Comparing that raw pathname against lowercase literals below is
  // bypassable (e.g. an agent hitting `/Financeiro` would skip the guard) — do
  // not "simplify" this back to `location.pathname`.
  const pathname = location.pathname.toLowerCase();

  if (role === 'agent' && AGENT_BLOCKED.some((p) => pathname.startsWith(p))) {
    return <Navigate to="/dashboard" replace />;
  }

  if (!isUnlimited && features) {
    for (const [path, { flag, label }] of Object.entries(FEATURE_GATED)) {
      if (pathname.startsWith(path) && features[flag as keyof typeof features] === false) {
        return <UpgradeLockedScreen featureLabel={label} />;
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
