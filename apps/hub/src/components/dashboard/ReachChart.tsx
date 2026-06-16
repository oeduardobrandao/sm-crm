import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip } from 'chart.js';
import { Bar } from 'react-chartjs-2';
import type { DashboardReachEntry } from '../../types';

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip);

function formatAbbrev(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(n);
}

interface ReachChartProps {
  reachHistory: DashboardReachEntry[];
}

export function ReachChart({ reachHistory }: ReachChartProps) {
  const totalReach = reachHistory.reduce((sum, e) => sum + e.reach, 0);

  const labels = reachHistory.map((e) => {
    const [, m, d] = e.date.split('-');
    return `${d}/${m}`;
  });

  const maxReach = Math.max(...reachHistory.map((e) => e.reach), 1);

  const data = {
    labels,
    datasets: [
      {
        data: reachHistory.map((e) => e.reach),
        backgroundColor: reachHistory.map(
          (e) => `rgba(234, 179, 8, ${0.4 + 0.6 * (e.reach / maxReach)})`,
        ),
        borderRadius: { topLeft: 3, topRight: 3, bottomLeft: 0, bottomRight: 0 },
        borderSkipped: 'bottom' as const,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      tooltip: {
        callbacks: {
          label: (ctx: any) => {
            const entry = reachHistory[ctx.dataIndex];
            return [
              `Alcance: ${formatAbbrev(entry.reach)}`,
              `Impressões: ${formatAbbrev(entry.impressions)}`,
            ];
          },
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: {
          font: { family: 'Instrument Sans, sans-serif', size: 10 },
          color: '#9ca3af',
          maxTicksLimit: 8,
        },
      },
      y: {
        grid: { color: 'rgba(255,255,255,0.04)' },
        ticks: {
          font: { family: 'Instrument Sans, sans-serif', size: 10 },
          color: '#9ca3af',
          callback: (value: number | string) => formatAbbrev(Number(value)),
        },
      },
    },
  };

  if (reachHistory.length === 0) {
    return (
      <div className="hub-card p-5 flex items-center justify-center min-h-[260px]">
        <p className="text-sm text-stone-400">Nenhum dado de alcance disponível.</p>
      </div>
    );
  }

  return (
    <div className="hub-card p-5">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400 mb-4">
        Alcance
      </h3>
      <div className="h-[180px]">
        <Bar data={data} options={options as any} />
      </div>
      <div className="mt-3 flex items-center gap-2">
        <span className="text-lg font-bold text-stone-900 dark:text-stone-100">
          {formatAbbrev(totalReach)}
        </span>
        <span className="text-[11px] text-stone-500 dark:text-stone-400">total no período</span>
      </div>
    </div>
  );
}
