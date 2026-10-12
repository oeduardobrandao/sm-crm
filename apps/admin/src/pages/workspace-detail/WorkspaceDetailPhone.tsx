// Workspace detail on phones (WorkspaceDetalhe, WorkspaceDetalhe2): nav bar, hero, usage tiles,
// then grouped lists whose rows drill down into sheets. Data and handlers come from the page.
import type { ReactNode } from 'react';
import { ExternalLink, Gauge, ToggleRight } from 'lucide-react';
import { Cell, GroupedList, PickerCell } from '@mesaas/ios-kit';
import { FEATURE_FLAG_KEYS, type McpKeyRow, type OAuthGrantRow } from '../../lib/api';
import { hasSubscription, providerLabel } from '../../lib/subscription';
import { sanitizeExternalUrl } from '../../lib/security';
import { getPlanColor } from '../../lib/plan-colors';
import { PageHeader } from '../../components/PageHeader';
import { KpiGrid } from '../../components/shell/KpiTile';
import { Badge } from '../../components/ui/badge';
import WorkspaceInvitesCard from '../WorkspaceInvitesCard';
import WorkspaceEventsCard from '../WorkspaceEventsCard';
import { ConnectionsPhone } from './ConnectionsPhone';
import {
  PagarmeLiveNotes,
  UsageTile,
  dashboardLink,
  roleLabel,
  subscriptionRows,
  subscriptionTitle,
  usageTiles,
} from './shared';
import type { WorkspaceDetailViewProps } from './types';

/** Section title with a trailing text action (the kit header has no action slot). */
function SectionHeader({ id, title, action }: { id: string; title: string; action?: ReactNode }) {
  return (
    <div className="mx-4 mb-1.5 flex items-center justify-between gap-3">
      <h2 id={id} className="phone-group__header" style={{ margin: 0 }}>
        {title}
      </h2>
      {action}
    </div>
  );
}

