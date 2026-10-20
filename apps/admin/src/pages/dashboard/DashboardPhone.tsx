import { useState, type ReactNode } from 'react';
import { Cell, GroupedList } from '@mesaas/ios-kit';
import { formatMoney, intervalLabel, statusMeta } from '../../lib/subscription';
import { workspaceDetailPath } from '../../lib/routes';
import { ACTIVITY_TONE_CLASS } from '../workspace-activity';
import { Skeleton } from '../../components/ui/skeleton';
import { PageHeader } from '../../components/PageHeader';
import { EmptyState } from '../../components/EmptyState';
import { KpiGrid, KpiTile } from '../../components/shell/KpiTile';
import { cn } from '../../lib/utils';
import { RiskCard } from './RiskCard';
import { activity, trialEndInfo, relativeCreated, type DashboardPhoneProps } from './shared';

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-3 px-4 py-4">
      <Skeleton className="h-4 w-56" />
      <Skeleton className="h-4 w-48" />
      <Skeleton className="h-4 w-44" />
    </div>
  );
}

/** Group chrome for the loading / empty states, which are not `<li>` rows. */
function GroupMessage({ header, children }: { header: string; children: ReactNode }) {
  return (
    <section className="phone-kit phone-group">
      <h2 className="phone-group__header">{header}</h2>
      <div className="phone-group__list">{children}</div>
    </section>
  );
}

const PAYING_PREVIEW = 5;

const toneClass = {
  danger: 'text-destructive',
  warning: 'text-warning',
  muted: 'text-muted-foreground',
} as const;

export function DashboardPhone({ kpis, risk, mrr, trials, recent }: DashboardPhoneProps) {
  const [showAllPaying, setShowAllPaying] = useState(false);
  const mrrData = mrr.data;
  const payingRows = mrrData?.workspaces ?? [];
  const trialsData = trials.data;
  const payingHeader = mrr.loading
    ? 'Workspaces pagantes'
    : `Workspaces pagantes · ${mrrData?.paying_count ?? 0} · ${formatMoney(mrrData?.mrr_cents ?? null, mrrData?.currency)}/mês`;
  const trialsHeader = trials.loading
    ? 'Testes'
    : `Testes · ${trialsData?.trial_count ?? 0} · ${formatMoney(trials.mrrCents, trials.currency)}/mês`;

  return (
    <div className="pb-4">
      <PageHeader title="Dashboard" description="Visão geral da plataforma" />

      <KpiGrid min={150}>
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

      <RiskCard {...risk} phone />

      {mrr.loading ? (
        <GroupMessage header={payingHeader}>
          <ListSkeleton />
        </GroupMessage>
      ) : (mrrData?.workspaces?.length ?? 0) === 0 ? (
        <GroupMessage header={payingHeader}>
          <EmptyState title="Nenhum workspace pagante ainda" />
        </GroupMessage>
      ) : (
        <GroupedList header={payingHeader}>
          {(showAllPaying ? payingRows : payingRows.slice(0, PAYING_PREVIEW)).map((ws) => {
            const a = activity(ws);
            const meta = statusMeta(ws.status);
            return (
              <Cell
                key={ws.workspace_id}
                label={ws.name}
                subtitle={
                  <>
                    {[ws.plan_name, intervalLabel(ws.interval)].filter(Boolean).join(' · ') || '—'}
                    {ws.status !== 'active' ? ` · ${meta.label}` : ''}
                    {' · '}
                    <span className={ACTIVITY_TONE_CLASS[a.tone]}>Ativo: {a.label}</span>
                  </>
                }
                value={formatMoney(ws.monthly_cents, mrrData?.currency)}
                to={workspaceDetailPath(ws.workspace_id)}
              />
            );
          })}
          {!showAllPaying && payingRows.length > PAYING_PREVIEW ? (
            <Cell
              label={`Ver todos os ${payingRows.length}`}
              onClick={() => setShowAllPaying(true)}
              chevron
            />
          ) : null}
        </GroupedList>
      )}

      {trials.loading ? (
        <GroupMessage header={trialsHeader}>
          <ListSkeleton />
        </GroupMessage>
      ) : (trialsData?.trials?.length ?? 0) === 0 ? (
        <GroupMessage header={trialsHeader}>
          <EmptyState title="Nenhum workspace em teste no momento" />
        </GroupMessage>
      ) : (
        <GroupedList header={trialsHeader}>
          {(trialsData?.trials ?? []).map((ws) => {
            const a = activity(ws);
            const { endLabel, daysLabel, daysTone } = trialEndInfo(ws.trial_ends_at);
            return (
              <Cell
                key={ws.workspace_id}
                label={ws.name}
                subtitle={
                  <>
                    {[ws.plan_name, intervalLabel(ws.interval)].filter(Boolean).join(' · ') || '—'}
                    {' · '}
                    <span className={ACTIVITY_TONE_CLASS[a.tone]}>Ativo: {a.label}</span>
                  </>
                }
                value={
                  <span className="flex flex-col items-end leading-tight">
                    <span className="text-foreground">
                      {formatMoney(ws.monthly_cents, trials.currency)}
                    </span>
                    <span className="text-xs">
                      {endLabel}
                      {daysLabel && <span className={cn(toneClass[daysTone])}> · {daysLabel}</span>}
                    </span>
                  </span>
                }
                to={workspaceDetailPath(ws.workspace_id)}
              />
            );
          })}
        </GroupedList>
      )}

      {recent.loading ? (
        <GroupMessage header="Workspaces recentes">
          <ListSkeleton />
        </GroupMessage>
      ) : (
        <GroupedList header="Workspaces recentes">
          {recent.workspaces.map((ws) => (
            <Cell
              key={ws.id}
              label={ws.name}
              subtitle={
                // Only the owner's name truncates, so the member count and plan stay visible.
                <span className="flex min-w-0">
                  <span className="truncate">{ws.owner?.name || '—'}</span>
                  <span className="shrink-0 whitespace-pre">
                    {` · ${ws.member_count} ${ws.member_count === 1 ? 'membro' : 'membros'}`}
                    {ws.plan_name ? ` · ${ws.plan_name}` : ''}
                  </span>
                </span>
              }
              value={relativeCreated(ws.created_at)}
              to={workspaceDetailPath(ws.id)}
            />
          ))}
        </GroupedList>
      )}
    </div>
  );
}
