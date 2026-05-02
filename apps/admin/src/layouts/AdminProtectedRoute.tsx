import { Navigate } from 'react-router-dom';
import { ReactNode } from 'react';
import { useAdminAuth } from '../context/AdminAuthContext';

export default function AdminProtectedRoute({ children }: { children: ReactNode }) {
  const { user, isAdmin, loading } = useAdminAuth();

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'hsl(220 14% 4%)' }}>
        <div style={{ width: 24, height: 24, border: '2px solid #333', borderTopColor: '#eab308', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (!user || !isAdmin) {
    return <Navigate to="/admin/login" replace />;
  }

  return <>{children}</>;
}
