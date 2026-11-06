import { useMemo } from 'react';
import { Bar, Line } from 'react-chartjs-2';
import { getAdminChartTheme, useIsDark } from '../../lib/chartTheme';

export interface DailyDataset {
  label: string;
  data: number[];
}

interface DailyChartProps {
  /** 'YYYY-MM-DD', one per point. */
  days: string[];
  datasets: DailyDataset[];
  ariaLabel: string;
}

/** '2026-10-27' to '27/10': the axis and tooltip need no year. */
function shortDay(day: string): string {
  const [, m, d] = day.split('-');
  return d && m ? `${d}/${m}` : day;
}

/** Daily series over ~90 days. One dataset draws bars (views); two draw lines (clicks and
 * impressions, whose scales differ so the second rides its own axis). */
export function DailyChart({ days, datasets, ariaLabel }: DailyChartProps) {
  useIsDark(); // re-resolve the theme tokens on a theme flip
  const theme = getAdminChartTheme();
  const labels = useMemo(() => days.map(shortDay), [days]);
  const colors = theme.categorical;
  const axisText = { color: theme.text, font: theme.font };

  const common = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index' as const, intersect: false },
    plugins: {
      legend: { display: datasets.length > 1, labels: axisText },
      tooltip: theme.tooltip,
    },
  };
  const xScale = {
    grid: { display: false },
    ticks: { ...axisText, maxRotation: 0, autoSkip: true, maxTicksLimit: 6 },
  };

  if (datasets.length > 1) {
    return (
      <Line
        aria-label={ariaLabel}
        role="img"
        data={{
          labels,
          datasets: datasets.map((d, i) => ({
            label: d.label,
            data: d.data,
            borderColor: colors[i % colors.length],
            backgroundColor: colors[i % colors.length],
            pointRadius: 0,
            borderWidth: 2,
            tension: 0.25,
            yAxisID: i === 0 ? 'y' : 'y1',
          })),
        }}
        options={{
          ...common,
          scales: {
            x: xScale,
            y: { beginAtZero: true, ticks: axisText, grid: { color: theme.grid } },
            y1: {
              beginAtZero: true,
              position: 'right',
              ticks: axisText,
              grid: { drawOnChartArea: false },
            },
          },
        }}
      />
    );
  }

  return (
    <Bar
      aria-label={ariaLabel}
      role="img"
      data={{
        labels,
        datasets: datasets.map((d) => ({
          label: d.label,
          data: d.data,
          backgroundColor: colors[0],
          borderRadius: 2,
        })),
      }}
      options={{
        ...common,
        scales: {
          x: xScale,
          y: {
            beginAtZero: true,
            ticks: { ...axisText, precision: 0 },
            grid: { color: theme.grid },
          },
        },
      }}
    />
  );
}
