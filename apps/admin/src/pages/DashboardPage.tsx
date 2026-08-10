import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { listWorkspaces, listPlans, getMrr, getTrials } from '../lib/api';
import { getPlanColor } from '../lib/plan-colors';
import { formatMoney, intervalLabel, statusMeta, toneBadgeClass } from '../lib/subscription';

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
  const { data: trialsData, isLoading: trialsLoading } = useQuery({
    queryKey: ['admin', 'trials'],
    queryFn: getTrials,
  });

  const totalWorkspaces = workspacesData?.total ?? 0;
  const activePlans = plansData?.plans?.length ?? 0;
  // Platform-wide counts from the RPC — deriving them from the fetched page would
  // under-count once there are more workspaces than the page size.
  const withOverrides = workspacesData?.total_with_overrides ?? 0;
  const totalMembers = workspacesData?.total_members ?? 0;

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
  const kpis: { label: string; value: string | number; sub?: string; loading: boolean }[] = [
    { label: 'Workspaces', value: totalWorkspaces, loading: wsLoading },
    { label: 'Total Users', value: totalMembers, loading: wsLoading },
    { label: 'Active Plans', value: activePlans, loading: plansLoading },
    { label: 'With Overrides', value: withOverrides, loading: wsLoading },
    {
      label: 'MRR',
      value: kpiMoney(mrrData?.mrr_cents ?? null),
      sub: mrrData ? `${mrrData.paying_count} pagantes` : undefined,
      loading: mrrLoading,
    },
    {
      label: 'Trials',
      value: kpiMoney(trialMrrCents),
      sub: trialsData ? `${trialsData.trial_count} em teste` : undefined,
      loading: trialsLoading,
    },
    {
      label: 'Total MRR',
      value: kpiMoney(totalMrrCents),
      sub: 'MRR + trials',
      loading: mrrLoading || trialsLoading,
    },
  ];

  return (
    <div>
      <h1 className="font-sf text-2xl font-bold mb-1">Dashboard</h1>
      <p className="text-sm text-muted-foreground mb-8">Platform overview</p>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mb-8">
        {kpis.map((kpi) => (
          <div
            key={kpi.label}
            className="glass-surface bg-card border border-border rounded-2xl p-5 min-w-0"
          >
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">
              {kpi.label}
            </p>
            <p className="text-2xl sm:text-3xl font-bold font-sf break-words">
              {kpi.loading ? '—' : kpi.value}
            </p>
            {!kpi.loading && kpi.sub ? (
              <p className="text-xs text-muted-foreground mt-1">{kpi.sub}</p>
            ) : null}
          </div>
        ))}
      </div>

      <div className="glass-surface bg-card border border-border rounded-2xl p-5 mb-8">
        <div className="flex items-baseline justify-between mb-4 gap-3">
          <h2 className="font-semibold">Paying Workspaces</h2>
          <span className="text-sm text-muted-foreground">
            {mrrLoading
              ? '—'
              : `${mrrData?.paying_count ?? 0} · ${formatMoney(mrrData?.mrr_cents ?? null, mrrData?.currency)}/mês`}
          </span>
        </div>

        {/* Desktop table header */}
        <div className="hidden md:grid grid-cols-[2fr_1fr_1.25fr_1fr] gap-2 text-xs text-muted-foreground uppercase tracking-wider pb-3 border-b border-border">
          <span>Workspace</span>
          <span>Plan</span>
          <span>Billing</span>
          <span className="text-right">MRR</span>
        </div>

        {mrrLoading ? (
          <p className="text-sm text-dim-foreground py-4">Loading...</p>
        ) : (mrrData?.workspaces?.length ?? 0) === 0 ? (
          <p className="text-sm text-dim-foreground py-4">No paying workspaces yet.</p>
        ) : (
          (mrrData?.workspaces || []).map((ws) => {
            const meta = statusMeta(ws.status);
            return (
              <div
                key={ws.workspace_id}
                onClick={() => navigate(`/admin/workspaces/${ws.workspace_id}`)}
                className="cursor-pointer hover:bg-secondary/30 transition-colors border-b border-border/50 py-3 -mx-5 px-5 md:grid md:grid-cols-[2fr_1fr_1.25fr_1fr] md:gap-2 md:items-center"
              >
                {/* Mobile card layout */}
                <div className="md:hidden flex items-center justify-between gap-3">
                  <div className="flex flex-col gap-1 min-w-0">
                    <span className="text-foreground font-medium truncate">{ws.name}</span>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      {ws.plan_name && (
                        <span
                          className="inline-block text-[0.65rem] font-semibold uppercase px-1.5 py-0.5 rounded-sm"
                          style={{
                            color: getPlanColor(ws.plan_name),
                            backgroundColor: getPlanColor(ws.plan_name) + '26',
                          }}
                        >
                          {ws.plan_name}
                        </span>
                      )}
                      <span>{intervalLabel(ws.interval) || '—'}</span>
                      {ws.status !== 'active' && (
                        <span className={`px-1.5 py-0.5 rounded-sm ${toneBadgeClass(meta.tone)}`}>
                          {meta.label}
                        </span>
                      )}
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
                    <span
                      className={`shrink-0 text-[0.7rem] px-1.5 py-0.5 rounded-sm whitespace-nowrap ${toneBadgeClass(meta.tone)}`}
                    >
                      {meta.label}
                    </span>
                  )}
                </span>
                <span className="hidden md:inline text-sm">
                  {ws.plan_name ? (
                    <span
                      className="inline-block text-[0.7rem] font-semibold uppercase px-2 py-0.5 rounded-sm"
                      style={{
                        color: getPlanColor(ws.plan_name),
                        backgroundColor: getPlanColor(ws.plan_name) + '26',
                      }}
                    >
                      {ws.plan_name}
                    </span>
                  ) : (
                    <span className="text-dim-foreground">—</span>
                  )}
                </span>
                <span className="hidden md:flex items-center gap-2 text-muted-foreground text-sm min-w-0">
                  <span className="shrink-0">{intervalLabel(ws.interval) || '—'}</span>
                  {ws.discount_label && (
                    <span className="text-[0.7rem] text-success truncate" title={ws.discount_label}>
                      {ws.discount_label}
                    </span>
                  )}
                </span>
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
          <h2 className="font-semibold">Trials</h2>
          <span className="text-sm text-muted-foreground">
            {trialsLoading
              ? '—'
              : `${trialsData?.trial_count ?? 0} · ${formatMoney(trialMrrCents, currency)}/mês`}
          </span>
        </div>

        {/* Desktop table header */}
        <div className="hidden md:grid grid-cols-[2fr_1fr_1.25fr_1fr] gap-2 text-xs text-muted-foreground uppercase tracking-wider pb-3 border-b border-border">
          <span>Workspace</span>
          <span>Plan</span>
          <span>Trial ends</span>
          <span className="text-right">MRR</span>
        </div>

        {trialsLoading ? (
          <p className="text-sm text-dim-foreground py-4">Loading...</p>
        ) : (trialsData?.trials?.length ?? 0) === 0 ? (
          <p className="text-sm text-dim-foreground py-4">No workspaces on trial right now.</p>
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
            const daysToneClass = toneBadgeClass(daysTone);
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
                className="cursor-pointer hover:bg-secondary/30 transition-colors border-b border-border/50 py-3 -mx-5 px-5 md:grid md:grid-cols-[2fr_1fr_1.25fr_1fr] md:gap-2 md:items-center"
              >
                {/* Mobile card layout */}
                <div className="md:hidden flex items-center justify-between gap-3">
                  <div className="flex flex-col gap-1 min-w-0">
                    <span className="text-foreground font-medium truncate">{ws.name}</span>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      {ws.plan_name && (
                        <span
                          className="inline-block text-[0.65rem] font-semibold uppercase px-1.5 py-0.5 rounded-sm"
                          style={{
                            color: getPlanColor(ws.plan_name),
                            backgroundColor: getPlanColor(ws.plan_name) + '26',
                          }}
                        >
                          {ws.plan_name}
                        </span>
                      )}
                      <span>{intervalLabel(ws.interval) || '—'}</span>
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
                  {ws.plan_name ? (
                    <span
                      className="inline-block text-[0.7rem] font-semibold uppercase px-2 py-0.5 rounded-sm"
                      style={{
                        color: getPlanColor(ws.plan_name),
                        backgroundColor: getPlanColor(ws.plan_name) + '26',
                      }}
                    >
                      {ws.plan_name}
                    </span>
                  ) : (
                    <span className="text-dim-foreground">—</span>
                  )}
                </span>
                <span className="hidden md:flex items-center gap-2 text-sm min-w-0">
                  <span className="text-muted-foreground truncate">{endLabel}</span>
                  {daysLabel && (
                    <span
                      className={`shrink-0 text-[0.7rem] px-1.5 py-0.5 rounded-sm ${daysToneClass}`}
                    >
                      {daysLabel}
                    </span>
                  )}
                </span>
                <span className="hidden md:block text-right font-sf text-sm">
                  {formatMoney(ws.monthly_cents, currency)}
                </span>
              </div>
            );
          })
        )}
      </div>

      <div className="glass-surface bg-card border border-border rounded-2xl p-5">
        <h2 className="font-semibold mb-4">Recent Workspaces</h2>

        {/* Desktop table header */}
        <div className="hidden md:grid grid-cols-[2fr_1.5fr_1fr_1fr_0.75fr] gap-2 text-xs text-muted-foreground uppercase tracking-wider pb-3 border-b border-border">
          <span>Workspace</span>
          <span>Owner</span>
          <span>Plan</span>
          <span>Members</span>
          <span>Created</span>
        </div>

        {wsLoading ? (
          <p className="text-sm text-dim-foreground py-4">Loading...</p>
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
                  <span>{ws.member_count} members</span>
                  {ws.plan_name && (
                    <>
                      <span>·</span>
                      <span
                        className="inline-block text-[0.65rem] font-semibold uppercase px-1.5 py-0.5 rounded-sm"
                        style={{
                          color: getPlanColor(ws.plan_name),
                          backgroundColor: getPlanColor(ws.plan_name) + '26',
                        }}
                      >
                        {ws.plan_name}
                      </span>
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
                {ws.plan_name ? (
                  <span
                    className="inline-block text-[0.7rem] font-semibold uppercase px-2 py-0.5 rounded-sm"
                    style={{
                      color: getPlanColor(ws.plan_name),
                      backgroundColor: getPlanColor(ws.plan_name) + '26',
                    }}
                  >
                    {ws.plan_name}
                  </span>
                ) : (
                  <span className="text-dim-foreground">—</span>
                )}
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
