import { useEffect } from 'react';
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { UserX } from 'lucide-react';
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

  // Wait for the session/profile before deciding anything: rendering the
  // strip early would flash the agent-sized set of tabs at an owner, and the
  // guard below would bounce them off a tab they are allowed to see.
  if (loading || !user) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <Spinner size="lg" />
      </div>
    );
  }

  // `workspaceRole` is null here in exactly one real case: the membership
  // lookup RESOLVED (loading is already false, and that flag only flips once
  // the lookup has settled) but found no row for the active workspace. Live
  // revocation now also produces this mid-session when the caller is removed
  // from the workspace. Gating the spinner above on `workspaceRole === null`
  // too -- as this used to -- left a removed user spinning forever with no
  // explanation, since nothing was ever going to make workspaceRole non-null
  // again.
  if (workspaceRole === null) {
    return (
      <div className="page-content">
        <div className="card" style={{ maxWidth: 480, margin: '3rem auto', textAlign: 'center' }}>
          <UserX size={40} style={{ color: 'var(--text-muted)', marginBottom: '1rem' }} />
          <h3 style={{ marginBottom: '0.75rem' }}>Sem acesso a este workspace</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            Você não tem mais acesso a este workspace. Fale com o proprietário se acha que isso é um
            engano.
          </p>
        </div>
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
