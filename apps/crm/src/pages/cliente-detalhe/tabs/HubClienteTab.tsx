import { useOutletContext } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/context/AuthContext';
import { RoleRestrictionNotice } from '@/components/help/RoleRestrictionNotice';
import { getWorkspaceSlug } from '@/store';
import { HubTab } from '../HubTab';
import type { ClienteDetalheOutletContext } from '../clienteTabs.model';

/**
 * "Hub" tab: renders the pre-existing `HubTab.tsx` (unchanged — it owns the
 * Acesso/Briefing/Marca/Páginas/Ideias sub-tabs), ported out of the
 * pre-split ClienteDetalhePage (see git history at d30adeea) where this
 * lived as an inline `{/* Hub do Cliente *\/}` block plus a page-level
 * `workspace-slug` query.
 *
 * Role gating is deliberately DIFFERENT from most other tabs here. Tabs like
 * RelatoriosTab never re-check role because clienteTabs.model.ts already
 * redirects a disallowed role away at the route layer (STAFF-only). `hub`'s
 * `roles` entry is ALL on purpose: the plan wants every role to reach
 * /clientes/:id/hub, so an agent sees a RoleRestrictionNotice here instead
 * of being redirected. That means this tab — and only this tab among the
 * ones split so far — owns its own role check.
 *
 * Query isolation: `getWorkspaceSlug` is scoped to only this route (it was
 * page-wide before). HubTab owns the rest of its queries internally
 * (hub-token/hub-brand-crm/hub-pages-crm, all keyed by clienteId).
 */
export default function HubClienteTab() {
  const { clienteId, cliente } = useOutletContext<ClienteDetalheOutletContext>();
  const { t } = useTranslation('clients');
  const { workspaceRole } = useAuth();
  const isAgent = workspaceRole === 'agent';

  const { data: workspaceSlug } = useQuery({
    queryKey: ['workspace-slug'],
    queryFn: getWorkspaceSlug,
  });

  if (isAgent) {
    return (
      <div id="sec-hub" className="card animate-up" style={{ marginBottom: '1.5rem' }}>
        <h3 className="text-xl font-bold tracking-tight text-foreground mb-3">
          {t('detail.clientHub')}
        </h3>
        <RoleRestrictionNotice
          title={t('detail.clientHubRestrictedTitle')}
          description={t('detail.clientHubRestrictedDesc')}
        />
      </div>
    );
  }

  if (cliente.id == null || !cliente.conta_id || !workspaceSlug) {
    return null;
  }

  return (
    <div id="sec-hub" className="card animate-up" style={{ marginBottom: '1.5rem' }}>
      <h3 className="text-xl font-bold tracking-tight text-foreground mb-1">
        {t('detail.clientHub')}
      </h3>
      <p className="text-sm text-muted-foreground mb-4">{t('detail.clientHubDesc')}</p>
      <HubTab clienteId={clienteId} contaId={cliente.conta_id} workspaceSlug={workspaceSlug} />
    </div>
  );
}
