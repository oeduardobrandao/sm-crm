import { Navigate, useLocation } from 'react-router-dom';
import { ReactNode } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Spinner } from '@/components/ui/spinner';

const AGENT_BLOCKED = ['/financeiro', '/contratos', '/leads', '/clientes'];

export default function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, role, loading } = useAuth();
  const location = useLocation();

  if (loading) {
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

  return <>{children}</>;
}
