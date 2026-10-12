import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { listWorkspaces, getMrr, getTrials } from '../lib/api';
import { formatMoney } from '../lib/subscription';
import { toCSV, downloadCSV } from '../lib/csv-export';
import { useIsPhone } from '../hooks/useIsPhone';
import { metricasPath } from '../lib/routes';
import { DashboardDesktop } from './dashboard/DashboardDesktop';
import { DashboardPhone } from './dashboard/DashboardPhone';
import type { DashboardKpi } from './dashboard/shared';
import { selectTrialsEndingSoon } from './dashboard-risk';
import {
  PAYING_WORKSPACE_EXPORT_COLUMNS,
  buildPayingWorkspaceExportRows,
  TRIAL_EXPORT_COLUMNS,
  buildTrialExportRows,
} from './dashboard-export';

export default function DashboardPage() {
  const isPhone = useIsPhone();

  const { data: workspacesData, isLoading: wsLoading } = useQuery({
    queryKey: ['admin', 'workspaces', { limit: 10 }],
    queryFn: () => listWorkspaces({ limit: 10 }),
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
  // The RiskCard below already shows per-group ErrorState — the KPI tile must not contradict it
  // by falling back to 0 and rendering a false all-clear during an outage.
  const riskUnavailable = trialsQuery.isError || pendingQuery.isError;

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
  // Platform-wide counts from the RPC — deriving them from the fetched page would
  // under-count once there are more workspaces than the page size.
  const totalMembers = workspacesData?.total_members ?? 0;
  // Instagram totals only exist from admin_list_workspaces v7 (20260912000001) on: undefined
  // means "database not migrated yet", which the card shows as '—' rather than a false zero.
  const igAccounts = workspacesData?.total_instagram_accounts;
  const igActive = workspacesData?.total_instagram_accounts_active;
  const igNeedingReauth =
    igAccounts !== undefined && igActive !== undefined ? igAccounts - igActive : 0;

  // Trials carry an *expected* MRR (what they convert to); the "MRR projetado" card sums
  // realized + expected.
  const trialMrrCents = trialsData?.trial_mrr_cents ?? null;
  const totalMrrCents = (mrrData?.mrr_cents ?? 0) + (trialsData?.trial_mrr_cents ?? 0);
  const currency = mrrData?.currency ?? trialsData?.currency;

  // Intl glues "R$" to the amount with a non-breaking space, so a long value can't wrap inside
  // a half-width mobile card and overflows instead. Swap it for a normal space in the KPI cards
  // only, so break-words wraps after "R$" rather than mid-number.
  const kpiMoney = (cents: number | null | undefined) =>
    formatMoney(cents, currency).replace(/[\u00A0\u202F]/g, ' ');

  // Each card gates on its own query only: the Stripe-backed MRR/Trials queries
  // must not hold the instant workspace counts hostage.
  const kpis: DashboardKpi[] = [
    { label: 'Workspaces', value: totalWorkspaces, loading: wsLoading },
    { label: 'Usuários', value: totalMembers, loading: wsLoading },
    {
      label: 'Contas do Instagram',
      value: igAccounts ?? '—',
      sub:
        igNeedingReauth > 0
          ? `${igNeedingReauth} ${igNeedingReauth === 1 ? 'precisa reconectar' : 'precisam reconectar'}`
          : undefined,
      loading: wsLoading,
    },
    {
      label: 'Pagantes',
      value: mrrData?.paying_count ?? '—',
      sub:
        mrrData && totalWorkspaces > 0
          ? `${Math.round((mrrData.paying_count / totalWorkspaces) * 100)}% dos workspaces`
          : undefined,
      loading: mrrLoading,
      to: `${metricasPath()}#mrr`,
    },
    {
      label: 'MRR',
      value: kpiMoney(mrrData?.mrr_cents ?? null),
      sub: mrrData ? `${mrrData.paying_count} pagantes` : undefined,
      loading: mrrLoading,
      to: `${metricasPath()}#mrr`,
    },
    {
      label: 'Testes',
      value: kpiMoney(trialMrrCents),
      sub: trialsData ? `${trialsData.trial_count} em teste` : undefined,
      loading: trialsLoading,
    },
    {
      label: 'Em risco',
      value: riskUnavailable ? '—' : endingSoonCount + pendingCount,
      sub: riskUnavailable
        ? 'Não foi possível carregar'
        : `${endingSoonCount} ${endingSoonCount === 1 ? 'teste vencendo' : 'testes vencendo'} · ${pendingCount} ${pendingCount === 1 ? 'pendente' : 'pendentes'}`,
      loading: trialsLoading || pendingQuery.isPending,
      tone: !riskUnavailable && endingSoonCount + pendingCount > 0 ? 'warning' : undefined,
    },
    {
      label: 'MRR projetado',
      value: kpiMoney(totalMrrCents),
      sub: 'MRR + testes',
      loading: mrrLoading || trialsLoading,
      to: `${metricasPath()}#mrr`,
    },
  ];

  const view = {
    kpis,
    risk: {
      now,
      trials: {
        data: trialsData?.trials,
        loading: trialsLoading,
        error: trialsQuery.isError,
        retry: () => trialsQuery.refetch(),
      },
      pending: {
        data: pendingQuery.data
          ? { workspaces: pendingQuery.data.workspaces, total: pendingQuery.data.total }
          : undefined,
        loading: pendingQuery.isPending,
        error: pendingQuery.isError,
        retry: () => pendingQuery.refetch(),
      },
    },
    mrr: { loading: mrrLoading, data: mrrData },
    trials: { loading: trialsLoading, data: trialsData, mrrCents: trialMrrCents, currency },
    recent: { loading: wsLoading, workspaces: workspacesData?.workspaces ?? [] },
  };

  return isPhone ? (
    <DashboardPhone {...view} />
  ) : (
    <DashboardDesktop
      {...view}
      onExportPaying={exportPayingWorkspacesCsv}
      onExportTrials={exportTrialsCsv}
    />
  );
}
