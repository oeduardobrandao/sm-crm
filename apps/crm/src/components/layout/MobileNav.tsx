import { useEffect, useRef, useState, type ComponentType, type CSSProperties } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  CalendarDays,
  ChartLine,
  Compass,
  Ellipsis,
  ExternalLink,
  House,
  Lock,
  LogOut,
  MessageCircle,
  Moon,
  Search,
  SquareKanban,
  Users,
  type LucideProps,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useWorkspaceLimits } from '../../hooks/useWorkspaceLimits';
import { useEffectiveNavFeatures } from '../../hooks/useEffectiveNavFeatures';
import { useMensagensUnread } from '../../hooks/useMensagensUnread';
import { useEquipeChatUnread } from '../../hooks/useEquipeChatUnread';
import { getPhoneNav, isNavRouteActive, type NavItem } from './nav-data';
import GlobalSearchDialog from './GlobalSearchDialog';
import { PessoaAvatar } from '@/components/PessoaAvatar';
import { useGuide } from '../guide/GuideContext';
import { openSupportChat } from '@/lib/supportChat';
import { BottomSheet } from '@/components/mobile/BottomSheet';
import { Cell, GroupedList } from '@/components/mobile/GroupedList';
import { useSheetActions } from '@/components/mobile/sheetActions';

declare global {
  interface Window {
    $crisp?: Array<unknown[]>;
  }
}

const TAB_ICON: Record<string, ComponentType<LucideProps>> = {
  dashboard: House,
  entregas: SquareKanban,
  calendario: CalendarDays,
  mensagens: MessageCircle,
  clientes: Users,
  analytics: ChartLine,
};

function formatCount(count: number): string {
  return count > 99 ? '99+' : String(count);
}

/**
 * Phone tab bar (below 768px): Início, Entregas, Agenda, Mensagens, Mais (D18), with
 * Clientes then Analytics filling the slot of a tab the user's plan or role doesn't
 * have. The bar is permanently mounted and is NOT a dialog; the Mais sheet is, but only
 * while open (its content unmounts on close).
 */
