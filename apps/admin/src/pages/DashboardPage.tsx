import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { listWorkspaces, listPlans, getMrr } from '../lib/api';
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

  const totalWorkspaces = workspacesData?.total ?? 0;
  const activePlans = plansData?.plans?.length ?? 0;
  const withOverrides = workspacesData?.workspaces?.filter((w) => w.has_overrides).length ?? 0;
  const totalMembers = workspacesData?.workspaces?.reduce((sum, w) => sum + w.member_count, 0) ?? 0;

  const isLoading = wsLoading || plansLoading || mrrLoading;

  const kpis = [
    { label: 'Workspaces', value: totalWorkspaces },
    { label: 'Total Users', value: totalMembers },
    { label: 'Active Plans', value: activePlans },
    { label: 'MRR', value: formatMoney(mrrData?.mrr_cents ?? null, mrrData?.currency) },
    { label: 'With Overrides', value: withOverrides },
  ];

  return (
    <div>
      <h1 className="font-sf text-2xl font-bold mb-1">Dashboard</h1>
      <p className="text-sm text-muted-foreground mb-8">Platform overview</p>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-8">
        {kpis.map((kpi) => (
          <div
            key={kpi.label}
            className="glass-surface bg-card border border-border rounded-2xl p-5"
          >
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">
              {kpi.label}
            </p>
            <p className="text-3xl font-bold font-sf">{isLoading ? '—' : kpi.value}</p>
          </div>
        ))}
      </div>

      <div className="glass-surface bg-card border border-border rounded-2xl p-5 mb-8">
        <div className="flex items-baseline justify-between mb-4 gap-3">
          <h2 className="font-semibold">Paying Workspaces</h2>
          <span className="text-sm text-muted-foreground">
            {isLoading
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

        {isLoading ? (
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

        {isLoading ? (
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
