import { Fragment, useEffect, useRef } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { visibleClienteTabs, CLIENTE_TAB_GROUP_LABELS } from './clienteTabs.model';
import type { Cliente } from '../../store';

interface ClienteDetalheNavProps {
  clienteId: number;
  /**
   * Not read internally today — kept in the props contract because tabs may
   * need to react to cliente state (plan, features) in a later task, and this
   * is the seam ConfiguracaoLayout doesn't need but this nav does.
   */
  cliente: Cliente;
}

/**
 * Grouped, route-based tab strip for /clientes/:id/*. Each item is a real
 * `NavLink` (deep-linkable, survives a refresh); the active tab comes from
 * React Router's own route matching via `NavLink`'s `aria-current="page"`,
 * not from scroll position.
 *
 * Below the 1100px breakpoint (see `.cliente-tabs-nav` in style.css) this
 * strip becomes a horizontally-overflowing row. The effect below keeps the
 * active pill inside the visible scroll window when deep-linking straight to
 * a tab positioned further down the list (e.g. Financeiro) — otherwise the
 * strip stays scrolled to its start and the active tab is off-screen with no
 * visual cue. Ported from the pre-Task-2 anchor-based nav (git history at
 * b283b880), same manual `scrollTo`/`offsetLeft` math, but re-keyed off the
 * route (`useLocation`) instead of the old IntersectionObserver-derived
 * `activeId` scroll-spy state. Deliberately does NOT use `scrollIntoView` or
 * `IntersectionObserver` — those are the banned scroll-spy machinery this
 * split removed; see the "does not use IntersectionObserver or
 * scrollIntoView" test in ClienteDetalheNav.test.tsx.
 */
export function ClienteDetalheNav({ clienteId }: ClienteDetalheNavProps) {
  const { t } = useTranslation('clients');
  const { can } = useAuth();
  const tabs = visibleClienteTabs(can);
  const { pathname } = useLocation();
  const navRef = useRef<HTMLElement>(null);
  const tabLinkRefs = useRef<Record<string, HTMLAnchorElement | null>>({});

  // Single trailing segment after /clientes/:id/ — same extraction contract
  // as ClienteDetalhePage's own route guard.
  const activeKey = pathname.replace(/^\/clientes\/[^/]+\/?/, '').replace(/\/+$/, '');

  useEffect(() => {
    if (!activeKey || typeof window === 'undefined') return;
    if (!window.matchMedia('(max-width: 1100px)').matches) return;
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const nav = navRef.current;
    const link = tabLinkRefs.current[activeKey];
    if (!nav || !link) return;
    const centeredLeft = link.offsetLeft - (nav.clientWidth - link.offsetWidth) / 2;
    const maxLeft = Math.max(0, nav.scrollWidth - nav.clientWidth);
    nav.scrollTo({
      left: Math.min(maxLeft, Math.max(0, centeredLeft)),
      behavior: prefersReduced ? 'auto' : 'smooth',
    });
  }, [activeKey]);

  return (
    <nav className="cliente-tabs-nav" aria-label={t('detail.pageNav')} ref={navRef}>
      {tabs.map((tab, i) => {
        const Icon = tab.icon;
        const startsGroup = i === 0 || tabs[i - 1].group !== tab.group;
        return (
          <Fragment key={tab.key}>
            {startsGroup && (
              <span className="cliente-tabs-nav__label">
                {t(CLIENTE_TAB_GROUP_LABELS[tab.group])}
              </span>
            )}
            <NavLink
              ref={(el) => {
                tabLinkRefs.current[tab.key] = el;
              }}
              to={`/clientes/${clienteId}/${tab.key}`}
              className={({ isActive }) => `cliente-tabs-nav__item${isActive ? ' active' : ''}`}
            >
              <Icon className="cliente-tabs-nav__icon" aria-hidden="true" />
              <span className="cliente-tabs-nav__text">{t(tab.labelKey)}</span>
            </NavLink>
          </Fragment>
        );
      })}
    </nav>
  );
}