export default function MobileNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const { workspaceRole, can } = useAuth();
  const { features: rawFeatures, isLoading: limitsLoading } = useWorkspaceLimits();
  const features = useEffectiveNavFeatures(rawFeatures as Record<string, boolean> | null);
  const mensagensUnread = useMensagensUnread();
  const equipeUnread = useEquipeChatUnread();
  const mensagensBadge = mensagensUnread + equipeUnread;
  const { t } = useTranslation();
  const [moreOpen, setMoreOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const moreButtonRef = useRef<HTMLButtonElement>(null);

  // Agenda follows CalendarioPage: /calendario is the Agenda only with feature_agenda
  // explicitly on. While the plan is still loading the bar keeps its default shape
  // (Agenda and Mensagens, like getNavGroups' null-features pass), so most workspaces
  // don't see a tab flip on boot; only one without the Agenda swaps it once loaded.
  const agendaEnabled = limitsLoading || rawFeatures?.feature_agenda === true;
  const { tabs, shortcuts, moreGroups } = getPhoneNav(features, workspaceRole, can, {
    agendaEnabled,
  });

  const isMoreRouteActive =
    shortcuts.some((item) => isNavRouteActive(location.pathname, item.route)) ||
    moreGroups.some((group) =>
      group.items.some((item) => isNavRouteActive(location.pathname, item.route)),
    );
  const activeTab = isMoreRouteActive
    ? null
    : (tabs.find((tab) => isNavRouteActive(location.pathname, tab.route))?.navId ?? null);
  // Column the selection pill sits on: the active tab, or Mais (the last column) while
  // its sheet is open or one of its routes is showing. -1 hides the pill.
  const selectedIndex =
    moreOpen || isMoreRouteActive ? tabs.length : tabs.findIndex((tab) => tab.navId === activeTab);

  useEffect(() => {
    const phoneMedia = window.matchMedia('(max-width: 767px)');
    const closeOutsidePhone = (event: MediaQueryListEvent) => {
      if (!event.matches) setMoreOpen(false);
    };

    phoneMedia.addEventListener('change', closeOutsidePhone);
    return () => phoneMedia.removeEventListener('change', closeOutsidePhone);
  }, []);

  // `env(safe-area-inset-bottom)` only covers the home-indicator inset, not Safari's
  // own collapsible bottom toolbar -- a separate overlay that shrinks the visible
  // (visual) viewport without moving the layout viewport `.mobile-nav-glass` is fixed
  // against. When Safari's toolbar is expanded, that gap can fully hide the pill
  // behind it. window.visualViewport tracks the actually-visible area, so the gap
  // between its bottom edge and the layout viewport's bottom edge is exactly the
  // extra clearance the pill needs -- 0px whenever there's no such overlay (Chrome,
  // the standalone home-screen app, or Safari with its toolbar collapsed).
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    const updateChromeOffset = () => {
      // The iOS home-screen app reports offsetTop as minus the status-bar height
      // (-62px) with height = innerHeight, which would read as a 62px toolbar.
      const gap = window.innerHeight - (Math.max(0, viewport.offsetTop) + viewport.height);
      document.documentElement.style.setProperty(
        '--mobile-nav-chrome-offset',
        `${Math.max(0, Math.round(gap))}px`,
      );
    };

    updateChromeOffset();
    viewport.addEventListener('resize', updateChromeOffset);
    viewport.addEventListener('scroll', updateChromeOffset);

    return () => {
      viewport.removeEventListener('resize', updateChromeOffset);
      viewport.removeEventListener('scroll', updateChromeOffset);
      document.documentElement.style.setProperty('--mobile-nav-chrome-offset', '0px');
    };
  }, []);

  return (
    <>
      <nav className="mobile-nav-glass" id="mobile-nav" aria-label="Navegação principal">
        <div
          className="mobile-nav-items"
          style={
            {
              '--tab-count': tabs.length + 1,
              '--tab-index': Math.max(0, selectedIndex),
            } as CSSProperties
          }
        >
          <span
            className="mobile-nav-indicator"
            aria-hidden="true"
            data-hidden={selectedIndex < 0 || undefined}
          />
          {tabs.map((tab) => {
            const active = activeTab === tab.navId;
            const Icon = TAB_ICON[tab.navId];
            const label = t(tab.labelKey, tab.label);
            const unread = tab.navId === 'mensagens' ? mensagensBadge : 0;
            return (
              <button
                key={tab.navId}
                className={`mobile-nav-item${active ? ' active' : ''}`}
                onClick={() => navigate(tab.route)}
                type="button"
                aria-current={active ? 'page' : undefined}
                aria-label={unread > 0 ? `${label}, ${formatCount(unread)} não lidas` : label}
                data-tab={tab.navId}
              >
                <span className="mobile-nav-item__icon" aria-hidden="true">
                  <Icon strokeWidth={active ? 2.3 : 2} />
                  {unread > 0 && (
                    <span className="mobile-nav-item__badge" data-testid="mensagens-tab-badge">
                      {formatCount(unread)}
                    </span>
                  )}
                </span>
                <span className="nav-label" aria-hidden="true">
                  {label}
                </span>
              </button>
            );
          })}

          <button
            ref={moreButtonRef}
            id="mobile-more-btn"
            className={`mobile-nav-item${moreOpen || isMoreRouteActive ? ' active' : ''}`}
            type="button"
            aria-label={t('nav.mais', 'Mais')}
            aria-current={isMoreRouteActive ? 'page' : undefined}
            aria-expanded={moreOpen}
            aria-controls="mobile-more-sheet"
            aria-haspopup="dialog"
            onClick={() => setMoreOpen(true)}
          >
            <span className="mobile-nav-item__icon" aria-hidden="true">
              <Ellipsis />
            </span>
            <span className="nav-label" aria-hidden="true">
              {t('nav.mais', 'Mais')}
            </span>
          </button>
        </div>
      </nav>

      <BottomSheet
        open={moreOpen}
        onOpenChange={setMoreOpen}
        title={t('nav.mais', 'Mais')}
        hideTitle
        id="mobile-more-sheet"
        className="mobile-more-sheet"
        overlayClassName="mobile-more-overlay"
        returnFocusRef={moreButtonRef}
      >
        <MoreSheetContent
          shortcuts={shortcuts}
          moreGroups={moreGroups}
          onSearch={() => setSearchOpen(true)}
        />
      </BottomSheet>
      <GlobalSearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
    </>
  );
}

interface MoreSheetContentProps {
  shortcuts: NavItem[];
  moreGroups: ReturnType<typeof getPhoneNav>['moreGroups'];
  onSearch: () => void;
}

