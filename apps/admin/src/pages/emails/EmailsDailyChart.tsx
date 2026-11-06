import { Bar } from 'react-chartjs-2';
import type { EmailMetricsDaily } from '../../lib/api';
import { getAdminChartTheme, useIsDark } from '../../lib/chartTheme';

/** 'YYYY-MM-DD' to 'DD/MM'. */
function dayLabel(day: string): string {
  const [, m, d] = day.slice(0, 10).split('-');
  return `${d}/${m}`;
}

/** Stacked bars per day: delivered, bounced, other. */
export function EmailsDailyChart({
  daily,
  compact = false,
}: {
  daily: EmailMetricsDaily[];
  compact?: boolean;
}) {
  useIsDark();
  const theme = getAdminChartTheme();
  const data = {
    labels: daily.map((d) => dayLabel(d.day)),
    datasets: [
      {
        label: 'Entregues',
        data: daily.map((d) => d.delivered),
        backgroundColor: theme.movement.new,
        borderRadius: 3,
        stack: 'email',
      },
      {
        label: 'Bounces',
        data: daily.map((d) => d.bounced),
        backgroundColor: theme.movement.churn,
        borderRadius: 3,
        stack: 'email',
      },
      {
        label: 'Outros',
        data: daily.map((d) => d.other),
        backgroundColor: theme.movement.past_due,
        borderRadius: 3,
        stack: 'email',
      },
    ],
  };
  return (
    <div className={compact ? 'h-56' : 'h-72'}>
      <Bar
        data={data}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            x: {
              stacked: true,
              ticks: { color: theme.text, font: theme.font, maxRotation: 0, autoSkip: true },
              grid: { display: false },
            },
            y: {
              stacked: true,
              ticks: { color: theme.text, font: theme.font, precision: 0 },
              grid: { color: theme.grid },
            },
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
    </div>
  );
}
