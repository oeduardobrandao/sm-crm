import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useHub } from '../../HubContext';
import { fetchDashboard } from '../../api';
import { PeriodSelector } from './PeriodSelector';
import { TopPostsRow } from './TopPostsRow';
import { FollowerChart } from './FollowerChart';
import { ReachChart } from './ReachChart';

export function DashboardSection() {
  const { token } = useHub();
  const [period, setPeriod] = useState(30);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['hub-dashboard', token, period],
    queryFn: () => fetchDashboard(token, period),
    staleTime: 5 * 60 * 1000,
  });

  if (isError) return null;

  if (isLoading) {
    return (
      <div className="mb-12">
        <div className="flex justify-between items-center mb-5">
          <div className="h-7 w-36 rounded-lg bg-stone-200 dark:bg-white/[0.06] animate-pulse" />
          <div className="h-8 w-32 rounded-lg bg-stone-200 dark:bg-white/[0.06] animate-pulse" />
        </div>
        <div className="flex gap-3 mb-6">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="min-w-[160px] h-[220px] rounded-2xl bg-stone-200 dark:bg-white/[0.06] animate-pulse flex-shrink-0" />
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="h-[280px] rounded-2xl bg-stone-200 dark:bg-white/[0.06] animate-pulse" />
          <div className="h-[280px] rounded-2xl bg-stone-200 dark:bg-white/[0.06] animate-pulse" />
        </div>
      </div>
    );
  }

  if (!data) return null;

  if (!data.account) {
    return (
      <div className="mb-12 hub-card p-8 text-center">
        <p className="text-sm text-stone-400">
          Conecte o Instagram para ver métricas de desempenho.
        </p>
      </div>
    );
  }

  return (
    <div className="mb-12">
      <div className="flex justify-between items-center mb-5">
        <h2 className="font-display text-xl font-semibold tracking-tight text-stone-900 dark:text-stone-100">
          Desempenho
        </h2>
        <PeriodSelector value={period} onChange={setPeriod} />
      </div>

      <div className="mb-6">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400 mb-3">
          Melhores Posts
        </h3>
        <TopPostsRow posts={data.topPosts} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FollowerChart followerHistory={data.followerHistory} />
        <ReachChart reachHistory={data.reachHistory} />
      </div>
    </div>
  );
}
