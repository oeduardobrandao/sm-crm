import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';

interface NavItem { id: string; route: string; label: string; icon: string; }
interface NavGroup { id: string; label: string; icon: string; items: NavItem[]; isBottom?: boolean; }

const ALL_NAV_GROUPS: NavGroup[] = [
  {
    id: 'visao-geral', label: 'Visão Geral', icon: 'ph-squares-four', items: [
      { id: 'dashboard', route: '/dashboard', label: 'Dashboard', icon: 'ph-chart-pie-slice' },
      { id: 'calendario', route: '/calendario', label: 'Calendário', icon: 'ph-calendar-blank' },
    ]
  },
  {
    id: 'crm', label: 'CRM', icon: 'ph-users', items: [
      { id: 'leads', route: '/leads', label: 'Leads', icon: 'ph-funnel' },
      { id: 'clientes', route: '/clientes', label: 'Clientes', icon: 'ph-users' },
    ]
  },
  {
    id: 'gestao', label: 'Gestão', icon: 'ph-folder', items: [
      { id: 'entregas', route: '/entregas', label: 'Entregas', icon: 'ph-kanban' },
      { id: 'financeiro', route: '/financeiro', label: 'Financeiro', icon: 'ph-wallet' },
      { id: 'contratos', route: '/contratos', label: 'Contratos', icon: 'ph-file-text' },
      { id: 'equipe', route: '/equipe', label: 'Equipe', icon: 'ph-user-circle-gear' },
    ]
  },
  {
    id: 'analytics-group', label: 'Analytics', icon: 'ph-chart-line-up', items: [
      { id: 'analytics', route: '/analytics', label: 'Instagram', icon: 'ph-instagram-logo' },
      { id: 'analytics-fluxos', route: '/analytics-fluxos', label: 'Fluxos', icon: 'ph-flow-arrow' },
    ]
  },
  {
    id: 'plataforma', label: 'Plataforma', icon: 'ph-plugs-connected', items: [
      { id: 'integracoes', route: '/integracoes', label: 'Integrações', icon: 'ph-plugs-connected' },
    ]
  },
  {
    id: 'config', label: 'Configurações', icon: 'ph-gear', isBottom: true, items: [
      { id: 'configuracao', route: '/configuracao', label: 'Configurações', icon: 'ph-gear' },
      { id: 'politica-de-privacidade', route: '/politica-de-privacidade', label: 'Privacidade', icon: 'ph-shield-check' },
    ]
  },
];

function getNavGroups(role: string): NavGroup[] {
  if (role !== 'agent') return ALL_NAV_GROUPS;
  return ALL_NAV_GROUPS
    .filter(g => g.id !== 'crm')
    .map(g => g.id === 'gestao'
      ? { ...g, items: g.items.filter(i => i.id !== 'financeiro' && i.id !== 'contratos') }
      : g
    );
}

