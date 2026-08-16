import { Fragment } from 'react';
import { NavLink } from 'react-router-dom';
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
 */
export function ClienteDetalheNav({ clienteId }: ClienteDetalheNavProps) {
  const { t } = useTranslation('clients');
  const { workspaceRole, canSeeFinancials } = useAuth();
  const tabs = visibleClienteTabs(workspaceRole, canSeeFinancials);

  return (
    <nav className="cliente-tabs-nav" aria-label={t('detail.pageNav')}>
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
