import type { MetricsMonth } from '../../lib/api';
import { KpiGrid, KpiTile } from '../../components/shell/KpiTile';
import { formatMoney } from '../../lib/subscription';
import { latestMonth, monthLabel, mrrDelta, type MetricsCurrency } from './metrics-view';
import { formatMonth } from './deposits-view';

/** MRR / ARR / pagantes / variação: the same four tiles on desktop and phone (2-up there). */
export function RevenueKpis({
  months,
  currency = 'brl',
}: {
  months: MetricsMonth[];
  currency?: MetricsCurrency;
}) {
  const sfx = currency === 'usd' ? '-usd' : '';
  const current = latestMonth(months);
  const delta = mrrDelta(months);
  return (
    <KpiGrid>
      <KpiTile
        label={currency === 'usd' ? 'MRR atual (USD)' : 'MRR atual'}
        value={
          <span data-testid={`revenue-mrr${sfx}`}>
            {formatMoney(current?.mrr_cents ?? 0, currency)}
          </span>
        }
        sub={current ? monthLabel(current) : undefined}
      />
      <KpiTile
        label={currency === 'usd' ? 'ARR (USD)' : 'ARR'}
        value={
          <span data-testid={`revenue-arr${sfx}`}>
            {formatMoney(current?.arr_cents ?? 0, currency)}
          </span>
        }
      />
      <KpiTile
        label={currency === 'usd' ? 'Pagantes (USD)' : 'Pagantes'}
        value={
          <span data-testid={`revenue-paying${sfx}`}>{String(current?.paying_count ?? 0)}</span>
        }
      />
      <KpiTile
        label="Variação"
        tone={delta ? (delta.cents >= 0 ? 'success' : 'danger') : 'default'}
        value={
          <span data-testid={`revenue-delta${sfx}`}>
            {delta ? `${delta.cents >= 0 ? '+' : ''}${formatMoney(delta.cents, currency)}` : 'n/d'}
          </span>
        }
        sub={delta ? `desde ${formatMonth(delta.since)}` : undefined}
      />
    </KpiGrid>
  );
}
