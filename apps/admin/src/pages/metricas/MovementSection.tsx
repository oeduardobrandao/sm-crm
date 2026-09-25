import { useMemo } from 'react';
import { Bar, Line } from 'react-chartjs-2';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Skeleton } from '../../components/ui/skeleton';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import { formatMoney } from '../../lib/subscription';
import { getAdminChartTheme, useIsDark } from '../../lib/chartTheme';
import { useMetricsHistory } from './useMetricsHistory';
import {
  formatPct,
  MOVEMENT_KEYS,
  MOVEMENT_LABELS,
  monthLabel,
  movementSeries,
} from './metrics-view';
import { formatMonth } from './deposits-view';

/** 'YYYY-MM' of the calendar month before `month`. */
function prevCalendarMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

export function MovementSection() {
  const q = useMetricsHistory();
  useIsDark(); // subscribes to theme flips so the tokens below re-resolve on re-render
  const theme = getAdminChartTheme();
  const s = useMemo(() => movementSeries(q.data?.months ?? []), [q.data]);

  if (q.isPending) return <Skeleton className="h-80 w-full rounded-2xl" />;
  if (q.isError)
    return (
      <ErrorState message="Não foi possível carregar o histórico." onRetry={() => q.refetch()} />
    );
  if (!s.months.length) {
    return (
      <EmptyState
        title="Movimento aparece a partir do segundo mês"
        description="Cada mês é comparado com o fechamento anterior."
      />
    );
  }

  const axis = { ticks: { color: theme.text, font: theme.font } };
  const bar = {
    labels: s.labels,
    datasets: s.bars.map((b) => ({
      label: b.label,
      data: b.data,
      backgroundColor: theme.movement[b.key],
      borderRadius: 3,
      stack: 'mov',
    })),
  };
  const line = {
    labels: s.labels,
    datasets: [
      {
        label: 'Churn de logos (%)',
        data: s.logoPct,
        borderColor: theme.line.logo,
        backgroundColor: theme.line.logo,
        tension: 0.25,
        spanGaps: true,
      },
      {
        label: 'Churn de receita (%)',
        data: s.revenuePct,
        borderColor: theme.line.revenue,
        backgroundColor: theme.line.revenue,
        tension: 0.25,
        spanGaps: true,
      },
    ],
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Movimento do MRR</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-72">
              <Bar
                data={bar}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  scales: {
                    x: { ...axis, stacked: true, grid: { display: false } },
                    y: { ...axis, stacked: true, grid: { color: theme.grid } },
                  },
                  plugins: {
                    legend: { labels: { color: theme.text, font: theme.font } },
                    tooltip: {
                      ...theme.tooltip,
                      callbacks: {
                        label: (ctx) =>
                          `${ctx.dataset.label}: ${formatMoney(Math.round(Number(ctx.raw ?? 0) * 100), 'brl')}`,
                      },
                    },
                  },
                }}
              />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Churn</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-72">
              <Line
                data={line}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  scales: {
                    x: { ...axis, grid: { display: false } },
                    y: { ...axis, beginAtZero: true, grid: { color: theme.grid } },
                  },
                  plugins: {
                    legend: { labels: { color: theme.text, font: theme.font } },
                    tooltip: theme.tooltip,
                  },
                }}
              />
            </div>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardContent className="overflow-x-auto pt-6">
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
        </CardContent>
      </Card>
    </div>
  );
}
