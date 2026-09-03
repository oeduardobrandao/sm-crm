import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { useWorkspaceLimits } from '../../hooks/useWorkspaceLimits';
import { useEffectiveNavFeatures } from '../../hooks/useEffectiveNavFeatures';
import { useMensagensUnread } from '../../hooks/useMensagensUnread';
import { getMoreSheetGroups, NAV_MODULE } from './nav-data';
import type { PermissionAction, PermissionCheck, PermissionModule } from '@/lib/permissions';
import { Search, MessageCircle, Compass } from 'lucide-react';
import GlobalSearchDialog from './GlobalSearchDialog';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { avatarColorClass } from '@/lib/avatarColor';
import { useGuide } from '../guide/GuideContext';

declare global {
  interface Window {
    $crisp?: Array<unknown[]>;
  }
}

const PRIMARY_ITEMS = [
  { id: 'dashboard', route: '/dashboard', label: 'Dashboard', icon: 'ph-chart-pie-slice' },
  { id: 'clientes', route: '/clientes', label: 'Clientes', icon: 'ph-users' },
  { id: 'analytics', route: '/analytics', label: 'Analytics', icon: 'ph-chart-line-up' },
  { id: 'entregas', route: '/entregas', label: 'Entregas', icon: 'ph-kanban' },
];

/** `dashboard` has no NAV_MODULE entry (outside the permission catalog, same
 * as getNavGroups treats it) so it always survives this filter -- "keep
 * Dashboard always" falls out of the shared table rather than needing its
 * own special case here. */
function filterPrimaryItems(
  can: (module: PermissionModule, action?: PermissionAction) => PermissionCheck,
): typeof PRIMARY_ITEMS {
  return PRIMARY_ITEMS.filter((item) => {
    const gate = NAV_MODULE[item.id];
    return !gate || can(gate[0], gate[1]) === true;
  });
}

function getActiveIndex(items: typeof PRIMARY_ITEMS, pathname: string): number {
  const idx = items.findIndex((item) => pathname.startsWith(item.route));
  return idx >= 0 ? idx : -1;
}

