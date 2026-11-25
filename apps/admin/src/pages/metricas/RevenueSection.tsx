import { useMemo, useState } from 'react';
import { LineChart as LineChartIcon } from 'lucide-react';
import { GlassPanel } from '../../components/shell/GlassPanel';
import { Skeleton } from '../../components/ui/skeleton';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { useIsPhone } from '../../hooks/useIsPhone';
import { useMetricsHistory } from './useMetricsHistory';
import { hasUsdHistory, type RevenueMode } from './metrics-view';
import { RevenueDesktop } from './RevenueDesktop';
import { RevenuePhone } from './RevenuePhone';

export function RevenueSection() {
  const q = useMetricsHistory();
  const isPhone = useIsPhone();
  // Lives here, not in a view, so the choice survives crossing the phone/desktop breakpoint.
  const [mode, setMode] = useState<RevenueMode>('provider');
  const months = useMemo(() => q.data?.months ?? [], [q.data]);
  const monthsUsd = useMemo(() => q.data?.months_usd ?? [], [q.data]);
  const showUsd = hasUsdHistory(monthsUsd);

  if (q.isPending) return <Skeleton className="h-80 w-full rounded-2xl" />;
  if (q.isError)
    return (
      <GlassPanel flush>
        <ErrorState message="Não foi possível carregar o histórico." onRetry={() => q.refetch()} />
      </GlassPanel>
    );
  if (!months.length && !showUsd) {
    return (
      <GlassPanel flush>
        <EmptyState
          icon={LineChartIcon}
          title="Histórico ainda vazio"
          description="O histórico começa no primeiro fechamento diário ou na reconstrução pelos provedores."
        />
      </GlassPanel>
    );
  }

  const View = isPhone ? RevenuePhone : RevenueDesktop;
  return (
    <div className="space-y-6">
      {months.length ? <View months={months} mode={mode} onModeChange={setMode} /> : null}
      {showUsd ? (
        <div data-testid="revenue-usd">
          <View months={monthsUsd} mode={mode} onModeChange={setMode} currency="usd" />
        </div>
      ) : null}
    </div>
  );
}