export default function Sidebar() {
  const { user, profile, role, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [openGroupId, setOpenGroupId] = useState<string | null>(null);
  const [isDark, setIsDark] = useState(document.documentElement.getAttribute('data-theme') === 'dark');
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [workspaces, setWorkspaces] = useState<any[]>([]);

  const navGroups = getNavGroups(role);

  // Determine active group from current route
  const activeRoute = location.pathname;
  const activeGroupId = navGroups.find(g => g.items.some(i => activeRoute.startsWith(i.route)))?.id ?? null;

  // Load workspaces for switcher
  useEffect(() => {
    if (!user) return;
    supabase
      .from('workspace_members')
      .select('workspace_id, role, workspaces!inner(id, name)')
      .eq('user_id', user.id)
      .then(({ data }) => {
        if (data && data.length > 1) setWorkspaces(data);
      });
  }, [user?.id]);

  const toggleTheme = () => {
    const next = isDark ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next === 'dark' ? 'dark' : '');
    if (next === 'light') document.documentElement.removeAttribute('data-theme');
    localStorage.setItem('theme', next);
    setIsDark(next === 'dark');
  };

  const handleGroupClick = (groupId: string) => {
    setOpenGroupId(prev => prev === groupId ? null : groupId);
  };

  const handleNavClick = (route: string) => {
    navigate(route);
    setOpenGroupId(null);
  };

  const handleWorkspaceSwitch = async (workspaceId: string) => {
    if (!user) return;
    await supabase
      .from('profiles')
      .update({ active_workspace_id: workspaceId, conta_id: workspaceId })
      .eq('id', user.id);
    window.location.reload();
  };

  const initials = profile?.nome
    ? profile.nome.split(' ').map((w: string) => w?.[0] || '').join('').substring(0, 2).toUpperCase()
    : 'U';

  const mainGroups = navGroups.filter(g => !g.isBottom);
  const bottomGroups = navGroups.filter(g => g.isBottom);

  return (
    <nav className="sidebar" id="sidebar">
      <div className="sidebar-rail">
        <div className="logo-container" style={{ height: 64, display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', marginBottom: '1.5rem' }}>
          <a href="#" onClick={(e) => { e.preventDefault(); navigate('/dashboard'); }} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none' }}>
            <img src="/icon.svg" alt="Mesaas" className="rail-logo" style={{ height: 20, width: 'auto' }} />
          </a>
        </div>

        <ul className="rail-nav" id="rail-nav-main">
          {mainGroups.map(group => (
            <li key={group.id} className="rail-item">
              <button
                className={`rail-icon-btn${openGroupId === group.id || (!openGroupId && activeGroupId === group.id) ? ' active' : ''}`}
                data-group-id={group.id}
                data-tooltip={group.label}
                data-tooltip-dir="right"
                aria-expanded={openGroupId === group.id}
                onClick={() => handleGroupClick(group.id)}
              >
                <i className={`ph ${group.icon}`} />
              </button>
            </li>
          ))}
        </ul>

        <div className="rail-bottom">
          <ul className="rail-nav" id="rail-nav-bottom">
            {bottomGroups.map(group => (
              <li key={group.id} className="rail-item">
                <button
                  className={`rail-icon-btn${openGroupId === group.id || (!openGroupId && activeGroupId === group.id) ? ' active' : ''}`}
                  data-group-id={group.id}
                  data-tooltip={group.label}
                  data-tooltip-dir="right"
                  aria-expanded={openGroupId === group.id}
                  onClick={() => handleGroupClick(group.id)}
                >
                  <i className={`ph ${group.icon}`} />
                </button>
              </li>
            ))}
          </ul>

          <button
            id="theme-toggle"
            className="rail-icon-btn"
            title="Alternar Tema"
            data-tooltip={isDark ? 'Modo Claro' : 'Modo Escuro'}
            data-tooltip-dir="right"
            style={{ marginBottom: '0.5rem' }}
            onClick={toggleTheme}
          >
            <i className={`ph ${isDark ? 'ph-sun' : 'ph-moon'}`} />
          </button>

          <div
            className="sidebar-user"
            id="user-menu-btn"
            tabIndex={0}
            data-tooltip="Sua Conta"
            data-tooltip-dir="right"
            onClick={() => setUserMenuOpen(v => !v)}
            onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setUserMenuOpen(false); }}
          >
            <div className="avatar" style={{ width: 38, height: 38, borderRadius: 10, fontSize: '0.85rem' }}>
              {initials}
            </div>

            {userMenuOpen && (
              <div className="user-dropdown">
                <div className="user-dropdown-header">Opções da Conta</div>

                {workspaces.length > 1 && (
                  <div style={{ padding: '0.25rem 0', borderBottom: '1px solid var(--border-color)', marginBottom: '0.25rem' }}>
                    <div style={{ padding: '0.25rem 0.75rem', fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      Workspace
                    </div>
                    {workspaces.map((m: any) => {
                      const isActive = m.workspaces.id === (profile?.active_workspace_id || profile?.conta_id);
                      return (
                        <button
                          key={m.workspaces.id}
                          className="user-dropdown-item"
                          style={{ width: '100%', border: 'none', background: 'transparent', textAlign: 'left', fontFamily: 'inherit', fontSize: 'inherit', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: isActive ? 600 : undefined, color: isActive ? 'var(--primary-color)' : undefined }}
                          onClick={() => !isActive && handleWorkspaceSwitch(m.workspaces.id)}
                        >
                          <i className={`ph ${isActive ? 'ph-check-circle' : 'ph-circle'}`} />
                          <span>{m.workspaces.name || 'Workspace'}</span>
                        </button>
                      );
                    })}
                  </div>
                )}

                <button
                  id="btn-logout-flutuante"
                  className="user-dropdown-item text-danger"
                  style={{ width: '100%', border: 'none', background: 'transparent', textAlign: 'left', fontFamily: 'inherit', fontSize: 'inherit', cursor: 'pointer' }}
                  onClick={signOut}
                >
                  <i className="ph ph-sign-out" /> Sair
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Flyout panel */}
      <div className={`sidebar-flyout${openGroupId ? ' open' : ''}`} id="sidebar-flyout" aria-hidden={!openGroupId}>
        {openGroupId && (() => {
          const group = navGroups.find(g => g.id === openGroupId);
          if (!group) return null;
          return (
            <>
              <div className="flyout-header">
                <h2 id="flyout-title">{group.label}</h2>
              </div>
              <div className="flyout-content">
                <ul className="flyout-menu" id="flyout-menu">
                  {group.items.map(item => (
                    <li key={item.id}>
                      <a
                        className={`flyout-link${activeRoute.startsWith(item.route) ? ' active' : ''}`}
                        href={`#${item.route}`}
                        data-route={item.route}
                        aria-current={activeRoute.startsWith(item.route) ? 'page' : undefined}
                        onClick={(e) => { e.preventDefault(); handleNavClick(item.route); }}
                      >
                        <i className={`ph ${item.icon}`} /> <span>{item.label}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          );
        })()}
      </div>
    </nav>
  );
}