export function WorkspaceDetailPhone(props: WorkspaceDetailViewProps) {
  const { data, workspaceId } = props;
  const sub = data.subscription;
  const link = dashboardLink(data);
  const created = new Date(data.workspace.created_at).toLocaleDateString('pt-BR');
  const planColor = data.plan ? getPlanColor(data.plan.name) : null;

  return (
    <div className="min-w-0 pb-4">
      <PageHeader
        back={{ to: '/admin/workspaces', label: 'Workspaces' }}
        title={data.workspace.name}
      />

      <div className="flex items-center gap-3.5 pb-3.5 pt-2">
        <span
          aria-hidden="true"
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-secondary text-[22px] font-bold text-white"
          style={planColor ? { backgroundColor: planColor } : undefined}
        >
          {data.workspace.name.charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0">
          <p className="m-0 break-words font-sf text-[28px] font-bold leading-[1.1]">
            {data.workspace.name}
          </p>
          <p className="mt-1 text-[13px] leading-snug text-muted-foreground">
            Dono: {data.owner?.email || '—'}
            <br />
            {data.owner?.telefone ? `${data.owner.telefone} · ` : ''}criado em {created}
          </p>
        </div>
      </div>

      <GroupedList aria-label="Plano do workspace">
        <PickerCell<string>
          id="workspace-plan-cell"
          label="Plano"
          value={props.selectedPlanId === '' ? null : props.selectedPlanId}
          onChange={(v) => props.onPlanChange(v ?? '')}
          emptyOption={{ label: 'Sem plano' }}
          options={props.plans.map((p) => ({ value: p.id, label: p.name }))}
        />
        {data.workspace.plan_source === 'manual' && (
          <Cell
            label="Remover comp (voltar à cobrança)"
            destructive
            disabled={props.unsetPending}
            onClick={props.onUnsetComp}
          />
        )}
      </GroupedList>

      <KpiGrid>
        {usageTiles(data).map((t) => (
          <UsageTile key={t.label} tile={t} compact />
        ))}
      </KpiGrid>

      <section className="phone-group" aria-labelledby="wdp-subscription">
        <SectionHeader
          id="wdp-subscription"
          title={subscriptionTitle(data)}
          action={
            link && (
              <a
                href={sanitizeExternalUrl(link.href)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[13px] font-semibold text-primary no-underline"
              >
                {link.label}
                <ExternalLink size={12} aria-hidden="true" />
              </a>
            )
          }
        />
        {hasSubscription(sub) ? (
          <>
            <GroupedList
              aria-label={subscriptionTitle(data)}
              className="mb-0"
              footer={
                data.workspace.plan_source === 'manual'
                  ? `O plano efetivo foi ajustado manualmente (comp). Os dados acima refletem a assinatura real do cliente no ${providerLabel(sub.provider)}.`
                  : undefined
              }
            >
              {subscriptionRows(sub).map((row) => (
                <Cell key={row.label} label={row.label} value={row.value} />
              ))}
            </GroupedList>
            {sub.provider === 'pagarme' && <PagarmeLiveNotes subscription={sub} />}
          </>
        ) : (
          <p className="mx-4 text-sm text-muted-foreground">Sem assinatura.</p>
        )}
      </section>

      <GroupedList
        header="Configuração"
        footer="Valores diferentes do plano viram override deste workspace."
      >
        <Cell
          label="Limites de recursos"
          icon={<Gauge aria-hidden="true" />}
          accessory={
            props.resourceOverrideCount > 0 ? (
              <Badge variant="warning" size="sm">
                {props.resourceOverrideCount}{' '}
                {props.resourceOverrideCount === 1 ? 'override' : 'overrides'}
              </Badge>
            ) : undefined
          }
          aria-haspopup="dialog"
          chevron
          onClick={props.onOpenLimits}
        />
        <Cell
          label="Funcionalidades"
          icon={<ToggleRight aria-hidden="true" />}
          value={`${props.activeFeatureCount} de ${FEATURE_FLAG_KEYS.length}`}
          accessory={
            props.featureOverrideCount > 0 ? (
              <Badge variant="warning" size="sm">
                {props.featureOverrideCount}{' '}
                {props.featureOverrideCount === 1 ? 'override' : 'overrides'}
              </Badge>
            ) : undefined
          }
          aria-haspopup="dialog"
          chevron
          onClick={props.onOpenFeatures}
        />
      </GroupedList>

      <GroupedList header={`Membros (${data.members.length})`}>
        {data.members.map((m) => (
          <Cell
            key={m.user_id}
            label={m.name}
            subtitle={
              <span className="flex flex-col">
                <span className="truncate">{m.email}</span>
                {m.telefone && (
                  <span className="flex items-center gap-1.5">
                    {m.telefone}
                    {m.marketing_opt_in && (
                      <Badge variant="success" size="sm" title="Aceitou contato de marketing">
                        MKT
                      </Badge>
                    )}
                  </span>
                )}
              </span>
            }
            value={
              <span className={m.role === 'owner' ? 'font-semibold text-foreground' : undefined}>
                {roleLabel(m.role)}
              </span>
            }
          />
        ))}
        <WorkspaceInvitesCard workspaceId={workspaceId} />
      </GroupedList>

      <GroupedList header="Atividade e acesso">
        <WorkspaceEventsCard workspaceId={workspaceId} />
        <ConnectionsPhone<McpKeyRow>
          title="Chaves de API do MCP"
          emptyText="Nenhuma chave ativa."
          model={props.mcpKeys}
          toRow={(k) => ({
            id: k.id,
            label: `${k.name} …${k.token_suffix}`,
            scopes: k.scopes,
            revoked: !!k.revoked_at,
          })}
        />
        <ConnectionsPhone<OAuthGrantRow>
          title="Conexões OAuth do MCP"
          emptyText="Nenhuma conexão ativa."
          model={props.oauthGrants}
          toRow={(g) => ({
            id: g.id,
            label: g.connected_by ?? 'Claude',
            scopes: g.scopes,
            revoked: !!g.revoked_at,
          })}
        />
      </GroupedList>

      <section className="phone-group" aria-labelledby="wdp-notes">
        <SectionHeader
          id="wdp-notes"
          title="Notas"
          action={
            <button
              type="button"
              className="border-0 bg-transparent p-0 text-[13px] font-semibold text-primary disabled:text-muted-foreground"
              onClick={props.onSaveNotes}
              disabled={props.saveNotesPending || !props.plan}
              title={!props.plan ? 'Atribua um plano ao workspace para salvar notas' : undefined}
            >
              {props.saveNotesPending ? 'Salvando…' : 'Salvar'}
            </button>
          }
        />
        <textarea
          value={props.notes}
          onChange={(e) => props.onNotesChange(e.target.value)}
          placeholder="Notas do admin…"
          aria-label="Notas do admin"
          rows={3}
          className="box-border w-full resize-none rounded-[16px] border border-border bg-card px-3.5 py-3 text-[15px] text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      </section>
    </div>
  );
}
