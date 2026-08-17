import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { changeLanguage, SUPPORTED_LANGUAGES } from '@mesaas/i18n';
import type { Language } from '@mesaas/i18n';
import { getNavGroups } from './nav-data';
import type { NavGroup } from './nav-data';
import { useWorkspaceLimits } from '../../hooks/useWorkspaceLimits';
import { useEffectiveNavFeatures } from '../../hooks/useEffectiveNavFeatures';
import { useMensagensUnread } from '../../hooks/useMensagensUnread';
import { FlagIcon } from '@mesaas/ui/FlagIcon';
import { avatarColorClass } from '@/lib/avatarColor';
import { switchWorkspace } from '@/store/workspace';

interface SidebarProps {
  isDrawer?: boolean;
  isOpen?: boolean;
  onClose?: () => void;
}

export default function Sidebar({ isDrawer = false, isOpen = false, onClose }: SidebarProps) {
  const { user, profile, role, signOut, canSeeFinancials, workspaceRole } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { t, i18n } = useTranslation();
  const { features: rawFeatures } = useWorkspaceLimits();
  const features = useEffectiveNavFeatures(rawFeatures as Record<string, boolean> | null);
  const mensagensUnread = useMensagensUnread();
  const [isDark, setIsDark] = useState(
    document.documentElement.getAttribute('data-theme') === 'dark',
  );
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [languageMenuOpen, setLanguageMenuOpen] = useState(false);
  const [workspaces, setWorkspaces] = useState<any[]>([]);

  const navGroups = getNavGroups(role, features, canSeeFinancials, workspaceRole);
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
    try {
      await switchWorkspace(workspaceId);
      window.location.reload();
    } catch {
      // Previously the error was discarded and the page reloaded regardless, so
      // a refused switch was indistinguishable from a successful one.
      toast.error('Não foi possível trocar de workspace.');
    }
  };

  const handleLanguageChange = (lang: Language) => {
    changeLanguage(lang);
  };

  const initials = profile?.nome
    ? profile.nome
        .split(' ')
        .map((w: string) => w?.[0] || '')
        .join('')
        .substring(0, 2)
        .toUpperCase()
    : 'U';

  const userName = profile?.nome || t('sidebar.myAccount');

  // The support group (Novidades/Ajuda) lives in the account menu on desktop
  // instead of the main nav list — see the utilityItems section below.
  const mainGroups = navGroups.filter((g) => !g.isBottom && g.id !== 'ajuda-group');
  const configItems = navGroups.find((g) => g.id === 'config')?.items ?? [];
  const supportItems = navGroups.find((g) => g.id === 'ajuda-group')?.items ?? [];
  const utilityItems = [...configItems, ...supportItems];

  const renderGroup = (group: NavGroup) => (
    <li key={group.id} className="sidebar-group">
      <div className="sidebar-group-label">{t(group.labelKey, group.label)}</div>
      <ul className="sidebar-sub-nav">
        {group.items.map((item) => {
          const isActiveItem = activeRoute.startsWith(item.route);
          const ItemIcon = isActiveItem ? `ph-fill ${item.icon}` : `ph ${item.icon}`;
          return (
            <li key={item.id} className="sidebar-sub-item">
              {item.disabled ? (
                <div className="sidebar-sub-link sidebar-sub-link--disabled" aria-disabled="true">
                  <i className={`ph ${item.icon}`} />
                  <span>{t(item.labelKey, item.label)}</span>
                  <span className="nav-badge">{t('sidebar.comingSoon', 'Em breve')}</span>
                </div>
              ) : item.newTab ? (
                <a
                  className="sidebar-sub-link"
                  href={item.route}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => {
                    if (isDrawer) onClose?.();
                  }}
                >
                  <i className={`ph ${item.icon}`} />
                  <span>{t(item.labelKey, item.label)}</span>
                </a>
              ) : (
                <a
                  className={`sidebar-sub-link ${isActiveItem ? 'active' : ''}`}
                  href={`#${item.route}`}
                  onClick={(e) => {
                    e.preventDefault();
                    handleNavClick(item.route);
                  }}
                >
                  <i className={ItemIcon} />
                  <span>{t(item.labelKey, item.label)}</span>
                  {item.id === 'mensagens' && mensagensUnread > 0 && (
                    <span className="nav-badge nav-badge--count" data-testid="mensagens-nav-badge">
                      {mensagensUnread > 99 ? '99+' : mensagensUnread}
                    </span>
                  )}
                </a>
              )}
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
        <div className="sidebar-scrollable" style={{ paddingTop: '1rem' }}>
          <ul className="sidebar-nav" id="sidebar-nav-main">
            {mainGroups.map(renderGroup)}
          </ul>
        </div>

        <div className="sidebar-bottom">
          <div
            className="sidebar-user-menu"
            id="user-menu-wrap"
            tabIndex={0}
            onClick={() =>
              setUserMenuOpen((v) => {
                const next = !v;
                if (!next) setLanguageMenuOpen(false);
                return next;
              })
            }
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                setUserMenuOpen(false);
                setLanguageMenuOpen(false);
              }
            }}
          >
            <div className="sidebar-user-trigger">
              <div
                className={`avatar ${avatarColorClass(user?.id ?? profile?.nome)}`}
                style={{ width: 32, height: 32, borderRadius: 8, fontSize: '0.8rem' }}
              >
                {initials}
              </div>
              <span className="user-name-text">{userName}</span>
              <i
                className={`ph ${userMenuOpen ? 'ph-caret-up' : 'ph-caret-down'}`}
                style={{ marginLeft: 'auto', color: 'var(--text-muted)' }}
              />
            </div>

            {userMenuOpen && (
              <div className="user-menu-popover">
                <div className="user-dropdown-header">{t('sidebar.accountOptions')}</div>

                {workspaces.length > 1 && (
                  <div className="user-dropdown-section">
                    <div className="user-dropdown-section-label">{t('sidebar.workspace')}</div>
                    {workspaces.map((m: any) => {
                      const isActive =
                        m.workspaces.id === (profile?.active_workspace_id || profile?.conta_id);
                      return (
                        <button
                          key={m.workspaces.id}
                          className={`user-dropdown-item${isActive ? ' user-dropdown-item--active' : ''}`}
                          onClick={() => !isActive && handleWorkspaceSwitch(m.workspaces.id)}
                        >
                          <i className="ph ph-buildings" />
                          <span>{m.workspaces.name || 'Workspace'}</span>
                          {isActive && <i className="ph ph-check user-dropdown-item-check" />}
                        </button>
                      );
                    })}
                  </div>
                )}

                {utilityItems.length > 0 && (
                  <div className="user-dropdown-section">
                    {utilityItems.map((item) =>
                      item.newTab ? (
                        <a
                          key={item.id}
                          className="user-dropdown-item"
                          href={item.route}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => {
                            e.stopPropagation();
                            setUserMenuOpen(false);
                          }}
                        >
                          <i className={`ph ${item.icon}`} />
                          <span>{t(item.labelKey, item.label)}</span>
                        </a>
                      ) : (
                        <button
                          key={item.id}
                          className="user-dropdown-item"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleNavClick(item.route);
                            setUserMenuOpen(false);
                          }}
                        >
                          <i className={`ph ${item.icon}`} />
                          <span>{t(item.labelKey, item.label)}</span>
                        </button>
                      ),
                    )}
                  </div>
                )}

                <div className="user-dropdown-section">
                  <button
                    className="user-dropdown-item"
                    onClick={(e) => {
                      e.stopPropagation();
                      setLanguageMenuOpen((v) => !v);
                    }}
                  >
                    <i className="ph ph-globe" />
                    <span>{t('sidebar.language')}</span>
                    <span className="user-dropdown-item-value">
                      <FlagIcon lang={i18n.language as Language} size={14} />
                      {t(`language.${i18n.language}`)}
                    </span>
                    <i className={`ph ${languageMenuOpen ? 'ph-caret-up' : 'ph-caret-down'}`} />
                  </button>
                  {languageMenuOpen && (
                    <div className="user-dropdown-submenu">
                      {SUPPORTED_LANGUAGES.map((lang) => {
                        const isActive = i18n.language === lang;
                        return (
                          <button
                            key={lang}
                            className={`user-dropdown-item${isActive ? ' user-dropdown-item--active' : ''}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleLanguageChange(lang);
                              setLanguageMenuOpen(false);
                            }}
                          >
                            <FlagIcon lang={lang} size={16} />
                            <span>{t(`language.${lang}`)}</span>
                            {isActive && <i className="ph ph-check user-dropdown-item-check" />}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                <button
                  className="user-dropdown-item"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleTheme();
                  }}
                >
                  <i className={`ph ${isDark ? 'ph-sun' : 'ph-moon'}`} />
                  <span>{isDark ? t('sidebar.lightMode') : t('sidebar.darkMode')}</span>
                </button>

                <button
                  id="btn-logout-flutuante"
                  className="user-dropdown-item text-danger"
                  onClick={signOut}
                >
                  <i className="ph ph-sign-out" />
                  <span>{t('sidebar.logout')}</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
