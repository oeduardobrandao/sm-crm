import { Link, useNavigate } from 'react-router-dom';
import { Download } from 'lucide-react';
import {
  formatMoney,
  intervalLabel,
  statusMeta,
  STATUS_BADGE_VARIANT,
} from '../../lib/subscription';
import { workspaceDetailPath, metricasPath } from '../../lib/routes';
import { ACTIVITY_TONE_CLASS } from '../workspace-activity';
import { Tooltip, TooltipTrigger, TooltipContent } from '../../components/ui/tooltip';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import { Skeleton } from '../../components/ui/skeleton';
import { PageHeader } from '../../components/PageHeader';
import { RowLink } from '../../components/RowLink';
import { EmptyState } from '../../components/EmptyState';
import { GlassPanel } from '../../components/shell/GlassPanel';
import { KpiGrid, KpiTile } from '../../components/shell/KpiTile';
import { cn } from '../../lib/utils';
import { RiskCard } from './RiskCard';
import { PlanBadge, activity, trialEndInfo, type DashboardViewProps } from './shared';

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-3 px-[18px] py-4">
      <Skeleton className="h-4 w-72" />
      <Skeleton className="h-4 w-64" />
      <Skeleton className="h-4 w-60" />
    </div>
  );
}

function ActivityCell({
  ws,
}: {
  ws: { last_activity_at: string | null; created_at: string | null };
}) {
  const a = activity(ws);
  return (
    <Tooltip>
      {/* asChild keeps the span: the default trigger is a <button>, which would sit
          inside this navigable row and hijack its click. */}
      <TooltipTrigger asChild>
        <span className={cn('w-fit text-sm', ACTIVITY_TONE_CLASS[a.tone])}>{a.label}</span>
      </TooltipTrigger>
      <TooltipContent>{a.title}</TooltipContent>
    </Tooltip>
  );
}

const rowClass = 'cursor-pointer';

