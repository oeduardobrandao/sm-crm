import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { changeLanguage, SUPPORTED_LANGUAGES } from '@mesaas/i18n';
import type { Language } from '@mesaas/i18n';
import { getNavGroups, isNavRouteActive } from './nav-data';
import type { NavGroup } from './nav-data';
import { useWorkspaceLimits } from '../../hooks/useWorkspaceLimits';
import { useEffectiveNavFeatures } from '../../hooks/useEffectiveNavFeatures';
import { useMensagensUnread } from '../../hooks/useMensagensUnread';
import { useEquipeChatUnread } from '../../hooks/useEquipeChatUnread';
import { FlagIcon } from '@mesaas/ui/FlagIcon';
import { PessoaAvatar } from '@/components/PessoaAvatar';
import { switchWorkspace } from '@/store/workspace';
import { GuideNavItem } from '../guide/GuidePill';
import { clearVidroCache } from '../../lib/vidroLook';
import GlobalSearchTrigger from './GlobalSearchTrigger';

interface SidebarProps {
  isDrawer?: boolean;
  isOpen?: boolean;
  onClose?: () => void;
  /** Desktop static sidebar: an icon rail that expands over the content on hover. */
  collapsible?: boolean;
  /** Pinned open: always expanded, and the content sits beside it. */
  pinned?: boolean;
  onTogglePinned?: () => void;
  /** Desktop "Vidro" shell: glass header (logo, workspace, plan) and the search above the nav. */
  vidroShell?: boolean;
  /** Account-menu switch between the Vidro and classic looks (desktop rail only). */
  look?: { enabled: boolean; optedOut: boolean; onToggle: () => void };
}

// Hover intent: crossing the rail on the way to the content shouldn't flap it open.
const HOVER_EXPAND_DELAY_MS = 120;

const COLLAPSED_GROUPS_STORAGE_KEY = 'sidebar-collapsed-groups';

function readCollapsedGroups(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSED_GROUPS_STORAGE_KEY);
    if (!raw) return new Set();
    const ids = JSON.parse(raw);
    return Array.isArray(ids) ? new Set(ids) : new Set();
  } catch {
    return new Set();
  }
}

