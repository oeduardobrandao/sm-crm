import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { changeLanguage, SUPPORTED_LANGUAGES } from '@mesaas/i18n';
import type { Language } from '@mesaas/i18n';
import { getNavGroups } from './nav-data';
import type { NavGroup } from './nav-data';

const LANGUAGE_FLAGS: Record<Language, string> = { pt: '\u{1F1E7}\u{1F1F7}', en: '\u{1F1FA}\u{1F1F8}' };

interface SidebarProps {
  isDrawer?: boolean;
  isOpen?: boolean;
  onClose?: () => void;
}

export default function Sidebar({ isDrawer = false, isOpen = false, onClose }: SidebarProps) {
  const { user, profile, role, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { t, i18n } = useTranslation();
  const [isDark, setIsDark] = useState(document.documentElement.getAttribute('data-theme') === 'dark');
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [workspaces, setWorkspaces] = useState<any[]>([]);

  const navGroups = getNavGroups(role);
  const activeRoute = location.pathname;

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

  const handleLanguageChange = (lang: Language) => {
    changeLanguage(lang);
  };

  const initials = profile?.nome
    ? profile.nome.split(' ').map((w: string) => w?.[0] || '').join('').substring(0, 2).toUpperCase()
    : 'U';

  const userName = profile?.nome || t('sidebar.myAccount');

  const mainGroups = navGroups.filter(g => !g.isBottom);
  const configItems = navGroups.find(g => g.id === 'config')?.items ?? [];

  const renderGroup = (group: NavGroup) => (
    <li key={group.id} className="sidebar-group">
      <div className="sidebar-group-label">{t(group.labelKey, group.label)}</div>
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
                <span>{t(item.labelKey, item.label)}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </li>
  );

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
            {mainGroups.map(renderGroup)}
          </ul>
        </div>

        <div className="sidebar-bottom">
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
                <div className="user-dropdown-header" style={{ padding: '0.75rem', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{t('sidebar.accountOptions')}</div>

                {workspaces.length > 1 && (
                  <div style={{ padding: '0.25rem 0', borderBottom: '1px solid var(--border-color)', marginBottom: '0.25rem' }}>
                    <div style={{ padding: '0.25rem 0.75rem', fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      {t('sidebar.workspace')}
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

                {configItems.length > 0 && (
                  <div style={{ padding: '0.25rem 0', borderBottom: '1px solid var(--border-color)', marginBottom: '0.25rem' }}>
                    {configItems.map(item => (
                      <button
                        key={item.id}
                        className="user-dropdown-item"
                        style={{ width: '100%', border: 'none', background: 'transparent', textAlign: 'left', fontFamily: 'inherit', fontSize: '0.85rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-main)', padding: '0.5rem 0.75rem' }}
                        onClick={() => { handleNavClick(item.route); setUserMenuOpen(false); }}
                      >
                        <i className={`ph ${item.icon}`} />
                        <span>{t(item.labelKey, item.label)}</span>
                      </button>
                    ))}
                  </div>
                )}

                <div style={{ padding: '0.25rem 0', borderBottom: '1px solid var(--border-color)', marginBottom: '0.25rem' }}>
                  <div style={{ padding: '0.25rem 0.75rem', fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    {t('sidebar.language')}
                  </div>
                  {SUPPORTED_LANGUAGES.map(lang => {
                    const isActive = i18n.language === lang;
                    return (
                      <button
                        key={lang}
                        className="user-dropdown-item"
                        style={{
                          width: '100%', border: 'none', textAlign: 'left', fontFamily: 'inherit', fontSize: '0.85rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 0.75rem',
                          background: isActive ? 'rgba(234, 179, 8, 0.08)' : 'transparent',
                          fontWeight: isActive ? 600 : 400,
                          color: isActive ? 'var(--primary-color)' : 'var(--text-main)',
                          borderRadius: '6px',
                        }}
                        onClick={(e) => { e.stopPropagation(); handleLanguageChange(lang); }}
                      >
                        <span>{LANGUAGE_FLAGS[lang]}</span>
                        <span>{t(`language.${lang}`)}</span>
                        {isActive && <i className="ph ph-check" style={{ marginLeft: 'auto' }} />}
                      </button>
                    );
                  })}
                </div>

                <button
                  className="user-dropdown-item"
                  style={{ width: '100%', border: 'none', background: 'transparent', textAlign: 'left', fontFamily: 'inherit', fontSize: '0.85rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-main)', padding: '0.5rem 0.75rem' }}
                  onClick={(e) => { e.stopPropagation(); toggleTheme(); }}
                >
                  <i className={`ph ${isDark ? 'ph-sun' : 'ph-moon'}`} />
                  <span>{isDark ? t('sidebar.lightMode') : t('sidebar.darkMode')}</span>
                </button>

                <button
                  id="btn-logout-flutuante"
                  className="user-dropdown-item"
                  style={{ width: '100%', border: 'none', background: 'transparent', textAlign: 'left', fontFamily: 'inherit', fontSize: '0.85rem', cursor: 'pointer', color: 'var(--danger)', display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 0.75rem' }}
                  onClick={signOut}
                >
                  <i className="ph ph-sign-out" /> {t('sidebar.logout')}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