export default function MobileNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const { profile, signOut, workspaceRole, can } = useAuth();
  const { features: rawFeatures } = useWorkspaceLimits();
  const features = useEffectiveNavFeatures(rawFeatures as Record<string, boolean> | null);
  const mensagensUnread = useMensagensUnread();
  const guide = useGuide();
  const { t } = useTranslation();
  const [moreOpen, setMoreOpen] = useState(false);
  const [isDark, setIsDark] = useState(
    document.documentElement.getAttribute('data-theme') === 'dark',
  );
  const [searchOpen, setSearchOpen] = useState(false);

  const moreSheetGroups = getMoreSheetGroups(features, workspaceRole, can);
  const isMoreRouteActive = moreSheetGroups.some((group) =>
    group.items.some((item) => location.pathname.startsWith(item.route)),
  );
  // Task 14, revisão externa round 4 (P2): the fixed primary bar used to
  // render dashboard/clientes/analytics/entregas unconditionally -- only the
  // "Mais" sheet (getMoreSheetGroups, which already runs the NAV_MODULE
  // permission filter) was gated. A denied module's primary item now
  // disappears too, sharing the same NAV_MODULE table `getNavGroups` uses so
  // the two can't drift apart on which modules require which grant.
  const primaryItems = filterPrimaryItems(can);
  const activeIndex = isMoreRouteActive ? -1 : getActiveIndex(primaryItems, location.pathname);

  useEffect(() => {
    const phoneMedia = window.matchMedia('(max-width: 767px)');
    const closeOutsidePhone = (event: MediaQueryListEvent) => {
      if (!event.matches) setMoreOpen(false);
    };

    phoneMedia.addEventListener('change', closeOutsidePhone);
    return () => phoneMedia.removeEventListener('change', closeOutsidePhone);
  }, []);

  const go = (route: string) => {
    navigate(route);
    setMoreOpen(false);
  };

  const toggleTheme = () => {
    const next = isDark ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next === 'dark' ? 'dark' : '');
    if (next === 'light') document.documentElement.removeAttribute('data-theme');
    localStorage.setItem('theme', next);
    setIsDark(next === 'dark');
  };

  const initials = profile?.nome
    ? profile.nome
        .split(' ')
        .map((w: string) => w?.[0] || '')
        .join('')
        .substring(0, 2)
        .toUpperCase()
    : 'U';

  return (
    <>
      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <nav className="mobile-nav-glass" id="mobile-nav" aria-label="Navegação principal">
          <div className="mobile-nav-items">
            {primaryItems.map((item, index) => {
              const active = activeIndex === index;
              return (
                <button
                  key={item.id}
                  className={`mobile-nav-item${active ? ' active' : ''}`}
                  onClick={() => go(item.route)}
                  type="button"
                  aria-current={active ? 'page' : undefined}
                  aria-label={item.label}
                >
                  <span className="mobile-nav-item__icon" aria-hidden="true">
                    <i className={`${active ? 'ph-fill' : 'ph'} ${item.icon}`} />
                  </span>
                  <span className="nav-label">{item.label}</span>
                </button>
              );
            })}

            <SheetTrigger asChild>
              <button
                id="mobile-more-btn"
                className={`mobile-nav-item${moreOpen || isMoreRouteActive ? ' active' : ''}`}
                type="button"
                aria-label="Mais"
                aria-current={isMoreRouteActive ? 'page' : undefined}
                aria-expanded={moreOpen}
                aria-controls="mobile-more-sheet"
              >
                <span className="mobile-nav-item__icon" aria-hidden="true">
                  <i className="ph ph-dots-three" />
                </span>
                <span className="nav-label">Mais</span>
              </button>
            </SheetTrigger>
          </div>
        </nav>

        <SheetContent
          side="bottom"
          id="mobile-more-sheet"
          className="mobile-more-sheet"
          overlayClassName="mobile-more-overlay"
          aria-describedby={undefined}
        >
          <SheetTitle className="sr-only">Mais</SheetTitle>

          {/* Profile */}
          <div className="mobile-more-profile" id="mobile-profile">
            <div
              className={`avatar ${avatarColorClass(profile?.id ?? profile?.nome)}`}
              id="mobile-avatar"
            >
              {initials}
            </div>
            <div className="mobile-more-profile-info">
              <div className="mobile-more-profile-name" id="mobile-user-name">
                {profile?.nome || 'Minha Conta'}
              </div>
              <div className="mobile-more-profile-plan">
                {(profile?.plano as string | undefined)?.toUpperCase() || 'FREE'}
              </div>
            </div>
          </div>

          <div className="mobile-more-divider" />

          {/* Quick actions */}
          <button
            className="mobile-more-item"
            onClick={() => {
              setMoreOpen(false);
              setSearchOpen(true);
            }}
            type="button"
          >
            <div className="mobile-more-item-icon">
              <Search size={18} />
            </div>
            <span>Buscar</span>
          </button>

          {guide?.showEntryPoint && (
            <button
              className="mobile-more-item"
              type="button"
              onClick={() => {
                setMoreOpen(false);
                guide.open('mobile_nav');
              }}
            >
              <div className="mobile-more-item-icon">
                <Compass size={18} />
              </div>
              <span>Guia de primeiros passos</span>
            </button>
          )}

          <button
            className="mobile-more-item"
            onClick={() => {
              window.$crisp?.push(['do', 'chat:open']);
              setMoreOpen(false);
            }}
            type="button"
          >
            <div className="mobile-more-item-icon">
              <MessageCircle size={18} />
            </div>
            <span>Chat</span>
          </button>

          <div className="mobile-more-divider" />

          {/* Grouped nav items */}
          {moreSheetGroups.map((group) => (
            <div key={group.id}>
              <div className="mobile-more-group-label">{t(group.labelKey, group.label)}</div>
              {group.items.map((item) => {
                if (item.disabled) {
                  return (
                    <div
                      key={item.id}
                      className="mobile-more-item mobile-more-item--disabled"
                      aria-disabled="true"
                    >
                      <div className="mobile-more-item-icon">
                        <i className={`ph ${item.icon}`} />
                      </div>
                      <span>{t(item.labelKey, item.label)}</span>
                      <span className="nav-badge">{t('sidebar.comingSoon', 'Em breve')}</span>
                    </div>
                  );
                }
                if (item.locked) {
                  return (
                    <button
                      key={item.id}
                      className="mobile-more-item mobile-more-item--locked"
                      onClick={() => go(item.route)}
                      type="button"
                      data-testid={`mobile-nav-locked-${item.id}`}
                      title={t('sidebar.upgradeToUnlock', 'Disponível nos planos Pro e Max')}
                    >
                      <div className="mobile-more-item-icon">
                        <i className={`ph ${item.icon}`} />
                      </div>
                      <span>{t(item.labelKey, item.label)}</span>
                      <i className="ph ph-lock nav-lock-icon" aria-hidden="true" />
                    </button>
                  );
                }
                const isActive = location.pathname.startsWith(item.route);
                return (
                  <button
                    key={item.id}
                    className={`mobile-more-item${isActive ? ' active' : ''}`}
                    onClick={() => go(item.route)}
                    type="button"
                  >
                    <div className="mobile-more-item-icon">
                      <i className={`${isActive ? 'ph-fill' : 'ph'} ${item.icon}`} />
                    </div>
                    <span>{t(item.labelKey, item.label)}</span>
                    {item.id === 'mensagens' && mensagensUnread > 0 && (
                      <span
                        className="nav-badge nav-badge--count"
                        data-testid="mensagens-nav-badge"
                      >
                        {mensagensUnread > 99 ? '99+' : mensagensUnread}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}

          <div className="mobile-more-divider" />

          {/* Actions */}
          <button
            id="mobile-theme-toggle"
            className="mobile-more-item"
            onClick={toggleTheme}
            type="button"
          >
            <div className="mobile-more-item-icon">
              <i className={`ph ${isDark ? 'ph-sun' : 'ph-moon'}`} />
            </div>
            <span>{isDark ? 'Modo Claro' : 'Modo Escuro'}</span>
          </button>

          <button
            id="mobile-logout-btn"
            className="mobile-more-item danger"
            onClick={signOut}
            type="button"
          >
            <div className="mobile-more-item-icon">
              <i className="ph ph-sign-out" />
            </div>
            <span>Sair</span>
          </button>
        </SheetContent>
      </Sheet>
      <GlobalSearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
    </>
  );
}