export default function Sidebar({
  isDrawer = false,
  isOpen = false,
  onClose,
  collapsible = false,
  pinned = false,
  onTogglePinned,
  vidroShell,
  look,
}: SidebarProps) {
  const { user, profile, signOut, workspaceRole, can } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { t, i18n } = useTranslation();
  const { features: rawFeatures, planName } = useWorkspaceLimits();
  const features = useEffectiveNavFeatures(rawFeatures as Record<string, boolean> | null);
  const mensagensUnread = useMensagensUnread();
  const equipeUnread = useEquipeChatUnread();
  const mensagensBadge = mensagensUnread + equipeUnread;
  const [isDark, setIsDark] = useState(
    document.documentElement.getAttribute('data-theme') === 'dark',
  );
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [languageMenuOpen, setLanguageMenuOpen] = useState(false);
  const [workspaces, setWorkspaces] = useState<any[]>([]);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(readCollapsedGroups);
  const [hovered, setHovered] = useState(false);
  const [keyboardFocused, setKeyboardFocused] = useState(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (hoverTimer.current) clearTimeout(hoverTimer.current);
    },
    [],
  );

  // The open account menu holds the overlay: it lives inside the sidebar and
  // would otherwise collapse out from under the pointer.
  const expanded = !collapsible || pinned || hovered || keyboardFocused || userMenuOpen;
  const isRail = collapsible && !expanded;
  const isOverlay = collapsible && expanded && !pinned;

  // Portaled content (the search dialog and its full-screen overlay) is a descendant of the nav
  // in React's tree, so its pointer and focus events bubble here although it is not in the nav's
  // DOM. Only events from the nav's own DOM may expand the rail. Leaves stay unguarded: a leave
  // toward portal content should still collapse.
  const handleMouseEnter = (e: React.MouseEvent<HTMLElement>) => {
    if (!collapsible || !e.currentTarget.contains(e.target as Node)) return;
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setHovered(true), HOVER_EXPAND_DELAY_MS);
  };

  const handleMouseLeave = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
    setHovered(false);
  };

  // Only keyboard focus expands the rail. A mouse click leaves focus on the
  // clicked link, and expanding on any focus would then keep the overlay open
  // after the pointer leaves. Focus from portaled content is ignored for the reason above.
  const handleFocus = (e: React.FocusEvent<HTMLElement>) => {
    if (
      collapsible &&
      e.currentTarget.contains(e.target as Node) &&
      e.target.matches(':focus-visible')
    )
      setKeyboardFocused(true);
  };

  const handleBlur = (e: React.FocusEvent<HTMLElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setKeyboardFocused(false);
  };

  const toggleGroup = (groupId: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      try {
        localStorage.setItem(COLLAPSED_GROUPS_STORAGE_KEY, JSON.stringify([...next]));
      } catch {
        // localStorage unavailable (private mode, quota) -- collapse state just won't persist.
      }
      return next;
    });
  };

  const navGroups = getNavGroups(features, workspaceRole, can);
  const activeRoute = location.pathname;

  // Load workspaces for switcher
  useEffect(() => {
    if (!user) return;
    supabase
      .from('workspace_members')
      .select('workspace_id, role, workspaces!inner(id, name)')
      .eq('user_id', user.id)
      .then(({ data }) => {
        // Every row is kept (the Vidro header names the active one); the account-menu switcher
        // still renders only with more than one. An empty result leaves the initial [] as is.
        if (data?.length) setWorkspaces(data);
      });
  }, [user?.id]);

  const activeWorkspaceName =
    workspaces.find(
      (m: any) => m.workspaces?.id === (profile?.active_workspace_id || profile?.conta_id),
    )?.workspaces?.name ?? null;

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
      // The pre-paint cache belongs to the workspace being left.
      clearVidroCache();
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

  const userName = profile?.nome || t('sidebar.myAccount');

  // The support group (Novidades/Ajuda) lives in the account menu on desktop
  // instead of the main nav list — see the utilityItems section below.
  // Configurações lives in the main nav list itself (it's not filtered out
  // here), so it isn't repeated in the dropdown.
  const mainGroups = navGroups.filter((g) => g.id !== 'ajuda-group');
  const utilityItems = navGroups.find((g) => g.id === 'ajuda-group')?.items ?? [];

  const renderGroup = (group: NavGroup) => {
    const groupHasActiveItem = group.items.some((item) =>
      isNavRouteActive(activeRoute, item.route),
    );
    const isCollapsed = collapsedGroups.has(group.id) && !groupHasActiveItem;
    return (
      <li key={group.id} className="sidebar-group">
        <button
          type="button"
          className="sidebar-group-label"
          aria-expanded={!isCollapsed}
          onClick={() => toggleGroup(group.id)}
        >
          <span>{t(group.labelKey, group.label)}</span>
          <i
            className={`ph ph-caret-down sidebar-group-caret${isCollapsed ? ' sidebar-group-caret--collapsed' : ''}`}
          />
        </button>
        <div
          className={`sidebar-group-content${isCollapsed ? ' sidebar-group-content--collapsed' : ''}`}
        >
          <ul className="sidebar-sub-nav" inert={isCollapsed || undefined}>
            {group.items.map((item) => {
              const isActiveItem = isNavRouteActive(activeRoute, item.route);
              const ItemIcon = isActiveItem ? `ph-fill ${item.icon}` : `ph ${item.icon}`;
              return (
                <li key={item.id} className="sidebar-sub-item">
                  {item.disabled ? (
                    <div
                      className="sidebar-sub-link sidebar-sub-link--disabled"
                      aria-disabled="true"
                    >
                      <i className={`ph ${item.icon}`} />
                      <span className="sidebar-sub-label">{t(item.labelKey, item.label)}</span>
                      <span className="nav-badge">{t('sidebar.comingSoon', 'Em breve')}</span>
                    </div>
                  ) : item.locked ? (
                    <a
                      className="sidebar-sub-link sidebar-sub-link--locked"
                      href={`#${item.route}`}
                      data-testid={`nav-locked-${item.id}`}
                      title={t('sidebar.upgradeToUnlock', 'Disponível nos planos Pro e Max')}
                      onClick={(e) => {
                        e.preventDefault();
                        handleNavClick(item.route);
                      }}
                    >
                      <i className={`ph ${item.icon}`} />
                      <span className="sidebar-sub-label">{t(item.labelKey, item.label)}</span>
                      <i className="ph ph-lock nav-lock-icon" aria-hidden="true" />
                    </a>
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
                      <span className="sidebar-sub-label">{t(item.labelKey, item.label)}</span>
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
                      <span className="sidebar-sub-label">{t(item.labelKey, item.label)}</span>
                      {item.id === 'mensagens' && mensagensBadge > 0 && (
                        <span
                          className="nav-badge nav-badge--count"
                          data-testid="mensagens-nav-badge"
                        >
                          {mensagensBadge > 99 ? '99+' : mensagensBadge}
                        </span>
                      )}
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </li>
    );
  };

  const pinButton = (
    <button
      type="button"
      className="sidebar-pin-btn"
      onClick={onTogglePinned}
      aria-pressed={pinned}
      aria-label={pinned ? 'Recolher menu lateral' : 'Fixar menu lateral aberto'}
      title={pinned ? 'Recolher menu lateral' : 'Fixar menu lateral aberto'}
    >
      <i className="ph ph-sidebar-simple" />
    </button>
  );

  return (
    <nav
      className={`sidebar${isDrawer ? ' sidebar--drawer' : ''}${isDrawer && isOpen ? ' sidebar--open' : ''}${isRail ? ' sidebar--rail' : ''}${isOverlay ? ' sidebar--overlay' : ''}`}
      id="sidebar"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onFocus={handleFocus}
      onBlur={handleBlur}
    >
      <div className="sidebar-wrapper">
        {vidroShell && (
          <div className="vidro-sidebar-head">
            {/* Logo and the open/close toggle on the first row, workspace and plan under it. */}
            <div className="vidro-sidebar-head-row">
              <Link
                to="/dashboard"
                className="vidro-sidebar-logo"
                aria-label="Mesaas, ir para o início"
              >
                <img
                  className="vidro-sidebar-wordmark"
                  src={isDark ? '/logo-white.svg' : '/logo-black.svg'}
                  alt=""
                />
                <img className="vidro-sidebar-mark" src="/icon.svg" alt="" />
              </Link>
              {collapsible && pinButton}
            </div>
            {(activeWorkspaceName || planName) && (
              <div className="vidro-sidebar-ws">
                {activeWorkspaceName && (
                  <span className="vidro-sidebar-ws-name">{activeWorkspaceName}</span>
                )}
                {planName && <span className="vidro-sidebar-ws-plan">{planName}</span>}
              </div>
            )}
          </div>
        )}
        {collapsible && !vidroShell && <div className="sidebar-pin-row">{pinButton}</div>}
        {/* Closing the palette removes its overlay without a mouseleave reaching the nav, so a
          hover-expanded rail would stay open over the content: collapse it on close. */}
        {vidroShell && <GlobalSearchTrigger variant="sidebar" onClose={handleMouseLeave} />}
        <div
          className="sidebar-scrollable"
          style={{ paddingTop: collapsible ? '0.25rem' : '1rem' }}
        >
          <ul className="sidebar-nav" id="sidebar-nav-main">
            {mainGroups.map(renderGroup)}
          </ul>
        </div>

        <div className="sidebar-bottom">
          {isDrawer && (
            <GuideNavItem source="sidebar" className="sidebar-guide-item" onBeforeOpen={onClose} />
          )}
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
              {/* 'U' keeps the old placeholder initial while the profile loads. */}
              <PessoaAvatar
                nome={profile?.nome || 'U'}
                fotoUrl={profile?.avatar_url}
                seed={user?.id ?? profile?.nome}
                size={32}
                className="!rounded-[8px]"
              />
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
                          <i className="ph-bold ph-buildings" />
                          <span>{m.workspaces.name || 'Workspace'}</span>
                          {isActive && <i className="ph-bold ph-check user-dropdown-item-check" />}
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
                          <i className={`ph-bold ${item.icon}`} />
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
                          <i className={`ph-bold ${item.icon}`} />
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
                    <i className="ph-bold ph-globe" />
                    <span>{t('sidebar.language')}</span>
                    <span className="user-dropdown-item-value">
                      <FlagIcon lang={i18n.language as Language} size={14} />
                      {t(`language.${i18n.language}`)}
                    </span>
                    <i
                      className={`ph-bold ${languageMenuOpen ? 'ph-caret-up' : 'ph-caret-down'}`}
                    />
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
                            {isActive && (
                              <i className="ph-bold ph-check user-dropdown-item-check" />
                            )}
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
                  <i className={`ph-bold ${isDark ? 'ph-sun' : 'ph-moon'}`} />
                  <span>{isDark ? t('sidebar.lightMode') : t('sidebar.darkMode')}</span>
                </button>

                {look?.enabled && collapsible && (
                  <button
                    className="user-dropdown-item"
                    onClick={(e) => {
                      e.stopPropagation();
                      look.onToggle();
                    }}
                  >
                    <i className={`ph-bold ${look.optedOut ? 'ph-sparkle' : 'ph-squares-four'}`} />
                    <span>{look.optedOut ? t('sidebar.lookNew') : t('sidebar.lookClassic')}</span>
                  </button>
                )}

                <button
                  id="btn-logout-flutuante"
                  className="user-dropdown-item text-danger"
                  onClick={signOut}
                >
                  <i className="ph-bold ph-sign-out" />
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
