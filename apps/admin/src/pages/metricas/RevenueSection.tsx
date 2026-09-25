import { useMemo, useState } from 'react';
import { Bar } from 'react-chartjs-2';
import { LineChart as LineChartIcon } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Skeleton } from '../../components/ui/skeleton';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { formatMoney } from '../../lib/subscription';
import { getAdminChartTheme, useIsDark } from '../../lib/chartTheme';
import { useMetricsHistory } from './useMetricsHistory';
import { BACKFILL_NOTE, latestMonth, monthLabel, mrrDelta, revenueSeries } from './metrics-view';
import { formatMonth } from './deposits-view';

function Stat({
  label,
  value,
  testId,
  sub,
}: {
  label: string;
  value: string;
  testId: string;
  sub?: string;
}) {
  return (
    <div className="glass-surface bg-card border border-border rounded-2xl p-4 min-w-0">
      <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">{label}</p>
      <p data-testid={testId} className="text-xl sm:text-2xl font-bold font-sf break-words">
        {value}
      </p>
      {sub ? <p className="text-xs text-muted-foreground mt-1">{sub}</p> : null}
    </div>
  );
}

export function RevenueSection() {
  const q = useMetricsHistory();
  useIsDark(); // subscribes to theme flips so the tokens below re-resolve on re-render
  const theme = getAdminChartTheme();
  const [mode, setMode] = useState<'provider' | 'plan'>('provider');
  const months = useMemo(() => q.data?.months ?? [], [q.data]);
  const series = useMemo(() => revenueSeries(months, mode), [months, mode]);

  if (q.isPending) return <Skeleton className="h-80 w-full rounded-2xl" />;
  if (q.isError)
    return (
      <ErrorState message="Não foi possível carregar o histórico." onRetry={() => q.refetch()} />
    );
  if (!months.length) {
    return (
      <EmptyState
        icon={LineChartIcon}
        title="Histórico ainda vazio"
        description="O histórico começa no primeiro fechamento diário ou na reconstrução pelos provedores."
      />
    );
  }

  const current = latestMonth(months);
  const delta = mrrDelta(months);
  const colors =
    mode === 'provider' ? [theme.provider.stripe, theme.provider.pagarme] : theme.categorical;
  const data = {
    labels: series.labels,
    datasets: series.series.map((s, i) => ({
      label: s.label,
      data: s.data,
      backgroundColor: months.map((m) =>
        m.closed
          ? colors[i % colors.length]
          : colors[i % colors.length].replace(/\/ 1\)$/, '/ 0.45)'),
      ),
      borderRadius: 4,
      stack: 'mrr',
    })),
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat
          label="MRR atual"
          testId="revenue-mrr"
          value={formatMoney(current?.mrr_cents ?? 0, 'brl')}
          sub={current ? monthLabel(current) : undefined}
        />
        <Stat
          label="ARR"
          testId="revenue-arr"
          value={formatMoney(current?.arr_cents ?? 0, 'brl')}
        />
        <Stat label="Pagantes" testId="revenue-paying" value={String(current?.paying_count ?? 0)} />
        <Stat
          label="Variação"
          testId="revenue-delta"
          value={delta ? `${delta.cents >= 0 ? '+' : ''}${formatMoney(delta.cents, 'brl')}` : 'n/d'}
          sub={delta ? `desde ${formatMonth(delta.since)}` : undefined}
        />
      </div>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-base">MRR por mês</CardTitle>
          <div className="flex gap-1" role="group" aria-label="Empilhar por">
            <Button
              size="sm"
              variant={mode === 'provider' ? 'secondary' : 'ghost'}
              onClick={() => setMode('provider')}
            >
              Por provedor
            </Button>
            <Button
              size="sm"
              variant={mode === 'plan' ? 'secondary' : 'ghost'}
              onClick={() => setMode('plan')}
            >
              Por plano
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="h-72">
            <Bar
              data={data}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                  x: {
                    stacked: true,
                    ticks: { color: theme.text, font: theme.font },
                    grid: { display: false },
                  },
                  y: {
                    stacked: true,
                    ticks: { color: theme.text, font: theme.font },
                    grid: { color: theme.grid },
                  },
                },
                plugins: {
                  legend: { labels: { color: theme.text, font: theme.font } },
                  tooltip: {
                    ...theme.tooltip,
                    callbacks: {
                      label: (ctx) =>
                        `${ctx.dataset.label}: ${formatMoney(Math.round(Number(ctx.raw ?? 0) * 100), 'brl')}`,
                      footer: (items) =>
                        months[items[0]?.dataIndex ?? -1]?.source === 'backfill'
                          ? BACKFILL_NOTE
                          : '',
                    },
                  },
                },
              }}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
