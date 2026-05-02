import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { listWorkspaces, listPlans } from '../lib/api';
import { getPlanColor } from '../lib/plan-colors';

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

  const totalWorkspaces = workspacesData?.total ?? 0;
  const activePlans = plansData?.plans?.length ?? 0;
  const withOverrides = workspacesData?.workspaces?.filter((w) => w.has_overrides).length ?? 0;
  const totalMembers = workspacesData?.workspaces?.reduce((sum, w) => sum + w.member_count, 0) ?? 0;

  const isLoading = wsLoading || plansLoading;

  const kpis = [
    { label: 'Workspaces', value: totalWorkspaces },
    { label: 'Total Users', value: totalMembers },
    { label: 'Active Plans', value: activePlans },
    { label: 'With Overrides', value: withOverrides },
  ];

  return (
    <div>
      <h1 className="font-['Playfair_Display'] text-2xl font-bold mb-1">Dashboard</h1>
      <p className="text-sm text-muted-foreground mb-8">Platform overview</p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="bg-card border border-border rounded-2xl p-5">
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">{kpi.label}</p>
            <p className="text-3xl font-bold font-['DM_Mono']">
              {isLoading ? '—' : kpi.value}
            </p>
          </div>
        ))}
      </div>

      <div className="bg-card border border-border rounded-2xl p-5">
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
                <span className="text-primary font-medium">{ws.name}</span>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span>{ws.owner?.name || '—'}</span>
                  <span>·</span>
                  <span>{ws.member_count} members</span>
                  {ws.plan_name && (
                    <>
                      <span>·</span>
                      <span className="inline-block text-[0.65rem] font-semibold uppercase px-1.5 py-0.5 rounded-sm"
                        style={{ color: getPlanColor(ws.plan_name), backgroundColor: getPlanColor(ws.plan_name) + '26' }}>
                        {ws.plan_name}
                      </span>
                    </>
                  )}
                </div>
              </div>
              {/* Desktop row */}
              <span className="hidden md:inline text-primary font-medium text-sm">{ws.name}</span>
              <span className="hidden md:inline text-muted-foreground text-sm">{ws.owner?.name || '—'}</span>
              <span className="hidden md:inline text-sm">
                {ws.plan_name ? (
                  <span className="inline-block text-[0.7rem] font-semibold uppercase px-2 py-0.5 rounded-sm"
                    style={{ color: getPlanColor(ws.plan_name), backgroundColor: getPlanColor(ws.plan_name) + '26' }}>
                    {ws.plan_name}
                  </span>
                ) : (
                  <span className="text-dim-foreground">—</span>
                )}
              </span>
              <span className="hidden md:inline font-['DM_Mono'] text-sm">{ws.member_count}</span>
              <span className="hidden md:inline text-muted-foreground text-sm">
                {new Date(ws.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
