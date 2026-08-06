import { Fragment, useEffect } from 'react';
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { UserX, AlertTriangle } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { useAuth } from '../../context/AuthContext';
import { visibleConfigTabs, canAccessConfigTab } from './configTabs';

/**
 * Shell for /configuracao/*: page title plus the tab strip, with each tab a real
 * route so a tab is deep-linkable and survives a refresh.
 */
export default function ConfiguracaoLayout() {
  const { user, workspaceRole, membershipResolved, loading } = useAuth();
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

  // `workspaceRole` is null here in two DIFFERENT real cases, and
  // `membershipResolved` (see AuthContext.tsx) is what tells them apart:
  //
  //   - membershipResolved === true: the membership lookup RESOLVED (loading
  //     is already false, and that flag only flips once the lookup has
  //     settled) and genuinely found no row for the active workspace. Live
  //     revocation produces this mid-session too, when the caller is removed
  //     from the workspace. This is the only case that should ever show the
  //     definitive "removed" copy below.
  //   - membershipResolved === 'error' (or, defensively, anything other than
  //     `true`): the lookup THREW -- a network/RLS blip, not a resolved
  //     answer. Showing the "removed" card here would tell a real member
  //     they've been kicked out over a transient error. Gating the spinner
  //     above on `workspaceRole === null` instead of `loading` -- as this
  //     used to -- left a removed user spinning forever with no explanation,
  //     since nothing was ever going to make workspaceRole non-null again;
  //     so this branch must render SOMETHING, just not the definitive claim.
  if (workspaceRole === null && membershipResolved === true) {
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

  if (workspaceRole === null) {
    return (
      <div className="page-content">
        <div className="card" style={{ maxWidth: 480, margin: '3rem auto', textAlign: 'center' }}>
          <AlertTriangle size={40} style={{ color: 'var(--warning)', marginBottom: '1rem' }} />
          <h3 style={{ marginBottom: '0.75rem' }}>Não foi possível confirmar seu acesso</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1rem' }}>
            Houve um problema ao verificar seu acesso a este workspace. Isso costuma ser temporário
            — tente novamente.
          </p>
          <button className="btn-secondary" onClick={() => window.location.reload()}>
            Tentar novamente
          </button>
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
    <div className="page-content config-page">
      <div className="config-shell">
        <header className="config-shell-header">
          <h1>Configurações</h1>
        </header>

        <div className={`config-shell-body${tabs.length > 1 ? '' : ' config-shell-body--single'}`}>
          {/* A single visible tab is not a choice — don't render a nav for it. */}
          {tabs.length > 1 && (
            <nav className="config-nav" aria-label="Seções de configurações">
              {tabs.map((tab, i) => {
                const Icon = tab.icon;
                const startsGroup = i === 0 || tabs[i - 1].group !== tab.group;
                return (
                  <Fragment key={tab.path}>
                    {startsGroup && <span className="config-nav-label">{tab.group}</span>}
                    <NavLink
                      to={tab.path}
                      className={({ isActive }) => `config-nav-item${isActive ? ' active' : ''}`}
                    >
                      <Icon aria-hidden="true" />
                      {tab.label}
                    </NavLink>
                  </Fragment>
                );
              })}
            </nav>
          )}

          <div className="config-shell-content">
            <Outlet />
          </div>
        </div>
      </div>
    </div>
  );
}
