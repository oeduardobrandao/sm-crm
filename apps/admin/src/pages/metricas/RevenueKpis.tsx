import type { MetricsMonth } from '../../lib/api';
import { KpiGrid, KpiTile } from '../../components/shell/KpiTile';
import { formatMoney } from '../../lib/subscription';
import { latestMonth, monthLabel, mrrDelta } from './metrics-view';
import { formatMonth } from './deposits-view';

/** MRR / ARR / pagantes / variação: the same four tiles on desktop and phone (2-up there). */
export function RevenueKpis({ months }: { months: MetricsMonth[] }) {
  const current = latestMonth(months);
  const delta = mrrDelta(months);
  return (
    <KpiGrid>
      <KpiTile
        label="MRR atual"
        value={<span data-testid="revenue-mrr">{formatMoney(current?.mrr_cents ?? 0, 'brl')}</span>}
        sub={current ? monthLabel(current) : undefined}
      />
      <KpiTile
        label="ARR"
        value={<span data-testid="revenue-arr">{formatMoney(current?.arr_cents ?? 0, 'brl')}</span>}
      />
      <KpiTile
        label="Pagantes"
        value={<span data-testid="revenue-paying">{String(current?.paying_count ?? 0)}</span>}
      />
      <KpiTile
        label="Variação"
        tone={delta ? (delta.cents >= 0 ? 'success' : 'danger') : 'default'}
        value={
          <span data-testid="revenue-delta">
            {delta ? `${delta.cents >= 0 ? '+' : ''}${formatMoney(delta.cents, 'brl')}` : 'n/d'}
          </span>
        }
        sub={delta ? `desde ${formatMonth(delta.since)}` : undefined}
      />
    </KpiGrid>
  );
}