/** Body of the Mais sheet. A child of the sheet so rows can close it before navigating. */
function MoreSheetContent({ shortcuts, moreGroups, onSearch }: MoreSheetContentProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const { profile, signOut } = useAuth();
  const { planName } = useWorkspaceLimits();
  const guide = useGuide();
  const { close, closeThen } = useSheetActions();
  const [isDark, setIsDark] = useState(
    document.documentElement.getAttribute('data-theme') === 'dark',
  );

  // Close first, then navigate once the sheet's history entry is gone (no dead Back step).
  const go = (route: string) => closeThen(() => navigate(route));
  // Public pages (Novidades, Privacidade) live outside the shell: open them in a new tab
  // or window instead of leaving the app with no tab bar. No SPA navigation, so a plain
  // close is enough (the sheet's entry pops with it).
  const openOutside = (route: string) => {
    close();
    window.open(route, '_blank', 'noopener,noreferrer');
  };

  const toggleTheme = () => {
    const next = isDark ? 'light' : 'dark';
    if (next === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');
    localStorage.setItem('theme', next);
    setIsDark(next === 'dark');
  };

  const navCell = (item: NavItem) => {
    const label = t(item.labelKey, item.label);
    const icon = <i className={`ph ${item.icon}`} />;
    if (item.disabled) {
      return (
        <Cell
          key={item.id}
          label={label}
          icon={icon}
          disabled
          accessory={<span className="nav-badge">{t('sidebar.comingSoon', 'Em breve')}</span>}
        />
      );
    }
    if (item.locked) {
      return (
        <Cell
          key={item.id}
          label={label}
          icon={icon}
          className="mobile-more-item--locked"
          data-testid={`mobile-nav-locked-${item.id}`}
          title={t('sidebar.upgradeToUnlock', 'Disponível nos planos Pro e Max')}
          accessory={<Lock className="phone-cell__chevron" aria-label="Bloqueado" />}
          onClick={() => go(item.route)}
        />
      );
    }
    if (item.newTab || item.outsideShell) {
      return (
        <Cell
          key={item.id}
          label={label}
          icon={icon}
          data-testid={`mobile-nav-external-${item.id}`}
          accessory={<ExternalLink className="phone-cell__chevron" aria-hidden="true" />}
          aria-label={`${label} (abre em nova aba)`}
          onClick={() => openOutside(item.route)}
        />
      );
    }
    return (
      <Cell
        key={item.id}
        label={label}
        icon={icon}
        current={isNavRouteActive(location.pathname, item.route)}
        chevron
        onClick={() => go(item.route)}
      />
    );
  };

  return (
    <>
      <div className="mobile-more-profile" id="mobile-profile">
        {/* `.mobile-more-profile .avatar` sizes it (56px circle). */}
        <PessoaAvatar
          nome={profile?.nome || 'U'}
          fotoUrl={profile?.avatar_url}
          seed={profile?.id ?? profile?.nome}
        />
        <div className="mobile-more-profile-info">
          <div className="mobile-more-profile-name" id="mobile-user-name">
            {profile?.nome || 'Minha Conta'}
          </div>
          <div className="mobile-more-profile-plan">{planName?.toUpperCase() || 'FREE'}</div>
        </div>
      </div>

      {shortcuts.length > 0 && (
        <GroupedList aria-label="Atalhos">{shortcuts.map(navCell)}</GroupedList>
      )}

      <GroupedList aria-label="Ações rápidas">
        <Cell
          label="Buscar"
          icon={<Search />}
          // The search and the guide carry their own history entry on phones: open them
          // only after the sheet's entry is gone, or the in-flight pop would close them.
          onClick={() => closeThen(onSearch)}
        />
        {guide?.showEntryPoint && (
          <Cell
            label="Guia de primeiros passos"
            icon={<Compass />}
            value={`${guide.totals.done} de ${guide.totals.total}`}
            onClick={() => closeThen(() => guide.open('mobile_nav'))}
          />
        )}
        <Cell
          label="Chat de suporte"
          icon={<MessageCircle />}
          onClick={() => {
            close();
            openSupportChat();
          }}
        />
      </GroupedList>

      {moreGroups.map((group) => (
        <GroupedList key={group.id} header={t(group.labelKey, group.label)}>
          {group.items.map(navCell)}
        </GroupedList>
      ))}

      <GroupedList aria-label="Preferências">
        <Cell
          id="mobile-theme-toggle"
          label={t('sidebar.darkMode', 'Modo Escuro')}
          icon={<Moon />}
          switch={{ checked: isDark, onCheckedChange: toggleTheme }}
        />
      </GroupedList>

      <GroupedList aria-label="Conta">
        <Cell
          id="mobile-logout-btn"
          label={t('sidebar.logout', 'Sair')}
          icon={<LogOut />}
          destructive
          onClick={signOut}
        />
      </GroupedList>
    </>
  );
}
