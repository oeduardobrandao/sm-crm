// Workspace detail on desktop (DkWorkspaceDetalhe): back link + hero header, a segmented
// control over the sections, panels below. Data and handlers come from the page.
import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { SegmentedControl } from '@mesaas/ios-kit';
import { statusMeta, STATUS_BADGE_VARIANT, hasSubscription } from '../../lib/subscription';
import { sanitizeExternalUrl } from '../../lib/security';
import { getPlanColor } from '../../lib/plan-colors';
import type { McpKeyRow, OAuthGrantRow } from '../../lib/api';
import { PageHeader } from '../../components/PageHeader';
import { KpiGrid } from '../../components/shell/KpiTile';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import WorkspaceInvitesCard from '../WorkspaceInvitesCard';
import WorkspaceEventsCard from '../WorkspaceEventsCard';
import { UsageTile, dashboardLink, ownerLine, usageTiles } from './shared';
import {
  ConnectionsPanel,
  FeaturesPanel,
  LimitsPanel,
  MembersPanel,
  NotesPanel,
  OverridesPanel,
  SubscriptionPanel,
} from './PanelsDesktop';
import type { WorkspaceDetailViewProps } from './types';

/** Radix Select rejects '' as an item value; this sentinel stands for "Sem plano". */
const NO_PLAN = '__none__';

type Section = 'geral' | 'funcionalidades' | 'limites' | 'membros' | 'atividade';
const SECTIONS: { value: Section; label: string }[] = [
  { value: 'geral', label: 'Visão geral' },
  { value: 'funcionalidades', label: 'Funcionalidades' },
  { value: 'limites', label: 'Limites' },
  { value: 'membros', label: 'Membros' },
  { value: 'atividade', label: 'Atividade' },
];

export function WorkspaceDetailDesktop(props: WorkspaceDetailViewProps) {
  const { data, workspaceId } = props;
  const [section, setSection] = useState<Section>('geral');
  const link = dashboardLink(data);
  const sub = data.subscription;
  const status = hasSubscription(sub) ? statusMeta(sub.status) : null;
  const overrides = props.resourceOverrideCount + props.featureOverrideCount;
  const planColor = data.plan ? getPlanColor(data.plan.name) : null;

  const actions = (
    <>
      {link && (
        <Button variant="secondary" asChild>
          <a href={sanitizeExternalUrl(link.href)} target="_blank" rel="noopener noreferrer">
            <ExternalLink aria-hidden="true" />
            {link.label}
          </a>
        </Button>
      )}
      <span id="workspace-plan-label" className="sr-only">
        Plano do workspace
      </span>
      <Select
        value={props.selectedPlanId === '' ? NO_PLAN : props.selectedPlanId}
        onValueChange={(v) => props.onPlanChange(v === NO_PLAN ? '' : v)}
      >
        <SelectTrigger
          id="workspace-plan-trigger"
          aria-labelledby="workspace-plan-label workspace-plan-trigger"
          className="h-[34px] w-auto gap-2 rounded-full border-0 bg-foreground/[0.12] px-3.5 font-semibold shadow-none"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_PLAN}>Sem plano</SelectItem>
          {props.plans.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {data.workspace.plan_source === 'manual' && (
        <Button variant="secondary" onClick={props.onUnsetComp} disabled={props.unsetPending}>
          Remover comp (voltar à cobrança)
        </Button>
      )}
    </>
  );

  const tabId = (s: Section) => `wd-tab-${s}`;
  const panelId = 'wd-section-panel';

  return (
    <div className="w-full min-w-0 max-w-full">
      <PageHeader
        back={{ to: '/admin/workspaces', label: 'Workspaces' }}
        title={data.workspace.name}
        description={ownerLine(data)}
        actions={actions}
      >
        <div className="flex flex-col items-start gap-4">
          <div className="flex flex-wrap gap-1.5" aria-label="Situação do workspace">
            {data.plan && planColor && (
              <Badge
                style={{
                  color: planColor,
                  backgroundColor: `color-mix(in srgb, ${planColor} 15%, transparent)`,
                }}
              >
                {data.plan.name}
              </Badge>
            )}
            {status && <Badge variant={STATUS_BADGE_VARIANT[status.tone]}>{status.label}</Badge>}
            {data.workspace.plan_source === 'manual' && <Badge variant="info">Comp</Badge>}
            {overrides > 0 && <Badge variant="primary">Overrides</Badge>}
          </div>
          <SegmentedControl
            semantics="tablist"
            aria-label="Seções do workspace"
            value={section}
            onChange={setSection}
            options={SECTIONS.map((s) => ({ ...s, id: tabId(s.value), controls: panelId }))}
          />
        </div>
      </PageHeader>

      <div
        role="tabpanel"
        id={panelId}
        aria-labelledby={tabId(section)}
        className="flex min-w-0 flex-col gap-4"
      >
        {section === 'geral' && (
          <>
            <KpiGrid min={180}>
              {usageTiles(data).map((t) => (
                <UsageTile key={t.label} tile={t} />
              ))}
            </KpiGrid>
            <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
              <div className="flex min-w-0 flex-col gap-4">
                <MembersPanel members={data.members} />
                <NotesPanel {...props} />
              </div>
              <div className="flex min-w-0 flex-col gap-4">
                <SubscriptionPanel data={data} />
                <OverridesPanel {...props} />
              </div>
            </div>
          </>
        )}
        {section === 'funcionalidades' && <FeaturesPanel {...props} />}
        {section === 'limites' && <LimitsPanel {...props} />}
        {section === 'membros' && (
          <>
            <MembersPanel members={data.members} />
            <WorkspaceInvitesCard workspaceId={workspaceId} />
          </>
        )}
        {section === 'atividade' && (
          <>
            <WorkspaceEventsCard workspaceId={workspaceId} />
            <ConnectionsPanel<McpKeyRow>
              title="Chaves de API do MCP"
              titleId="wd-mcp-keys"
              firstColumn="Nome"
              emptyText="Nenhuma chave ativa."
              model={props.mcpKeys}
              toRow={(k) => ({
                id: k.id,
                primary: (
                  <>
                    <span className="font-medium">{k.name}</span>
                    <span className="text-muted-foreground"> …{k.token_suffix}</span>
                  </>
                ),
                scopes: k.scopes,
                revoked: !!k.revoked_at,
              })}
            />
            <ConnectionsPanel<OAuthGrantRow>
              title="Conexões OAuth do MCP"
              titleId="wd-oauth-grants"
              firstColumn="Conectado por"
              emptyText="Nenhuma conexão ativa."
              model={props.oauthGrants}
              toRow={(g) => ({
                id: g.id,
                primary: <span className="font-medium">{g.connected_by ?? 'Claude'}</span>,
                scopes: g.scopes,
                revoked: !!g.revoked_at,
              })}
            />
          </>
        )}
      </div>
    </div>
  );
}
