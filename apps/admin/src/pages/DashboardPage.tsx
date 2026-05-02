import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { listWorkspaces, listPlans } from '../lib/api';

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
      <p className="text-sm text-[#9ca3af] mb-8">Platform overview</p>

      <div className="grid grid-cols-4 gap-4 mb-8">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="bg-[#12151a] border border-[#1e2430] rounded-2xl p-5">
            <p className="text-xs text-[#9ca3af] uppercase tracking-wider mb-2">{kpi.label}</p>
            <p className="text-3xl font-bold font-['DM_Mono']">
              {isLoading ? '—' : kpi.value}
            </p>
          </div>
        ))}
      </div>

      <div className="bg-[#12151a] border border-[#1e2430] rounded-2xl p-5">
        <h2 className="font-semibold mb-4">Recent Workspaces</h2>

        <div className="grid grid-cols-[2fr_1.5fr_1fr_1fr_0.75fr] gap-2 text-xs text-[#9ca3af] uppercase tracking-wider pb-3 border-b border-[#1e2430]">
          <span>Workspace</span>
          <span>Owner</span>
          <span>Plan</span>
          <span>Members</span>
          <span>Created</span>
        </div>

        {isLoading ? (
          <p className="text-sm text-[#4b5563] py-4">Loading...</p>
        ) : (
          (workspacesData?.workspaces || []).map((ws) => (
            <div
              key={ws.id}
              onClick={() => navigate(`/admin/workspaces/${ws.id}`)}
              className="grid grid-cols-[2fr_1.5fr_1fr_1fr_0.75fr] gap-2 py-3 border-b border-[#1e2430]/50 text-sm cursor-pointer hover:bg-[#1e2430]/30 transition-colors -mx-5 px-5"
            >
              <span className="text-[#eab308] font-medium">{ws.name}</span>
              <span className="text-[#9ca3af]">{ws.owner?.name || '—'}</span>
              <span>
                {ws.plan_name ? (
                  <span className="inline-block text-[0.7rem] font-semibold uppercase px-2 py-0.5 rounded-sm bg-[#eab308]/15 text-[#eab308]">
                    {ws.plan_name}
                  </span>
                ) : (
                  <span className="text-[#4b5563]">—</span>
                )}
              </span>
              <span className="font-['DM_Mono']">{ws.member_count}</span>
              <span className="text-[#9ca3af]">
                {new Date(ws.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
