import type { KbViewStatsEntry } from '../lib/api';
import { formatCompleted, formatPeople, formatViews } from '../lib/kb-view-stats';
import { cn } from '../lib/utils';
import { Skeleton } from './ui/skeleton';

interface KbViewStatsProps {
  stats: KbViewStatsEntry | undefined;
  loading: boolean;
  failed: boolean;
  /** Videos: append the completions count to the total line. */
  showCompleted?: boolean;
  className?: string;
}

/** One article's or video's view counts: last 30 days first, then all time. */
export function KbViewStats({
  stats,
  loading,
  failed,
  showCompleted,
  className,
}: KbViewStatsProps) {
  if (loading) return <Skeleton className={cn('h-4 w-28', className)} />;
  if (failed) return null;
  if (!stats || stats.views_total === 0) {
    return (
      <span className={cn('text-xs text-muted-foreground', className)}>Sem visualizações</span>
    );
  }

  const total = [
    `Total: ${stats.views_total.toLocaleString('pt-BR')}`,
    formatPeople(stats.users_total),
  ];
  if (showCompleted) total.push(formatCompleted(stats.completed ?? 0));

  return (
    <div className={cn('min-w-0 tabular-nums', className)}>
      <div className="text-sm" title="Últimos 30 dias">
        <span className="sr-only">Últimos 30 dias:</span>
        {`${formatViews(stats.views_30d)} · ${formatPeople(stats.users_30d)}`}
      </div>
      <div className="text-xs text-muted-foreground">{total.join(' · ')}</div>
    </div>
  );
}
