import { useMemo } from 'react';
import { Cell, GroupedList } from '@mesaas/ios-kit';
import type { MetricsMonth } from '../../lib/api';
import { cn } from '../../lib/utils';
import {
  formatPct,
  monthLabel,
  movementNet,
  movementSeries,
  prevCalendarMonth,
  signedMoney,
} from './metrics-view';
import { formatMonth } from './deposits-view';
import { ChurnLineChart, MovementBarChart } from './charts';

function ChartCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="admin-glass overflow-hidden rounded-2xl border border-border bg-card p-3.5">
      <div className="h-56">{children}</div>
    </div>
  );
}

export function MovementPhone({ months }: { months: MetricsMonth[] }) {
  const rows = useMemo(() => [...movementSeries(months).months].reverse(), [months]);
  return (
    <div className="phone-kit">
      <h2 className="phone-group__header">Movimento do MRR</h2>
      <ChartCard>
        <MovementBarChart months={months} compact />
      </ChartCard>
      <h2 className="phone-group__header">Churn</h2>
      <ChartCard>
        <ChurnLineChart months={months} compact />
      </ChartCard>
      <GroupedList header="Por mês">
        {rows.map((m) => {
          const net = movementNet(m);
          const since =
            m.movements_since && m.movements_since !== prevCalendarMonth(m.month)
              ? ` · desde ${formatMonth(m.movements_since)}`
              : '';
          return (
            <Cell
              key={m.month}
              label={monthLabel(m)}
              subtitle={`churn ${formatPct(m.churn?.logo_pct ?? null)} logos · ${formatPct(m.churn?.revenue_pct ?? null)} receita${since}`}
              value={
                <span
                  className={cn(
                    'font-semibold tabular-nums',
                    net > 0 && 'text-success',
                    net < 0 && 'text-destructive',
                  )}
                >
                  {signedMoney(net)}
                </span>
              }
            />
          );
        })}
      </GroupedList>
    </div>
  );
}
