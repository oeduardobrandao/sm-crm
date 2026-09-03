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
 * Role gating is deliberately DIFFERENT from most other tabs here — or was,
 * pre-Task-12: tabs like RelatoriosTab rely on clienteTabs.model.ts to
 * redirect a disallowed role away at the route layer for the whole-tab mount
 * decision. (RelatoriosTab does ALSO do a narrower, field-level role check of
 * its own — the send_report_email switch is disabled for non-owner/admin as
 * defense-in-depth around its DB-level guard, migration 20260904000001 — but
 * that is a single field staying read-only, not a redirect or a
 * RoleRestrictionNotice; it still never re-decides whether to mount at all.)
 * `hub` used to be an ALL-roles tab on purpose, with an agent reaching the
 * route and seeing a RoleRestrictionNotice here instead of being redirected.
 *
 * Task 12 (permission-model rewire) moved `hub`'s tab-level gate to
 * `configuracoes:editar` (clienteTabs.model.ts), which a legacy agent never
 * has — so ClienteDetalhePage's own guard redirects a legacy agent away
 * before this component ever mounts, and the notice below is unreachable
 * for that case.
 *
 * Task 14 fix: the notice used to fire on the coarse `workspaceRole ===
 * 'agent'` check, which a CUSTOM role whose chassis `workspaceRole` reads
 * 'agent' (see Task 11 report) but whose role_id permissions grant
 * `configuracoes:editar` would still pass the route-level guard and reach
 * here — the chassis check then wrongly showed this restriction notice
 * anyway, even though the route guard (and the server) had already decided
 * this member IS authorized. Now keyed on the same `can('configuracoes',
 * 'editar')` the route guard itself uses, so a custom role that clears the
 * gate never sees a notice contradicting it.
 *
 * Query isolation: `getWorkspaceSlug` is scoped to only this route (it was
 * page-wide before). HubTab owns the rest of its queries internally
 * (hub-token/hub-brand-crm/hub-pages-crm, all keyed by clienteId).
 */
export default function HubClienteTab() {
  const { clienteId, cliente } = useOutletContext<ClienteDetalheOutletContext>();
  const { t } = useTranslation('clients');
  const { can } = useAuth();
  const restricted = can('configuracoes', 'editar') !== true;

  const { data: workspaceSlug } = useQuery({
    queryKey: ['workspace-slug'],
    queryFn: getWorkspaceSlug,
  });

  if (restricted) {
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
