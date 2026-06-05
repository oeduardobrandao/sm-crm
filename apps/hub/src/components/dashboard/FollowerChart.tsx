import { useRef } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import type { DashboardFollowerEntry } from '../../types';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip);

function formatAbbrev(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(n);
}

interface FollowerChartProps {
  followerHistory: DashboardFollowerEntry[];
}

export function FollowerChart({ followerHistory }: FollowerChartProps) {
  const canvasRef = useRef<ChartJS<'line'>>(null);

  const labels = followerHistory.map((e) => {
    const [, m, d] = e.date.split('-');
    return `${d}/${m}`;
  });

  const dataPoints = followerHistory.map((e) => e.followerCount);

  const earliest = followerHistory.length > 0 ? followerHistory[0].followerCount : 0;
  const latest =
    followerHistory.length > 0 ? followerHistory[followerHistory.length - 1].followerCount : 0;
  const delta = earliest > 0 ? Math.round(((latest - earliest) / earliest) * 1000) / 10 : 0;

  const data = {
    labels,
    datasets: [
      {
        data: dataPoints,
        borderColor: '#eab308',
        borderWidth: 2.5,
        pointRadius: 2,
        pointBackgroundColor: 'transparent',
        pointBorderColor: '#eab308',
        pointBorderWidth: 1.5,
        fill: true,
        backgroundColor: (ctx: any) => {
          const chart = ctx.chart;
          const { ctx: canvasCtx, chartArea } = chart;
          if (!chartArea) return 'transparent';
          const gradient = canvasCtx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
          gradient.addColorStop(0, 'rgba(234, 179, 8, 0.3)');
          gradient.addColorStop(1, 'rgba(234, 179, 8, 0)');
          return gradient;
        },
        tension: 0.3,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      tooltip: {
        callbacks: {
          label: (ctx: any) => `${formatAbbrev(ctx.parsed.y)} seguidores`,
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: {
          font: { family: 'DM Mono, monospace', size: 10 },
          color: '#9ca3af',
          maxTicksLimit: 6,
        },
      },
      y: {
        grid: { color: 'rgba(255,255,255,0.04)' },
        ticks: {
          font: { family: 'DM Mono, monospace', size: 10 },
          color: '#9ca3af',
          callback: (value: number | string) => formatAbbrev(Number(value)),
        },
      },
    },
  };

  if (followerHistory.length === 0) {
    return (
      <div className="hub-card p-5 flex items-center justify-center min-h-[260px]">
        <p className="text-sm text-stone-400">Nenhum dado de seguidores disponível.</p>
      </div>
    );
  }

  return (
    <div className="hub-card p-5">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400 mb-4">
        Seguidores
      </h3>
      <div className="h-[180px]">
        <Line ref={canvasRef} data={data} options={options as any} />
      </div>
      <div className="mt-3 flex items-center gap-2">
        <span className="font-mono text-lg font-bold text-stone-900 dark:text-stone-100">
          {formatAbbrev(latest)}
        </span>
        {delta !== 0 && (
          <span
            className={`text-[11px] font-semibold px-1.5 py-0.5 rounded ${
              delta > 0 ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500'
            }`}
          >
            {delta > 0 ? '+' : ''}
            {delta}%
          </span>
        )}
      </div>
    </div>
  );
}