export function DashboardDesktop({
  kpis,
  risk,
  mrr,
  trials,
  recent,
  onExportPaying,
  onExportTrials,
}: DashboardViewProps) {
  const navigate = useNavigate();
  const mrrData = mrr.data;
  const trialsData = trials.data;

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="Visão geral da plataforma"
        actions={
          <Button asChild variant="secondary">
            <Link to={metricasPath()}>Ver métricas</Link>
          </Button>
        }
      />

      <KpiGrid min={220}>
        {kpis.map((kpi) => (
          <KpiTile
            key={kpi.label}
            label={kpi.label}
            value={kpi.loading ? '—' : kpi.value}
            sub={!kpi.loading ? kpi.sub : undefined}
            tone={kpi.tone}
            to={kpi.to}
          />
        ))}
      </KpiGrid>

      <div className="mb-5 flex flex-wrap items-start gap-4">
        <RiskCard {...risk} className="flex-[1_1_340px]" />

        <GlassPanel
          title={
            <>
              Workspaces pagantes
              <span className="font-normal text-muted-foreground">
                {mrr.loading
                  ? ''
                  : ` · ${mrrData?.paying_count ?? 0} · ${formatMoney(mrrData?.mrr_cents ?? null, mrrData?.currency)}/mês`}
              </span>
            </>
          }
          className="flex-[1.5_1_480px]"
          flush
          actions={
            <Button variant="secondary" size="sm" onClick={onExportPaying}>
              <Download size={14} aria-hidden="true" />
              Exportar CSV
            </Button>
          }
        >
          {mrr.loading ? (
            <ListSkeleton />
          ) : (mrrData?.workspaces?.length ?? 0) === 0 ? (
            <EmptyState title="Nenhum workspace pagante ainda" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Workspace</TableHead>
                  <TableHead>Plano</TableHead>
                  <TableHead>Cobrança</TableHead>
                  <TableHead>Última atividade</TableHead>
                  <TableHead className="text-right">MRR</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(mrrData?.workspaces ?? []).map((ws) => {
                  const meta = statusMeta(ws.status);
                  return (
                    <TableRow
                      key={ws.workspace_id}
                      onClick={() => navigate(workspaceDetailPath(ws.workspace_id))}
                      className={rowClass}
                    >
                      <TableCell>
                        <span className="flex min-w-0 items-center gap-2">
                          <RowLink
                            to={workspaceDetailPath(ws.workspace_id)}
                            className="block truncate text-sm"
                          >
                            {ws.name}
                          </RowLink>
                          {ws.status !== 'active' && (
                            <Badge
                              variant={STATUS_BADGE_VARIANT[meta.tone]}
                              className="shrink-0 whitespace-nowrap"
                            >
                              {meta.label}
                            </Badge>
                          )}
                        </span>
                      </TableCell>
                      <TableCell>
                        <PlanBadge name={ws.plan_name} />
                      </TableCell>
                      <TableCell>
                        <span className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
                          <span className="shrink-0">{intervalLabel(ws.interval) || '—'}</span>
                          {ws.discount_label && (
                            <span
                              className="truncate text-[0.7rem] text-success"
                              title={ws.discount_label}
                            >
                              {ws.discount_label}
                            </span>
                          )}
                        </span>
                      </TableCell>
                      <TableCell>
                        <ActivityCell ws={ws} />
                      </TableCell>
                      <TableCell className="text-right font-sf text-sm">
                        {formatMoney(ws.monthly_cents, mrrData?.currency)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </GlassPanel>
      </div>

      <GlassPanel
        title="Testes"
        className="mb-5"
        flush
        actions={
          <>
            <span className="text-sm text-muted-foreground">
              {trials.loading
                ? '—'
                : `${trialsData?.trial_count ?? 0} · ${formatMoney(trials.mrrCents, trials.currency)}/mês`}
            </span>
            <Button variant="secondary" size="sm" onClick={onExportTrials}>
              <Download size={14} aria-hidden="true" />
              Exportar CSV
            </Button>
          </>
        }
      >
        {trials.loading ? (
          <ListSkeleton />
        ) : (trialsData?.trials?.length ?? 0) === 0 ? (
          <EmptyState title="Nenhum workspace em teste no momento" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Workspace</TableHead>
                <TableHead>Plano</TableHead>
                <TableHead>Fim do teste</TableHead>
                <TableHead>Última atividade</TableHead>
                <TableHead className="text-right">MRR</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(trialsData?.trials ?? []).map((ws) => {
                const { endLabel, daysLabel, daysTone } = trialEndInfo(ws.trial_ends_at);
                return (
                  <TableRow
                    key={ws.workspace_id}
                    onClick={() => navigate(workspaceDetailPath(ws.workspace_id))}
                    className={rowClass}
                  >
                    <TableCell>
                      <RowLink
                        to={workspaceDetailPath(ws.workspace_id)}
                        className="block truncate text-sm"
                      >
                        {ws.name}
                      </RowLink>
                    </TableCell>
                    <TableCell>
                      <PlanBadge name={ws.plan_name} />
                    </TableCell>
                    <TableCell>
                      <span className="flex min-w-0 items-center gap-2 text-sm">
                        <span className="truncate text-muted-foreground">{endLabel}</span>
                        {daysLabel && (
                          <Badge variant={STATUS_BADGE_VARIANT[daysTone]} className="shrink-0">
                            {daysLabel}
                          </Badge>
                        )}
                      </span>
                    </TableCell>
                    <TableCell>
                      <ActivityCell ws={ws} />
                    </TableCell>
                    <TableCell className="text-right font-sf text-sm">
                      {formatMoney(ws.monthly_cents, trials.currency)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </GlassPanel>

      <GlassPanel title="Workspaces recentes" flush>
        {recent.loading ? (
          <ListSkeleton />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Workspace</TableHead>
                <TableHead>Dono</TableHead>
                <TableHead>Plano</TableHead>
                <TableHead>Membros</TableHead>
                <TableHead>Criado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recent.workspaces.map((ws) => (
                <TableRow
                  key={ws.id}
                  onClick={() => navigate(workspaceDetailPath(ws.id))}
                  className={rowClass}
                >
                  <TableCell>
                    <RowLink to={workspaceDetailPath(ws.id)} className="text-sm">
                      {ws.name}
                    </RowLink>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {ws.owner?.name || '—'}
                  </TableCell>
                  <TableCell>
                    <PlanBadge name={ws.plan_name} />
                  </TableCell>
                  <TableCell className="font-sf text-sm">{ws.member_count}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(ws.created_at).toLocaleDateString('pt-BR', {
                      day: '2-digit',
                      month: 'short',
                    })}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </GlassPanel>
    </div>
  );
}
