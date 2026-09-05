import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Download } from 'lucide-react';
import { toast } from 'sonner';
import { listWorkspaces, listPlans, getMrr, getTrials } from '../lib/api';
import { getPlanColor } from '../lib/plan-colors';
import { formatMoney, intervalLabel, statusMeta } from '../lib/subscription';
import { toCSV, downloadCSV } from '../lib/csv-export';
import { describeActivity, ACTIVITY_TONE_CLASS } from './workspace-activity';
import { Tooltip, TooltipTrigger, TooltipContent } from '../components/ui/tooltip';
import { Badge } from '../components/ui/badge';
import { PageHeader } from '../components/PageHeader';
import { cn } from '../lib/utils';
import { RiskCard } from './dashboard/RiskCard';
import { selectTrialsEndingSoon } from './dashboard-risk';
import {
  PAYING_WORKSPACE_EXPORT_COLUMNS,
  buildPayingWorkspaceExportRows,
  TRIAL_EXPORT_COLUMNS,
  buildTrialExportRows,
} from './dashboard-export';

const STATUS_VARIANT = {
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  muted: 'neutral',
} as const;

function PlanBadge({ name }: { name: string | null }) {
  if (!name) return <span className="text-dim-foreground">—</span>;
  const color = getPlanColor(name);
  return (
    <Badge variant="neutral" style={{ color, backgroundColor: `${color}26` }}>
      {name}
    </Badge>
  );
}

// created_at is only read when last_activity_at is null ("Nunca"); the "now" fallback keeps
// that branch on the cooling tone in the unlikely case the workspace row wasn't found.
const activity = (ws: { last_activity_at: string | null; created_at: string | null }) =>
  describeActivity(ws.last_activity_at, ws.created_at ?? new Date().toISOString(), new Date());

