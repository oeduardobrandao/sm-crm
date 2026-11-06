import { useMemo } from 'react';
import { Bar, Line } from 'react-chartjs-2';
import type { MetricsMonth } from '../../lib/api';
import { formatMoney } from '../../lib/subscription';
import { getAdminChartTheme, useIsDark } from '../../lib/chartTheme';
import { BACKFILL_NOTE, movementSeries, revenueSeries } from './metrics-view';

/** 'YYYY-MM' to the short pt-BR month ("set") that fits a phone-width axis. */
function shortMonth(month: string): string {
  return new Date(`${month}-01T00:00:00Z`)
    .toLocaleDateString('pt-BR', { month: 'short', timeZone: 'UTC' })
    .replace('.', '');
}

const money = (raw: unknown) => formatMoney(Math.round(Number(raw ?? 0) * 100), 'brl');

/** Month axis ticks: the long label on desktop, "set" on phones (the tooltip keeps the long one). */
function xTicks(
  theme: ReturnType<typeof getAdminChartTheme>,
  months: { month: string }[],
  compact: boolean,
) {
  return {
    color: theme.text,
    font: theme.font,
    ...(compact
      ? {
          maxRotation: 0,
          callback: (_: unknown, i: number) => (months[i] ? shortMonth(months[i].month) : ''),
        }
      : {}),
  };
}

interface ChartProps {
  months: MetricsMonth[];
  /** Phone: short month ticks, legend at the bottom. */
  compact?: boolean;
}

export function MrrChart({
  months,
  mode,
  compact = false,
}: ChartProps & { mode: 'provider' | 'plan' }) {
  useIsDark(); // subscribes to theme flips so the tokens below re-resolve on re-render
  const theme = getAdminChartTheme();
  const series = useMemo(() => revenueSeries(months, mode), [months, mode]);
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
    <Bar
      data={data}
      options={{
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            stacked: true,
            ticks: xTicks(theme, months, compact),
            grid: { display: false },
          },
          y: {
            stacked: true,
            ticks: { color: theme.text, font: theme.font },
            grid: { color: theme.grid },
          },
        },
        plugins: {
          legend: {
            position: compact ? 'bottom' : 'top',
            labels: { color: theme.text, font: theme.font },
          },
          tooltip: {
            ...theme.tooltip,
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ${money(ctx.raw)}`,
              footer: (items) =>
                months[items[0]?.dataIndex ?? -1]?.source === 'backfill' ? BACKFILL_NOTE : '',
            },
          },
        },
      }}
    />
  );
}

export function MovementBarChart({ months, compact = false }: ChartProps) {
  useIsDark();
  const theme = getAdminChartTheme();
  const s = useMemo(() => movementSeries(months), [months]);
  const axis = { ticks: { color: theme.text, font: theme.font } };
  const data = {
    labels: s.labels,
    datasets: s.bars.map((b) => ({
      label: b.label,
      data: b.data,
      backgroundColor: theme.movement[b.key],
      borderRadius: 3,
      stack: 'mov',
    })),
  };
  return (
    <Bar
      data={data}
      options={{
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            ...axis,
            ticks: xTicks(theme, s.months, compact),
            stacked: true,
            grid: { display: false },
          },
          y: { ...axis, stacked: true, grid: { color: theme.grid } },
        },
        plugins: {
          legend: {
            position: compact ? 'bottom' : 'top',
            labels: { color: theme.text, font: theme.font },
          },
          tooltip: {
            ...theme.tooltip,
            callbacks: { label: (ctx) => `${ctx.dataset.label}: ${money(ctx.raw)}` },
          },
        },
      }}
    />
  );
}

export function ChurnLineChart({ months, compact = false }: ChartProps) {
  useIsDark();
  const theme = getAdminChartTheme();
  const s = useMemo(() => movementSeries(months), [months]);
  const axis = { ticks: { color: theme.text, font: theme.font } };
  const data = {
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
    <Line
      data={data}
      options={{
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { ...axis, ticks: xTicks(theme, s.months, compact), grid: { display: false } },
          y: { ...axis, beginAtZero: true, grid: { color: theme.grid } },
        },
        plugins: {
          legend: {
            position: compact ? 'bottom' : 'top',
            labels: { color: theme.text, font: theme.font },
          },
          tooltip: theme.tooltip,
        },
      }}
    />
  );
}
