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
      { id: 'ideias', route: '/ideias', label: 'Ideias', icon: 'ph-lightbulb' },
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
    .map(g => {
      if (g.id === 'crm') return { ...g, items: g.items.filter(i => i.id !== 'leads') };
      if (g.id === 'gestao') return { ...g, items: g.items.filter(i => i.id !== 'financeiro' && i.id !== 'contratos') };
      return g;
    })
    .filter(g => g.items.length > 0);
}

interface SidebarProps {
  isDrawer?: boolean;
  isOpen?: boolean;
  onClose?: () => void;
}

export default function Sidebar({ isDrawer = false, isOpen = false, onClose }: SidebarProps) {
  const { user, profile, role, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [expandedGroups, setExpandedGroups] = useState<string[]>([]);
  const [isDark, setIsDark] = useState(document.documentElement.getAttribute('data-theme') === 'dark');
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [workspaces, setWorkspaces] = useState<any[]>([]);

  const navGroups = getNavGroups(role);

  // Determine active group from current route
  const activeRoute = location.pathname;
  const activeGroupId = navGroups.find(g => g.items.some(i => activeRoute.startsWith(i.route)))?.id ?? null;

  // Auto-expand active group
  useEffect(() => {
    if (activeGroupId && !expandedGroups.includes(activeGroupId)) {
      setExpandedGroups(prev => [...prev, activeGroupId]);
    }
  }, [activeGroupId]);

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

  useEffect(() => {
    if (!isDrawer || !isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isDrawer, isOpen, onClose]);

  const toggleTheme = () => {
    const next = isDark ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next === 'dark' ? 'dark' : '');
    if (next === 'light') document.documentElement.removeAttribute('data-theme');
    localStorage.setItem('theme', next);
    setIsDark(next === 'dark');
  };

  const handleGroupClick = (groupId: string) => {
    setExpandedGroups(prev => 
      prev.includes(groupId) ? prev.filter(id => id !== groupId) : [...prev, groupId]
    );
  };

  const handleNavClick = (route: string) => {
    navigate(route);
    if (isDrawer) onClose?.();
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

  const userName = profile?.nome || 'Minha Conta';

  const mainGroups = navGroups.filter(g => !g.isBottom);
  const bottomGroups = navGroups.filter(g => g.isBottom);

  return (
    <nav
      className={`sidebar${isDrawer ? ' sidebar--drawer' : ''}${isDrawer && isOpen ? ' sidebar--open' : ''}`}
      id="sidebar"
    >
      <div className="sidebar-wrapper">
        <div className="logo-container" style={{ height: 64, display: 'flex', alignItems: 'center', justifyContent: 'flex-start', paddingLeft: '1.25rem', width: '100%', marginBottom: '1.5rem', marginTop: '1rem' }}>
          <a href="#" onClick={(e) => { e.preventDefault(); navigate('/dashboard'); }} style={{ display: 'flex', alignItems: 'center', textDecoration: 'none' }}>
            <img src={isDark ? "/logo-white.svg" : "/logo-black.svg"} alt="Mesaas" className="rail-logo" style={{ height: 16, width: 'auto' }} />
          </a>
        </div>

        <div className="sidebar-scrollable">
          <ul className="sidebar-nav" id="sidebar-nav-main">
            {mainGroups.map(group => {
              const isActiveGroup = activeGroupId === group.id;
              const isExpanded = expandedGroups.includes(group.id);
              const GroupIcon = isActiveGroup ? `ph-fill ${group.icon}` : `ph ${group.icon}`;
              
              return (
                <li key={group.id} className="sidebar-item">
                  <button
                    className={`sidebar-nav-btn ${isActiveGroup ? 'active' : ''}`}
                    aria-expanded={isExpanded}
                    onClick={() => handleGroupClick(group.id)}
                  >
                    <div className="sidebar-nav-btn-content">
                      <i className={GroupIcon} />
                      <span>{group.label}</span>
                    </div>
                    {group.items.length > 0 && (
                      <i className={`ph ${isExpanded ? 'ph-caret-up' : 'ph-caret-down'} chevron-icon`} />
                    )}
                  </button>

                  {isExpanded && group.items.length > 0 && (
                    <ul className="sidebar-sub-nav">
                      {group.items.map(item => {
                        const isActiveItem = activeRoute.startsWith(item.route);
                        const ItemIcon = isActiveItem ? `ph-fill ${item.icon}` : `ph ${item.icon}`;
                        return (
                          <li key={item.id} className="sidebar-sub-item">
                            <a
                              className={`sidebar-sub-link ${isActiveItem ? 'active' : ''}`}
                              href={`#${item.route}`}
                              onClick={(e) => { e.preventDefault(); handleNavClick(item.route); }}
                            >
                              <i className={ItemIcon} />
                              <span>{item.label}</span>
                            </a>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        <div className="sidebar-bottom">
          <ul className="sidebar-nav" id="sidebar-nav-bottom">
            {bottomGroups.map(group => {
              const isActiveGroup = activeGroupId === group.id;
              const isExpanded = expandedGroups.includes(group.id);
              const GroupIcon = isActiveGroup ? `ph-fill ${group.icon}` : `ph ${group.icon}`;
              
              return (
                <li key={group.id} className="sidebar-item">
                  <button
                    className={`sidebar-nav-btn ${isActiveGroup ? 'active' : ''}`}
                    aria-expanded={isExpanded}
                    onClick={() => handleGroupClick(group.id)}
                  >
                    <div className="sidebar-nav-btn-content">
                      <i className={GroupIcon} />
                      <span>{group.label}</span>
                    </div>
                    {group.items.length > 0 && (
                      <i className={`ph ${isExpanded ? 'ph-caret-up' : 'ph-caret-down'} chevron-icon`} />
                    )}
                  </button>

                  {isExpanded && group.items.length > 0 && (
                    <ul className="sidebar-sub-nav">
                      {group.items.map(item => {
                        const isActiveItem = activeRoute.startsWith(item.route);
                        const ItemIcon = isActiveItem ? `ph-fill ${item.icon}` : `ph ${item.icon}`;
                        return (
                          <li key={item.id} className="sidebar-sub-item">
                            <a
                              className={`sidebar-sub-link ${isActiveItem ? 'active' : ''}`}
                              href={`#${item.route}`}
                              onClick={(e) => { e.preventDefault(); handleNavClick(item.route); }}
                            >
                              <i className={ItemIcon} />
                              <span>{item.label}</span>
                            </a>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>

          <button
            id="theme-toggle"
            className="sidebar-action-btn"
            title="Alternar Tema"
            onClick={toggleTheme}
          >
            <div className="sidebar-action-btn-content">
              <i className={`ph ${isDark ? 'ph-sun' : 'ph-moon'}`} />
              <span>{isDark ? 'Modo Claro' : 'Modo Escuro'}</span>
            </div>
          </button>

          <div
            className="sidebar-user-menu"
            id="user-menu-wrap"
            tabIndex={0}
            onClick={() => setUserMenuOpen(v => !v)}
            onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setUserMenuOpen(false); }}
          >
            <div className="sidebar-user-trigger">
              <div className="avatar" style={{ width: 32, height: 32, borderRadius: 8, fontSize: '0.8rem' }}>
                {initials}
              </div>
              <span className="user-name-text">{userName}</span>
              <i className={`ph ${userMenuOpen ? 'ph-caret-up' : 'ph-caret-down'}`} style={{ marginLeft: 'auto', color: 'var(--text-muted)' }} />
            </div>

            {userMenuOpen && (
              <div className="user-menu-popover">
                <div className="user-dropdown-header" style={{ padding: '0.75rem', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Opções da Conta</div>

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
                          style={{ width: '100%', border: 'none', background: 'transparent', textAlign: 'left', fontFamily: 'inherit', fontSize: '0.85rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: isActive ? 600 : 400, color: isActive ? 'var(--primary-color)' : 'var(--text-main)', padding: '0.5rem 0.75rem' }}
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
                  className="user-dropdown-item"
                  style={{ width: '100%', border: 'none', background: 'transparent', textAlign: 'left', fontFamily: 'inherit', fontSize: '0.85rem', cursor: 'pointer', color: 'var(--danger)', display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 0.75rem' }}
                  onClick={signOut}
                >
                  <i className="ph ph-sign-out" /> Sair
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}