export default function DashboardPage() {
  const navigate = useNavigate();

  const { data: workspacesData, isLoading: wsLoading } = useQuery({
    queryKey: ['admin', 'workspaces', { limit: 10 }],
    queryFn: () => listWorkspaces({ limit: 10 }),
  });

  const { data: plansData, isLoading: plansLoading } = useQuery({
    queryKey: ['admin', 'plans'],
    queryFn: listPlans,
  });

  // MRR is sourced from real Stripe subscriptions (workspace_subscriptions), not plan-assignment
  // counts, so complimentary/manual plan grants never inflate it.
  const { data: mrrData, isLoading: mrrLoading } = useQuery({
    queryKey: ['admin', 'mrr'],
    queryFn: getMrr,
  });

  // Workspaces on a Stripe trial (status 'trialing') — separate from MRR, which they don't
  // contribute to until they convert.
  const trialsQuery = useQuery({
    queryKey: ['admin', 'trials'],
    queryFn: getTrials,
  });
  const trialsData = trialsQuery.data;
  const trialsLoading = trialsQuery.isLoading;

  // Past-due subscriptions, least-recently-active first. total feeds the KPI, rows feed the card.
  const pendingQuery = useQuery({
    queryKey: [
      'admin',
      'workspaces',
      { status: 'pendente', sort: 'last_activity_at', dir: 'asc', limit: 5 },
    ],
    queryFn: () =>
      listWorkspaces({
        status: 'pendente',
        sort: 'last_activity_at',
        dir: 'asc',
        offset: 0,
        limit: 5,
      }),
  });
  const now = new Date();
  const endingSoonCount = trialsData ? selectTrialsEndingSoon(trialsData.trials, now).length : 0;
  const pendingCount = pendingQuery.data?.total ?? 0;

  function exportPayingWorkspacesCsv() {
    const workspaces = mrrData?.workspaces ?? [];
    if (workspaces.length === 0) {
      toast.error('Nada para exportar');
      return;
    }
    const csv = toCSV(buildPayingWorkspaceExportRows(workspaces), PAYING_WORKSPACE_EXPORT_COLUMNS);
    downloadCSV(`paying-workspaces-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  }

  function exportTrialsCsv() {
    const trials = trialsData?.trials ?? [];
    if (trials.length === 0) {
      toast.error('Nada para exportar');
      return;
    }
    const csv = toCSV(buildTrialExportRows(trials), TRIAL_EXPORT_COLUMNS);
    downloadCSV(`trials-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  }

  const totalWorkspaces = workspacesData?.total ?? 0;
  const activePlans = plansData?.plans?.length ?? 0;
  // Platform-wide counts from the RPC — deriving them from the fetched page would
  // under-count once there are more workspaces than the page size.
  const withOverrides = workspacesData?.total_with_overrides ?? 0;
  const totalMembers = workspacesData?.total_members ?? 0;
  const totalClients = workspacesData?.total_clients ?? 0;

  // Trials carry an *expected* MRR (what they convert to); the Total card sums realized + expected.
  const trialMrrCents = trialsData?.trial_mrr_cents ?? null;
  const totalMrrCents = (mrrData?.mrr_cents ?? 0) + (trialsData?.trial_mrr_cents ?? 0);
  const currency = mrrData?.currency ?? trialsData?.currency;

  // Intl glues "R$" to the amount with a non-breaking space, so a long value can't wrap inside
  // a half-width mobile card and overflows instead. Swap it for a normal space in the KPI cards
  // only, so break-words wraps after "R$" rather than mid-number.
  const kpiMoney = (cents: number | null | undefined) =>
    formatMoney(cents, currency).replace(/[\u00A0\u202F]/g, ' ');

  // Each card gates on its own query only: the Stripe-backed MRR/Trials queries
  // must not hold the instant workspace/plan counts hostage.
  const kpis: {
    label: string;
    value: string | number;
    sub?: string;
    loading: boolean;
    tone?: 'warning';
  }[] = [
    { label: 'Workspaces', value: totalWorkspaces, loading: wsLoading },
    { label: 'Usuários', value: totalMembers, loading: wsLoading },
    { label: 'Clientes', value: totalClients, loading: wsLoading },
    { label: 'Planos ativos', value: activePlans, loading: plansLoading },
    { label: 'Com overrides', value: withOverrides, loading: wsLoading },
    {
      label: 'MRR',
      value: kpiMoney(mrrData?.mrr_cents ?? null),
      sub: mrrData ? `${mrrData.paying_count} pagantes` : undefined,
      loading: mrrLoading,
    },
    {
      label: 'Testes',
      value: kpiMoney(trialMrrCents),
      sub: trialsData ? `${trialsData.trial_count} em teste` : undefined,
      loading: trialsLoading,
    },
    {
      label: 'Em risco',
      value: endingSoonCount + pendingCount,
      sub: `${endingSoonCount} ${endingSoonCount === 1 ? 'teste vencendo' : 'testes vencendo'} · ${pendingCount} ${pendingCount === 1 ? 'pendente' : 'pendentes'}`,
      loading: trialsLoading || pendingQuery.isPending,
      tone: endingSoonCount + pendingCount > 0 ? 'warning' : undefined,
    },
    {
      label: 'MRR total',
      value: kpiMoney(totalMrrCents),
      sub: 'MRR + testes',
      loading: mrrLoading || trialsLoading,
    },
  ];

  return (
    <div>
      <PageHeader title="Dashboard" description="Visão geral da plataforma" />

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mb-8">
        {kpis.map((kpi) => (
          <div
            key={kpi.label}
            className="glass-surface bg-card border border-border rounded-2xl p-5 min-w-0"
          >
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">
              {kpi.label}
            </p>
            <p
              className={cn(
                'text-2xl sm:text-3xl font-bold font-sf break-words',
                kpi.tone === 'warning' && 'text-warning',
              )}
            >
              {kpi.loading ? '—' : kpi.value}
            </p>
            {!kpi.loading && kpi.sub ? (
              <p className="text-xs text-muted-foreground mt-1">{kpi.sub}</p>
            ) : null}
          </div>
        ))}
      </div>

      <RiskCard
        now={now}
        trials={{
          data: trialsData?.trials,
          loading: trialsLoading,
          error: trialsQuery.isError,
          retry: () => trialsQuery.refetch(),
        }}
        pending={{
          data: pendingQuery.data
            ? { workspaces: pendingQuery.data.workspaces, total: pendingQuery.data.total }
            : undefined,
          loading: pendingQuery.isPending,
          error: pendingQuery.isError,
          retry: () => pendingQuery.refetch(),
        }}
      />

      <div className="glass-surface bg-card border border-border rounded-2xl p-5 mb-8">
        <div className="flex items-baseline justify-between mb-4 gap-3">
          <h2 className="font-semibold">Workspaces pagantes</h2>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">
              {mrrLoading
                ? '—'
                : `${mrrData?.paying_count ?? 0} · ${formatMoney(mrrData?.mrr_cents ?? null, mrrData?.currency)}/mês`}
            </span>
            <button
              onClick={exportPayingWorkspacesCsv}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <Download size={14} />
              Exportar CSV
            </button>
          </div>
        </div>

        {/* Desktop table header */}
        <div className="hidden md:grid grid-cols-[2fr_1fr_1.25fr_1fr_1fr] gap-2 text-xs text-muted-foreground uppercase tracking-wider pb-3 border-b border-border">
          <span>Workspace</span>
          <span>Plano</span>
          <span>Cobrança</span>
          <span>Última atividade</span>
          <span className="text-right">MRR</span>
        </div>

        {mrrLoading ? (
          <p className="text-sm text-dim-foreground py-4">Carregando…</p>
        ) : (mrrData?.workspaces?.length ?? 0) === 0 ? (
          <p className="text-sm text-dim-foreground py-4">Nenhum workspace pagante ainda.</p>
        ) : (
          (mrrData?.workspaces || []).map((ws) => {
            const meta = statusMeta(ws.status);
            return (
              <div
                key={ws.workspace_id}
                onClick={() => navigate(`/admin/workspaces/${ws.workspace_id}`)}
                className="cursor-pointer hover:bg-secondary/30 transition-colors border-b border-border/50 py-3 -mx-5 px-5 md:grid md:grid-cols-[2fr_1fr_1.25fr_1fr_1fr] md:gap-2 md:items-center"
              >
                {/* Mobile card layout */}
                <div className="md:hidden flex items-center justify-between gap-3">
                  <div className="flex flex-col gap-1 min-w-0">
                    <span className="text-foreground font-medium truncate">{ws.name}</span>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      {ws.plan_name && <PlanBadge name={ws.plan_name} />}
                      <span>{intervalLabel(ws.interval) || '—'}</span>
                      {ws.status !== 'active' && (
                        <Badge variant={STATUS_VARIANT[meta.tone]}>{meta.label}</Badge>
                      )}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className={ACTIVITY_TONE_CLASS[activity(ws).tone]}>
                            Ativo: {activity(ws).label}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>{activity(ws).title}</TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                  <span className="font-sf font-medium whitespace-nowrap">
                    {formatMoney(ws.monthly_cents, mrrData?.currency)}
                  </span>
                </div>

                {/* Desktop row */}
                <span className="hidden md:flex items-center gap-2 min-w-0">
                  <span className="text-foreground font-medium text-sm truncate">{ws.name}</span>
                  {ws.status !== 'active' && (
                    <Badge
                      variant={STATUS_VARIANT[meta.tone]}
                      className="shrink-0 whitespace-nowrap"
                    >
                      {meta.label}
                    </Badge>
                  )}
                </span>
                <span className="hidden md:inline text-sm">
                  <PlanBadge name={ws.plan_name} />
                </span>
                <span className="hidden md:flex items-center gap-2 text-muted-foreground text-sm min-w-0">
                  <span className="shrink-0">{intervalLabel(ws.interval) || '—'}</span>
                  {ws.discount_label && (
                    <span className="text-[0.7rem] text-success truncate" title={ws.discount_label}>
                      {ws.discount_label}
                    </span>
                  )}
                </span>
                <Tooltip>
                  {/* asChild keeps the span: the default trigger is a <button>, which would sit
                      inside this navigable row and hijack its click. */}
                  <TooltipTrigger asChild>
                    <span
                      className={`hidden w-fit md:inline text-sm ${ACTIVITY_TONE_CLASS[activity(ws).tone]}`}
                    >
                      {activity(ws).label}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{activity(ws).title}</TooltipContent>
                </Tooltip>
                <span className="hidden md:block text-right font-sf text-sm">
                  {formatMoney(ws.monthly_cents, mrrData?.currency)}
                </span>
              </div>
            );
          })
        )}
      </div>

      <div className="glass-surface bg-card border border-border rounded-2xl p-5 mb-8">
        <div className="flex items-baseline justify-between mb-4 gap-3">
          <h2 className="font-semibold">Testes</h2>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">
              {trialsLoading
                ? '—'
                : `${trialsData?.trial_count ?? 0} · ${formatMoney(trialMrrCents, currency)}/mês`}
            </span>
            <button
              onClick={exportTrialsCsv}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <Download size={14} />
              Exportar CSV
            </button>
          </div>
        </div>

        {/* Desktop table header */}
        <div className="hidden md:grid grid-cols-[2fr_1fr_1.25fr_1fr_1fr] gap-2 text-xs text-muted-foreground uppercase tracking-wider pb-3 border-b border-border">
          <span>Workspace</span>
          <span>Plano</span>
          <span>Fim do teste</span>
          <span>Última atividade</span>
          <span className="text-right">MRR</span>
        </div>

        {trialsLoading ? (
          <p className="text-sm text-dim-foreground py-4">Carregando…</p>
        ) : (trialsData?.trials?.length ?? 0) === 0 ? (
          <p className="text-sm text-dim-foreground py-4">Nenhum workspace em teste no momento.</p>
        ) : (
          (trialsData?.trials || []).map((ws) => {
            const end = ws.trial_ends_at ? new Date(ws.trial_ends_at) : null;
            const endLabel = end
              ? end.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
              : '—';
            // An end time that has already passed is "expirado" — decided by exact timestamp, so a
            // trial that ended earlier *today* (webhook status update still in flight) isn't shown
            // as "expira hoje". For a still-future end, the calendar-day delta distinguishes
            // "expira hoje" (ends later today) from "Nd" — a 24h-window Math.ceil would mislabel
            // "later today" as "1d". Math.round absorbs the ±1h DST wobble between two midnights.
            let daysLabel: string | null = null;
            let daysTone: 'danger' | 'warning' | 'muted' = 'muted';
            if (end) {
              if (end.getTime() <= Date.now()) {
                daysLabel = 'expirado';
                daysTone = 'danger';
              } else {
                const startOfToday = new Date();
                startOfToday.setHours(0, 0, 0, 0);
                const endDay = new Date(end);
                endDay.setHours(0, 0, 0, 0);
                const dayDiff = Math.round(
                  (endDay.getTime() - startOfToday.getTime()) / 86_400_000,
                );
                daysLabel = dayDiff === 0 ? 'expira hoje' : `${dayDiff}d`;
                daysTone = dayDiff <= 3 ? 'warning' : 'muted';
              }
            }
            const daysTextClass =
              daysTone === 'danger'
                ? 'text-destructive'
                : daysTone === 'warning'
                  ? 'text-warning'
                  : 'text-muted-foreground';
            return (
              <div
                key={ws.workspace_id}
                onClick={() => navigate(`/admin/workspaces/${ws.workspace_id}`)}
                className="cursor-pointer hover:bg-secondary/30 transition-colors border-b border-border/50 py-3 -mx-5 px-5 md:grid md:grid-cols-[2fr_1fr_1.25fr_1fr_1fr] md:gap-2 md:items-center"
              >
                {/* Mobile card layout */}
                <div className="md:hidden flex items-center justify-between gap-3">
                  <div className="flex flex-col gap-1 min-w-0">
                    <span className="text-foreground font-medium truncate">{ws.name}</span>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      {ws.plan_name && <PlanBadge name={ws.plan_name} />}
                      <span>{intervalLabel(ws.interval) || '—'}</span>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className={ACTIVITY_TONE_CLASS[activity(ws).tone]}>
                            Ativo: {activity(ws).label}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>{activity(ws).title}</TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-0.5 whitespace-nowrap">
                    <span className="font-sf text-sm font-medium">
                      {formatMoney(ws.monthly_cents, currency)}
                    </span>
                    <span className="text-[0.7rem] text-muted-foreground">
                      {endLabel}
                      {daysLabel && <span className={daysTextClass}> · {daysLabel}</span>}
                    </span>
                  </div>
                </div>

                {/* Desktop row */}
                <span className="hidden md:inline text-foreground font-medium text-sm truncate">
                  {ws.name}
                </span>
                <span className="hidden md:inline text-sm">
                  <PlanBadge name={ws.plan_name} />
                </span>
                <span className="hidden md:flex items-center gap-2 text-sm min-w-0">
                  <span className="text-muted-foreground truncate">{endLabel}</span>
                  {daysLabel && (
                    <Badge variant={STATUS_VARIANT[daysTone]} className="shrink-0">
                      {daysLabel}
                    </Badge>
                  )}
                </span>
                <Tooltip>
                  {/* asChild keeps the span: the default trigger is a <button>, which would sit
                      inside this navigable row and hijack its click. */}
                  <TooltipTrigger asChild>
                    <span
                      className={`hidden w-fit md:inline text-sm ${ACTIVITY_TONE_CLASS[activity(ws).tone]}`}
                    >
                      {activity(ws).label}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{activity(ws).title}</TooltipContent>
                </Tooltip>
                <span className="hidden md:block text-right font-sf text-sm">
                  {formatMoney(ws.monthly_cents, currency)}
                </span>
              </div>
            );
          })
        )}
      </div>

      <div className="glass-surface bg-card border border-border rounded-2xl p-5">
        <h2 className="font-semibold mb-4">Workspaces recentes</h2>

        {/* Desktop table header */}
        <div className="hidden md:grid grid-cols-[2fr_1.5fr_1fr_1fr_0.75fr] gap-2 text-xs text-muted-foreground uppercase tracking-wider pb-3 border-b border-border">
          <span>Workspace</span>
          <span>Dono</span>
          <span>Plano</span>
          <span>Membros</span>
          <span>Criado</span>
        </div>

        {wsLoading ? (
          <p className="text-sm text-dim-foreground py-4">Carregando…</p>
        ) : (
          (workspacesData?.workspaces || []).map((ws) => (
            <div
              key={ws.id}
              onClick={() => navigate(`/admin/workspaces/${ws.id}`)}
              className="cursor-pointer hover:bg-secondary/30 transition-colors border-b border-border/50 py-3 -mx-5 px-5 md:grid md:grid-cols-[2fr_1.5fr_1fr_1fr_0.75fr] md:gap-2 md:items-center"
            >
              {/* Mobile card layout */}
              <div className="md:hidden flex flex-col gap-1">
                <span className="text-foreground font-medium">{ws.name}</span>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span>{ws.owner?.name || '—'}</span>
                  <span>·</span>
                  <span>{ws.member_count} membros</span>
                  {ws.plan_name && (
                    <>
                      <span>·</span>
                      <PlanBadge name={ws.plan_name} />
                    </>
                  )}
                </div>
              </div>
              {/* Desktop row */}
              <span className="hidden md:inline text-foreground font-medium text-sm">
                {ws.name}
              </span>
              <span className="hidden md:inline text-muted-foreground text-sm">
                {ws.owner?.name || '—'}
              </span>
              <span className="hidden md:inline text-sm">
                <PlanBadge name={ws.plan_name} />
              </span>
              <span className="hidden md:inline font-sf text-sm">{ws.member_count}</span>
              <span className="hidden md:inline text-muted-foreground text-sm">
                {new Date(ws.created_at).toLocaleDateString('pt-BR', {
                  day: '2-digit',
                  month: 'short',
                })}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
