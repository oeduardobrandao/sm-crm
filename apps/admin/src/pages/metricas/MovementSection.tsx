import { useMemo } from 'react';
import { GlassPanel } from '../../components/shell/GlassPanel';
import { Skeleton } from '../../components/ui/skeleton';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { useIsPhone } from '../../hooks/useIsPhone';
import { useMetricsHistory } from './useMetricsHistory';
import { hasUsdHistory, movementSeries } from './metrics-view';
import { MovementDesktop } from './MovementDesktop';
import { MovementPhone } from './MovementPhone';

export function MovementSection() {
  const q = useMetricsHistory();
  const isPhone = useIsPhone();
  const months = useMemo(() => q.data?.months ?? [], [q.data]);
  const monthsUsd = useMemo(() => q.data?.months_usd ?? [], [q.data]);
  const showUsd = hasUsdHistory(monthsUsd) && movementSeries(monthsUsd).months.length > 0;
  const withMovements = useMemo(() => movementSeries(months).months, [months]);

  if (q.isPending) return <Skeleton className="h-80 w-full rounded-2xl" />;
  if (q.isError)
    return (
      <GlassPanel flush>
        <ErrorState message="Não foi possível carregar o histórico." onRetry={() => q.refetch()} />
      </GlassPanel>
    );
  if (!withMovements.length && !showUsd) {
    return (
      <GlassPanel flush>
        <EmptyState
          title="Movimento aparece a partir do segundo mês"
          description="Cada mês é comparado com o fechamento anterior."
        />
      </GlassPanel>
    );
  }

  const View = isPhone ? MovementPhone : MovementDesktop;
  return (
    <div className="space-y-6">
      {withMovements.length ? <View months={months} /> : null}
      {showUsd ? (
        <div data-testid="movement-usd">
          <View months={monthsUsd} currency="usd" />
        </div>
      ) : null}
    </div>
  );
}
