import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Search, ArrowRight } from 'lucide-react';
import { listWorkspaces, listPlans } from '../lib/api';
import { getPlanColor } from '../lib/plan-colors';

export default function WorkspacesPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [planFilter, setPlanFilter] = useState('');
  const [page, setPage] = useState(0);
  const limit = 20;

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'workspaces', { search, plan_id: planFilter, offset: page * limit, limit }],
    queryFn: () => listWorkspaces({ search: search || undefined, plan_id: planFilter || undefined, offset: page * limit, limit }),
  });

  const { data: plansData } = useQuery({
    queryKey: ['admin', 'plans'],
    queryFn: listPlans,
  });

  const workspaces = data?.workspaces || [];
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / limit);

  return (
    <div>
      <h1 className="font-['Playfair_Display'] text-2xl font-bold mb-1">Workspaces</h1>
      <p className="text-sm text-muted-foreground mb-6">All registered workspaces</p>

      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="flex-1 relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search workspaces..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            className="w-full pl-9 pr-3 py-2.5 rounded-lg bg-card border border-border text-sm font-['DM_Mono'] text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary transition-colors"
          />
        </div>
        <select
          value={planFilter}
          onChange={(e) => { setPlanFilter(e.target.value); setPage(0); }}
          className="px-3 py-2.5 rounded-lg bg-card border border-border text-sm text-muted-foreground focus:outline-none focus:border-primary"
        >
          <option value="">All Plans</option>
          {plansData?.plans?.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      <div className="bg-card border border-border rounded-2xl p-5">
        {/* Desktop table header */}
        <div className="hidden md:grid grid-cols-[2fr_1.5fr_1fr_0.75fr_0.75fr_0.75fr_0.5fr] gap-2 text-[0.7rem] text-muted-foreground uppercase tracking-wider pb-3 border-b border-border">
          <span>Workspace</span>
          <span>Owner</span>
          <span>Plan</span>
          <span>Clients</span>
          <span>Members</span>
          <span>Created</span>
          <span></span>
        </div>

        {isLoading ? (
          <p className="text-sm text-dim-foreground py-4">Loading...</p>
        ) : workspaces.length === 0 ? (
          <p className="text-sm text-dim-foreground py-4">No workspaces found.</p>
        ) : (
          workspaces.map((ws) => (
            <div
              key={ws.id}
              onClick={() => navigate(`/admin/workspaces/${ws.id}`)}
              className="cursor-pointer hover:bg-secondary/30 transition-colors border-b border-border/50 py-3 -mx-5 px-5 md:grid md:grid-cols-[2fr_1.5fr_1fr_0.75fr_0.75fr_0.75fr_0.5fr] md:gap-2 md:items-center"
            >
              {/* Mobile card layout */}
              <div className="md:hidden flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-foreground font-medium">{ws.name}</span>
                  {ws.has_overrides && (
                    <span className="text-[0.6rem] font-semibold uppercase px-1.5 py-0.5 rounded-sm bg-warning/10 text-warning">
                      OVERRIDES
                    </span>
                  )}
                  <ArrowRight size={14} className="ml-auto text-muted-foreground" />
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span className="truncate max-w-[180px]">{ws.owner?.email || '—'}</span>
                  {ws.plan_name && (
                    <span className="inline-block text-[0.65rem] font-semibold uppercase px-1.5 py-0.5 rounded-sm"
                      style={{ color: getPlanColor(ws.plan_name), backgroundColor: getPlanColor(ws.plan_name) + '26' }}>
                      {ws.plan_name}
                    </span>
                  )}
                  <span>{ws.client_count} clients</span>
                  <span>{ws.member_count} members</span>
                </div>
              </div>
              {/* Desktop row */}
              <span className="hidden md:inline">
                <span className="text-foreground font-medium">{ws.name}</span>
                {ws.has_overrides && (
                  <span className="ml-2 text-[0.6rem] font-semibold uppercase px-1.5 py-0.5 rounded-sm bg-warning/10 text-warning">
                    OVERRIDES
                  </span>
                )}
              </span>
              <span className="hidden md:inline text-muted-foreground truncate text-sm">{ws.owner?.email || '—'}</span>
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
              <span className="hidden md:inline font-['DM_Mono'] text-sm">{ws.client_count}</span>
              <span className="hidden md:inline font-['DM_Mono'] text-sm">{ws.member_count}</span>
              <span className="hidden md:inline text-muted-foreground text-sm">
                {new Date(ws.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
              </span>
              <span className="hidden md:inline text-muted-foreground"><ArrowRight size={16} /></span>
            </div>
          ))
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex justify-center gap-2 mt-4">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="px-3 py-1.5 rounded-lg text-sm bg-card border border-border text-muted-foreground disabled:opacity-30"
          >
            Previous
          </button>
          <span className="px-3 py-1.5 text-sm text-muted-foreground">
            {page + 1} / {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            className="px-3 py-1.5 rounded-lg text-sm bg-card border border-border text-muted-foreground disabled:opacity-30"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
