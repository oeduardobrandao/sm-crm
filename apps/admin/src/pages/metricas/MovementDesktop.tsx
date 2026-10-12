import { useMemo } from 'react';
import type { MetricsMonth } from '../../lib/api';
import { GlassPanel } from '../../components/shell/GlassPanel';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import { formatMoney } from '../../lib/subscription';
import {
  formatPct,
  MOVEMENT_KEYS,
  MOVEMENT_LABELS,
  monthLabel,
  movementSeries,
  prevCalendarMonth,
} from './metrics-view';
import { formatMonth } from './deposits-view';
import { ChurnLineChart, MovementBarChart } from './charts';

export function MovementDesktop({ months }: { months: MetricsMonth[] }) {
  const s = useMemo(() => movementSeries(months), [months]);
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <GlassPanel title="Movimento do MRR" titleId="mov-bars-title">
          <div className="h-72">
            <MovementBarChart months={months} />
          </div>
        </GlassPanel>
        <GlassPanel title="Churn" titleId="mov-churn-title">
          <div className="h-72">
            <ChurnLineChart months={months} />
          </div>
        </GlassPanel>
      </div>
      <GlassPanel flush>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Mês</TableHead>
              {MOVEMENT_KEYS.map((k) => (
                <TableHead key={k} className="text-right">
                  {MOVEMENT_LABELS[k]}
                </TableHead>
              ))}
              <TableHead className="text-right">Churn logos</TableHead>
              <TableHead className="text-right">Churn receita</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {s.months.map((m) => (
              <TableRow key={m.month}>
                <TableCell className="whitespace-nowrap">
                  <span>{monthLabel(m)}</span>
                  {m.movements_since && m.movements_since !== prevCalendarMonth(m.month) ? (
                    <span className="block text-xs text-muted-foreground">
                      desde {formatMonth(m.movements_since)}
                    </span>
                  ) : null}
                </TableCell>
                {MOVEMENT_KEYS.map((k) => (
                  <TableCell key={k} className="text-right tabular-nums">
                    {formatMoney(m.movements![k], 'brl')}
                  </TableCell>
                ))}
                <TableCell className="text-right tabular-nums">
                  {formatPct(m.churn?.logo_pct ?? null)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatPct(m.churn?.revenue_pct ?? null)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </GlassPanel>
    </div>
  );
}
