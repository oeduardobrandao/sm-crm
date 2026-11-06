import { useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Ellipsis } from 'lucide-react';
import { PHONE_TABS, MAIS_GROUPS, isRouteActive } from '../../lib/nav-items';
import { MaisSheet, type MaisSheetProps } from './MaisSheet';
import { useChromeOffset } from './useChromeOffset';

export type AdminTabBarProps = Omit<MaisSheetProps, 'open' | 'onOpenChange' | 'returnFocusRef'>;

/** Floating glass tab bar of the phone shell (<768px), with the Mais sheet behind its last tab. */
export function AdminTabBar(props: AdminTabBarProps) {
  useChromeOffset();
  const { pathname } = useLocation();
  const [maisOpen, setMaisOpen] = useState(false);
  const maisRef = useRef<HTMLButtonElement>(null);
  const onMaisRoute = MAIS_GROUPS.some((g) => g.items.some((i) => isRouteActive(pathname, i.to)));

  return (
    <>
      <nav className="admin-tab-bar" aria-label="Navegação principal">
        <div className="admin-tab-bar__items">
          {PHONE_TABS.map(({ id, to, label, icon: Icon }) => {
            const active = isRouteActive(pathname, to);
            return (
              <NavLink
                key={id}
                to={to}
                end={to === '/admin'}
                className="admin-tab-bar__item"
                aria-current={active ? 'page' : undefined}
              >
                <Icon strokeWidth={active ? 2.3 : 2} aria-hidden="true" />
                <span className="admin-tab-bar__label">{label}</span>
              </NavLink>
            );
          })}
          <button
            ref={maisRef}
            type="button"
            className="admin-tab-bar__item"
            aria-current={onMaisRoute ? 'page' : undefined}
            aria-expanded={maisOpen}
            aria-haspopup="dialog"
            onClick={() => setMaisOpen(true)}
          >
            <Ellipsis aria-hidden="true" />
            <span className="admin-tab-bar__label">Mais</span>
          </button>
        </div>
      </nav>
      <MaisSheet {...props} open={maisOpen} onOpenChange={setMaisOpen} returnFocusRef={maisRef} />
    </>
  );
}
