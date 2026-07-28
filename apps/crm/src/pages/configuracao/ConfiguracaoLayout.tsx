import { useEffect } from 'react';
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Spinner } from '@/components/ui/spinner';
import { useAuth } from '../../context/AuthContext';
import { visibleConfigTabs, canAccessConfigTab } from './configTabs';

/**
 * Shell for /configuracao/*: page title plus the tab strip, with each tab a real
 * route so a tab is deep-linkable and survives a refresh.
 */
export default function ConfiguracaoLayout() {
  const { user, workspaceRole, loading } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  useEffect(() => {
    if (!loading && !user) navigate('/login');
  }, [loading, user, navigate]);

  // Wait for the role before deciding anything: rendering the strip early would
  // flash the agent-sized set of tabs at an owner, and the guard below would
  // bounce them off a tab they are allowed to see.
  if (loading || !user || workspaceRole === null) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <Spinner size="lg" />
      </div>
    );
  }

  const tabs = visibleConfigTabs(workspaceRole);
  const current = pathname.replace(/^\/configuracao\/?/, '').split('/')[0];

  if (current && !canAccessConfigTab(current, workspaceRole)) {
    return <Navigate to="/configuracao/perfil" replace />;
  }

  return (
    <div className="page-content" style={{ maxWidth: 1040, margin: '0 auto' }}>
      <div className="header-title" style={{ marginBottom: '1.25rem' }}>
        <h1>Configurações</h1>
      </div>

      {/* A single visible tab is not a choice — don't render a strip for it. */}
      {tabs.length > 1 && (
        <nav className="page-tabs" aria-label="Seções de configurações">
          {tabs.map((tab) => (
            <NavLink
              key={tab.path}
              to={tab.path}
              className={({ isActive }) => `page-tab${isActive ? ' active' : ''}`}
            >
              {tab.label}
            </NavLink>
          ))}
        </nav>
      )}

      <Outlet />
    </div>
  );
}
