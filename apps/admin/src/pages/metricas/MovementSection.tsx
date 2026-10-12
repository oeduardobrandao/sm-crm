import { useMemo } from 'react';
import { GlassPanel } from '../../components/shell/GlassPanel';
import { Skeleton } from '../../components/ui/skeleton';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { useIsPhone } from '../../hooks/useIsPhone';
import { useMetricsHistory } from './useMetricsHistory';
import { movementSeries } from './metrics-view';
import { MovementDesktop } from './MovementDesktop';
import { MovementPhone } from './MovementPhone';

export function MovementSection() {
  const q = useMetricsHistory();
  const isPhone = useIsPhone();
  const months = useMemo(() => q.data?.months ?? [], [q.data]);
  const withMovements = useMemo(() => movementSeries(months).months, [months]);

  if (q.isPending) return <Skeleton className="h-80 w-full rounded-2xl" />;
  if (q.isError)
    return (
      <GlassPanel flush>
        <ErrorState message="Não foi possível carregar o histórico." onRetry={() => q.refetch()} />
      </GlassPanel>
    );
  if (!withMovements.length) {
    return (
      <GlassPanel flush>
        <EmptyState
          title="Movimento aparece a partir do segundo mês"
          description="Cada mês é comparado com o fechamento anterior."
        />
      </GlassPanel>
    );
  }

  return isPhone ? <MovementPhone months={months} /> : <MovementDesktop months={months} />;
}
