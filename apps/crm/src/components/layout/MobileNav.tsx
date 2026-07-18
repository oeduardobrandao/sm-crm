import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { useWorkspaceLimits } from '../../hooks/useWorkspaceLimits';
import { getMoreSheetGroups } from './nav-data';
import { Search, MessageCircle } from 'lucide-react';
import { CommandDialog, CommandInput, CommandList, CommandEmpty } from '@/components/ui/command';

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

function getActiveIndex(pathname: string): number {
  const idx = PRIMARY_ITEMS.findIndex((item) => pathname.startsWith(item.route));
  return idx >= 0 ? idx : -1;
}

export default function MobileNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const { profile, role, signOut } = useAuth();
  const { features } = useWorkspaceLimits();
  const { t } = useTranslation();
  const [moreOpen, setMoreOpen] = useState(false);
  const [isDark, setIsDark] = useState(
    document.documentElement.getAttribute('data-theme') === 'dark',
  );
  const [searchOpen, setSearchOpen] = useState(false);

  const activeIndex = getActiveIndex(location.pathname);

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

  const moreSheetGroups = getMoreSheetGroups(role, features as Record<string, boolean> | null);

  return (
    <>
      <nav className="mobile-nav-glass" id="mobile-nav" aria-label="Navegação principal">
        <div className="mobile-nav-items">
          {PRIMARY_ITEMS.map((item, index) => {
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

          <button
            id="mobile-more-btn"
            className={`mobile-nav-item${moreOpen ? ' active' : ''}`}
            onClick={() => setMoreOpen((value) => !value)}
            type="button"
            aria-label="Mais"
            aria-expanded={moreOpen}
            aria-controls="mobile-more-sheet"
          >
            <span className="mobile-nav-item__icon" aria-hidden="true">
              <i className="ph ph-dots-three" />
            </span>
            <span className="nav-label">Mais</span>
          </button>
        </div>
      </nav>

      {/* More Sheet Overlay */}
      <div
        className={`mobile-more-overlay${moreOpen ? ' visible' : ''}`}
        onClick={() => setMoreOpen(false)}
      >
        <div
          id="mobile-more-sheet"
          className="mobile-more-sheet"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Profile */}
          <div className="mobile-more-profile" id="mobile-profile">
            <div className="avatar" id="mobile-avatar">
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
        </div>
      </div>
      <CommandDialog open={searchOpen} onOpenChange={setSearchOpen}>
        <CommandInput placeholder="Buscar..." />
        <CommandList>
          <CommandEmpty>Nenhum resultado.</CommandEmpty>
        </CommandList>
      </CommandDialog>
    </>
  );
}
