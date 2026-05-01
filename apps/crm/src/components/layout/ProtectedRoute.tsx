import { Navigate, useLocation } from 'react-router-dom';
import { ReactNode } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useWorkspaceLimits } from '../../hooks/useWorkspaceLimits';
import { Spinner } from '@/components/ui/spinner';

const AGENT_BLOCKED = ['/financeiro', '/contratos', '/leads', '/equipe'];

const FEATURE_GATED: Record<string, string> = {
  '/analytics': 'analytics',
  '/post-express': 'post_express',
  '/ideias': 'ideias',
};

export default function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, profile, role, loading } = useAuth();
  const location = useLocation();
  const { features, isLoading: limitsLoading, isUnlimited } = useWorkspaceLimits();

  if (loading || limitsLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <Spinner size="lg" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (role === 'agent' && AGENT_BLOCKED.some(p => location.pathname.startsWith(p))) {
    return <Navigate to="/dashboard" replace />;
  }

  if (!isUnlimited && features) {
    for (const [path, flag] of Object.entries(FEATURE_GATED)) {
      if (location.pathname.startsWith(path) && features[flag as keyof typeof features] === false) {
        return <Navigate to="/dashboard" replace />;
      }
    }
  }

  const needsSetup = role === 'owner'
    && profile !== null
    && !(profile as any).empresa
    && location.pathname !== '/workspace-setup';

  if (needsSetup) {
    return <Navigate to="/workspace-setup" replace />;
  }

  return <>{children}</>;
}
